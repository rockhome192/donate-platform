import { describe, expect, it } from 'vitest'
import {
  checkSlipAgainstDonation,
  SLIP_FUTURE_SKEW_MS,
  SLIP_MAX_AGE_MS,
} from '../payments/slip-checks'
import type { SlipFacts } from '../payments/slip-types'

/**
 * Layers 3, 4 and 5 of DESIGN.md 7.3.
 *
 * Every case here is a genuine slip — the upstream has already said the
 * transfer is real. What is on trial is whether it is OURS, which is the part
 * no verification API can answer.
 */

const NOW = new Date('2026-08-20T12:00:00.000Z')

function facts(overrides: Partial<SlipFacts> = {}): SlipFacts {
  return {
    transRef: '20260820ABCDEF1234',
    amount: 5_000,
    senderBank: '014',
    receiverBankCode: '004',
    receiverAccountLast4: '7788',
    receiverName: null,
    transferredAt: new Date(NOW.getTime() - 60_000),
    ...overrides,
  }
}

const EXPECTED = { amount: 5_000, bankCode: '004', bankAccountLast4: '7788' }

describe('layer 3 — the destination account', () => {
  it('accepts a slip that landed in the streamer’s account', () => {
    expect(checkSlipAgainstDonation(facts(), EXPECTED, NOW)).toBeNull()
  })

  it('rejects a genuine slip paid to somebody else', () => {
    const result = checkSlipAgainstDonation(facts({ receiverAccountLast4: '0000' }), EXPECTED, NOW)
    expect(result?.code).toBe('receiver_mismatch')
    expect(result?.status).toBe(422)
  })

  it('rejects a matching account number at a different bank', () => {
    // Four digits collide constantly across banks; without the bank code this
    // check is a one-in-ten-thousand guess away from passing.
    const result = checkSlipAgainstDonation(facts({ receiverBankCode: '014' }), EXPECTED, NOW)
    expect(result?.code).toBe('receiver_mismatch')
  })

  it('FAILS CLOSED when the streamer has no registered account', () => {
    // The check cannot run. If that silently passed, every genuine slip in
    // Thailand would settle this streamer's donations.
    const result = checkSlipAgainstDonation(facts(), { ...EXPECTED, bankAccountLast4: null }, NOW)
    expect(result?.code).toBe('receiver_unconfigured')
    expect(result?.status).toBe(409)
  })

  it('FAILS CLOSED when the upstream cannot say where the money went', () => {
    const result = checkSlipAgainstDonation(facts({ receiverAccountLast4: null }), EXPECTED, NOW)
    // A separate code from a mismatch: this one means "send a clearer photo",
    // the other means "you paid somebody else".
    expect(result?.code).toBe('receiver_unreadable')
    expect(result?.status).toBe(422)
  })
})

describe('layer 4 — the amount', () => {
  it('rejects paying less than the donation claims', () => {
    const result = checkSlipAgainstDonation(facts({ amount: 2_000 }), EXPECTED, NOW)
    expect(result?.code).toBe('amount_mismatch')
    expect(result?.message).toContain('20.00')
  })

  it('rejects paying MORE than the donation claims', () => {
    // Not generosity to wave through: the streamer would be told a number the
    // ledger disagrees with, and the difference has nowhere to go.
    expect(checkSlipAgainstDonation(facts({ amount: 9_000 }), EXPECTED, NOW)?.code).toBe(
      'amount_mismatch',
    )
  })

  it('is checked after the account, so a wrong-account slip says so first', () => {
    const result = checkSlipAgainstDonation(
      facts({ amount: 2_000, receiverAccountLast4: '0000' }),
      EXPECTED,
      NOW,
    )
    expect(result?.code).toBe('receiver_mismatch')
  })
})

describe('layer 5 — the clock', () => {
  it('accepts a slip from just inside the window', () => {
    const transferredAt = new Date(NOW.getTime() - SLIP_MAX_AGE_MS + 1_000)
    expect(checkSlipAgainstDonation(facts({ transferredAt }), EXPECTED, NOW)).toBeNull()
  })

  it('rejects an old slip to the right account for the right amount', () => {
    // The dedupe in layer 2 only stops the same slip twice. Nothing but this
    // stops a real transfer from last month paying for a donation today.
    const transferredAt = new Date(NOW.getTime() - SLIP_MAX_AGE_MS - 1_000)
    const result = checkSlipAgainstDonation(facts({ transferredAt }), EXPECTED, NOW)
    expect(result?.code).toBe('slip_too_old')
  })

  it('tolerates a bank clock running slightly ahead of ours', () => {
    const transferredAt = new Date(NOW.getTime() + SLIP_FUTURE_SKEW_MS - 1_000)
    expect(checkSlipAgainstDonation(facts({ transferredAt }), EXPECTED, NOW)).toBeNull()
  })

  it('rejects a timestamp too far in the future to be skew', () => {
    const transferredAt = new Date(NOW.getTime() + SLIP_FUTURE_SKEW_MS + 1_000)
    expect(checkSlipAgainstDonation(facts({ transferredAt }), EXPECTED, NOW)?.code).toBe(
      'slip_from_future',
    )
  })

  it('FAILS CLOSED on a timestamp it cannot read at all', () => {
    // The subtle one. `age` becomes NaN, and every comparison against NaN is
    // false — so without an explicit guard BOTH bounds above wave the slip
    // through, and layer 5 is silently disabled rather than noisily broken.
    const result = checkSlipAgainstDonation(
      facts({ transferredAt: new Date('not a date') }),
      EXPECTED,
      NOW,
    )
    expect(result?.code).toBe('slip_unreadable_time')
  })
})
