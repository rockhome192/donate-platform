import { alertSettingSchema, type AlertSettingPayload } from '@dp/shared'
import { requireStreamer, sessionErrorResponse } from '@/lib/api-session'
import { db } from '@/lib/db'
import { rateLimit } from '@/lib/rate-limit'
import { publishToOverlay } from '@/lib/realtime/publish'

/**
 * PATCH /api/me/alert-setting — DESIGN.md 4.2, 9.
 *
 * Genuinely partial, as the verb promises: an absent key leaves the column
 * alone, and an explicit `null` on soundUrl/imageUrl clears it. That
 * distinction is the reason this is not a PUT — "leave the sound as it is" and
 * "remove the sound" are different requests and a whole-object write cannot
 * express both.
 *
 * The publish afterwards is what 9 calls out: without it the streamer edits
 * their template, sees the dashboard say "saved", and the alert on stream keeps
 * using the old text until they restart the OBS browser source — which nobody
 * would connect to the edit they made twenty minutes earlier.
 *
 * Upsert rather than update: the seed creates an AlertSetting, but a streamer
 * row created any other way has none, and `update` on a missing row throws
 * P2025 — a 500 on the first visit to the settings page.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'cache-control': 'no-store' } as const

/** Generous: this is a form save by an authenticated streamer, not a public route. */
const RATE_LIMIT = { requests: 30, windowSeconds: 60 }

/** Exactly the columns the overlay consumes, so the two cannot drift apart. */
const PAYLOAD_SELECT = {
  template: true,
  durationMs: true,
  soundUrl: true,
  soundVolume: true,
  imageUrl: true,
  minAlertAmount: true,
} as const

export async function PATCH(req: Request) {
  const session = await requireStreamer()
  if (!session.ok) return sessionErrorResponse(session)

  const limit = await rateLimit(
    `alert-setting:${session.streamerId}`,
    RATE_LIMIT.requests,
    RATE_LIMIT.windowSeconds,
  )
  if (!limit.ok) {
    return Response.json(
      { error: 'บันทึกถี่เกินไป กรุณารอสักครู่' },
      { status: 429, headers: { ...NO_STORE, 'retry-after': String(limit.retryAfter) } },
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'รูปแบบข้อมูลไม่ถูกต้อง' }, { status: 400, headers: NO_STORE })
  }

  const parsed = alertSettingSchema.partial().safeParse(body)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return Response.json(
      { error: 'ข้อมูลไม่ถูกต้อง', field: first?.path.join('.'), detail: first?.message },
      { status: 400, headers: NO_STORE },
    )
  }

  const patch = parsed.data
  if (Object.keys(patch).length === 0) {
    return Response.json({ error: 'ไม่มีข้อมูลที่จะบันทึก' }, { status: 400, headers: NO_STORE })
  }

  const setting = await db.alertSetting.upsert({
    where: { streamerId: session.streamerId },
    create: { streamerId: session.streamerId, ...patch },
    update: patch,
    select: PAYLOAD_SELECT,
  })

  // Best-effort, and reported rather than swallowed. A failure here is not a
  // failed save — the row is written — so the status stays 200 and the UI says
  // which half worked.
  const delivered = await publishToOverlay(session.streamerId, {
    type: 'settings.updated',
    data: setting satisfies AlertSettingPayload,
  })

  return Response.json(
    { setting, overlayNotified: delivered !== null, delivered },
    { headers: NO_STORE },
  )
}
