import { describe, expect, it } from 'vitest'
import { backoffDelay } from '../backoff.js'

describe('backoffDelay', () => {
  it('grows exponentially at the top of its range', () => {
    const full = () => 1 // random() -> 1 gives 100% of the capped delay
    expect(backoffDelay(0, { random: full })).toBe(1_000)
    expect(backoffDelay(1, { random: full })).toBe(2_000)
    expect(backoffDelay(2, { random: full })).toBe(4_000)
    expect(backoffDelay(3, { random: full })).toBe(8_000)
  })

  it('caps at maxMs no matter how many attempts', () => {
    const full = () => 1
    expect(backoffDelay(10, { random: full })).toBe(30_000)
    expect(backoffDelay(500, { random: full })).toBe(30_000)
    // 2 ** 5000 is Infinity; the clamp has to happen before the multiply.
    expect(Number.isFinite(backoffDelay(5000, { random: full }))).toBe(true)
  })

  it('never returns less than half the capped delay', () => {
    expect(backoffDelay(2, { random: () => 0 })).toBe(2_000)
    expect(backoffDelay(2, { random: () => 0.999999 })).toBeLessThanOrEqual(4_000)
  })

  it('actually jitters -- this is the thundering-herd guard', () => {
    const samples = new Set(Array.from({ length: 100 }, () => backoffDelay(4)))
    // If jitter were missing every sample would be identical.
    expect(samples.size).toBeGreaterThan(50)
    for (const s of samples) {
      expect(s).toBeGreaterThanOrEqual(8_000)
      expect(s).toBeLessThanOrEqual(16_000)
    }
  })

  it('rejects negative attempts', () => {
    expect(() => backoffDelay(-1)).toThrow(RangeError)
  })
})
