import { FakeSlipVerifier } from './slip-fake'
import type { SlipVerifier } from './slip-types'

export * from './slip-types'
export * from './slip-checks'
export { FakeSlipVerifier, encodeFakeSlip } from './slip-fake'

let cached: SlipVerifier | null = null

/**
 * SLIP_VERIFIER picks the implementation. Defaults to the fake, so a missing
 * env var can never point a demo at a real upstream — the same defaulting rule
 * `getPaymentProvider` follows, for the same reason.
 */
export function getSlipVerifier(): SlipVerifier {
  if (cached) return cached

  const choice = process.env.SLIP_VERIFIER ?? 'fake'

  switch (choice) {
    case 'fake':
      cached = new FakeSlipVerifier()
      return cached
    case 'slipok':
      // Deliberately absent. The Omise adapter was written from the spec alone
      // and its riskiest details only survived contact with a real payload by
      // luck; that lesson is not worth relearning. The SlipOK adapter gets
      // written against the real API document and a real slip, not against a
      // guess at the response shape.
      throw new Error('SLIP_VERIFIER=slipok is not implemented yet — see DESIGN.md 7.3')
    default:
      throw new Error(`Unknown SLIP_VERIFIER: ${choice}`)
  }
}

/** Test seam. */
export function __resetSlipVerifier(): void {
  cached = null
}
