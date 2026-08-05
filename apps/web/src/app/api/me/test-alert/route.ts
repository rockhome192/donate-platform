import { randomUUID } from 'node:crypto'
import { TEST_ALERT_ID_PREFIX, TEST_ALERT_SAMPLE, type AlertPayload } from '@dp/shared'
import { requireStreamer, sessionErrorResponse } from '@/lib/api-session'
import { rateLimit } from '@/lib/rate-limit'
import { publishToOverlay } from '@/lib/realtime/publish'

/**
 * POST /api/me/test-alert — DESIGN.md 4.2, 9.
 *
 * "Did I paste the URL into OBS correctly?" is a question a streamer must be
 * able to answer before going live, not during their first real donation.
 *
 * Nothing is written to the database. That is the point: a test alert is not a
 * donation, and inventing a Donation row for it would put fake money in the
 * dashboard totals — the one thing DESIGN.md 0 says this project may never do.
 *
 * Two consequences follow from being unpersisted, and both are handled here:
 *
 *  - **The id must be unique per press.** AlertQueue dedupes on id, so a fixed
 *    "test" id would play once and every later press would be silently dropped
 *    — indistinguishable, from the streamer's side, from the overlay being
 *    broken.
 *  - **The id must not look like a donation id.** The overlay acks whatever it
 *    finishes playing, so this id reaches POST /ack. There it matches no row
 *    and updates nothing, which is exactly right, but the `test-` prefix means
 *    a stray ack in the logs reads as what it is rather than as a mystery.
 *
 * minAlertAmount is deliberately not consulted. The threshold decides which
 * real donations are worth interrupting a stream for; this endpoint is testing
 * the wiring, and a test that silently does nothing because of a setting the
 * streamer forgot is a worse answer than no test button at all.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'cache-control': 'no-store' } as const

/** One press is one alert on a live broadcast. Enough to test, not enough to grief with. */
const RATE_LIMIT = { requests: 10, windowSeconds: 60 }

export async function POST() {
  const session = await requireStreamer()
  if (!session.ok) return sessionErrorResponse(session)

  const limit = await rateLimit(
    `test-alert:${session.streamerId}`,
    RATE_LIMIT.requests,
    RATE_LIMIT.windowSeconds,
  )
  if (!limit.ok) {
    return Response.json(
      { error: 'ยิง alert ทดสอบถี่เกินไป กรุณารอสักครู่' },
      { status: 429, headers: { ...NO_STORE, 'retry-after': String(limit.retryAfter) } },
    )
  }

  const alert: AlertPayload = {
    id: `${TEST_ALERT_ID_PREFIX}${randomUUID()}`,
    ...TEST_ALERT_SAMPLE,
    createdAt: new Date().toISOString(),
  }

  const delivered = await publishToOverlay(session.streamerId, {
    type: 'donation.alert',
    data: alert,
  })

  if (delivered === null) {
    // 502, not 500: this app is fine, the realtime service is what did not
    // answer. Unlike a donation there is no /missed to fall back on — an
    // unpersisted alert that was not delivered is simply gone, so saying "sent"
    // here would be a lie the streamer would then act on.
    return Response.json(
      { error: 'ติดต่อเซิร์ฟเวอร์ realtime ไม่ได้ — ลองใหม่อีกครั้ง' },
      { status: 502, headers: NO_STORE },
    )
  }

  return Response.json({ delivered }, { headers: NO_STORE })
}
