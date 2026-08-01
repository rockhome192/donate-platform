import { env } from '../env'
import { MockProvider } from './mock'
import { OmiseProvider } from './omise'
import type { PaymentProvider } from './types'

export * from './types'
export { MockProvider, signMockWebhook } from './mock'
export { OmiseProvider, verifyOmiseSignature } from './omise'

let cached: PaymentProvider | null = null

/**
 * PAYMENT_PROVIDER picks the implementation. Defaults to mock, so a missing env
 * var can never accidentally point a demo deploy at a real gateway.
 *
 * Omise runs in TEST MODE only — see DESIGN.md 0. The keys are test keys; there
 * is no live-mode path in this codebase to accidentally enable.
 */
export function getPaymentProvider(): PaymentProvider {
  if (cached) return cached

  switch (env.paymentProvider) {
    case 'mock':
      cached = new MockProvider()
      return cached
    case 'omise':
      cached = new OmiseProvider()
      return cached
    default:
      throw new Error(`Unknown PAYMENT_PROVIDER: ${String(env.paymentProvider)}`)
  }
}

/** Test seam. */
export function __resetProvider(): void {
  cached = null
}
