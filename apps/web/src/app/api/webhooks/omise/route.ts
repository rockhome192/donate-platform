import { after } from 'next/server'
import { db, isUniqueViolation } from '@/lib/db'
import { getPaymentProvider } from '@/lib/payments'
import { processWebhookEvent } from '@/lib/webhooks/process'

/**
 * POST /api/webhooks/omise — DESIGN.md 7.4
 *
 * Receive and process are split. This handler does the least it can: verify the
 * signature, write one row, answer. Everything that touches the network again
 * (retrieving the charge, publishing the alert) runs in `after()`, once the
 * response is already on its way.
 *
 * The trade that makes this correct: answering 200 fast forfeits the provider's
 * own retries, so `WebhookEvent.processedAt IS NULL` is swept by the reconciler
 * (see lib/webhooks/reconcile.ts). Without that half, a crash inside after()
 * would leave a paid donation PENDING forever.
 *
 * The route is named for Omise because that is who calls it in production. In
 * demo mode the same URL receives a MockProvider-signed synthetic event — same
 * pipeline, different signer (DESIGN.md 4.3).
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Nothing legitimate is anywhere near this large. */
const MAX_BODY_BYTES = 128 * 1024

export async function POST(req: Request) {
  // Refuse before buffering when the sender declares an oversized body. The
  // check after req.text() still has to exist — content-length is a claim, not
  // a fact — but this is what keeps an unauthenticated caller from making us
  // read the whole thing into memory first.
  const declared = Number(req.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return new Response('payload too large', { status: 413 })
  }

  // Raw text, not req.json(): the signature covers the exact bytes sent, and
  // re-serialising a parsed object does not reproduce them.
  const raw = await req.text()

  if (raw.length > MAX_BODY_BYTES) {
    return new Response('payload too large', { status: 413 })
  }

  const provider = getPaymentProvider()

  // Before any parsing, before any DB access. An unsigned request must cost us
  // one HMAC and nothing else.
  if (!provider.verifyWebhookSignature(raw, req.headers)) {
    console.warn('[webhook] rejected: bad signature')
    return new Response('invalid signature', { status: 401 })
  }

  let event: { id?: unknown; key?: unknown }
  try {
    event = JSON.parse(raw)
  } catch {
    return new Response('invalid json', { status: 400 })
  }

  const eventId = typeof event.id === 'string' ? event.id : null
  if (!eventId) {
    // The provider's event id IS our idempotency key. Without it we cannot tell
    // a replay from a new event, so there is nothing safe to do.
    return new Response('missing event id', { status: 400 })
  }

  const eventType = typeof event.key === 'string' ? event.key : 'unknown'

  try {
    await db.webhookEvent.create({
      data: {
        id: eventId,
        provider: provider.name,
        eventType,
        payload: event as object,
      },
    })
  } catch (e) {
    if (isUniqueViolation(e)) {
      // Seen before. Do NOT re-process here: the first delivery either finished
      // it or left it for the reconciler, and starting a second pass would race
      // the first over the same donation.
      return Response.json({ received: true, duplicate: true })
    }
    // A DB that cannot record the event is the one case where the provider's
    // retry is worth more than our speed — 500 asks Omise to send it again.
    console.error('[webhook] could not record event', eventId, e)
    return new Response('could not record event', { status: 500 })
  }

  after(async () => {
    try {
      await processWebhookEvent(eventId)
    } catch (e) {
      // processWebhookEvent records its own failures; this only catches the
      // unexpected, and must never surface as an unhandled rejection.
      console.error('[webhook] after() failed for', eventId, e)
    }
  })

  return Response.json({ received: true })
}
