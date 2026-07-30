import { describe, expect, it } from 'vitest'
import { checkStreamerRules, type StreamerRules } from '../donation-rules'

/**
 * These tests exist because the design review found minAmount declared in the
 * schema and never read (DESIGN.md 7.1.1, changelog item 4). Layer 1 cannot
 * cover any of this: the Zod schema is static and has no streamer to check
 * against.
 */

const streamer: StreamerRules = {
  displayName: 'Demo Streamer',
  isActive: true,
  isSuspended: false,
  minAmount: 2_000, // 20.00 THB
  maxAmount: 500_000, // 5,000.00 THB
}

describe('checkStreamerRules', () => {
  it('accepts an amount inside the streamer range', () => {
    expect(checkStreamerRules(5_000, streamer)).toBeNull()
  })

  it('accepts the boundaries themselves', () => {
    expect(checkStreamerRules(2_000, streamer)).toBeNull()
    expect(checkStreamerRules(500_000, streamer)).toBeNull()
  })

  /** T7: 1-baht donation spam. Layer 1 lets 100 satang through — this is the only stop. */
  it('rejects below the streamer minimum even though layer 1 allows it', () => {
    const failure = checkStreamerRules(100, streamer)
    expect(failure?.status).toBe(422)
    expect(failure?.field).toBe('amount')
  })

  it('names the real limit in the message so the viewer knows what to type', () => {
    expect(checkStreamerRules(100, streamer)?.message).toContain('20.00')
    expect(checkStreamerRules(600_000, streamer)?.message).toContain('5,000.00')
  })

  it('rejects above the streamer maximum', () => {
    expect(checkStreamerRules(600_000, streamer)?.status).toBe(422)
  })

  it('refuses a suspended streamer before looking at the amount', () => {
    const failure = checkStreamerRules(5_000, { ...streamer, isSuspended: true })
    expect(failure?.status).toBe(409)
  })

  it('refuses an inactive streamer', () => {
    expect(checkStreamerRules(5_000, { ...streamer, isActive: false })?.status).toBe(409)
  })

  /**
   * Suspension outranks the amount check: telling somebody their amount is
   * wrong, then that the account is closed anyway, wastes their second try.
   */
  it('reports suspension rather than the amount when both are wrong', () => {
    const failure = checkStreamerRules(1, { ...streamer, isSuspended: true })
    expect(failure?.status).toBe(409)
    expect(failure?.field).toBeUndefined()
  })

  it('treats min > max as a settings fault, not a viewer mistake', () => {
    const broken = { ...streamer, minAmount: 100_000, maxAmount: 1_000 }
    const failure = checkStreamerRules(50_000, broken)
    expect(failure?.status).toBe(409)
    expect(failure?.field).toBeUndefined()
  })
})
