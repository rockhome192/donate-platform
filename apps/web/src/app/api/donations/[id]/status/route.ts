import { db } from '@/lib/db'

/**
 * GET /api/donations/{id}/status
 *
 * What the QR screen polls while it waits, and the documented fallback if the
 * WebSocket work overruns (DESIGN.md 12.1).
 *
 * Public by design: the id is a cuid the viewer was just handed, and the reply
 * carries nothing they did not type themselves. No donor name, no message, no
 * streamer details — an enumerated id must not leak somebody else's donation.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params

  const donation = await db.donation.findUnique({
    where: { id },
    select: { status: true, amount: true, expiresAt: true, paidAt: true },
  })

  if (!donation) {
    return Response.json({ error: 'ไม่พบรายการนี้' }, { status: 404 })
  }

  // Lazy expiry for the viewer's benefit only. The row is NOT written here:
  // the sweeper in the reconciler cron owns that transition, and doing it on a
  // public GET would let anyone race the webhook by polling at the right moment
  // (DESIGN.md 6.3).
  const isExpired = donation.status === 'PENDING' && donation.expiresAt.getTime() < Date.now()

  return Response.json({
    status: isExpired ? 'EXPIRED' : donation.status,
    amount: donation.amount,
    expiresAt: donation.expiresAt.toISOString(),
    paidAt: donation.paidAt?.toISOString() ?? null,
  })
}
