import { FakeSlipVerifier } from './slip-fake'
import { SlipOkVerifier } from './slipok'
import type { SlipVerifier } from './slip-types'

export * from './slip-types'
export * from './slip-checks'
export { FakeSlipVerifier, encodeFakeSlip } from './slip-fake'
export { SlipOkVerifier } from './slipok'

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
      cached = new SlipOkVerifier()
      return cached
    default:
      throw new Error(`Unknown SLIP_VERIFIER: ${choice}`)
  }
}

/** Test seam. */
export function __resetSlipVerifier(): void {
  cached = null
}
