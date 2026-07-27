import { describe, expect, it } from 'vitest'
import { assertSatang, formatBaht, toBaht, toSatang } from '../money.js'

describe('toSatang', () => {
  it('converts whole baht', () => {
    expect(toSatang(20)).toBe(2000)
    expect(toSatang(1)).toBe(100)
  })

  it('survives the binary floating point cases that truncation gets wrong', () => {
    // 20.1 * 100 === 2009.9999999999998 -- Math.trunc would give 2009 and lose a satang.
    expect(toSatang(20.1)).toBe(2010)
    expect(toSatang(0.29)).toBe(29)
    expect(toSatang(1.99)).toBe(199)
    expect(toSatang(2500.5)).toBe(250050)
  })

  /**
   * 1.005 baht is not a real amount -- there is no half satang. Rounding it to
   * 100 would silently pocket the remainder, so it throws instead.
   *
   * (For the record: 1.005 * 100 is 100.49999999999999, because the nearest
   * double to 1.005 is just under it. Math.round would give 100, not 101. The
   * point is that neither answer should be handed back as if it were fine.)
   */
  it('rejects amounts finer than one satang instead of rounding them away', () => {
    expect(() => toSatang(1.005)).toThrow(RangeError)
    expect(() => toSatang(0.001)).toThrow(RangeError)
    expect(() => toSatang(19.999)).toThrow(RangeError)
  })

  it('rejects non-finite input', () => {
    expect(() => toSatang(Number.NaN)).toThrow(RangeError)
    expect(() => toSatang(Number.POSITIVE_INFINITY)).toThrow(RangeError)
  })
})

describe('toBaht / formatBaht', () => {
  it('round-trips', () => {
    expect(toBaht(toSatang(2500.5))).toBe(2500.5)
  })

  it('always shows two decimals with grouping', () => {
    expect(formatBaht(250050)).toBe('2,500.50')
    expect(formatBaht(100)).toBe('1.00')
    expect(formatBaht(0)).toBe('0.00')
  })

  it('refuses fractional satang instead of silently rounding', () => {
    expect(() => assertSatang(10.5)).toThrow(TypeError)
    expect(() => formatBaht(10.5)).toThrow(TypeError)
  })
})
