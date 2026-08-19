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
  /** null = silent. A same-origin path (the bundled sound) or an https URL. */
  soundUrl: string | null
  /** 0-100. Percent, because it is a slider a person reads — see alertSettingSchema. */
  soundVolume: number
  imageUrl: string | null
  minAlertAmount: number
}

/**
 * The sound that ships with the app, so a streamer gets audio without having
 * to find and host a file first.
 *
 * A path, not a URL: it is served by the same origin as the overlay, which
 * means it cannot break when the deployment domain changes and it costs no
 * extra DNS/TLS handshake in a Browser Source that may be opening it seconds
 * before the alert needs to be heard.
 */
export const DEFAULT_ALERT_SOUND = '/sounds/alert.mp3'

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

/**
 * The exact string signed for the /internal/* routes apps/web calls on
 * apps/realtime, and the prefix its signature header carries.
 *
 * Only the FORMAT lives here, not the HMAC: this package is imported by client
 * components, so pulling `node:crypto` in through the barrel export would drag
 * it into the browser bundle. Each side applies its own `createHmac` to this
 * string — which is fine, because the algorithm is not what drifts. The layout
 * is, and a sender and receiver that disagree by one byte fail silently: every
 * alert simply stops arriving and only the /missed sweep covers it.
 *
 * `<timestamp>.<rawBody>`, not the body alone. Signing only the body leaves the
 * timestamp header unauthenticated — a replayer edits it, the signature still
 * verifies, and the freshness window guards nothing. Omise signs its own
 * webhooks this way and so does this project's webhook receiver, so all three
 * agree. DESIGN.md 8.3.1.
 */
export function internalSigningPayload(timestamp: string, rawBody: string): string {
  return `${timestamp}.${rawBody}`
}

export const INTERNAL_SIGNATURE_PREFIX = 'sha256='

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

/**
 * Rate limits on the other two overlay endpoints, per overlayToken.
 *
 * /missed is called once per successful connect, so its natural rate is the
 * reconnect rate — the same shape as /ticket, and sized the same way. /ack is
 * called once per alert finishing, which during a raid can genuinely burst, so
 * it gets more headroom: refusing an ack does not lose money, but it does leave
 * a donation in the partial index to be replayed on the next connect.
 */
export const MISSED_RATE_LIMIT = 30
export const ACK_RATE_LIMIT = 120
export const OVERLAY_RATE_WINDOW_SECONDS = 60

/**
 * Cap on one /missed response.
 *
 * The partial index (DESIGN.md 6.2.1) normally holds 0-5 rows, so this is not
 * about the usual case. It is about the one where the realtime service was down
 * for an hour: without a cap the overlay reconnects, receives every alert of
 * that hour at once, and plays a queue nobody can stop for the next twenty
 * minutes. The remainder is not lost — it stays un-acked and arrives on the
 * next fetch.
 */
export const MISSED_ALERTS_LIMIT = 25

/** Cap on one /ack body. The overlay acks one alert at a time; this is slack. */
export const ACK_MAX_IDS = 50

export const HEARTBEAT_INTERVAL_MS = 30_000

/**
 * How long the client waits for its own ping to be answered before deciding the
 * socket is dead and reconnecting.
 *
 * The server already runs a protocol-level ping (HEARTBEAT_INTERVAL_MS), which
 * covers a socket that died silently — but only from the server's side. A
 * browser tab whose connection dropped without a close frame sees nothing at
 * all, and OBS would sit there for the rest of the stream showing no alerts.
 */
export const CLIENT_PING_INTERVAL_MS = 25_000
export const CLIENT_PONG_TIMEOUT_MS = 10_000

/**
 * The one sample donation behind both the settings-page preview and
 * POST /api/me/test-alert.
 *
 * Shared so those two cannot disagree. A preview that renders a different name
 * or amount than the alert the test button actually fires is worse than no
 * preview: the streamer tunes their template against text that never appears
 * on stream.
 *
 * No id — the endpoint mints a unique one per press, because the overlay queue
 * dedupes on id and a fixed one would make every press after the first do
 * nothing.
 */
export const TEST_ALERT_SAMPLE = {
  donorName: 'ทดสอบระบบ',
  message: 'นี่คือ alert ทดสอบ ไม่ใช่โดเนทจริง',
  /** satang */
  amount: 5_000,
} as const

/**
 * Prefix on a test alert's id. Nothing branches on it — the value exists so a
 * test alert reaching POST /ack (which it does, the overlay acks everything it
 * finishes) is legible as a test rather than a donation id matching no row.
 */
export const TEST_ALERT_ID_PREFIX = 'test-'
