import { jwtVerify } from 'jose'
import {
  TICKET_AUDIENCE,
  TICKET_CLOCK_TOLERANCE_SECONDS,
  TICKET_ISSUER,
} from '@dp/shared'

/**
 * The realtime half of the two-token overlay auth (DESIGN.md 8.3).
 *
 * This service never touches Prisma. Everything it needs to admit a socket is
 * inside the ticket apps/web signed, so an overlay can reconnect while Vercel
 * is having a bad minute, and there is only ever one service that owns the
 * schema.
 *
 * The issuer, audience and clock tolerance all come from @dp/shared — the same
 * constants apps/web signs with. If they ever drift, nothing connects, so they
 * must not be re-declared here.
 */

export type TicketResult =
  | { ok: true; streamerId: string; jti: string }
  | { ok: false; reason: 'invalid' | 'replayed' }

/**
 * Single-use enforcement for ticket `jti`s.
 *
 * KNOWN LIMIT (DESIGN.md 8.6): in memory, so single-instance only — the same
 * constraint the room registry has. If rooms ever move to a Redis backplane
 * this has to move in the same change, not later, or a replayed ticket simply
 * picks a different instance.
 */
export class SeenTickets {
  /** jti -> the ms timestamp after which it can be forgotten. */
  private seen = new Map<string, number>()

  /**
   * Records a jti and reports whether it was new.
   *
   * `forgetAfterMs` is the ticket's own exp plus the clock tolerance, not a
   * fixed TTL. Remembering only until exp would leave a replay window exactly
   * as wide as the tolerance we grant on the way in.
   */
  claim(jti: string, forgetAfterMs: number, now: number = Date.now()): boolean {
    this.prune(now)
    if (this.seen.has(jti)) return false
    this.seen.set(jti, forgetAfterMs)
    return true
  }

  /**
   * Lazy sweep on write. A timer would be more even, but entries only ever
   * live ~60s and the map is bounded by the connect rate over that window, so
   * an interval would mostly wake up to do nothing.
   */
  prune(now: number = Date.now()): void {
    for (const [jti, expiry] of this.seen) {
      if (expiry <= now) this.seen.delete(jti)
    }
  }

  get size(): number {
    return this.seen.size
  }
}

/**
 * Verifies a ticket and burns it.
 *
 * Order matters: the jti is only recorded AFTER the signature checks out.
 * Claiming first would let anyone fill the set with invented jtis by opening
 * sockets with garbage tickets — an unauthenticated write into server memory.
 */
export async function verifyTicket(
  token: string,
  secret: string,
  seen: SeenTickets,
  now: number = Date.now(),
): Promise<TicketResult> {
  if (!token) return { ok: false, reason: 'invalid' }

  let payload
  try {
    const verified = await jwtVerify(token, new TextEncoder().encode(secret), {
      issuer: TICKET_ISSUER,
      audience: TICKET_AUDIENCE,
      clockTolerance: TICKET_CLOCK_TOLERANCE_SECONDS,
      // Vercel signs HS256 and nothing else. Pinning it here is what stops an
      // "alg": "none" token, and a token signed with some other algorithm the
      // library happens to support.
      algorithms: ['HS256'],
      currentDate: new Date(now),
    })
    payload = verified.payload
  } catch {
    // Expired, wrong secret, wrong audience, tampered — all the same answer to
    // the client: get a fresh ticket. Which of them it was is not the socket's
    // business, and /ticket is where a permanent failure gets reported.
    return { ok: false, reason: 'invalid' }
  }

  const streamerId = typeof payload.sub === 'string' ? payload.sub : null
  const jti = typeof payload.jti === 'string' ? payload.jti : null
  if (!streamerId || !jti || typeof payload.exp !== 'number') {
    return { ok: false, reason: 'invalid' }
  }

  const forgetAfterMs = (payload.exp + TICKET_CLOCK_TOLERANCE_SECONDS) * 1000
  if (!seen.claim(jti, forgetAfterMs, now)) {
    return { ok: false, reason: 'replayed' }
  }

  return { ok: true, streamerId, jti }
}
