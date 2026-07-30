/**
 * Payment provider port. See DESIGN.md 7.2.
 *
 * Two implementations: OmiseProvider (M3) and MockProvider (now). The point of
 * the seam is that the webhook pipeline, the idempotency ledger and the alert
 * publish all sit on THIS side of it — swapping providers changes who says "the
 * money arrived", nothing else.
 */

export type ChargeStatus = 'pending' | 'successful' | 'failed'

export type CreateChargeInput = {
  donationId: string
  /** satang */
  amount: number
  currency: 'THB'
  expiresAt: Date
}

export type CreateChargeResult = {
  /** Provider's own id for this charge. Stored on Donation.providerRef. */
  providerRef: string
  qrImageUrl: string
  /**
   * The provider decides the real expiry. It may not match what we asked for,
   * so the caller stores what comes back rather than what it sent.
   */
  expiresAt: Date
}

export type RetrieveChargeResult = {
  status: ChargeStatus
  /** satang, as the PROVIDER has it — this is the number we trust, not the webhook body */
  amount: number
  paidAt: Date | null
}

export interface PaymentProvider {
  readonly name: 'omise' | 'mock'

  createCharge(input: CreateChargeInput): Promise<CreateChargeResult>

  /**
   * Read the truth back from the provider. DESIGN.md 7.1: a webhook body is an
   * untrusted claim that something happened, not evidence of what happened.
   */
  retrieveCharge(providerRef: string): Promise<RetrieveChargeResult>

  verifyWebhookSignature(rawBody: string, headers: Headers): boolean
}

/** Provider is down or unreachable -> the route answers 503, not 500. */
export class ProviderUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ProviderUnavailableError'
  }
}
