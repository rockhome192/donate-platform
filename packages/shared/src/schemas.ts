import { z } from 'zod'
import { SYSTEM_MAX_SATANG, SYSTEM_MIN_SATANG } from './money'
import { ACK_MAX_IDS } from './realtime'

/**
 * Slugs a streamer may never own, because a static route in apps/web already
 * answers that URL.
 *
 * A streamer page is `/{slug}` at the ROOT of the app, so it competes with
 * every top-level route the product will ever add. Give someone the slug
 * `dashboard` and their donate page is unreachable forever -- Next.js resolves
 * the static segment first, and nothing anywhere errors or warns. It just
 * quietly serves the wrong page.
 *
 * Only lowercase alphanumeric-with-dash names need listing. Next's own
 * reserved paths (`_next`, `favicon.ico`, `.well-known`) contain characters the
 * slug regex already rejects, so adding them here would be decoration.
 *
 * Names the app does not use YET are deliberately included. Reserving a word
 * costs nothing today; taking it back once a streamer owns it means breaking
 * their links.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  // live routes
  'api',
  'dashboard',
  'login',
  'overlay',
  // reserved for later
  'about',
  'account',
  'admin',
  'auth',
  'billing',
  'contact',
  'docs',
  'help',
  'legal',
  'logout',
  'payouts',
  'pricing',
  'privacy',
  'register',
  'settings',
  'signup',
  'static',
  'support',
  'terms',
  'webhooks',
])

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug.trim().toLowerCase())
}

/**
 * The one definition of a streamer slug. Anywhere a slug is accepted -- a
 * donation request today, streamer signup when it exists -- uses this, so the
 * reserved list cannot be enforced in one place and forgotten in another.
 */
export const streamerSlugSchema = z
  .string()
  .trim()
  .min(3)
  .max(30)
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'slug must be lowercase letters, digits and dashes')
  .refine((slug) => !isReservedSlug(slug), 'slug นี้เป็นคำสงวนของระบบ')

/**
 * Layer 1 validation only: shape and absolute system bounds.
 *
 * This schema CANNOT enforce Streamer.minAmount / maxAmount -- it has no idea
 * which streamer the request is for. That is layer 2, after the streamer row is
 * loaded. See DESIGN.md 7.1.1. Skipping layer 2 means T7 (1-baht spam) is not
 * actually prevented.
 */
export const createDonationSchema = z.object({
  slug: streamerSlugSchema,
  donorName: z.string().trim().min(1).max(40),
  // Empty message is fine -- plenty of people donate without saying anything.
  message: z.string().trim().max(200).default(''),
  amount: z
    .number()
    .int('amount must be an integer number of satang')
    .min(SYSTEM_MIN_SATANG)
    .max(SYSTEM_MAX_SATANG),
  /** Honeypot: real users never fill this. Same trick as the portfolio contact form. */
  website: z.string().max(0).optional(),
})

export type CreateDonationInput = z.infer<typeof createDonationSchema>

/**
 * Body of POST /api/overlay/{token}/ack — the overlay reporting that it has
 * finished playing these donations (DESIGN.md 8.4).
 *
 * A batch rather than one id per request, because the failure this endpoint
 * exists to survive is the network going away: on reconnect the overlay may
 * have several finished-but-unreported alerts in hand, and one request that
 * either lands or does not is easier to reason about than five that might
 * partially land.
 */
export const ackAlertsSchema = z.object({
  donationIds: z
    .array(z.string().trim().min(1).max(60))
    .min(1)
    .max(ACK_MAX_IDS)
    // The route turns this into a single `id IN (...)` update, and a repeated
    // id there is silently harmless — but it also means a client could pad a
    // body to the cap with one id repeated. Cheap to refuse.
    .refine((ids) => new Set(ids).size === ids.length, 'donationIds ต้องไม่ซ้ำกัน'),
})

export type AckAlertsInput = z.infer<typeof ackAlertsSchema>

/**
 * Password rules for registration.
 *
 * The 72-BYTE ceiling is bcrypt's, not a product decision: every bcrypt
 * implementation — bcryptjs included — silently ignores everything past byte 72
 * of the input. Left unchecked, two different long passwords can hash to the
 * same value and the user is never told, which is the worst possible way to
 * find out. Bytes, not characters, because Thai is 3 bytes per character in
 * UTF-8: 24 Thai characters already reach the limit.
 */
export const passwordSchema = z
  .string()
  .min(8, 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร')
  .max(200, 'รหัสผ่านยาวเกินไป')
  .refine(
    (p) => new TextEncoder().encode(p).length <= 72,
    'รหัสผ่านยาวเกินไป (ระบบเข้ารหัสรองรับสูงสุด 72 ไบต์)',
  )

/**
 * POST /api/register — NOT /api/auth/register, which is NextAuth's catch-all.
 *
 * A signup creates a User AND the Streamer row that owns the donate page, so
 * the slug is chosen here rather than later — there is no state in this product
 * where an account exists without a page.
 *
 * Email is trimmed and lowercased BEFORE validation: `User.email` is unique and
 * case-sensitive in Postgres, so without this "Demo@x.com" and "demo@x.com"
 * become two accounts and the second one can never sign in as the first.
 */
export const registerSchema = z.object({
  email: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
    z.email('อีเมลไม่ถูกต้อง').max(200),
  ),
  password: passwordSchema,
  displayName: z.string().trim().min(1, 'กรุณากรอกชื่อที่แสดง').max(40),
  slug: streamerSlugSchema,
  // No `website` honeypot field here, unlike createDonationSchema. The form runs
  // this schema client-side to show inline errors, and a `max(0)` field would
  // turn a browser autofilling an off-screen input labelled "Website" into
  // "Too big: expected string to have <=0 characters" — English, in a Thai form,
  // pointing at a control at left:-9999px that the user cannot find or clear.
  // Signup would be impossible with no visible cause. The honeypot is checked
  // on the raw body by the route instead, via isHoneypotFilled.
})

export type RegisterInput = z.infer<typeof registerSchema>

/**
 * Real people never fill this field; it is off-screen and has no label they can
 * see.
 *
 * **Every route that has a honeypot must call this BEFORE its Zod parse.** A
 * schema rejects a filled honeypot too, but with a field name and a reason
 * attached — which hands a bot the exact input to leave alone next time, and in
 * a Thai UI it surfaces as an untranslated Zod string blaming a control the user
 * cannot see. Shared rather than copied per route so the two cannot drift.
 */
export function isHoneypotFilled(body: unknown): boolean {
  return (
    typeof body === 'object' &&
    body !== null &&
    'website' in body &&
    Boolean((body as { website?: unknown }).website)
  )
}

/**
 * A per-donation bound, in satang, reported in baht.
 *
 * `toBaht` is not used here: this module is imported by client components and
 * the message is a constant, so the division is done once at module load
 * rather than per parse.
 */
function satangBound(label: string) {
  const minBaht = (SYSTEM_MIN_SATANG / 100).toLocaleString('th-TH')
  const maxBaht = (SYSTEM_MAX_SATANG / 100).toLocaleString('th-TH')
  return z
    .number()
    .int(`${label}ต้องเป็นจำนวนเต็มสตางค์`)
    .min(SYSTEM_MIN_SATANG, `${label}ต้องไม่ต่ำกว่า ${minBaht} บาท`)
    .max(SYSTEM_MAX_SATANG, `${label}ต้องไม่เกิน ${maxBaht} บาท`)
}

/**
 * PATCH /api/me/profile — the streamer's own public identity.
 *
 * Partial-able by the route (`.partial()`), so an absent key means "leave it
 * alone". `bio` accepts null to clear it; the rest are required when present.
 *
 * minAmount/maxAmount are the streamer's own layer-2 bounds and are checked
 * against each other in the route, not here — a partial patch may carry only
 * one of the two, and this schema cannot see the stored value of the other.
 */
export const profileSchema = z.object({
  displayName: z.string().trim().min(1, 'กรุณากรอกชื่อที่แสดง').max(40),
  slug: streamerSlugSchema,
  bio: z.string().trim().max(300).nullable(),
  avatarUrl: z.url().max(500).nullable(),
  // Thai messages, because these are the two fields a streamer can realistically
  // push past the system bounds, and Zod's default "Too big: expected number to
  // be <=10000000" is both English and in satang — two units and one language
  // away from anything the person typing baht into the form can act on.
  minAmount: satangBound('ยอดขั้นต่ำ'),
  maxAmount: satangBound('ยอดสูงสุด'),
})

export type ProfileInput = z.infer<typeof profileSchema>

export const alertSettingSchema = z.object({
  template: z.string().trim().min(1).max(120),
  durationMs: z.number().int().min(2_000).max(20_000),
  soundUrl: z.string().url().max(500).nullable(),
  imageUrl: z.string().url().max(500).nullable(),
  ttsEnabled: z.boolean(),
  minAlertAmount: z.number().int().min(0).max(SYSTEM_MAX_SATANG),
  profanityFilter: z.boolean(),
})

export type AlertSettingInput = z.infer<typeof alertSettingSchema>
