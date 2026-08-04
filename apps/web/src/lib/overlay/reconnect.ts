import { backoffDelay, shouldReconnect, ticketOutcome, type BackoffOptions } from '@dp/shared'

/**
 * The rules that decide whether the overlay tries again — DESIGN.md 8.5.
 *
 * Pure on purpose. Everything expensive about reconnect logic (sockets, timers,
 * a browser) makes it untestable, and reconnect logic is exactly the kind that
 * is wrong in a way you only discover during a live stream. So the DECISIONS
 * live here and the effects live in the component.
 *
 * The design's two livelocks both come from collapsing distinctions, and both
 * are guarded here:
 *
 *   - QUOTA_FULL (4003) must never retry. The server rejects the NEWCOMER
 *     rather than evicting a live overlay, so a retrying newcomer would knock
 *     on a door that is never going to open.
 *   - 4001 alone cannot decide anything. It means "ticket expired" (transient)
 *     AND "the streamer rotated their token" (permanent), and the realtime
 *     service cannot tell them apart because by design it never reads the
 *     database. So a 4001 close always leads to another /ticket call, and it is
 *     that response — 200 vs 404 — which decides retry or stop.
 */

export type StopReason = 'token-invalid' | 'suspended' | 'quota-full'

export type Decision =
  | { action: 'connect' }
  | { action: 'retry'; delayMs: number; attempt: number }
  | { action: 'stop'; reason: StopReason }

export type DecisionOptions = BackoffOptions

/**
 * What to do once a socket has closed with `code`.
 *
 * `attempt` is the count of consecutive failures so far; the returned `attempt`
 * is what the caller should carry into the next round. It resets to 0 only on a
 * `hello`, not merely on the socket opening — a socket that opens and is
 * immediately rejected has not succeeded at anything, and treating that as
 * success would reset the backoff into a tight loop.
 */
export function afterClose(code: number, attempt: number, opts: DecisionOptions = {}): Decision {
  if (!shouldReconnect(code)) {
    // 4002 and 4003. Anything unrecognised — 1006 from a dropped wifi, a proxy
    // hanging up — deliberately falls through to retry, because the terminal
    // set is the one we can enumerate and the transient set is not.
    return { action: 'stop', reason: code === 4003 ? 'quota-full' : 'suspended' }
  }
  // 1012 (server restarting) gets no special case, and that is on purpose even
  // though DESIGN.md 8.5 words it as "reconnect immediately (+jitter)". A
  // healthy overlay is at attempt 0 when a redeploy closes it — `attempt` only
  // resets on `hello` — so it already comes back in 0.5-1s, which is what the
  // doc is asking for. Special-casing the code instead of the attempt count
  // would also mean a realtime service stuck in a crash loop sends 1012 every
  // time and gets hammered at one request per second, forever.
  return { action: 'retry', delayMs: backoffDelay(attempt, opts), attempt: attempt + 1 }
}

/**
 * What to do once GET /ticket has answered `status`.
 *
 * A 429 is answered no sooner than the server asked. The floor wins over the
 * jittered backoff when it is larger, which does cost the jitter — acceptable
 * because this bucket is per overlayToken, so the most clients that can ever
 * synchronise on one Retry-After is the per-streamer socket quota, not the
 * whole fleet.
 */
export function afterTicket(
  status: number,
  retryAfterSeconds: number | undefined,
  attempt: number,
  opts: DecisionOptions = {},
): Decision {
  const outcome = ticketOutcome(status, retryAfterSeconds)

  if (outcome.action === 'connect') return { action: 'connect' }
  if (outcome.action === 'stop') return { action: 'stop', reason: outcome.reason }

  const jittered = backoffDelay(attempt, opts)
  const floor = outcome.retryAfterMs ?? 0
  return { action: 'retry', delayMs: Math.max(jittered, floor), attempt: attempt + 1 }
}

/** Copy shown on the overlay itself when it has given up. DESIGN.md 8.5. */
export const STOP_MESSAGE: Record<StopReason, string> = {
  'token-invalid': 'URL overlay นี้ถูกเปลี่ยนแล้ว — ไปคัดลอกอันใหม่จาก dashboard',
  suspended: 'บัญชีนี้ถูกระงับ overlay จึงหยุดทำงาน',
  'quota-full': 'มี overlay ของช่องนี้เปิดอยู่ครบแล้ว — ปิดหน้าต่างอื่นก่อนแล้วรีเฟรช',
}
