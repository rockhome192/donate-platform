import { formatBaht, type AlertPayload } from '@dp/shared'

/**
 * The alert queue — DESIGN.md 8.2.
 *
 * Five donations arriving together must play one after another, not stack on
 * top of each other. That part is obvious. The part that is not:
 *
 * **duplicates are guaranteed, not exceptional.** Every reconnect fetches
 * /missed, and /missed returns everything not yet acked — which includes the
 * alert the socket delivered two seconds before the connection dropped, and
 * every alert whose ack did not make it out. Without dedupe the streamer sees
 * the same donation twice on screen and assumes the money was counted twice.
 *
 * Kept as a plain class rather than React state on purpose: the component holds
 * it in a ref, because a re-render must never be able to drop the queue.
 */

/**
 * How many ids the dedupe set remembers.
 *
 * Unbounded would be a slow leak across an eight-hour stream. Bounded is also
 * more correct than it looks: the only way an evicted id comes back is /missed
 * returning it, which means its ack never landed — and replaying an alert whose
 * completion was never recorded is the behaviour 8.4 actually asks for.
 */
const SEEN_LIMIT = 500

export class AlertQueue {
  /** Insertion-ordered, which is what makes the eviction below FIFO. */
  private readonly seen = new Set<string>()
  private readonly pending: AlertPayload[] = []

  /** @returns false when this id has already been queued or played. */
  push(alert: AlertPayload): boolean {
    if (this.seen.has(alert.id)) return false

    this.seen.add(alert.id)
    if (this.seen.size > SEEN_LIMIT) {
      const oldest = this.seen.values().next()
      if (!oldest.done) this.seen.delete(oldest.value)
    }

    this.pending.push(alert)
    return true
  }

  /** @returns how many of these were new. */
  pushAll(alerts: readonly AlertPayload[]): number {
    let added = 0
    for (const alert of alerts) if (this.push(alert)) added++
    return added
  }

  shift(): AlertPayload | undefined {
    return this.pending.shift()
  }

  /**
   * Drops ids from the dedupe memory so /missed can deliver them again.
   *
   * Called when the client gives up on acking them. Without this the two bounds
   * disagree in a way that loses alerts permanently: an id whose ack was
   * abandoned is still in `seen`, so the next /missed hands it back and `push`
   * silently discards it — the row stays `alertedAt IS NULL` in Postgres,
   * occupies a slot in every future /missed response, and is never shown again.
   * Forgetting it is what lets the database's own retry actually work.
   */
  forget(ids: readonly string[]): void {
    for (const id of ids) this.seen.delete(id)
  }

  get size(): number {
    return this.pending.length
  }
}

/**
 * Renders the streamer's alert template.
 *
 * Placeholders are replaced in ONE pass over the template, never by chained
 * `.replace()` calls: with chaining, a donor named `{amount}` would be
 * substituted a second time by the following replace and could put text on
 * screen that no donation contained. Unknown placeholders are left verbatim so
 * a typo in the template shows up as a typo rather than vanishing.
 *
 * No escaping happens here and none is needed — React renders the result as a
 * text node. It must never be handed to dangerouslySetInnerHTML: the donor
 * message is attacker-controlled text displayed on the streamer's own machine
 * (DESIGN.md 10, T-XSS).
 */
export function renderAlertTemplate(
  template: string,
  alert: Pick<AlertPayload, 'donorName' | 'amount'>,
): string {
  const values: Record<string, string> = {
    name: alert.donorName,
    amount: formatBaht(alert.amount),
  }
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => values[key] ?? whole)
}
