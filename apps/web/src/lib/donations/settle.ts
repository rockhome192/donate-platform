import { db } from '@/lib/db'
import { publishToOverlay } from '@/lib/realtime/publish'
import { synthesizeDonationSpeech } from '@/lib/tts'

/**
 * Moving a donation to PAID, exactly once, and everything that follows from
 * winning that race.
 *
 * Extracted from the webhook pipeline (DESIGN.md 7.4) when the slip path
 * arrived, because both need the identical sequence and duplicating it is how
 * the two drift: the guarded update, the below-threshold alertedAt rule, the
 * cost-controlled TTS call, the best-effort publish. A second copy would have
 * to re-derive every comment below, and the one it got wrong would be invisible
 * until a donation went missing on stream.
 *
 * The caller decides WHETHER the money arrived. This decides what that means.
 */

export type SettleableDonation = {
  id: string
  streamerId: string
  donorName: string
  message: string
  /** satang */
  amount: number
  createdAt: Date
}

export type SettleOutcome =
  /** This call moved the row. `alerted` is false when it was below threshold. */
  | { won: true; alerted: boolean }
  /** Somebody else moved it first — a duplicate delivery, or the reconciler. */
  | { won: false }

/**
 * @param extra Written in the SAME statement as the settle, never after it.
 *   The slip path uses this to claim `slipTransRef`, which is what makes the
 *   dedupe atomic: a separate claim-then-settle can crash between the two and
 *   strand the donation PENDING with its slip already spent, unrecoverable by
 *   retry because the second attempt sees the ref taken. A unique-constraint
 *   violation from this propagates to the caller.
 */
export async function settleDonation(
  donation: SettleableDonation,
  paidAt: Date,
  extra?: { slipTransRef?: string },
): Promise<SettleOutcome> {
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
      paidAt,
      // "alerting is finished", not "it was shown" (DESIGN.md 8.4). A donation
      // under the threshold is finished the moment it is paid; one over it
      // stays NULL until the overlay acks having played it.
      ...(belowThreshold ? { alertedAt: new Date() } : {}),
      ...(extra?.slipTransRef ? { slipTransRef: extra.slipTransRef } : {}),
    },
  })

  if (count === 0) {
    // The money is recorded exactly once and the alert belongs to whoever won,
    // so this path publishes nothing.
    return { won: false }
  }

  if (belowThreshold) return { won: true, alerted: false }

  /*
    The voice line, if this streamer wants one.

    It happens HERE — after the guarded update, in the branch that only the
    winner reaches — and that placement is the whole cost control. Duplicate
    deliveries and the reconciler both re-enter this path; synthesising before
    the update would pay Azure again for every one of them. The URL is stored on
    the row so a replay through /missed says the same sentence without a second
    call.

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
    // The overlay plays the voice line at the alert-sound volume, so a streamer
    // sitting at 0% would be billed for a sentence played into a muted element.
    // Nothing to hear, nothing to synthesise.
    volume: setting?.soundVolume ?? 0,
  })

  if (ttsUrl) {
    // Not part of the settle update: that one is a race the row must win
    // exactly once, and adding a slow network call before it would widen the
    // window it is there to close.
    //
    // `.catch` for the same reason every other non-critical write here has one,
    // and this is the worst place to have learned it: an unguarded throw
    // escapes to the caller, turns a webhook outcome into 'retry', and skips
    // the publish below — and the retry then loses the guarded update (already
    // PAID) and returns "no alert". The donation would wait for the overlay's
    // next reconnect to appear at all, over a failure in the one write that
    // only makes a REPLAY nicer.
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

  return { won: true, alerted: true }
}
