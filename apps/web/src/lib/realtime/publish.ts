import { createHmac } from 'node:crypto'
import { INTERNAL_SIGNATURE_PREFIX, internalSigningPayload, type ServerMessage } from '@dp/shared'

/**
 * Fire-and-forget publish from Next.js (Vercel) to the WebSocket service
 * (Railway). DESIGN.md 8.3.1.
 *
 * **A failure here must never roll back a PAID donation.** The money arrived;
 * the only thing that failed is a screen effect, and it has its own recovery
 * path — the overlay pulls `/missed` on every (re)connect, which is exactly the
 * set of PAID donations with alertedAt IS NULL. So this returns a boolean and
 * logs; it never throws into the payment pipeline.
 *
 * The receiver lands in M2a. Until then the vars are unset in dev, the warning
 * fires once, and every donation goes to the overlay through /missed instead.
 *
 * DEVIATION from 8.3.1, deliberate: the doc signs the raw body and sends the
 * timestamp beside it, which leaves the timestamp unauthenticated — a replayer
 * just edits X-Timestamp and the signature still verifies, so the 5-minute
 * window guards nothing. Signing `<timestamp>.<body>` (the scheme Omise itself
 * uses) puts the timestamp inside the MAC.
 *
 * The layout now comes from @dp/shared so the M2a verifier cannot spell it
 * differently — only the HMAC call itself lives on each side, because shared is
 * imported by client components and must not pull in node:crypto.
 */

let warnedUnconfigured = false

function config(): { url: string; secret: string } | null {
  const url = process.env.REALTIME_HTTP_URL
  const secret = process.env.REALTIME_INTERNAL_SECRET
  if (!url || !secret) {
    if (!warnedUnconfigured) {
      warnedUnconfigured = true
      console.warn(
        '[realtime] REALTIME_HTTP_URL / REALTIME_INTERNAL_SECRET unset — alerts will only ' +
          'reach the overlay through /missed (M2a not deployed yet)',
      )
    }
    return null
  }
  return { url: url.replace(/\/$/, ''), secret }
}

export function signInternalRequest(
  rawBody: string,
  timestamp: string,
  secret: string,
): string {
  const digest = createHmac('sha256', secret)
    .update(internalSigningPayload(timestamp, rawBody))
    .digest('hex')
  return `${INTERNAL_SIGNATURE_PREFIX}${digest}`
}

export async function publishToOverlay(
  streamerId: string,
  message: ServerMessage,
): Promise<boolean> {
  const cfg = config()
  if (!cfg) return false

  const rawBody = JSON.stringify({ streamerId, message })
  const timestamp = String(Math.floor(Date.now() / 1000))

  try {
    const res = await fetch(`${cfg.url}/internal/publish`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-timestamp': timestamp,
        'x-signature': signInternalRequest(rawBody, timestamp, cfg.secret),
      },
      body: rawBody,
      // This runs inside after(), on a clock the platform can cut short. Keep
      // it well under any function timeout.
      signal: AbortSignal.timeout(3_000),
      cache: 'no-store',
    })

    if (!res.ok) {
      console.warn(`[realtime] publish rejected ${res.status} for streamer ${streamerId}`)
      return false
    }
    return true
  } catch (e) {
    console.warn(`[realtime] publish failed for streamer ${streamerId} — /missed will cover it`, e)
    return false
  }
}
