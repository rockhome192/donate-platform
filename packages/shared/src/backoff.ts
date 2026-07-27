/**
 * Reconnect backoff with jitter. See DESIGN.md 8.5.
 *
 * Jitter is not decoration. Without it, a realtime deploy disconnects every
 * overlay at the same instant and they all reconnect at the same instant --
 * the server restarts straight into a thundering herd of its own making.
 */

export type BackoffOptions = {
  baseMs?: number
  maxMs?: number
  /** Injectable for tests. Must return [0, 1). */
  random?: () => number
}

/** Full range is [50%, 100%] of the capped exponential delay. */
export function backoffDelay(attempt: number, opts: BackoffOptions = {}): number {
  const { baseMs = 1_000, maxMs = 30_000, random = Math.random } = opts
  if (attempt < 0) throw new RangeError('attempt must be >= 0')

  // 2 ** attempt overflows to Infinity around attempt 1024; clamp first.
  const exponential = attempt >= 32 ? maxMs : Math.min(maxMs, baseMs * 2 ** attempt)
  return Math.round(exponential * (0.5 + random() * 0.5))
}
