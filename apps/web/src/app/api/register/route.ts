import bcrypt from 'bcryptjs'
import { isHoneypotFilled, registerSchema } from '@dp/shared'
import { db, uniqueViolationTargets } from '@/lib/db'
import { clientIp, rateLimit } from '@/lib/rate-limit'

/**
 * POST /api/register — create an account and its donate page.
 *
 * Deliberately NOT under /api/auth: that path is NextAuth's catch-all. A static
 * segment does win over `[...nextauth]` in Next's router, so it would have
 * worked — but it would put one hand-written handler inside a namespace another
 * library owns, where the next person to read the route list has to know that
 * rule to tell which requests reach which code.
 *
 * One nested write, not three calls: Prisma runs a nested create inside a
 * single transaction, so there is no window in which a User exists without the
 * Streamer row that owns their page. Every screen in the console assumes that
 * pairing (see api-session.ts), and a half-created account would look exactly
 * like an admin — signed in, no streamerId, every /api/me route 403.
 *
 * **Uniqueness is decided by the database, never by a SELECT first.** Checking
 * "is this slug free?" and then inserting loses to a concurrent request that
 * asks the same question one millisecond later; both see free, one gets a 500.
 * The unique indexes on User.email and Streamer.slug already answer it
 * atomically, so this catches P2002 and reads which column it fired on.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'cache-control': 'no-store' } as const

/**
 * Per IP. Deliberately tight — an account here is free and creates a public
 * page, so this is the one endpoint on the site worth spamming.
 *
 * Note the limiter fails OPEN (see lib/rate-limit.ts): if Upstash is
 * unreachable, signup is unthrottled rather than closed. That is the right
 * trade for a demo whose worst case is junk rows in a sandbox database, and it
 * would be the wrong one for a product that pays anybody money.
 */
const RATE_LIMIT = { requests: 5, windowSeconds: 60 * 60 }

/** Matches the seed. bcryptjs is pure JS and noticeably slower than the native binding. */
const BCRYPT_ROUNDS = 10

export async function POST(req: Request) {
  const ip = clientIp(req.headers)
  const limit = await rateLimit(`register:${ip}`, RATE_LIMIT.requests, RATE_LIMIT.windowSeconds)
  if (!limit.ok) {
    return Response.json(
      { error: 'สมัครถี่เกินไป กรุณารอสักครู่แล้วลองใหม่' },
      { status: 429, headers: { ...NO_STORE, 'retry-after': String(limit.retryAfter) } },
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'รูปแบบข้อมูลไม่ถูกต้อง' }, { status: 400, headers: NO_STORE })
  }

  // Before Zod, and that ordering is the whole point — see isHoneypotFilled.
  // The answer is deliberately the same shapeless 400 the donation route gives,
  // with no field and no reason.
  if (isHoneypotFilled(body)) {
    return Response.json({ error: 'ข้อมูลไม่ถูกต้อง' }, { status: 400, headers: NO_STORE })
  }

  const parsed = registerSchema.safeParse(body)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return Response.json(
      { error: first?.message ?? 'ข้อมูลไม่ถูกต้อง', field: first?.path.join('.') },
      { status: 400, headers: NO_STORE },
    )
  }

  const { email, password, displayName, slug } = parsed.data

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS)

  try {
    await db.user.create({
      data: {
        email,
        passwordHash,
        role: 'STREAMER',
        streamer: {
          create: {
            slug,
            displayName,
            // Empty rather than absent: every /dashboard/alerts visit upserts
            // this row anyway, and creating it here means the overlay has a
            // template from the first second the account exists.
            alertSetting: { create: {} },
          },
        },
      },
      select: { id: true },
    })
  } catch (e) {
    const targets = uniqueViolationTargets(e)
    if (targets.includes('email')) {
      return Response.json(
        { error: 'อีเมลนี้ถูกใช้ไปแล้ว', field: 'email' },
        { status: 409, headers: NO_STORE },
      )
    }
    if (targets.includes('slug')) {
      return Response.json(
        { error: 'ลิงก์นี้มีคนใช้แล้ว ลองชื่ออื่น', field: 'slug' },
        { status: 409, headers: NO_STORE },
      )
    }
    throw e
  }

  // No session is issued here. The client signs in with the same credentials
  // straight afterwards, which keeps NextAuth the only thing that ever mints a
  // token — a second code path that hands out sessions is a second code path
  // that can hand one out wrongly.
  return Response.json({ ok: true, slug }, { status: 201, headers: NO_STORE })
}
