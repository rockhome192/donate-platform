import { env } from '../env'
import { MockProvider } from './mock'
import type { PaymentProvider } from './types'

export * from './types'
export { MockProvider, signMockWebhook } from './mock'

let cached: PaymentProvider | null = null

/**
 * PAYMENT_PROVIDER picks the implementation. Defaults to mock, so a missing env
 * var can never accidentally point a demo deploy at a real gateway.
 *
 * OmiseProvider lands in M3; until then asking for it fails at startup instead
 * of silently falling back to mock and looking like it worked.
 */
export function getPaymentProvider(): PaymentProvider {
  if (cached) return cached

  switch (env.paymentProvider) {
    case 'mock':
      cached = new MockProvider()
      return cached
    case 'omise':
      throw new Error('PAYMENT_PROVIDER=omise: OmiseProvider arrives in M3 — use "mock" for now')
    default:
      throw new Error(`Unknown PAYMENT_PROVIDER: ${String(env.paymentProvider)}`)
  }
}

/** Test seam. */
export function __resetProvider(): void {
  cached = null
}
