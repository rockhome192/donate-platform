import { TICKET_RATE_LIMIT, TICKET_RATE_WINDOW_SECONDS } from '@dp/shared'
import { db } from '@/lib/db'
import { env } from '@/lib/env'
import { rateLimit } from '@/lib/rate-limit'
import {
  checkOverlayGate,
  overlayTicketRateKey,
  signOverlayTicket,
} from '@/lib/realtime/ticket'

/**
 * GET /api/overlay/{token}/ticket — DESIGN.md 8.3, 8.5, 9.
 *
 * The overlay page calls this before every socket open, including every
 * reconnect, because a ticket lives 60 seconds and is single-use.
 *
 * The status code is a protocol, not decoration: 404/403 tell the client to
 * stop forever, 429 to respect Retry-After, everything else to back off and
 * return. Collapsing these into one generic error is how the earlier draft
 * produced a livelock — see the table in 8.5 before changing any of them.
 *
 * NO try/catch here, deliberately. The only throwers left are Prisma (Neon
 * unreachable) and a missing REALTIME_JWT_SECRET, and both should read as "the
 * web app is having a bad minute" — which is exactly the 500 an unhandled
 * throw already produces, and exactly the branch 8.5 maps to backoff-and-retry.
 * A catch could only change the body. The real hazard is the opposite one:
 * catching and answering 4xx would tell every overlay to give up permanently
 * over a two-second database blip, and only an OBS restart would bring them
 * back. `rateLimit` needs no guarding either — it fails open internally.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// The reply authorises a socket for the next minute. Nothing may cache it —
// not the browser, not a CDN, not OBS's CEF.
const NO_STORE = { 'cache-control': 'no-store' } as const

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params

  if (!token) {
    return Response.json({ error: 'overlay URL นี้ใช้ไม่ได้แล้ว' }, { status: 404, headers: NO_STORE })
  }

  // Rate limit BEFORE the database lookup, on purpose. The thing this limit
  // exists to survive is one client looping on one token (8.5), and checking
  // after the query would let that exact loop hit Prisma on every pass. Doing
  // it first also means a flood of guessed tokens never reaches the DB either.
  //
  // Fails open like every other limiter here (see lib/rate-limit.ts): with
  // Upstash unset in dev this always allows.
  const limit = await rateLimit(
    overlayTicketRateKey(token),
    TICKET_RATE_LIMIT,
    TICKET_RATE_WINDOW_SECONDS,
  )
  if (!limit.ok) {
    return Response.json(
      { error: 'ขอ ticket ถี่เกินไป' },
      {
        status: 429,
        headers: { ...NO_STORE, 'retry-after': String(limit.retryAfter) },
      },
    )
  }

  const streamer = await db.streamer.findUnique({
    where: { overlayToken: token },
    select: { id: true, isActive: true, isSuspended: true },
  })

  const gate = checkOverlayGate(streamer)
  if (!gate.ok) {
    return Response.json({ error: gate.error }, { status: gate.status, headers: NO_STORE })
  }

  const { ticket, expiresInSeconds } = await signOverlayTicket(
    gate.streamerId,
    env.realtimeJwtSecret,
  )

  // streamerId is not echoed back: the client never needs it (the socket's
  // `hello` carries it) and the ticket is not the place to widen what an
  // overlay URL discloses.
  return Response.json({ ticket, expiresInSeconds }, { headers: NO_STORE })
}
