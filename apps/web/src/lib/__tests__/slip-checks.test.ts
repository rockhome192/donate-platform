import { describe, expect, it } from 'vitest'
import {
  checkSlipAgainstDonation,
  lastFourDigits,
  SLIP_FUTURE_SKEW_MS,
  SLIP_MAX_AGE_MS,
} from '../payments/slip-checks'
import { nameMatches } from '../payments/slip-checks'
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
    receiverAccountRaw: 'xxx-x-x7788-x',
    receiverProxyLast4: null,
    receiverProxyRaw: null,
    receiverNames: ['นาย พชรดนัย ต', 'MR. PHATCHARADANAI T'],
    transferredAt: new Date(NOW.getTime() - 60_000),
    ...overrides,
  }
}

const EXPECTED = {
  amount: 5_000,
  bankCode: '004',
  bankAccountLast4: '7788',
  promptPayLast4: '1112',
  accountName: 'พชรดนัย ตั้งอั้น',
}

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

describe('layer 3 — a PromptPay slip names no account at all', () => {
  /**
   * The shape the first real slip actually came back in: no receiving bank, no
   * receiving account, the destination in the proxy. Checking accounts alone
   * meant layer 3 could never pass for the payment method this app's own QR
   * tells every donor to use.
   */
  function promptPayFacts(overrides: Partial<SlipFacts> = {}): SlipFacts {
    return facts({
      receiverBankCode: '',
      receiverAccountLast4: null,
      receiverAccountRaw: '',
      receiverProxyLast4: '1112',
      receiverProxyRaw: 'xxx-xxx-1112',
      ...overrides,
    })
  }

  it('accepts one paid to the streamer’s own PromptPay number', () => {
    expect(checkSlipAgainstDonation(promptPayFacts(), EXPECTED, NOW)).toBeNull()
  })

  it('rejects one paid to a different PromptPay number', () => {
    const result = checkSlipAgainstDonation(
      promptPayFacts({ receiverProxyLast4: '9999' }),
      EXPECTED,
      NOW,
    )
    expect(result?.code).toBe('receiver_mismatch')
  })

  it('FAILS CLOSED when the slip names neither an account nor a proxy', () => {
    const result = checkSlipAgainstDonation(
      promptPayFacts({ receiverProxyLast4: null, receiverProxyRaw: '' }),
      EXPECTED,
      NOW,
    )
    expect(result?.code).toBe('receiver_unreadable')
  })

  it('FAILS CLOSED when the streamer has no PromptPay number registered', () => {
    const result = checkSlipAgainstDonation(
      promptPayFacts(),
      { ...EXPECTED, promptPayLast4: null },
      NOW,
    )
    expect(result?.code).toBe('receiver_unconfigured')
  })

  it('requires BOTH to match when a slip names both', () => {
    // Naming one correctly does not excuse the other. A slip that carries an
    // account and a proxy has to agree with us about each.
    const result = checkSlipAgainstDonation(
      facts({ receiverProxyLast4: '9999', receiverProxyRaw: 'xxx-xxx-9999' }),
      EXPECTED,
      NOW,
    )
    expect(result?.code).toBe('receiver_mismatch')
  })
})

describe('nameMatches — banks abbreviate, attackers cannot', () => {
  it('accepts the real abbreviation a bank actually sent', () => {
    // Observed on the first real slip: title bolted on, surname cut to one
    // character. Any equality check would have rejected the account's owner.
    expect(nameMatches('นาย พชรดนัย ต', 'พชรดนัย ตั้งอั้น')).toBe(true)
  })

  it.each([['นาง'], ['นางสาว'], ['น.ส.'], ['Mr.'], ['MS']])('strips the title %s', (title) => {
    expect(nameMatches(`${title} พชรดนัย ต`, 'พชรดนัย ตั้งอั้น')).toBe(true)
  })

  it('rejects a different first name with the same initial surname', () => {
    // The whole point. `ต` alone must not match every surname in Thailand.
    expect(nameMatches('นาย สมชาย ต', 'พชรดนัย ตั้งอั้น')).toBe(false)
  })

  it('rejects a different surname', () => {
    expect(nameMatches('นาย พชรดนัย ส', 'พชรดนัย ตั้งอั้น')).toBe(false)
  })

  it('rejects a slip carrying MORE names than we hold', () => {
    expect(nameMatches('พชรดนัย ตั้งอั้น เพิ่ม', 'พชรดนัย ตั้งอั้น')).toBe(false)
  })

  it.each([[''], ['  '], ['นาย'], ['Mr.']])('treats %s as no name, not as agreement', (name) => {
    expect(nameMatches(name, 'พชรดนัย ตั้งอั้น')).toBe(false)
    expect(nameMatches('พชรดนัย ต', name)).toBe(false)
  })
})

describe('layer 3 — the name is what a phone number cannot be', () => {
  function promptPayFacts(overrides: Partial<SlipFacts> = {}): SlipFacts {
    return facts({
      receiverBankCode: '',
      receiverAccountLast4: null,
      receiverAccountRaw: '',
      receiverProxyLast4: '1112',
      receiverProxyRaw: 'xxx-xxx-1112',
      ...overrides,
    })
  }

  it('rejects a slip whose digits match but whose name does not', () => {
    /*
      The attack this closes. A Thai phone shop will sell a number ending in
      any four digits asked for, so an attacker can match `promptPayLast4`
      exactly, point PromptPay at their OWN account, transfer to themselves for
      the right amount, and submit a slip that is genuine in every particular.
      Every other layer passes it.
    */
    const result = checkSlipAgainstDonation(
      promptPayFacts({ receiverNames: ['นาย สมชาย ใจดี'] }),
      EXPECTED,
      NOW,
    )
    expect(result?.code).toBe('receiver_name_mismatch')
  })

  it('refuses a nameless PromptPay slip rather than trusting four digits alone', () => {
    const result = checkSlipAgainstDonation(
      promptPayFacts({ receiverNames: [] }),
      EXPECTED,
      NOW,
    )
    expect(result?.code).toBe('receiver_name_missing')
  })

  it('still accepts the streamer’s own PromptPay slip', () => {
    expect(checkSlipAgainstDonation(promptPayFacts(), EXPECTED, NOW)).toBeNull()
  })

  it('FAILS CLOSED when the streamer registered no account name', () => {
    const result = checkSlipAgainstDonation(
      promptPayFacts(),
      { ...EXPECTED, accountName: null },
      NOW,
    )
    expect(result?.code).toBe('receiver_unconfigured')
  })
})

describe('layer 3 — the same name in two scripts', () => {
  it('accepts when the THAI form matches, ignoring the romanised one', () => {
    /*
      Exactly what a real slip sent: SlipOK returns `displayName` in Thai and
      `name` romanised, and the streamer registered theirs in Thai. Ranking the
      two by length picked `MR. PHATCHARADANAI T`, compared it against
      `พชรดนัย ตั้งอั้น`, and refused the account's own owner.
    */
    const result = checkSlipAgainstDonation(
      facts({
        receiverBankCode: '',
        receiverAccountLast4: null,
        receiverProxyLast4: '1112',
        receiverNames: ['นาย พชรดนัย ต', 'MR. PHATCHARADANAI T'],
      }),
      EXPECTED,
      NOW,
    )
    expect(result).toBeNull()
  })

  it('accepts when only the ROMANISED form matches', () => {
    // A streamer who typed their name in English gets the mirror image.
    const result = checkSlipAgainstDonation(
      facts({
        receiverBankCode: '',
        receiverAccountLast4: null,
        receiverProxyLast4: '1112',
        receiverNames: ['นาย พชรดนัย ต', 'MR. PHATCHARADANAI T'],
      }),
      { ...EXPECTED, accountName: 'PHATCHARADANAI TANGAUN' },
      NOW,
    )
    expect(result).toBeNull()
  })

  it('still refuses when NEITHER form matches', () => {
    const result = checkSlipAgainstDonation(
      facts({
        receiverBankCode: '',
        receiverAccountLast4: null,
        receiverProxyLast4: '1112',
        receiverNames: ['นาย สมชาย ใจดี', 'MR. SOMCHAI J'],
      }),
      EXPECTED,
      NOW,
    )
    expect(result?.code).toBe('receiver_name_mismatch')
  })
})

describe('lastFourDigits — fails closed', () => {
  // Lives here rather than in an adapter's test file because BOTH sides of
  // layer 3's comparison run through it: the slip's masked value, and the
  // streamer's own registered number in `submit-slip.ts`.
  it.each([
    ['xxx-x-x7788-x', '7788'],
    ['1234567890', '7890'],
    ['xxxx7788', '7788'],
  ])('reads %s as %s', (masked, expected) => {
    expect(lastFourDigits(masked)).toBe(expected)
  })

  it.each([['xxx-x-x78-x'], ['xxxxxxx'], [''], [null], [undefined], [1234]])(
    'returns null rather than a short match for %s',
    (masked) => {
      // A two-digit "match" is not a match, and layer 3 refuses on null.
      expect(lastFourDigits(masked)).toBeNull()
    },
  )
})
