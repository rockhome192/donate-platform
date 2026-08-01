import { timingSafeEqual } from 'node:crypto'
import { env } from '@/lib/env'
import { runReconcilerCycle, stuckEventCount } from '@/lib/webhooks/reconcile'

/**
 * The reconciler cycle, exposed as an endpoint. DESIGN.md 7.4 + 6.3.
 *
 * Two callers, one secret:
 *   - Vercel Cron (GET, `Authorization: Bearer $CRON_SECRET`)
 *   - apps/realtime's interval (POST, same header)
 *
 * **Vercel Cron alone is not enough on the Hobby plan** — verified 2026-08-01:
 * Hobby crons run at most once per DAY, and the every-5-minutes expression the
 * design assumed fails at deploy time with "Hobby accounts are limited to daily
 * cron jobs". A daily sweep would leave a donation whose after() crashed
 * sitting PENDING for up to 24 hours. So the real
 * every-5-minutes driver is apps/realtime, which is a long-lived process on
 * Railway and can hold an interval; the daily Vercel cron stays as the backstop
 * for when the realtime service is down.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
/** Bounded batches keep this well under the limit; the ceiling is for a bad day. */
export const maxDuration = 60

export async function GET(req: Request) {
  return handle(req)
}

export async function POST(req: Request) {
  return handle(req)
}

async function handle(req: Request) {
  if (!isAuthorized(req)) {
    return new Response('unauthorized', { status: 401 })
  }

  const started = Date.now()
  const report = await runReconcilerCycle()
  const stuck = await stuckEventCount()

  // Logged, not just returned: nobody reads a cron's response body, and this
  // number going up is the signal that a human has to look at something.
  if (stuck > 0) {
    console.error(`[reconciler] ${stuck} webhook event(s) exhausted retries and need review`)
  }

  return Response.json({ ...report, stuck, ms: Date.now() - started })
}

function isAuthorized(req: Request): boolean {
  const header = req.headers.get('authorization')
  if (!header) return false

  const expected = `Bearer ${env.cronSecret}`
  const a = Buffer.from(header)
  const b = Buffer.from(expected)
  if (a.length !== b.length) {
    timingSafeEqual(b, b)
    return false
  }
  return timingSafeEqual(a, b)
}
