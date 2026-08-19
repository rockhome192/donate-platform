import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * processWebhookEvent, with Prisma and the payment provider stubbed.
 *
 * These are the invariants that make at-least-once delivery survivable, and
 * every one of them is invisible in a happy-path manual test: the double
 * delivery, the crossed reconciler, the amount that does not match, the alert
 * that must NOT fire twice.
 */

const { dbMock, providerMock, publishMock, ttsMock } = vi.hoisted(() => ({
  dbMock: {
    webhookEvent: {
      findUnique: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    donation: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
    },
    alertSetting: { findUnique: vi.fn() },
  },
  providerMock: { name: 'mock', retrieveCharge: vi.fn() },
  publishMock: vi.fn(),
  ttsMock: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ db: dbMock, isUniqueViolation: () => false }))
vi.mock('@/lib/payments', () => ({ getPaymentProvider: () => providerMock }))
vi.mock('@/lib/realtime/publish', () => ({ publishToOverlay: publishMock }))
vi.mock('@/lib/tts', () => ({ synthesizeDonationSpeech: ttsMock }))

import { extractChargeRef, MAX_ATTEMPTS, processWebhookEvent } from '../webhooks/process'

const CHARGE = 'chrg_test_1'
const EVENT_ID = 'evnt_test_1'

function anEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: EVENT_ID,
    provider: 'omise',
    eventType: 'charge.complete',
    payload: { id: EVENT_ID, key: 'charge.complete', data: { object: 'charge', id: CHARGE } },
    receivedAt: new Date(),
    processedAt: null,
    attempts: 0,
    lastError: null,
    ...overrides,
  }
}

function aDonation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'don_1',
    streamerId: 'str_1',
    amount: 5_000,
    status: 'PENDING',
    donorName: 'ผู้ชมนิรนาม',
    message: 'สู้ ๆ',
    createdAt: new Date('2026-08-01T09:00:00.000Z'),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  dbMock.webhookEvent.findUnique.mockResolvedValue(anEvent())
  dbMock.webhookEvent.update.mockResolvedValue({})
  dbMock.donation.findFirst.mockResolvedValue(aDonation())
  dbMock.donation.updateMany.mockResolvedValue({ count: 1 })
  dbMock.donation.update.mockResolvedValue({})
  dbMock.alertSetting.findUnique.mockResolvedValue({
    minAlertAmount: 2_000,
    ttsEnabled: true,
    soundVolume: 70,
  })
  ttsMock.mockResolvedValue(null)
  providerMock.retrieveCharge.mockResolvedValue({
    status: 'successful',
    amount: 5_000,
    paidAt: new Date('2026-08-01T09:05:00.000Z'),
  })
  publishMock.mockResolvedValue(true)
})

describe('processWebhookEvent — the happy path', () => {
  it('retrieves the charge, marks the donation PAID and publishes one alert', async () => {
    const outcome = await processWebhookEvent(EVENT_ID)

    expect(outcome).toMatchObject({ result: 'processed' })
    // The charge is re-read from the provider — the payload's own "status"
    // field is never consulted. DESIGN.md 7.1.
    expect(providerMock.retrieveCharge).toHaveBeenCalledWith(CHARGE)
    expect(dbMock.donation.updateMany).toHaveBeenCalledWith({
      where: { id: 'don_1', status: 'PENDING' },
      data: { status: 'PAID', paidAt: new Date('2026-08-01T09:05:00.000Z') },
    })
    expect(publishMock).toHaveBeenCalledTimes(1)
    expect(dbMock.webhookEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ processedAt: expect.any(Date) }) }),
    )
  })

  it('counts the attempt before doing the work, not after', async () => {
    // A crash mid-flight must still burn an attempt, or a request that reliably
    // kills the runtime is retried forever.
    await processWebhookEvent(EVENT_ID)

    expect(dbMock.webhookEvent.update).toHaveBeenNthCalledWith(1, {
      where: { id: EVENT_ID },
      data: { attempts: { increment: 1 } },
    })
  })
})

describe('processWebhookEvent — idempotency', () => {
  it('does nothing for an event already processed', async () => {
    dbMock.webhookEvent.findUnique.mockResolvedValue(anEvent({ processedAt: new Date() }))

    expect(await processWebhookEvent(EVENT_ID)).toMatchObject({ result: 'noop' })
    expect(providerMock.retrieveCharge).not.toHaveBeenCalled()
    expect(dbMock.donation.updateMany).not.toHaveBeenCalled()
  })

  /**
   * The case that makes duplicate alerts impossible: the guarded update matched
   * nothing, so somebody else already settled this donation. The money is
   * recorded once and the alert belongs to whoever won the race.
   */
  it('publishes no alert when the guarded update matches zero rows', async () => {
    dbMock.donation.updateMany.mockResolvedValue({ count: 0 })

    expect(await processWebhookEvent(EVENT_ID)).toMatchObject({
      result: 'processed',
      detail: expect.stringContaining('already settled'),
    })
    expect(publishMock).not.toHaveBeenCalled()
  })
})

describe('processWebhookEvent — what must not be credited', () => {
  it('refuses to pay a donation whose provider amount differs, and parks it for review', async () => {
    providerMock.retrieveCharge.mockResolvedValue({
      status: 'successful',
      amount: 100, // paid 1 baht against a 50 baht row
      paidAt: new Date(),
    })

    const outcome = await processWebhookEvent(EVENT_ID)

    expect(outcome).toMatchObject({ result: 'review' })
    expect(dbMock.donation.updateMany).not.toHaveBeenCalled()
    expect(publishMock).not.toHaveBeenCalled()
    // Parked at the ceiling so it leaves the retry queue and lands in the
    // manual bucket — retrying cannot change what the provider says.
    expect(dbMock.webhookEvent.update).toHaveBeenLastCalledWith({
      where: { id: EVENT_ID },
      data: { attempts: MAX_ATTEMPTS, lastError: expect.stringContaining('amount mismatch') },
    })
  })

  it('leaves the event unprocessed while the charge is still pending', async () => {
    providerMock.retrieveCharge.mockResolvedValue({ status: 'pending', amount: 5_000, paidAt: null })

    expect(await processWebhookEvent(EVENT_ID)).toMatchObject({ result: 'retry' })
    expect(dbMock.donation.updateMany).not.toHaveBeenCalled()
  })

  it('marks the donation FAILED when the provider says the charge failed', async () => {
    providerMock.retrieveCharge.mockResolvedValue({ status: 'failed', amount: 5_000, paidAt: null })

    expect(await processWebhookEvent(EVENT_ID)).toMatchObject({ result: 'processed' })
    expect(dbMock.donation.updateMany).toHaveBeenCalledWith({
      where: { id: 'don_1', status: 'PENDING' },
      data: { status: 'FAILED' },
    })
    expect(publishMock).not.toHaveBeenCalled()
  })

  it('retries rather than gives up when no donation matches the charge yet', async () => {
    // Either the webhook beat our own providerRef update (heals on retry) or
    // the charge was orphaned (never heals — the attempt ceiling routes it to
    // a human). Both want the same first move.
    dbMock.donation.findFirst.mockResolvedValue(null)

    expect(await processWebhookEvent(EVENT_ID)).toMatchObject({ result: 'retry' })
  })

  it('records the error and retries when the provider call throws', async () => {
    providerMock.retrieveCharge.mockRejectedValue(new Error('omise unreachable'))

    expect(await processWebhookEvent(EVENT_ID)).toMatchObject({ result: 'retry' })
    expect(dbMock.webhookEvent.update).toHaveBeenLastCalledWith({
      where: { id: EVENT_ID },
      data: { lastError: expect.stringContaining('omise unreachable') },
    })
  })
})

describe('processWebhookEvent — alerting', () => {
  /**
   * alertedAt means "this donation's alerting is finished", not "it was shown".
   * A donation under the threshold is finished the moment it is paid; leaving
   * it NULL would park it in /missed forever and grow the partial index that
   * exists precisely to stay tiny. DESIGN.md 8.4 + changelog 2026-07-30 #1.
   */
  it('closes out a below-threshold donation instead of alerting on it', async () => {
    dbMock.donation.findFirst.mockResolvedValue(aDonation({ amount: 1_000 }))
    providerMock.retrieveCharge.mockResolvedValue({ status: 'successful', amount: 1_000, paidAt: null })

    await processWebhookEvent(EVENT_ID)

    expect(publishMock).not.toHaveBeenCalled()
    expect(dbMock.donation.updateMany).toHaveBeenCalledWith({
      where: { id: 'don_1', status: 'PENDING' },
      data: { status: 'PAID', paidAt: expect.any(Date), alertedAt: expect.any(Date) },
    })
  })

  /**
   * The reason PAID and alertedAt share ONE statement (DESIGN.md 6.2.1).
   *
   * With two separate writes, a process killed between them leaves the row PAID
   * with alertedAt NULL — and the retry cannot repair it, because the guarded
   * update now matches zero rows and returns before ever reaching the alert
   * branch. That donation then plays on the overlay despite being under the
   * streamer's threshold, and never leaves the partial index.
   */
  it('writes PAID and alertedAt in a single statement, never a follow-up update', async () => {
    dbMock.donation.findFirst.mockResolvedValue(aDonation({ amount: 1_000 }))
    providerMock.retrieveCharge.mockResolvedValue({ status: 'successful', amount: 1_000, paidAt: null })

    await processWebhookEvent(EVENT_ID)

    expect(dbMock.donation.updateMany).toHaveBeenCalledTimes(1)
    expect(dbMock.donation.update).not.toHaveBeenCalled()
  })

  it('leaves alertedAt NULL after publishing, so the overlay ack owns it', async () => {
    await processWebhookEvent(EVENT_ID)

    expect(publishMock).toHaveBeenCalledTimes(1)
    expect(dbMock.donation.updateMany).toHaveBeenCalledWith({
      where: { id: 'don_1', status: 'PENDING' },
      data: { status: 'PAID', paidAt: expect.any(Date) },
    })
    expect(dbMock.donation.update).not.toHaveBeenCalled()
  })

  /**
   * DESIGN.md 8.3.1: a publish failure must never roll back PAID. The money
   * arrived; only a screen effect was missed, and /missed collects it.
   */
  it('still completes the event when the publish fails', async () => {
    publishMock.mockResolvedValue(false)

    expect(await processWebhookEvent(EVENT_ID)).toMatchObject({ result: 'processed' })
    expect(dbMock.webhookEvent.update).toHaveBeenLastCalledWith({
      where: { id: EVENT_ID },
      data: { processedAt: expect.any(Date), lastError: null },
    })
  })
})

describe('processWebhookEvent — the voice line', () => {
  const VOICE = 'https://pub.example.com/tts/str_1/don_1.mp3'

  /**
   * The money guarantee, asserted rather than reasoned about: Azure is billed
   * per character, and every path into this function that is NOT the single
   * winner of the guarded update must reach the provider zero times.
   */
  it('synthesises once, stores the url, and sends it with the alert', async () => {
    ttsMock.mockResolvedValue(VOICE)

    await processWebhookEvent(EVENT_ID)

    expect(ttsMock).toHaveBeenCalledTimes(1)
    expect(ttsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        donationId: 'don_1',
        streamerId: 'str_1',
        message: 'สู้ ๆ',
        enabled: true,
        volume: 70,
      }),
    )
    expect(dbMock.donation.update).toHaveBeenCalledWith({
      where: { id: 'don_1' },
      data: { ttsUrl: VOICE },
    })
    expect(publishMock.mock.calls[0]![1]).toMatchObject({ data: { ttsUrl: VOICE } })
  })

  it('spends nothing on a donation somebody else already settled', async () => {
    // count 0 = a duplicate delivery, or the reconciler crossing the live
    // webhook. Both re-enter this function; neither may pay again.
    dbMock.donation.updateMany.mockResolvedValue({ count: 0 })

    await processWebhookEvent(EVENT_ID)

    expect(ttsMock).not.toHaveBeenCalled()
    expect(publishMock).not.toHaveBeenCalled()
  })

  it('spends nothing on a donation under the alert threshold', async () => {
    dbMock.donation.findFirst.mockResolvedValue(aDonation({ amount: 1_000 }))
    providerMock.retrieveCharge.mockResolvedValue({
      status: 'successful',
      amount: 1_000,
      paidAt: new Date('2026-08-01T09:05:00.000Z'),
    })

    await processWebhookEvent(EVENT_ID)

    expect(ttsMock).not.toHaveBeenCalled()
  })

  it('passes the streamer switch through rather than deciding for them', async () => {
    dbMock.alertSetting.findUnique.mockResolvedValue({
      minAlertAmount: 2_000,
      ttsEnabled: false,
      soundVolume: 70,
    })

    await processWebhookEvent(EVENT_ID)

    expect(ttsMock).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }))
  })

  it('writes nothing when there is no voice line', async () => {
    ttsMock.mockResolvedValue(null)

    await processWebhookEvent(EVENT_ID)

    expect(dbMock.donation.update).not.toHaveBeenCalled()
    expect(publishMock.mock.calls[0]![1]).toMatchObject({ data: { ttsUrl: null } })
  })

  /**
   * The regression this file exists to prevent from coming back: persisting the
   * URL is the one write here that only makes a REPLAY nicer, and an unguarded
   * throw from it used to escape to processWebhookEvent, turn the outcome into
   * 'retry' and skip the publish entirely — costing the live alert over a
   * cosmetic write, on a donation that could then never be re-alerted because
   * the guarded update had already been won.
   */
  it('still publishes the alert when persisting the url fails', async () => {
    ttsMock.mockResolvedValue(VOICE)
    dbMock.donation.update.mockRejectedValue(new Error('connection terminated'))

    const outcome = await processWebhookEvent(EVENT_ID)

    expect(outcome).toMatchObject({ result: 'processed' })
    expect(publishMock).toHaveBeenCalledTimes(1)
    // In memory, so the live alert speaks even though the row does not know.
    expect(publishMock.mock.calls[0]![1]).toMatchObject({ data: { ttsUrl: VOICE } })
  })
})

describe('extractChargeRef', () => {
  it('reads the charge id and nothing else out of the payload', () => {
    expect(extractChargeRef({ data: { object: 'charge', id: CHARGE } })).toBe(CHARGE)
    expect(extractChargeRef({ data: { id: CHARGE } })).toBe(CHARGE)
  })

  it('ignores events about other objects', () => {
    expect(extractChargeRef({ data: { object: 'refund', id: 'rfnd_1' } })).toBeNull()
    expect(extractChargeRef({ data: {} })).toBeNull()
    expect(extractChargeRef({})).toBeNull()
    expect(extractChargeRef(null)).toBeNull()
    expect(extractChargeRef('charge')).toBeNull()
  })
})
