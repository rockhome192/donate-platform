import { describe, expect, it } from 'vitest'
import { createDonationSchema } from '../schemas.js'

const valid = { slug: 'somchai', donorName: 'ผู้ชม', message: 'สู้ ๆ', amount: 5000 }

describe('createDonationSchema (layer 1)', () => {
  it('accepts a normal donation', () => {
    expect(createDonationSchema.parse(valid)).toMatchObject({ amount: 5000 })
  })

  it('defaults an omitted message to empty', () => {
    const { message, ...rest } = valid
    expect(createDonationSchema.parse(rest).message).toBe('')
  })

  it.each([
    ['negative amount', { amount: -1 }],
    ['zero amount', { amount: 0 }],
    ['fractional satang', { amount: 100.5 }],
    ['above system ceiling', { amount: 10_000_001 }],
    ['empty donor name', { donorName: '   ' }],
    ['donor name too long', { donorName: 'x'.repeat(41) }],
    ['message too long', { message: 'x'.repeat(201) }],
    ['uppercase slug', { slug: 'Somchai' }],
    ['slug with spaces', { slug: 'som chai' }],
    ['honeypot filled', { website: 'http://spam.example' }],
  ])('rejects %s', (_label, patch) => {
    expect(createDonationSchema.safeParse({ ...valid, ...patch }).success).toBe(false)
  })

  /**
   * Layer 1 deliberately cannot see the streamer, so a 1-baht donation passes
   * here. Streamer.minAmount is enforced in layer 2 after the row is loaded --
   * DESIGN.md 7.1.1. Forgetting layer 2 leaves T7 (1-baht spam) wide open.
   */
  it('does NOT enforce per-streamer minimums (that is layer 2)', () => {
    expect(createDonationSchema.safeParse({ ...valid, amount: 100 }).success).toBe(true)
  })
})
