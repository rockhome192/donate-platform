import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * settleDonation — the one write that turns money into an alert, shared by the
 * webhook path and the slip path.
 *
 * `webhook-process.test.ts` already drives this function through the gateway
 * path, but never with `extra`, because a webhook has no slip. These tests
 * cover the part only the slip path reaches, and the claim they exist to prove
 * is a single sentence: **the dedupe and the status change are ONE statement.**
 * Split into two writes, everything still passes a happy-path test and a crash
 * between them strands a donation PENDING with its slip already spent.
 */

const { dbMock, publishMock, ttsMock } = vi.hoisted(() => ({
  dbMock: {
    donation: { updateMany: vi.fn(), update: vi.fn() },
    alertSetting: { findUnique: vi.fn() },
  },
  publishMock: vi.fn(),
  ttsMock: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ db: dbMock, isUniqueViolation: () => false }))
vi.mock('@/lib/realtime/publish', () => ({ publishToOverlay: publishMock }))
vi.mock('@/lib/tts', () => ({ synthesizeDonationSpeech: ttsMock }))

import { settleDonation } from '../donations/settle'

const DONATION = {
  id: 'don_1',
  streamerId: 'str_1',
  donorName: 'rock',
  message: 'test',
  amount: 5_000,
  createdAt: new Date('2026-08-20T11:59:00.000Z'),
}

const PAID_AT = new Date('2026-08-20T12:00:00.000Z')
const TRANS_REF = '20260820ABCDEF1234'

beforeEach(() => {
  vi.clearAllMocks()
  dbMock.donation.updateMany.mockResolvedValue({ count: 1 })
  dbMock.donation.update.mockResolvedValue({})
  dbMock.alertSetting.findUnique.mockResolvedValue({
    minAlertAmount: 0,
    ttsEnabled: false,
    soundVolume: 50,
  })
  ttsMock.mockResolvedValue(null)
})

describe('the slip path — layer 2 atomicity', () => {
  it('writes slipTransRef and PAID in ONE guarded statement', async () => {
    await settleDonation(DONATION, PAID_AT, { slipTransRef: TRANS_REF })

    expect(dbMock.donation.updateMany).toHaveBeenCalledTimes(1)
    const [call] = dbMock.donation.updateMany.mock.calls
    expect(call?.[0]).toMatchObject({
      // Still guarded on PENDING: the dedupe rides along with the race, it does
      // not replace it.
      where: { id: 'don_1', status: 'PENDING' },
      data: { status: 'PAID', paidAt: PAID_AT, slipTransRef: TRANS_REF },
    })
  })

  it('lets a unique violation on that statement propagate to the caller', async () => {
    // submitSlip turns this into "this slip is spent". Swallowing it here would
    // report success for a donation that was never settled.
    dbMock.donation.updateMany.mockRejectedValue(
      Object.assign(new Error('unique'), { code: 'P2002' }),
    )
    await expect(
      settleDonation(DONATION, PAID_AT, { slipTransRef: TRANS_REF }),
    ).rejects.toMatchObject({ code: 'P2002' })
    expect(publishMock).not.toHaveBeenCalled()
  })

  it('keeps alertedAt in the same statement for a below-threshold slip donation', async () => {
    // DESIGN.md 6.2.1. Three fields, one write, no window in between.
    dbMock.alertSetting.findUnique.mockResolvedValue({
      minAlertAmount: 10_000,
      ttsEnabled: false,
      soundVolume: 50,
    })

    const outcome = await settleDonation(DONATION, PAID_AT, { slipTransRef: TRANS_REF })

    expect(outcome).toEqual({ won: true, alerted: false })
    const data = dbMock.donation.updateMany.mock.calls[0]?.[0].data
    expect(data).toMatchObject({ status: 'PAID', slipTransRef: TRANS_REF })
    expect(data.alertedAt).toBeInstanceOf(Date)
    expect(publishMock).not.toHaveBeenCalled()
  })

  it('publishes nothing when a concurrent settle already won', async () => {
    dbMock.donation.updateMany.mockResolvedValue({ count: 0 })

    const outcome = await settleDonation(DONATION, PAID_AT, { slipTransRef: TRANS_REF })

    expect(outcome).toEqual({ won: false })
    expect(publishMock).not.toHaveBeenCalled()
    expect(ttsMock).not.toHaveBeenCalled()
  })
})

describe('the gateway path is unchanged by the extra parameter', () => {
  it('omits slipTransRef entirely when none is given', async () => {
    await settleDonation(DONATION, PAID_AT)

    const data = dbMock.donation.updateMany.mock.calls[0]?.[0].data
    expect(data).not.toHaveProperty('slipTransRef')
    expect(data).toMatchObject({ status: 'PAID', paidAt: PAID_AT })
  })

  it('still alerts, and still synthesises only after winning the race', async () => {
    ttsMock.mockResolvedValue('https://r2.example/tts/a.mp3')
    dbMock.alertSetting.findUnique.mockResolvedValue({
      minAlertAmount: 0,
      ttsEnabled: true,
      soundVolume: 80,
    })

    const outcome = await settleDonation(DONATION, PAID_AT)

    expect(outcome).toEqual({ won: true, alerted: true })
    expect(ttsMock).toHaveBeenCalledOnce()
    expect(publishMock).toHaveBeenCalledWith(
      'str_1',
      expect.objectContaining({
        type: 'donation.alert',
        data: expect.objectContaining({ ttsUrl: 'https://r2.example/tts/a.mp3' }),
      }),
    )
  })
})
