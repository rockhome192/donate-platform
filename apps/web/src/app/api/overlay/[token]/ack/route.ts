import { ACK_RATE_LIMIT, OVERLAY_RATE_WINDOW_SECONDS, ackAlertsSchema } from '@dp/shared'
import { db } from '@/lib/db'
import { rateLimit } from '@/lib/rate-limit'
import { checkOverlayGate, overlayRateKey } from '@/lib/realtime/ticket'

/**
 * POST /api/overlay/{token}/ack — DESIGN.md 8.4, 9.
 *
 * The overlay reporting that it has finished playing these donations. Setting
 * `alertedAt` is what removes a row from the partial index, so this endpoint is
 * the only thing standing between /missed and an ever-growing replay list.
 *
 * `alertedAt` is the source of truth for "this one is done", NOT the client's
 * memory — OBS restarts and takes all of that with it, and the whole point of
 * 8.4 is surviving exactly that.
 *
 * Two properties matter more than anything else here:
 *
 * 1. **Scoped to the streamer that owns the token.** The ids come from an
 *    unauthenticated request body; without `streamerId` in the WHERE clause,
 *    any overlay URL could mark any other streamer's donations as shown, and
 *    those alerts would never fire. That single clause is the authorisation.
 *
 * 2. **Idempotent.** `alertedAt: null` in the WHERE means a retried ack — after
 *    a timeout the client could not distinguish from a failure — matches zero
 *    rows and changes nothing, rather than moving a timestamp that another
 *    process already set.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'cache-control': 'no-store' } as const

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params

  if (!token) {
    return Response.json({ error: 'overlay URL นี้ใช้ไม่ได้แล้ว' }, { status: 404, headers: NO_STORE })
  }

  const limit = await rateLimit(
    overlayRateKey('ack', token),
    ACK_RATE_LIMIT,
    OVERLAY_RATE_WINDOW_SECONDS,
  )
  if (!limit.ok) {
    return Response.json(
      { error: 'ส่ง ack ถี่เกินไป' },
      { status: 429, headers: { ...NO_STORE, 'retry-after': String(limit.retryAfter) } },
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'รูปแบบข้อมูลไม่ถูกต้อง' }, { status: 400, headers: NO_STORE })
  }

  const parsed = ackAlertsSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      { error: 'ข้อมูลไม่ถูกต้อง', detail: parsed.error.issues[0]?.message },
      { status: 400, headers: NO_STORE },
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

  const { count } = await db.donation.updateMany({
    where: {
      id: { in: parsed.data.donationIds },
      // Both clauses are load-bearing — see the note above.
      streamerId: gate.streamerId,
      alertedAt: null,
    },
    data: { alertedAt: new Date() },
  })

  // `acked` is reported rather than asserted: fewer than requested is the
  // NORMAL outcome for a retry, not an error, and the client must not treat it
  // as one or it will retry forever.
  return Response.json({ acked: count }, { headers: NO_STORE })
}
