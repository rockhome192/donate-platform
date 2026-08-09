import { z } from 'zod'
import { requireAdmin, sessionErrorResponse } from '@/lib/api-session'
import { db } from '@/lib/db'
import { rateLimit } from '@/lib/rate-limit'
import { disconnectOverlays, isRealtimeConfigured } from '@/lib/realtime/publish'

/**
 * PATCH /api/admin/streamers/{id} — suspend or reinstate one account.
 *
 * `isSuspended` is the only field an admin may touch, and deliberately so. An
 * endpoint that let an admin edit someone else's displayName or bounds would be
 * a second write path into the same columns /api/me/profile owns, with a
 * different set of rules — and the product has no reason for one.
 *
 * **Suspending kicks the live overlay sockets.** Without that the flag only
 * takes effect at the next /ticket request: the realtime service holds sockets
 * keyed by streamerId and never reads the database, so a suspended streamer's
 * OBS source keeps receiving alerts for as long as the socket stays up — which
 * on a healthy connection is the rest of the stream. Same reasoning as token
 * rotation; see app/api/me/overlay/rotate/route.ts.
 *
 * The donate page reads isSuspended on every render, so the public side of the
 * suspension is immediate without any of this.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'cache-control': 'no-store' } as const

const RATE_LIMIT = { requests: 30, windowSeconds: 60 }

const bodySchema = z.object({ isSuspended: z.boolean() })

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdmin()
  if (!session.ok) return sessionErrorResponse(session)

  const limit = await rateLimit(
    `admin-streamer:${session.userId}`,
    RATE_LIMIT.requests,
    RATE_LIMIT.windowSeconds,
  )
  if (!limit.ok) {
    return Response.json(
      { error: 'ดำเนินการถี่เกินไป กรุณารอสักครู่' },
      { status: 429, headers: { ...NO_STORE, 'retry-after': String(limit.retryAfter) } },
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'รูปแบบข้อมูลไม่ถูกต้อง' }, { status: 400, headers: NO_STORE })
  }

  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'ข้อมูลไม่ถูกต้อง' }, { status: 400, headers: NO_STORE })
  }

  const { id } = await params

  // updateMany rather than update: `update` on a missing id throws P2025, which
  // would have to be caught and translated anyway. This reports 0 instead.
  const result = await db.streamer.updateMany({
    where: { id },
    data: { isSuspended: parsed.data.isSuspended },
  })
  if (result.count === 0) {
    return Response.json({ error: 'ไม่พบสตรีมเมอร์รายนี้' }, { status: 404, headers: NO_STORE })
  }

  // null means "could not be told", not "nothing was open" — the admin has to
  // be able to tell those apart, because the first one means the sockets are
  // still live and still receiving alerts.
  //
  // But "could not be told" and "there is nothing to tell" also have to be
  // separated, and null covers both: with no realtime service configured — the
  // state this deployment is in until M2a ships — every suspension would
  // otherwise warn that overlays are still on air when none can be.
  const configured = isRealtimeConfigured()
  const closed = parsed.data.isSuspended && configured ? await disconnectOverlays(id) : null

  return Response.json(
    {
      isSuspended: parsed.data.isSuspended,
      closedSockets: closed,
      /** true = told, false = configured but unreachable, null = no service here. */
      realtimeReachable: !parsed.data.isSuspended ? null : configured ? closed !== null : null,
    },
    { headers: NO_STORE },
  )
}
