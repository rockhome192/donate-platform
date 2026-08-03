/**
 * Wire protocol shared by apps/web (publisher) and the overlay client (consumer).
 * See DESIGN.md 8.1.
 */

export type AlertPayload = {
  /** Donation id. The client dedupes on this — reconnect + /missed WILL deliver repeats. */
  id: string
  /** Already sanitized server-side. The overlay renders it as text, never as HTML. */
  donorName: string
  message: string
  /** satang */
  amount: number
  createdAt: string
}

export type AlertSettingPayload = {
  template: string
  durationMs: number
  soundUrl: string | null
  imageUrl: string | null
  minAlertAmount: number
}

/** server -> client */
export type ServerMessage =
  | { type: 'hello'; streamerId: string; serverTime: string }
  | { type: 'donation.alert'; data: AlertPayload }
  | { type: 'settings.updated'; data: AlertSettingPayload }
  | { type: 'pong'; t: number }
  | { type: 'error'; code: string; message: string }

/** client -> server. Anything else is ignored: the socket is receive-only. */
export type ClientMessage =
  | { type: 'ping'; t: number }
  | { type: 'ack'; donationId: string }

/**
 * Close codes. 4000-4999 is the range RFC 6455 reserves for applications.
 *
 * The RETRYABLE set is the whole point of this table: a client that reconnects
 * on a terminal code spins forever. See DESIGN.md 8.1 for the 4003 livelock
 * this replaced.
 */
export const CloseCode = {
  /** ticket invalid / expired / already used -> get a fresh ticket, reconnect */
  BAD_TICKET: 4001,
  /** streamer suspended -> STOP */
  SUSPENDED: 4002,
  /** quota full; the NEWCOMER is rejected, live overlays are never evicted -> STOP */
  QUOTA_FULL: 4003,
  /** server restarting (RFC 6455 standard code) -> reconnect immediately with jitter */
  SERVICE_RESTART: 1012,
} as const

export type CloseCodeValue = (typeof CloseCode)[keyof typeof CloseCode]

/**
 * The terminal set, not the retryable one: unknown codes (network drop = 1006,
 * proxy hangup, ...) must reconnect, so listing what retries would be a list we
 * could never finish. Everything not named here comes back.
 */
const TERMINAL: ReadonlySet<number> = new Set([CloseCode.SUSPENDED, CloseCode.QUOTA_FULL])

export function shouldReconnect(code: number): boolean {
  return !TERMINAL.has(code)
}

/**
 * What to do after GET /api/overlay/{token}/ticket. See DESIGN.md 8.5.
 *
 * The close code alone cannot answer this. 4001 means both "ticket expired"
 * (transient, ask for another) and "token was rotated" (permanent, that URL is
 * dead) — and the WS server cannot tell them apart because by design it never
 * touches the DB. Only the web app knows, and it says so through this status.
 */
export type TicketOutcome =
  | { action: 'connect' }
  /** Streamer rotated the token or it never existed. The OBS URL must be replaced. */
  | { action: 'stop'; reason: 'token-invalid' }
  | { action: 'stop'; reason: 'suspended' }
  | { action: 'retry'; retryAfterMs?: number }

export function ticketOutcome(status: number, retryAfterSeconds?: number): TicketOutcome {
  if (status === 200) return { action: 'connect' }
  // 404 and 401 are the rotate case: retrying here only burns the rate limit
  // that /ticket carries for exactly this reason.
  if (status === 404 || status === 401) return { action: 'stop', reason: 'token-invalid' }
  if (status === 403) return { action: 'stop', reason: 'suspended' }
  if (status === 429) {
    return retryAfterSeconds === undefined
      ? { action: 'retry' }
      : { action: 'retry', retryAfterMs: retryAfterSeconds * 1000 }
  }
  // 5xx, network failure, anything unrecognised: the web app is having a bad
  // minute, not saying no. Back off and come back.
  return { action: 'retry' }
}

/** Max concurrent overlay sockets per streamer. Number 6 onward gets QUOTA_FULL. */
export const MAX_SOCKETS_PER_STREAMER = 5

/** Overlay ticket lifetime. Short because it is single-use anyway. */
export const TICKET_TTL_SECONDS = 60

/**
 * Issuer/audience on the ticket JWT. Both sides must agree or nothing connects.
 *
 * REALTIME_JWT_SECRET signs exactly one kind of token today, so these claims
 * are not strictly load-bearing yet. They are here because the moment a second
 * token type shares that secret, a ticket becomes a valid whatever-else — and
 * that is the sort of thing nobody remembers to add later.
 */
export const TICKET_ISSUER = 'dp-web'
export const TICKET_AUDIENCE = 'dp-realtime'

/**
 * Vercel and Railway do not share a clock. A ticket that lives 60s cannot
 * afford a generous tolerance, but zero means a second of drift rejects every
 * ticket at once — which looks exactly like an outage.
 */
export const TICKET_CLOCK_TOLERANCE_SECONDS = 5

/**
 * Rate limit on GET /api/overlay/{token}/ticket, per overlayToken (DESIGN.md 8.3).
 *
 * Sized against the client's own backoff, not against normal use: a healthy
 * overlay asks for one ticket per connect. The number that matters is what a
 * BROKEN one does — 8.5's backoff floor is 1s, so a client ignoring its own
 * rules tops out near 60/min and gets cut off, while a real reconnect storm
 * (a few tries, then 2s, 4s, 8s...) never comes close.
 */
export const TICKET_RATE_LIMIT = 30
export const TICKET_RATE_WINDOW_SECONDS = 60

export const HEARTBEAT_INTERVAL_MS = 30_000
