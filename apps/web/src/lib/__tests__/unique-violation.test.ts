import { describe, expect, it } from 'vitest'
import { isUniqueViolation, uniqueViolationTargets } from '@/lib/db'

/**
 * What decides whether a failed signup is a helpful 409 or a bare 500.
 *
 * `/api/register` does one nested create that can collide on `User.email` or on
 * `Streamer.slug`, and it tells them apart by reading `meta.target` off the
 * P2002. That is the most common failure this product has — somebody signing up
 * with an address they already used — so the shape assumption underneath it
 * deserves to be pinned rather than assumed.
 *
 * The payloads below are the ones Prisma 5's Postgres connector produces for
 * the constraints in migrations/20260727000000_init: it maps `User_email_key`
 * back to the FIELD name, so `target` is `['email']`. The last case is the one
 * that matters — if that mapping ever changed to raw constraint names, the
 * route would stop recognising either collision and start 500ing on both.
 */

function p2002(target: unknown) {
  return { code: 'P2002', meta: { target } }
}

describe('isUniqueViolation', () => {
  it('recognises P2002 and nothing else', () => {
    expect(isUniqueViolation(p2002(['email']))).toBe(true)
    expect(isUniqueViolation({ code: 'P2025' })).toBe(false)
    expect(isUniqueViolation(new Error('boom'))).toBe(false)
    expect(isUniqueViolation(null)).toBe(false)
    expect(isUniqueViolation(undefined)).toBe(false)
    expect(isUniqueViolation('P2002')).toBe(false)
  })
})

describe('uniqueViolationTargets', () => {
  it('reads the field array Postgres reports', () => {
    expect(uniqueViolationTargets(p2002(['email']))).toEqual(['email'])
    expect(uniqueViolationTargets(p2002(['slug']))).toEqual(['slug'])
  })

  it('handles a composite target', () => {
    expect(uniqueViolationTargets(p2002(['provider', 'providerRef']))).toEqual([
      'provider',
      'providerRef',
    ])
  })

  it('accepts a bare string, which some connectors send', () => {
    expect(uniqueViolationTargets(p2002('email'))).toEqual(['email'])
  })

  it('is empty rather than throwing when meta is missing or odd', () => {
    expect(uniqueViolationTargets({ code: 'P2002' })).toEqual([])
    expect(uniqueViolationTargets(p2002(undefined))).toEqual([])
    expect(uniqueViolationTargets(p2002(42))).toEqual([])
    expect(uniqueViolationTargets(p2002([1, 'email', null]))).toEqual(['email'])
  })

  it('is empty for anything that is not a P2002', () => {
    expect(uniqueViolationTargets({ code: 'P2025', meta: { target: ['email'] } })).toEqual([])
    expect(uniqueViolationTargets(new Error('boom'))).toEqual([])
  })

  /**
   * The failure mode the register route falls into if Prisma ever reports the
   * raw index name instead of the field. Nothing here can prevent that — the
   * point is that it is written down, so a 500 on duplicate signups has an
   * obvious first suspect.
   */
  it('does NOT match a raw constraint name — the route would 500 instead of 409', () => {
    expect(uniqueViolationTargets(p2002(['User_email_key']))).not.toContain('email')
  })
})
