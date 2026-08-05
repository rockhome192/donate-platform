import { randomBytes } from 'node:crypto'
import { requireStreamer, sessionErrorResponse } from '@/lib/api-session'
import { db } from '@/lib/db'
import { env } from '@/lib/env'
import { rateLimit } from '@/lib/rate-limit'
import { disconnectOverlays } from '@/lib/realtime/publish'

/**
 * POST /api/me/overlay/rotate — DESIGN.md 4.2, 9.
 *
 * The button a streamer presses the second their overlay URL appears on stream.
 * That URL is a credential: anyone holding it can open the overlay page and
 * mint 60-second tickets, which means watching every donation as it lands.
 *
 * **Order is load-bearing: write the new token, THEN kick the sockets.**
 * Kicking first opens a window where an overlay reconnects with the old token,
 * is handed a fresh ticket, and rides out the rotation for another minute — the
 * exact minute the streamer is trying to shut down. Rotating first makes every
 * reconnect on the old token a 404 at /ticket, which the client reads as
 * terminal and stops on (ticketOutcome, 'token-invalid').
 *
 * The kick itself is not optional cleanup either. The WS service holds sockets
 * keyed by streamerId and never reads the database, so a socket opened with the
 * old token keeps receiving that streamer's alerts until the process restarts.
 * Nothing else in the system revokes it.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'cache-control': 'no-store' } as const

/** Rotating is rare and each one kicks live sockets. No reason to allow a stream of them. */
const RATE_LIMIT = { requests: 10, windowSeconds: 300 }

/**
 * 24 random bytes, base64url.
 *
 * Not `cuid()` like the column default: cuid encodes a timestamp and a counter
 * and is built to be collision-free, not unguessable, which is the wrong
 * property for a value that is the only thing protecting the overlay feed.
 * This is 192 bits from the CSPRNG.
 */
function newOverlayToken(): string {
  return randomBytes(24).toString('base64url')
}

export async function POST() {
  const session = await requireStreamer()
  if (!session.ok) return sessionErrorResponse(session)

  const limit = await rateLimit(
    `overlay-rotate:${session.streamerId}`,
    RATE_LIMIT.requests,
    RATE_LIMIT.windowSeconds,
  )
  if (!limit.ok) {
    return Response.json(
      { error: 'เปลี่ยนโทเคนถี่เกินไป กรุณารอสักครู่' },
      { status: 429, headers: { ...NO_STORE, 'retry-after': String(limit.retryAfter) } },
    )
  }

  const overlayToken = newOverlayToken()

  await db.streamer.update({
    where: { id: session.streamerId },
    data: { overlayToken, tokenRotatedAt: new Date() },
    select: { id: true },
  })

  // null means "could not be told", which is NOT the same as "nothing was
  // open". The old sockets are then still live and still receiving alerts, and
  // the streamer has to be told that in words — a green "rotated" with a dead
  // realtime service behind it is the worst outcome this endpoint can produce.
  const closed = await disconnectOverlays(session.streamerId)

  return Response.json(
    {
      overlayUrl: `${env.siteUrl}/overlay/${overlayToken}`,
      closedSockets: closed,
      realtimeReachable: closed !== null,
    },
    { headers: NO_STORE },
  )
}
