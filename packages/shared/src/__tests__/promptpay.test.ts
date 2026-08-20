import { describe, expect, it } from 'vitest'
import { crc16, promptPayPayload, promptPayPhone } from '../promptpay'

/**
 * The one QR in this codebase that a bank actually has to be able to read.
 *
 * Structure and checksum are testable here. Whether a real banking app opens
 * it with the right amount pre-filled is NOT — that takes a phone, and it is
 * the reason this feature is not trusted until somebody scans one.
 */

describe('crc16 — CRC-16/CCITT-FALSE', () => {
  it('matches the standard check vector', () => {
    // The published check value for this algorithm: CRC("123456789") = 0x29B1.
    // If this passes, the polynomial, the seed and the bit order are all right.
    expect(crc16('123456789')).toBe('29B1')
  })

  it('always returns four hex characters', () => {
    // A checksum that drops a leading zero shifts every byte after it and the
    // bank simply refuses the QR.
    for (const s of ['a', 'bb', 'payload', '0000', 'ก']) {
      expect(crc16(s)).toMatch(/^[0-9A-F]{4}$/)
    }
  })
})

describe('promptPayPhone', () => {
  it.each([
    ['0812345678', '0066812345678'],
    ['081-234-5678', '0066812345678'],
    ['66812345678', '0066812345678'],
    ['+66 81 234 5678', '0066812345678'],
  ])('normalises %s', (raw, expected) => {
    expect(promptPayPhone(raw)).toBe(expected)
  })

  it.each([['08123456'], ['081234567890'], [''], ['abc']])('rejects %s', (raw) => {
    expect(promptPayPhone(raw)).toBeNull()
  })

  it.each([['021234567'], ['0712345678'], ['0512345678']])(
    'rejects %s — right length, not a mobile number',
    (raw) => {
      // Counting digits alone accepts a landline, and the QR it builds scans
      // fine and then fails at the bank — after it is already on the streamer's
      // public page.
      expect(promptPayPhone(raw)).toBeNull()
    },
  )

  it.each([['0612345678'], ['0812345678'], ['0912345678']])('accepts the %s prefix', (raw) => {
    expect(promptPayPhone(raw)).not.toBeNull()
  })
})

describe('promptPayPayload', () => {
  const target = { type: 'phone', value: '0812345678' } as const

  it('carries the amount in baht with two decimals', () => {
    // Layer 4 refuses a slip that is off by one satang, so this is the field
    // that keeps a donor from losing money to a typo.
    const payload = promptPayPayload(target, 12_345)
    expect(payload).toContain('5406123.45')
  })

  it('writes a whole baht amount as 1.00, not 1', () => {
    expect(promptPayPayload(target, 100)).toContain('54041.00')
  })

  it('marks the QR dynamic, because it is for one transfer', () => {
    // 11 would be the reusable one printed on a counter.
    expect(promptPayPayload(target, 100)?.startsWith('000201010212')).toBe(true)
  })

  it('nests the PromptPay AID and the number inside tag 29', () => {
    expect(promptPayPayload(target, 100)).toContain(
      '29370016A000000677010111011300668123456',
    )
  })

  it('ends with a checksum over everything before it', () => {
    const payload = promptPayPayload(target, 100)!
    const body = payload.slice(0, -4)
    expect(body.endsWith('6304')).toBe(true)
    expect(payload.slice(-4)).toBe(crc16(body))
  })

  it('is THB and Thailand', () => {
    const payload = promptPayPayload(target, 100)
    expect(payload).toContain('5303764')
    expect(payload).toContain('5802TH')
  })

  it('has no way to build a national-id QR at all', () => {
    // Not a preference the caller can override: the type does not admit one,
    // and tag 02 is never written. A PromptPay QR is public by construction,
    // and this is the field that decides how bad that is.
    expect(promptPayPayload(target, 100)).not.toContain('0213')
  })

  it.each([
    [{ type: 'phone', value: '123' } as const, 100],
    [{ type: 'phone', value: '0212345678' } as const, 100],
    // A zero or fractional-satang amount is not a transfer anyone can make.
    [{ type: 'phone', value: '0812345678' } as const, 0],
    [{ type: 'phone', value: '0812345678' } as const, 10.5],
  ])('returns null rather than an unscannable QR for %o / %i', (t, amount) => {
    expect(promptPayPayload(t, amount)).toBeNull()
  })
})
