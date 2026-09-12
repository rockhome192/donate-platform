import { randomUUID } from 'node:crypto'
import { TEST_ALERT_ID_PREFIX, TEST_ALERT_SAMPLE, type AlertPayload } from '@dp/shared'
import { requireStreamer, sessionErrorResponse } from '@/lib/api-session'
import { db } from '@/lib/db'
import { rateLimit } from '@/lib/rate-limit'
import { publishToOverlay } from '@/lib/realtime/publish'
import { synthesizeTestSpeech } from '@/lib/tts'

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
 *
 * ttsEnabled and soundVolume ARE consulted, which is not a contradiction: the
 * threshold is about which donations matter, while those two are the streamer
 * saying they do not want a voice at all. Speaking anyway would be testing
 * something they turned off.
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

  // The only read this endpoint makes, and only for the two settings that
  // decide whether a voice is wanted. Absent row means the Prisma defaults,
  // where ttsEnabled is false — so a streamer who has never opened the alert
  // settings gets the chime and nothing paid.
  const setting = await db.alertSetting.findUnique({
    where: { streamerId: session.streamerId },
    select: { ttsEnabled: true, soundVolume: true },
  })

  /*
    The voice line.

    This used to be a flat `ttsUrl: null` to keep the button free, which made
    the voice the one part of an alert that nobody could check before going
    live — the failure it hid, an unset speech key, looks from the streamer's
    chair exactly like a working one.

    It costs nothing per press now. The sentence is a constant, so
    synthesizeTestSpeech keys the recording by streamer, voice and sentence and
    reuses it: the first press pays ~62 characters of a 500,000-a-month free
    tier and the rest are a lookup. That is deliberate rather than lucky — a
    version that paid per press needed a budget of its own, and a budget would
    have run out mid-setup, on the day somebody is pressing test thirty times
    because they are dragging an OBS source into place.

    Null is an ordinary outcome — TTS off, volume at zero, no key configured, or
    Azure having a bad minute — and every one of them still delivers the alert.
    Testing the OBS wiring is the job; the voice is the accessory.
  */
  const ttsUrl = await synthesizeTestSpeech({
    streamerId: session.streamerId,
    enabled: setting?.ttsEnabled ?? false,
    volume: setting?.soundVolume ?? 0,
  })

  const alert: AlertPayload = {
    id: `${TEST_ALERT_ID_PREFIX}${randomUUID()}`,
    ttsUrl,
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
