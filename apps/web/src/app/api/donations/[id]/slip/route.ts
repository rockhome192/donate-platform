import { submitSlipSchema } from '@dp/shared'
import { submitSlip } from '@/lib/donations/submit-slip'
import { clientIp } from '@/lib/rate-limit'

/**
 * POST /api/donations/{id}/slip — DESIGN.md 7.3
 *
 * Deliberately thin. Every decision worth making about a slip lives in
 * `submitSlip`, where it can be tested without a Request: this file parses,
 * hands over, and translates the answer into a status code.
 *
 * Public on purpose — the person who transferred the money is a viewer, not a
 * signed-in streamer, so there is no session to require. What stands in for
 * one is that the donation id is a cuid nobody can enumerate, and that layers
 * 3, 4 and 5 make a slip useless against any donation but the one it paid for.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'รูปแบบข้อมูลไม่ถูกต้อง' }, { status: 400 })
  }

  const parsed = submitSlipSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'ข้อมูลสลิปไม่ถูกต้อง' }, { status: 400 })
  }

  const result = await submitSlip({
    donationId: id,
    slip: parsed.data,
    clientIp: clientIp(req.headers),
  })

  if (result.ok) {
    // `alerted` is not a detail: a donation under the streamer's alert
    // threshold is paid and finished without ever reaching the overlay, and a
    // page that says "watch the stream!" to that donor is lying to them.
    return Response.json({ status: 'PAID', alerted: result.alerted }, { status: 200 })
  }

  return Response.json(
    { error: result.message, code: result.code },
    {
      status: result.status,
      ...(result.retryAfter === undefined
        ? {}
        : { headers: { 'retry-after': String(result.retryAfter) } }),
    },
  )
}
