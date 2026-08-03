import { createHmac, timingSafeEqual } from 'node:crypto'
import { INTERNAL_SIGNATURE_PREFIX, internalSigningPayload } from '@dp/shared'

/**
 * Auth for the /internal/* routes apps/web calls (DESIGN.md 8.3.1).
 *
 * The signed layout comes from @dp/shared, which is also what
 * apps/web/src/lib/realtime/publish.ts signs with. Neither side spells the
 * format out itself, because a one-byte disagreement between sender and
 * receiver stops every alert silently.
 */

/** Rejects anything older than this. Matches the sender's own assumption. */
export const REPLAY_WINDOW_SECONDS = 300

/** Bodies here are one alert. Anything larger is not a caller we want to parse. */
export const MAX_BODY_BYTES = 64 * 1024

export type InternalAuthResult =
  | { ok: true }
  | { ok: false; status: 400 | 401; reason: string }

export function signInternalRequest(rawBody: string, timestamp: string, secret: string): string {
  const digest = createHmac('sha256', secret)
    .update(internalSigningPayload(timestamp, rawBody))
    .digest('hex')
  return `${INTERNAL_SIGNATURE_PREFIX}${digest}`
}

/**
 * Constant-time compare of two signature strings.
 *
 * `timingSafeEqual` throws on a length mismatch, which would itself leak
 * length through an exception path, so the lengths are compared first and a
 * mismatch is simply false — the value being compared is a fixed-width hex
 * digest, so its length is not a secret.
 */
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

export function verifyInternalRequest(input: {
  signature: string | undefined
  timestamp: string | undefined
  rawBody: string
  secret: string
  now?: number
}): InternalAuthResult {
  const { signature, timestamp, rawBody, secret } = input
  const now = input.now ?? Date.now()

  if (!signature || !timestamp) {
    return { ok: false, status: 400, reason: 'missing signature headers' }
  }

  const sentAt = Number(timestamp)
  if (!Number.isFinite(sentAt)) {
    return { ok: false, status: 400, reason: 'bad timestamp' }
  }

  // Both directions. A timestamp far in the future is just as much a sign of a
  // forged request as a stale one, and only checking the past leaves a caller
  // free to mint a signature that stays valid for a week.
  const skewSeconds = Math.abs(now / 1000 - sentAt)
  if (skewSeconds > REPLAY_WINDOW_SECONDS) {
    return { ok: false, status: 401, reason: 'timestamp outside replay window' }
  }

  if (!safeEqual(signature, signInternalRequest(rawBody, timestamp, secret))) {
    return { ok: false, status: 401, reason: 'bad signature' }
  }

  return { ok: true }
}

/**
 * Origin allowlist for the WebSocket handshake.
 *
 * OBS Browser Source is Chromium and does send an Origin. Browsers cannot be
 * relied on to block cross-origin WebSocket connections the way they block
 * fetch — there is no preflight — so this is the check that does it.
 *
 * Unset means allow, with a warning at boot. Refusing everything when the var
 * is missing would make a fresh dev clone look broken; refusing silently would
 * be worse. Production sets it.
 */
export function isOriginAllowed(origin: string | undefined, allowList: string | undefined): boolean {
  if (!allowList) return true
  if (!origin) return false
  const allowed = allowList
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean)
  return allowed.includes(origin.replace(/\/$/, ''))
}
