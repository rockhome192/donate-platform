import { EasySlipVerifier } from './easyslip'
import { FakeSlipVerifier } from './slip-fake'
import { SlipOkVerifier } from './slipok'
import { SlipVerifierUnavailableError, type SlipVerifier } from './slip-types'

export * from './slip-types'
export * from './slip-checks'
export { FakeSlipVerifier, encodeFakeSlip } from './slip-fake'
export { SlipOkVerifier } from './slipok'
export { EasySlipVerifier } from './easyslip'

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
    /*
      The multi-tenant choice. SlipOK verifies against ONE account configured
      inside its own branch, so on this deployment it can only ever serve the
      streamer whose account that is — see `easyslip.ts`. EasySlip has no such
      binding, which is what makes a second streamer possible at all.
    */
    case 'easyslip':
      cached = new EasySlipVerifier()
      return cached
    default:
      /*
        Typed, not a bare Error, and that difference cost a live donation.

        SLIP_VERIFIER was set to `true` on production — the shape of
        SLIP_DONATIONS_ENABLED=true, copied onto a variable that wants a NAME —
        and the plain Error thrown here walked out through `submitSlip` into an
        unhandled 500 with an empty body. The donor, who had already
        transferred the money, was shown the page's last-resort text for a
        response carrying no message at all.

        A deployment configured with a verifier that does not exist is in the
        same position as one whose verifier is down: it cannot check slips, and
        that is a fact about US. `SlipVerifierUnavailableError` is how this
        codebase says exactly that, and it answers 503 instead.
      */
      throw new SlipVerifierUnavailableError(`Unknown SLIP_VERIFIER: ${choice}`)
  }
}

/** Test seam. */
export function __resetSlipVerifier(): void {
  cached = null
}
