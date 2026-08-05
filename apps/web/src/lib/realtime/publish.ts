import { createHmac } from 'node:crypto'
import {
  CloseCode,
  INTERNAL_SIGNATURE_PREFIX,
  internalSigningPayload,
  type CloseCodeValue,
  type ServerMessage,
} from '@dp/shared'

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
 * With the vars unset — a fresh clone running only apps/web — the warning fires
 * once and every donation still reaches the overlay through /missed. Slower,
 * but not broken, which is what keeps the two services independently runnable.
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

/** One signed POST to an /internal route. Never throws; the caller decides. */
async function postInternal(
  route: 'publish' | 'disconnect',
  body: object,
): Promise<Response | null> {
  const cfg = config()
  if (!cfg) return null

  const rawBody = JSON.stringify(body)
  const timestamp = String(Math.floor(Date.now() / 1000))

  try {
    return await fetch(`${cfg.url}/internal/${route}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-timestamp': timestamp,
        'x-signature': signInternalRequest(rawBody, timestamp, cfg.secret),
      },
      body: rawBody,
      // This can run inside after(), on a clock the platform may cut short.
      // Keep it well under any function timeout.
      signal: AbortSignal.timeout(3_000),
      cache: 'no-store',
    })
  } catch (e) {
    console.warn(`[realtime] ${route} failed`, e)
    return null
  }
}

/**
 * @returns how many overlay sockets received it, or null when the publish did
 *          not happen at all (unconfigured, unreachable, refused).
 *
 * The two are worth telling apart even though the payment path ignores both:
 * **0 is a success**, and means the streamer simply has no overlay open. It is
 * also the single most useful thing the test-alert button can report, because
 * "nothing appeared in OBS" and "OBS is not connected" look identical on the
 * streamer's screen and have completely different fixes.
 */
export async function publishToOverlay(
  streamerId: string,
  message: ServerMessage,
): Promise<number | null> {
  const res = await postInternal('publish', { streamerId, message })
  if (!res) return null
  if (!res.ok) {
    console.warn(`[realtime] publish rejected ${res.status} for streamer ${streamerId}`)
    return null
  }
  const body = (await res.json().catch(() => null)) as { delivered?: unknown } | null
  return typeof body?.delivered === 'number' ? body.delivered : 0
}

/**
 * Kicks every overlay socket a streamer has open. DESIGN.md 9.
 *
 * Required by rotation, and it is the WS service's design that makes it so:
 * that service never touches the database (8.3), so it cannot possibly learn
 * that a token was rotated. Nobody tells it and the sockets opened with the OLD
 * token keep receiving alerts until the process happens to restart — which is
 * to say, the "rotate" button would not actually revoke anything.
 *
 * BAD_TICKET (4001) rather than a terminal code, deliberately: an overlay that
 * is still on the old URL must go ask /ticket, and it is THAT 404 which tells
 * it to stop for good (see ticketOutcome). An overlay the streamer has already
 * moved to the new URL gets a fresh ticket and comes straight back — the same
 * close code has to serve both, because from here we cannot tell them apart.
 *
 * @returns how many sockets were closed, or null when realtime is unreachable
 *          or unconfigured — the caller must not present that as "0 closed".
 */
export async function disconnectOverlays(
  streamerId: string,
  code: CloseCodeValue = CloseCode.BAD_TICKET,
): Promise<number | null> {
  const res = await postInternal('disconnect', { streamerId, code })
  if (!res?.ok) {
    if (res) console.warn(`[realtime] disconnect rejected ${res.status} for streamer ${streamerId}`)
    return null
  }
  const body = (await res.json().catch(() => null)) as { closed?: unknown } | null
  return typeof body?.closed === 'number' ? body.closed : null
}
