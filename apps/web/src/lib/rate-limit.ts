/**
 * Fixed-window rate limiter on Upstash Redis REST.
 *
 * Fail-open on purpose: if Redis is unreachable, donations keep working and the
 * incident is a logged warning, not an outage. A limiter that takes the whole
 * payment path down with it is worse than the abuse it prevents. The one place
 * this trade-off would be wrong is auth, and auth does not use this.
 *
 * Fail-open is not right everywhere, though, so every result carries a
 * `verdict` saying whether anything was actually counted. A caller where an
 * unlimited burst costs storage rather than noise -- the avatar upload -- reads
 * it and refuses to serve while the limiter is down.
 *
 * Upstash is optional in dev (see .env.example) — with no credentials every
 * check allows, and says so once at boot rather than on every request.
 */

export type RateLimitResult = {
  ok: boolean
  /** Seconds until the window resets. Only meaningful when ok === false. */
  retryAfter: number
  /**
   * Why `ok` says what it says -- the difference between "allowed" and "nothing
   * was counted", which `ok: true` alone cannot express.
   *
   *   'counted'      Redis answered. `ok` is a real verdict.
   *   'disabled'     No Upstash credentials at all (dev). Nothing was counted.
   *   'unavailable'  Configured, but the call failed. Nothing was counted.
   *
   * Most callers should keep ignoring this. 'disabled' stays permissive on
   * purpose so a dev machine with no Redis still works.
   */
  verdict: 'counted' | 'disabled' | 'unavailable'
}

const COUNTED: RateLimitResult = { ok: true, retryAfter: 0, verdict: 'counted' }
const DISABLED: RateLimitResult = { ok: true, retryAfter: 0, verdict: 'disabled' }
const UNAVAILABLE: RateLimitResult = { ok: true, retryAfter: 0, verdict: 'unavailable' }

let warnedDisabled = false

function credentials(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) {
    if (!warnedDisabled) {
      warnedDisabled = true
      console.warn('[rate-limit] UPSTASH_REDIS_REST_* unset — rate limiting is DISABLED')
    }
    return null
  }
  return { url: url.replace(/\/$/, ''), token }
}

/**
 * @param key      caller-namespaced, e.g. `donate:1.2.3.4` — never raw user input alone
 * @param limit    requests allowed per window
 * @param windowSeconds
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const creds = credentials()
  if (!creds) return DISABLED

  try {
    // INCR then EXPIRE-if-first, pipelined into one round trip. Fixed window
    // rather than sliding: one Redis key, no sorted set to trim, and being off
    // by a burst at a window boundary does not matter for this threat model.
    const res = await fetch(`${creds.url}/pipeline`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${creds.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify([
        ['INCR', key],
        ['EXPIRE', key, String(windowSeconds), 'NX'],
        ['TTL', key],
      ]),
      // A limiter must never be the slowest thing in the request.
      signal: AbortSignal.timeout(1_500),
      cache: 'no-store',
    })

    if (!res.ok) {
      console.warn(`[rate-limit] upstash responded ${res.status} — allowing`)
      return UNAVAILABLE
    }

    const body = (await res.json()) as Array<{ result?: unknown; error?: string }>
    const count = Number(body[0]?.result)
    const ttl = Number(body[2]?.result)

    if (!Number.isFinite(count)) {
      console.warn('[rate-limit] unexpected upstash payload — allowing')
      return UNAVAILABLE
    }

    if (count > limit) {
      // TTL is -1 when the key somehow has no expiry set; fall back to the full
      // window so the client is not told to retry immediately, forever.
      return { ok: false, retryAfter: ttl > 0 ? ttl : windowSeconds, verdict: 'counted' }
    }
    return COUNTED
  } catch (e) {
    console.warn('[rate-limit] upstash unreachable — allowing', e)
    return UNAVAILABLE
  }
}

/**
 * Best-effort client IP. Vercel sets x-forwarded-for and strips anything the
 * client sent, so the leftmost entry is the real peer there. Behind any other
 * proxy this is spoofable — which is why it limits abuse rather than enforcing
 * anything security-critical.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0]!.trim()
  return headers.get('x-real-ip')?.trim() || 'unknown'
}
