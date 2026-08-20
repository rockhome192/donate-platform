import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SlipRejectedError, SlipVerifierUnavailableError } from '../payments/slip-types'

/**
 * submitSlip — the six layers of DESIGN.md 7.3 wired together.
 *
 * `slip-checks.test.ts` proves layers 3-5 in isolation. What is on trial here
 * is the ORDER and the writes: that nothing reaches the upstream until it has
 * earned the call, that a spent slip cannot pay twice, and that our own outage
 * is never reported to a donor as a forged slip.
 */

const { dbMock, rateLimitMock, verifierMock, settleMock, envMock } = vi.hoisted(() => ({
  dbMock: { donation: { findUnique: vi.fn() } },
  rateLimitMock: vi.fn(),
  verifierMock: { name: 'fake', verify: vi.fn() },
  settleMock: vi.fn(),
  envMock: { slipDonationsEnabled: true },
}))

vi.mock('@/lib/db', () => ({
  db: dbMock,
  isUniqueViolation: (e: unknown) =>
    typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002',
}))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: rateLimitMock }))
vi.mock('@/lib/env', () => ({ env: envMock }))
vi.mock('@/lib/payments/slip', async (importOriginal) => ({
  // The real checks run — only the upstream is swapped out.
  ...(await importOriginal<typeof import('../payments/slip')>()),
  getSlipVerifier: () => verifierMock,
}))
vi.mock('@/lib/donations/settle', () => ({ settleDonation: settleMock }))

import { submitSlip } from '../donations/submit-slip'

const TRANS_REF = '20260820ABCDEF1234'

function aDonation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'don_1',
    streamerId: 'str_1',
    donorName: 'rock',
    message: 'test',
    amount: 5_000,
    status: 'PENDING',
    provider: 'SLIP',
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 10 * 60_000),
    streamer: {
      bankCode: '004',
      bankAccountLast4: '7788',
      bankAccountName: 'พชรดนัย ตั้งอั้น',
      promptPayId: '0812341112',
    },
    ...overrides,
  }
}

function goodFacts(overrides: Record<string, unknown> = {}) {
  return {
    transRef: TRANS_REF,
    amount: 5_000,
    senderBank: '014',
    receiverBankCode: '004',
    receiverAccountLast4: '7788',
    receiverAccountRaw: 'xxx-x-x7788-x',
    receiverProxyLast4: null,
    receiverProxyRaw: null,
    receiverNames: ['นาย พชรดนัย ต', 'MR. PHATCHARADANAI T'],
    transferredAt: new Date(Date.now() - 30_000),
    ...overrides,
  }
}

const INPUT = { donationId: 'don_1', slip: { qrPayload: 'x' }, clientIp: '1.2.3.4' }

beforeEach(() => {
  vi.clearAllMocks()
  envMock.slipDonationsEnabled = true
  rateLimitMock.mockResolvedValue({ ok: true, retryAfter: 0 })
  dbMock.donation.findUnique.mockResolvedValue(aDonation())
  verifierMock.verify.mockResolvedValue(goodFacts())
  settleMock.mockResolvedValue({ won: true, alerted: true })
})

describe('the happy path', () => {
  it('settles the donation and reports that the alert fired', async () => {
    await expect(submitSlip(INPUT)).resolves.toEqual({ ok: true, alerted: true })
  })

  it('claims the transRef in the SAME statement as the settle', async () => {
    // Layer 2 is only atomic if the dedupe rides along with the status change.
    // A separate claim-then-settle can crash between the two and strand the
    // donation PENDING with its slip already spent.
    await submitSlip(INPUT)
    expect(settleMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'don_1' }),
      expect.any(Date),
      { slipTransRef: TRANS_REF },
    )
  })

  it('settles at the bank transfer time, not ours', async () => {
    const transferredAt = new Date(Date.now() - 45_000)
    verifierMock.verify.mockResolvedValue(goodFacts({ transferredAt }))
    await submitSlip(INPUT)
    expect(settleMock.mock.calls[0]?.[1]).toEqual(transferredAt)
  })
})

describe('layer 6 — nothing reaches the upstream until it has earned the call', () => {
  it('stops a flood at the IP before touching the database', async () => {
    rateLimitMock.mockResolvedValue({ ok: false, retryAfter: 42 })
    const result = await submitSlip(INPUT)
    expect(result).toMatchObject({ ok: false, status: 429, retryAfter: 42 })
    expect(dbMock.donation.findUnique).not.toHaveBeenCalled()
    expect(verifierMock.verify).not.toHaveBeenCalled()
  })

  it('stops a flood at the streamer, which is really the monthly quota', async () => {
    rateLimitMock
      .mockResolvedValueOnce({ ok: true, retryAfter: 0 })
      .mockResolvedValueOnce({ ok: false, retryAfter: 900 })
    const result = await submitSlip(INPUT)
    expect(result).toMatchObject({ ok: false, status: 429 })
    expect(verifierMock.verify).not.toHaveBeenCalled()
  })
})

describe('cheap refusals never spend a verification', () => {
  it.each([
    ['an unknown donation', null, 404],
    ['a gateway donation', aDonation({ provider: 'OMISE' }), 409],
    ['one that already settled', aDonation({ status: 'PAID' }), 409],
    ['an expired one', aDonation({ expiresAt: new Date(Date.now() - 1_000) }), 409],
    [
      'a streamer with no account',
      aDonation({
        streamer: {
          bankCode: null,
          bankAccountLast4: null,
          bankAccountName: null,
          promptPayId: null,
        },
      }),
      409,
    ],
  ])('%s', async (_label, row, status) => {
    dbMock.donation.findUnique.mockResolvedValue(row)
    const result = await submitSlip(INPUT)
    expect(result).toMatchObject({ ok: false, status })
    expect(verifierMock.verify).not.toHaveBeenCalled()
    expect(settleMock).not.toHaveBeenCalled()
  })
})

describe('layer 1 — what the upstream says, and what it does not', () => {
  it('reports a slip the bank has never heard of as the donor problem', async () => {
    verifierMock.verify.mockRejectedValue(new SlipRejectedError('nope', 'not_found'))
    const result = await submitSlip(INPUT)
    expect(result).toMatchObject({ ok: false, status: 422, code: 'slip_not_found' })
    expect(settleMock).not.toHaveBeenCalled()
  })

  it.each([
    // The upstream's own dedupe firing means what ours means: 409, not a 422
    // telling the donor their slip is unreadable.
    ['duplicate', 409, 'slip_already_used'],
    // NOT 'receiver_mismatch' — that is our layer 3. This one is SlipOK
    // refusing against the account registered in its own branch, which is
    // fixed in their LINE bot, not in this app. One shared code cost three
    // rounds of debugging a check that had never run.
    ['wrong_receiver', 422, 'upstream_receiver_mismatch'],
    ['wrong_amount', 422, 'amount_mismatch'],
    ['unreadable', 422, 'slip_unreadable'],
  ] as const)('maps an upstream %s refusal to %i', async (reason, status, code) => {
    verifierMock.verify.mockRejectedValue(new SlipRejectedError('x', reason))
    const result = await submitSlip(INPUT)
    expect(result).toMatchObject({ ok: false, status, code })
    expect(settleMock).not.toHaveBeenCalled()
  })

  it('NEVER calls a slip fake because our own upstream is down', async () => {
    // 503, not 422. Telling a paying donor their genuine slip is forged
    // because SlipOK is out of quota is the worst answer available.
    verifierMock.verify.mockRejectedValue(new SlipVerifierUnavailableError('quota'))
    const result = await submitSlip(INPUT)
    expect(result).toMatchObject({ ok: false, status: 503, code: 'verifier_unavailable' })
  })

  // Each of these fails OPEN somewhere downstream if it is let through, which
  // is why the contract is enforced at the boundary rather than trusted.
  it.each([
    // formatBaht throws on a non-integer — a 500 from inside a message template.
    ['baht where the port promises satang', goodFacts({ amount: 50.5 })],
    // NaN age, and every comparison against NaN is false: layer 5 disabled.
    ['a timestamp it cannot parse', goodFacts({ transferredAt: new Date('nope') })],
    // Falsy, so the settle would drop it: layer 2's dedupe disabled.
    ['an empty transRef', goodFacts({ transRef: '' })],
  ])('refuses an upstream that returns %s', async (_label, f) => {
    verifierMock.verify.mockResolvedValue(f)
    const result = await submitSlip(INPUT)
    expect(result).toMatchObject({ ok: false, status: 503, code: 'verifier_unavailable' })
    expect(settleMock).not.toHaveBeenCalled()
  })

  it('lets an unexpected error escape rather than swallowing it', async () => {
    verifierMock.verify.mockRejectedValue(new TypeError('boom'))
    await expect(submitSlip(INPUT)).rejects.toThrow('boom')
  })
})

describe('the fake verifier never blames the donor for our configuration', () => {
  it('answers 503 when SLIP_VERIFIER=fake is handed an image', async () => {
    // What this test exists for: the fake cannot read pixels, and saying so as
    // "your slip is unreadable" told a donor who had already transferred real
    // money to retake a photo that could never work on that deployment.
    const { FakeSlipVerifier } = await import('../payments/slip-fake')
    verifierMock.verify.mockImplementation((i: unknown) =>
      new FakeSlipVerifier().verify(i as never),
    )

    const result = await submitSlip({ ...INPUT, slip: { imageBase64: 'aGk=' } })

    expect(result).toMatchObject({ ok: false, status: 503, code: 'verifier_unavailable' })
  })
})

describe('layers 3-5 refuse before anything is written', () => {
  it.each([
    ['the wrong account', goodFacts({ receiverAccountLast4: '0000' }), 'receiver_mismatch'],
    ['the wrong amount', goodFacts({ amount: 2_000 }), 'amount_mismatch'],
    [
      'a stale transfer',
      goodFacts({ transferredAt: new Date(Date.now() - 20 * 60_000) }),
      'slip_too_old',
    ],
  ])('%s', async (_label, f, code) => {
    verifierMock.verify.mockResolvedValue(f)
    const result = await submitSlip(INPUT)
    expect(result).toMatchObject({ ok: false, code })
    expect(settleMock).not.toHaveBeenCalled()
  })
})

describe('layer 2 — one slip, one donation', () => {
  it('turns the unique violation into "this slip is spent"', async () => {
    // The constraint fired because this transfer already paid for a DIFFERENT
    // donation. A SELECT-then-INSERT would lose this race, which is exactly
    // how one slip ends up paying for two.
    settleMock.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }))
    const result = await submitSlip(INPUT)
    expect(result).toMatchObject({ ok: false, status: 409, code: 'slip_already_used' })
  })

  it('answers "already settled" when a concurrent submit won the guarded update', async () => {
    settleMock.mockResolvedValue({ won: false })
    const result = await submitSlip(INPUT)
    expect(result).toMatchObject({ ok: false, status: 409, code: 'already_settled' })
  })

  it('reports a below-threshold donation as settled but not alerted', async () => {
    settleMock.mockResolvedValue({ won: true, alerted: false })
    await expect(submitSlip(INPUT)).resolves.toEqual({ ok: true, alerted: false })
  })

  it('lets a database error escape rather than reporting a spent slip', async () => {
    settleMock.mockRejectedValue(Object.assign(new Error('down'), { code: 'P1001' }))
    await expect(submitSlip(INPUT)).rejects.toThrow('down')
  })
})

describe('the deployment switch', () => {
  it('refuses before touching the database or the upstream when slips are off', async () => {
    // A donation created while the feature was on is still PENDING when it is
    // turned off. Settling one would spend a verification and credit money on
    // a deployment that has decided it takes none.
    envMock.slipDonationsEnabled = false

    const result = await submitSlip(INPUT)

    expect(result).toMatchObject({ ok: false, status: 503, code: 'slip_disabled' })
    expect(rateLimitMock).not.toHaveBeenCalled()
    expect(dbMock.donation.findUnique).not.toHaveBeenCalled()
    expect(verifierMock.verify).not.toHaveBeenCalled()
    expect(settleMock).not.toHaveBeenCalled()
  })
})
