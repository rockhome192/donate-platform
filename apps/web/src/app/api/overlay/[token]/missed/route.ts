import {
  MISSED_ALERTS_LIMIT,
  MISSED_RATE_LIMIT,
  OVERLAY_RATE_WINDOW_SECONDS,
  type AlertPayload,
} from '@dp/shared'
import { db } from '@/lib/db'
import { rateLimit } from '@/lib/rate-limit'
import { checkOverlayGate, overlayRateKey } from '@/lib/realtime/ticket'

/**
 * GET /api/overlay/{token}/missed — DESIGN.md 8.4, 9.
 *
 * A WebSocket has no buffer. Drop off the network for thirty seconds and the
 * alerts published during those thirty seconds are simply gone — nothing
 * redelivers them, and the streamer never learns they existed. So the overlay
 * calls this on every `hello`, first connect and reconnect alike, and plays
 * whatever it finds.
 *
 * `alertedAt IS NULL AND status = 'PAID'` is the whole query, and it is served
 * by the hand-written partial index Donation_pending_alert_idx. `alertedAt`
 * means "the alerting of this row is FINISHED", not "it was displayed" — a
 * donation under the streamer's minAlertAmount gets it set at payment time
 * without ever being shown, because otherwise it would sit in this result
 * forever and the index would grow without bound (DESIGN.md 6.2.1).
 *
 * The status codes are the same protocol as /ticket: 404/403 mean the OBS URL
 * is dead and the client must stop, anything else means come back later. See
 * the table in 8.5 before changing one.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'cache-control': 'no-store' } as const

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params

  if (!token) {
    return Response.json({ error: 'overlay URL นี้ใช้ไม่ได้แล้ว' }, { status: 404, headers: NO_STORE })
  }

  // Before the database, for the same reason as /ticket: the thing this guards
  // against is one client looping, and checking afterwards would let that loop
  // hit Prisma on every pass.
  const limit = await rateLimit(
    overlayRateKey('missed', token),
    MISSED_RATE_LIMIT,
    OVERLAY_RATE_WINDOW_SECONDS,
  )
  if (!limit.ok) {
    return Response.json(
      { error: 'ขอ missed alerts ถี่เกินไป' },
      { status: 429, headers: { ...NO_STORE, 'retry-after': String(limit.retryAfter) } },
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

  const donations = await db.donation.findMany({
    where: { streamerId: gate.streamerId, status: 'PAID', alertedAt: null },
    // Oldest first: these are replayed in the order they were received, so a
    // viewer watching the recording sees the same sequence the chat did.
    orderBy: { createdAt: 'asc' },
    take: MISSED_ALERTS_LIMIT,
    select: { id: true, donorName: true, message: true, amount: true, createdAt: true },
  })

  const alerts: AlertPayload[] = donations.map((d) => ({
    id: d.id,
    donorName: d.donorName,
    message: d.message,
    amount: d.amount,
    createdAt: d.createdAt.toISOString(),
  }))

  return Response.json({ alerts }, { headers: NO_STORE })
}
