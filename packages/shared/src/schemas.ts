import { z } from 'zod'
import { SYSTEM_MAX_SATANG, SYSTEM_MIN_SATANG } from './money'

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
