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

const RETRYABLE: ReadonlySet<number> = new Set([
  CloseCode.BAD_TICKET,
  CloseCode.SERVICE_RESTART,
])

export function shouldReconnect(code: number): boolean {
  // Unknown codes (network drop = 1006, etc.) are retryable; only the codes we
  // explicitly declare terminal are not.
  if (code === CloseCode.SUSPENDED || code === CloseCode.QUOTA_FULL) return false
  if (RETRYABLE.has(code)) return true
  return true
}

/** Max concurrent overlay sockets per streamer. Number 6 onward gets QUOTA_FULL. */
export const MAX_SOCKETS_PER_STREAMER = 5

/** Overlay ticket lifetime. Short because it is single-use anyway. */
export const TICKET_TTL_SECONDS = 60

export const HEARTBEAT_INTERVAL_MS = 30_000
