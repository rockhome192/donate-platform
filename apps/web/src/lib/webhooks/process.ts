import type { PaymentProvider as PaymentProviderEnum } from '@prisma/client'
import { db } from '@/lib/db'
import { getPaymentProvider } from '@/lib/payments'
import { publishToOverlay } from '@/lib/realtime/publish'
import { synthesizeDonationSpeech } from '@/lib/tts'

/**
 * The second half of the webhook: what actually happens once we have said 200.
 * DESIGN.md 7.4.
 *
 * Two rules shape everything here.
 *
 * 1. **Never trust the payload.** The event body is an untrusted claim that
 *    something happened. The charge is re-read from the provider and THAT is
 *    what decides the donation's fate (DESIGN.md 7.1). This is why the event
 *    type barely matters below: whatever Omise says happened, we go and look.
 *
 * 2. **Every write is idempotent.** Answering the provider early gave up its
 *    retries, so we run our own (the reconciler), which means this function is
 *    re-entered on purpose. Status changes go through
 *    `updateMany({ where: { id, status: 'PENDING' } })` and the row count is
 *    the answer to "was it me who moved it" — 0 means somebody already did,
 *    and no alert may fire twice (DESIGN.md 6.3).
 */

/** After this many failures the event stops retrying and waits for a human. */
export const MAX_ATTEMPTS = 5

export type ProcessOutcome =
  /** Terminal. processedAt is set; the reconciler will not pick it up again. */
  | { result: 'processed'; detail: string }
  /** Left unprocessed on purpose — the reconciler tries again in ~5 minutes. */
  | { result: 'retry'; detail: string }
  /** Terminal in the other direction: parked at MAX_ATTEMPTS for manual review. */
  | { result: 'review'; detail: string }
  | { result: 'noop'; detail: string }

export async function processWebhookEvent(eventId: string): Promise<ProcessOutcome> {
  const event = await db.webhookEvent.findUnique({ where: { id: eventId } })

  if (!event) {
    // after() racing the insert cannot produce this — the insert is awaited
    // before after() is scheduled. So it means somebody deleted the row.
    console.warn(`[webhook] event ${eventId} not found`)
    return { result: 'noop', detail: 'event not found' }
  }
  if (event.processedAt) {
    return { result: 'noop', detail: 'already processed' }
  }

  // Count the attempt before doing the work, not after. A process killed
  // mid-flight must still burn an attempt, or a request that reliably crashes
  // the runtime is retried forever.
  await db.webhookEvent.update({
    where: { id: eventId },
    data: { attempts: { increment: 1 } },
  })

  let outcome: ProcessOutcome
  try {
    outcome = await handleEvent(event.id, event.provider, event.payload)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error(`[webhook] event ${eventId} failed`, e)
    await db.webhookEvent
      .update({ where: { id: eventId }, data: { lastError: message.slice(0, 500) } })
      .catch(() => {})
    return { result: 'retry', detail: message }
  }

  if (outcome.result === 'processed') {
    await db.webhookEvent.update({
      where: { id: eventId },
      data: { processedAt: new Date(), lastError: null },
    })
  } else if (outcome.result === 'review') {
    // Not an error we can retry our way out of. Park it at the attempt ceiling
    // so it drops out of the reconciler queue and shows up in the manual bucket
    // (DESIGN.md 7.4 item 5) instead of inventing a new state for it.
    await db.webhookEvent.update({
      where: { id: eventId },
      data: { attempts: MAX_ATTEMPTS, lastError: outcome.detail.slice(0, 500) },
    })
  } else if (outcome.result === 'retry') {
    await db.webhookEvent
      .update({ where: { id: eventId }, data: { lastError: outcome.detail.slice(0, 500) } })
      .catch(() => {})
  }

  return outcome
}

/**
 * The charge id is the only thing we read out of the payload — see rule 1.
 * Omise puts the affected object in `data`, so `data.id` for a charge event.
 */
export function extractChargeRef(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null
  const data = (payload as { data?: unknown }).data
  if (typeof data !== 'object' || data === null) return null

  const object = (data as { object?: unknown }).object
  if (typeof object === 'string' && object !== 'charge') return null

  const id = (data as { id?: unknown }).id
  return typeof id === 'string' && id.length > 0 ? id : null
}

async function handleEvent(
  eventId: string,
  eventProvider: string,
  payload: unknown,
): Promise<ProcessOutcome> {
  const providerRef = extractChargeRef(payload)
  if (!providerRef) {
    // A subscription we did not ask for, or a shape we do not model. Nothing to
    // reconcile, so it is done — not an error and not worth a retry.
    return { result: 'processed', detail: 'event carries no charge id — ignored' }
  }

  const providerEnum: PaymentProviderEnum = eventProvider === 'mock' ? 'MOCK' : 'OMISE'

  // findFirst, not findUnique: (provider, providerRef) is unique in the DB —
  // that constraint is what makes this a single row — but providerRef is
  // nullable, which makes the generated compound-unique input awkward to type.
  const donation = await db.donation.findFirst({
    where: { provider: providerEnum, providerRef },
    select: { id: true, streamerId: true, amount: true, status: true, donorName: true, message: true, createdAt: true },
  })

  if (!donation) {
    // Two ways to get here: the webhook beat our own `UPDATE ... providerRef`
    // (a real race), or the charge was orphaned by that update failing. The
    // first heals itself on retry, the second never does — so retry, and let
    // the attempt ceiling route it to a human.
    return { result: 'retry', detail: `no donation for ${providerEnum} charge ${providerRef}` }
  }

  const provider = getPaymentProvider()
  const charge = await provider.retrieveCharge(providerRef)

  if (charge.status === 'pending') {
    // The provider has not settled it yet. Our own retry loop is the right
    // place to wait, not a sleep inside this call.
    return { result: 'retry', detail: `charge ${providerRef} still pending at provider` }
  }

  if (charge.status === 'failed') {
    const { count } = await db.donation.updateMany({
      where: { id: donation.id, status: 'PENDING' },
      data: { status: 'FAILED' },
    })
    return {
      result: 'processed',
      detail: count === 1 ? 'donation marked FAILED' : 'donation already settled — no change',
    }
  }

  // charge.status === 'successful' from here down.

  if (charge.amount !== donation.amount) {
    // Never credit an amount we did not ask for, in either direction. The row
    // stays PENDING and the sweeper will expire it, which is the safe way to be
    // wrong: a donation that is not credited can be fixed by hand, one that is
    // credited for the wrong amount has already lied to the streamer.
    console.error(
      `[webhook] AMOUNT MISMATCH — event=${eventId} donation=${donation.id} ` +
        `expected=${donation.amount} provider=${charge.amount}`,
    )
    return {
      result: 'review',
      detail: `amount mismatch: donation ${donation.amount} vs provider ${charge.amount}`,
    }
  }

  // Read the threshold BEFORE the update, so the decision can ride along in the
  // same statement. DESIGN.md 6.2.1 requires alertedAt to be set in the same
  // transaction as PAID for a below-threshold donation, and the reason is a
  // crash exactly between two separate writes: the row would be PAID with
  // alertedAt NULL, the retry's guarded update would match zero rows and skip
  // the alert branch entirely, and that donation would then sit in /missed
  // forever — played on the overlay despite being under the streamer's
  // minAlertAmount, and never leaving the partial index.
  const setting = await db.alertSetting.findUnique({
    where: { streamerId: donation.streamerId },
    select: { minAlertAmount: true, ttsEnabled: true, soundVolume: true },
  })
  const belowThreshold = donation.amount < (setting?.minAlertAmount ?? 0)

  const { count } = await db.donation.updateMany({
    where: { id: donation.id, status: 'PENDING' },
    data: {
      status: 'PAID',
      paidAt: charge.paidAt ?? new Date(),
      // "alerting is finished", not "it was shown" (DESIGN.md 8.4). A donation
      // under the threshold is finished the moment it is paid; one over it
      // stays NULL until the overlay acks having played it.
      ...(belowThreshold ? { alertedAt: new Date() } : {}),
    },
  })

  if (count === 0) {
    // Somebody else already moved it — a duplicate delivery, or the reconciler
    // and the live webhook crossing. The money is recorded exactly once and the
    // alert belongs to whoever won, so this path publishes nothing.
    return { result: 'processed', detail: 'donation already settled — no alert' }
  }

  if (belowThreshold) {
    return { result: 'processed', detail: 'donation marked PAID — below alert threshold' }
  }

  /*
    The voice line, if this streamer wants one.

    It happens HERE — after the guarded update, in the branch that only the
    winner reaches — and that placement is the whole cost control. Duplicate
    deliveries and the reconciler both re-enter this function; synthesising
    before the update would pay Azure again for every one of them. The URL is
    stored on the row so a replay through /missed says the same sentence
    without a second call.

    Failures return null rather than throwing, so a donation is never left
    unannounced because a speech API was down.
  */
  const ttsUrl = await synthesizeDonationSpeech({
    donationId: donation.id,
    streamerId: donation.streamerId,
    donorName: donation.donorName,
    message: donation.message,
    amount: donation.amount,
    enabled: setting?.ttsEnabled ?? false,
    // The overlay plays the voice line at the alert-sound volume, so a
    // streamer sitting at 0% would be billed for a sentence that is played
    // into a muted element. Nothing to hear, nothing to synthesise.
    volume: setting?.soundVolume ?? 0,
  })

  if (ttsUrl) {
    // Not part of the settle update: that one is a race the row must win
    // exactly once, and adding a slow network call before it would widen the
    // window it is there to close.
    //
    // `.catch` for the same reason every other non-critical write in this file
    // has one, and this is the worst place to have learned it: an unguarded
    // throw here escapes to processWebhookEvent, turns the outcome into
    // 'retry', and skips the publish below — and the retry then loses the
    // guarded update (already PAID) and returns "no alert". The donation would
    // wait for the overlay's next reconnect to appear at all, over a failure
    // in the one write that only makes a REPLAY nicer.
    await db.donation
      .update({ where: { id: donation.id }, data: { ttsUrl } })
      .catch((e) => console.error(`[tts] could not persist url for ${donation.id}:`, e))
  }

  // Best-effort by design: a publish failure must not undo PAID (DESIGN.md
  // 8.3.1). The overlay pulls this donation from /missed on its next connect.
  await publishToOverlay(donation.streamerId, {
    type: 'donation.alert',
    data: {
      id: donation.id,
      donorName: donation.donorName,
      message: donation.message,
      amount: donation.amount,
      createdAt: donation.createdAt.toISOString(),
      ttsUrl,
    },
  })

  return { result: 'processed', detail: 'donation marked PAID' }
}
