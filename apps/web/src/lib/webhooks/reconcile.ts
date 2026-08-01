import { db } from '@/lib/db'
import { MAX_ATTEMPTS, processWebhookEvent } from './process'

/**
 * The compensating job for answering the provider 200 before doing the work.
 * DESIGN.md 7.4 + 6.3.
 *
 * Two tasks, one cycle, and the order between them is load-bearing.
 */

/** Rows per cycle. Caps how much work is picked up — see DEADLINE_MS for how long it may take. */
const BATCH = 25

/**
 * Wall-clock budget for one cycle.
 *
 * BATCH alone does not bound the runtime: each event can call the payment
 * provider, whose own timeout is 15s, so 25 slow events would be 375s against a
 * route declaring maxDuration = 60. Being killed mid-event is survivable (the
 * attempt is already counted and the next cycle picks it up) but it costs the
 * caller its response, and it happens exactly when the provider is degraded —
 * the worst moment to lose visibility. Stopping early and saying so is better.
 */
const DEADLINE_MS = 45_000

/**
 * How long after expiresAt a PENDING donation may still be rescued.
 *
 * A viewer paying at the last second produces a webhook that arrives after
 * expiresAt has passed. Sweeping on the exact boundary would stamp EXPIRED over
 * a donation whose money is already in — and the PAID update, guarded on
 * `status = 'PENDING'`, would then quietly match zero rows.
 */
const EXPIRY_GRACE_MS = 2 * 60_000

export type ReconcileReport = {
  picked: number
  processed: number
  retried: number
  parked: number
  /** Events picked but left untouched because the cycle ran out of budget. */
  skipped: number
  expired: number
}

export async function runReconcilerCycle(now: Date = new Date()): Promise<ReconcileReport> {
  // Reconcile FIRST. Sweeping first can expire a donation whose webhook is
  // sitting unprocessed in this very batch — the exact bug the grace period
  // above is the second line of defence against. DESIGN.md 6.3.
  const events = await reconcileWebhookEvents()
  const expired = await sweepExpiredDonations(now)

  return { ...events, expired }
}

export async function reconcileWebhookEvents(
  deadline: number = Date.now() + DEADLINE_MS,
): Promise<Omit<ReconcileReport, 'expired'>> {
  const pending = await db.webhookEvent.findMany({
    where: { processedAt: null, attempts: { lt: MAX_ATTEMPTS } },
    // Oldest first: a stuck event should not be starved by fresher ones, and
    // charges settle in roughly the order they were made.
    orderBy: { receivedAt: 'asc' },
    take: BATCH,
    select: { id: true },
  })

  const report = { picked: pending.length, processed: 0, retried: 0, parked: 0, skipped: 0 }

  for (const [index, { id }] of pending.entries()) {
    if (Date.now() >= deadline) {
      // Out of budget. These events keep processedAt NULL and their attempt
      // counts untouched, so the next cycle starts on exactly this row.
      report.skipped = pending.length - index
      console.warn(`[reconciler] deadline reached — ${report.skipped} event(s) left for next cycle`)
      break
    }

    // Sequential on purpose. These calls hit the payment provider, and a
    // parallel burst against a gateway that is already slow is how a retry
    // storm starts.
    const outcome = await processWebhookEvent(id).catch((e) => {
      console.error(`[reconciler] event ${id} threw`, e)
      return { result: 'retry' as const, detail: 'threw' }
    })

    if (outcome.result === 'processed' || outcome.result === 'noop') report.processed += 1
    else if (outcome.result === 'review') report.parked += 1
    else report.retried += 1
  }

  return report
}

/**
 * PENDING -> EXPIRED for donations nobody paid. This is the only place that
 * transition happens: doing it lazily on a public GET would let anyone race the
 * webhook by polling at the right moment (DESIGN.md 6.3).
 *
 * Served by the [status, expiresAt] index declared in the schema.
 */
export async function sweepExpiredDonations(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - EXPIRY_GRACE_MS)

  const { count } = await db.donation.updateMany({
    where: { status: 'PENDING', expiresAt: { lt: cutoff } },
    data: { status: 'EXPIRED' },
  })

  return count
}

/** Events that exhausted their retries and need a human. Surfaced by the cron route. */
export async function stuckEventCount(): Promise<number> {
  return db.webhookEvent.count({
    where: { processedAt: null, attempts: { gte: MAX_ATTEMPTS } },
  })
}
