import { createHash, randomUUID } from 'node:crypto'
import { SignJWT } from 'jose'
import {
  TICKET_AUDIENCE,
  TICKET_ISSUER,
  TICKET_TTL_SECONDS,
} from '@dp/shared'

/**
 * The web half of the two-token overlay auth (DESIGN.md 8.3).
 *
 * `overlayToken` is long-lived and sits in a URL the streamer regularly shows
 * on stream by accident. It buys nothing except this: a 60-second, single-use
 * JWT that opens one socket. The realtime service verifies that JWT offline, so
 * it never needs Prisma and never needs Vercel to be up.
 *
 * Everything here is pure except the clock and the RNG, both injectable, so the
 * unit tests need no database — which is the rule for this suite (DESIGN.md 11.2).
 */

export type OverlayGateInput = {
  id: string
  isActive: boolean
  isSuspended: boolean
} | null

export type OverlayGate =
  | { ok: true; streamerId: string }
  | { ok: false; status: 404 | 403; error: string }

/**
 * Maps streamer state to the status codes in DESIGN.md 8.5.
 *
 * The client reads the STATUS, not the close code, to decide whether to keep
 * trying — 4001 means both "ticket expired" and "token was rotated" and the WS
 * server cannot tell them apart. So every branch here is really an instruction:
 * 404 and 403 mean stop forever, anything else means come back.
 *
 * `isActive === false` deliberately still gets a ticket. It is the streamer's
 * own "my page is closed right now" switch, and no donation can be created
 * while it is off — so the socket connects and simply has nothing to carry.
 * Refusing here would mean 403 (terminal), and re-opening the page would leave
 * the overlay dead until the streamer restarted OBS. Suspension is different:
 * it is an admin action the streamer cannot undo, so stopping is correct.
 */
export function checkOverlayGate(streamer: OverlayGateInput): OverlayGate {
  // Also the rotate case: the old token no longer matches any row.
  if (!streamer) {
    return { ok: false, status: 404, error: 'overlay URL นี้ใช้ไม่ได้แล้ว' }
  }
  if (streamer.isSuspended) {
    return { ok: false, status: 403, error: 'บัญชีนี้ถูกระงับ' }
  }
  return { ok: true, streamerId: streamer.id }
}

/**
 * Rate-limit bucket for one overlayToken.
 *
 * Hashed, not raw. The token is a credential, and an unhashed key would print
 * it in every Redis key listing, slow-query log and metrics label that ever
 * touches this bucket. Truncating to 32 hex chars is 128 bits — far past what a
 * counter key needs to stay collision-free.
 */
export function overlayTicketRateKey(overlayToken: string): string {
  const digest = createHash('sha256').update(overlayToken).digest('hex')
  return `overlay-ticket:${digest.slice(0, 32)}`
}

export type IssuedTicket = {
  ticket: string
  expiresInSeconds: number
  /** Returned for logging and tests; the client has no use for it. */
  jti: string
}

/**
 * Signs the ticket. HS256 because both sides are ours and share one secret —
 * an asymmetric key would buy nothing and add a distribution problem.
 */
export async function signOverlayTicket(
  streamerId: string,
  secret: string,
  clock: { now?: () => number; jti?: () => string } = {},
): Promise<IssuedTicket> {
  const nowSeconds = Math.floor((clock.now?.() ?? Date.now()) / 1000)
  const jti = clock.jti?.() ?? randomUUID()

  const ticket = await new SignJWT({})
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(TICKET_ISSUER)
    .setAudience(TICKET_AUDIENCE)
    .setSubject(streamerId)
    .setJti(jti)
    .setIssuedAt(nowSeconds)
    .setExpirationTime(nowSeconds + TICKET_TTL_SECONDS)
    .sign(new TextEncoder().encode(secret))

  return { ticket, expiresInSeconds: TICKET_TTL_SECONDS, jti }
}
