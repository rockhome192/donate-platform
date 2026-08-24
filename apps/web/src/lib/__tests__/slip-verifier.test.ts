import { afterEach, describe, expect, it } from 'vitest'
import { __resetSlipVerifier, getSlipVerifier } from '../payments/slip'
import { SlipVerifierUnavailableError } from '../payments/slip-types'

/**
 * The factory, which is one line of switch and one production incident.
 *
 * SLIP_VERIFIER was set to `true` on Vercel — the shape of
 * SLIP_DONATIONS_ENABLED=true, copied onto a variable that wants a name — and
 * the refusal here reached a donor as an unhandled 500 with an empty body.
 * What it says now is a fact about the deployment, in the type this codebase
 * uses for exactly that, so `submitSlip` can answer 503.
 */
describe('getSlipVerifier', () => {
  const original = process.env.SLIP_VERIFIER

  afterEach(() => {
    process.env.SLIP_VERIFIER = original
    __resetSlipVerifier()
  })

  it.each([
    ['fake', 'fake'],
    ['slipok', 'slipok'],
    ['easyslip', 'easyslip'],
  ])('builds the %s verifier', (choice, name) => {
    process.env.SLIP_VERIFIER = choice
    __resetSlipVerifier()
    expect(getSlipVerifier().name).toBe(name)
  })

  it('defaults to the fake, so a missing var cannot point a demo at a real upstream', () => {
    delete process.env.SLIP_VERIFIER
    __resetSlipVerifier()
    expect(getSlipVerifier().name).toBe('fake')
  })

  it('refuses an unknown value as OUR problem, not a bare Error', () => {
    process.env.SLIP_VERIFIER = 'true'
    __resetSlipVerifier()

    const error = (() => {
      try {
        getSlipVerifier()
      } catch (e: unknown) {
        return e
      }
    })()

    expect(error).toBeInstanceOf(SlipVerifierUnavailableError)
    expect((error as Error).message).toContain('true')
  })
})
