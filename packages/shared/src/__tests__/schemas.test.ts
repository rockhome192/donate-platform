import { describe, expect, it } from 'vitest'
import { ACK_MAX_IDS } from '../realtime.js'
import {
  RESERVED_SLUGS,
  ackAlertsSchema,
  createDonationSchema,
  isReservedSlug,
  streamerSlugSchema,
} from '../schemas.js'

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
    ['reserved slug', { slug: 'dashboard' }],
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

describe('reserved slugs', () => {
  it.each(['api', 'dashboard', 'login', 'overlay'])(
    'rejects %s, which a static route already answers',
    (slug) => {
      expect(streamerSlugSchema.safeParse(slug).success).toBe(false)
    },
  )

  it('still accepts an ordinary slug', () => {
    expect(streamerSlugSchema.safeParse('demo').success).toBe(true)
  })

  it('matches case-insensitively and ignores surrounding space', () => {
    // The schema lowercases nothing -- the regex rejects capitals outright --
    // but isReservedSlug is also called from places that have not been through
    // it yet, so it normalises on its own.
    expect(isReservedSlug('  DASHBOARD ')).toBe(true)
  })

  /**
   * A reserved word that the slug rules would have rejected anyway is a dead
   * entry: it looks like protection and provides none. This catches the typo
   * (`sign_up`, `Dashboard`) at the moment somebody adds it to the list.
   */
  it('every reserved word is a slug someone could otherwise have claimed', () => {
    const unclaimable = [...RESERVED_SLUGS].filter(
      (slug) => !/^[a-z0-9][a-z0-9-]*$/.test(slug) || slug.length < 3 || slug.length > 30,
    )
    expect(unclaimable).toEqual([])
  })
})

describe('ackAlertsSchema', () => {
  it('accepts a batch the overlay would actually send', () => {
    expect(ackAlertsSchema.safeParse({ donationIds: ['don_1', 'don_2'] }).success).toBe(true)
  })

  it.each([
    ['no ids at all — nothing to do is a client bug, not a request', { donationIds: [] }],
    ['a missing field', {}],
    ['an id that is not a string', { donationIds: [42] }],
    ['an empty id', { donationIds: [''] }],
    ['repeated ids', { donationIds: ['don_1', 'don_1'] }],
    ['more ids than the cap', { donationIds: Array.from({ length: ACK_MAX_IDS + 1 }, (_, i) => `d${i}`) }],
  ])('rejects %s', (_label, body) => {
    expect(ackAlertsSchema.safeParse(body).success).toBe(false)
  })

  /**
   * The route turns this into one `id IN (...)` update, where a repeat is
   * silently harmless -- which is exactly why it has to be caught here instead.
   * Otherwise a client could fill a body to the cap with a single id repeated.
   */
  it('accepts exactly the cap', () => {
    const ids = Array.from({ length: ACK_MAX_IDS }, (_, i) => `d${i}`)
    expect(ackAlertsSchema.safeParse({ donationIds: ids }).success).toBe(true)
  })
})
