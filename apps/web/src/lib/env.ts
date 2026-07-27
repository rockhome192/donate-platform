/**
 * Fail loudly at boot on a missing secret rather than 500ing at 2am when the
 * first donation comes in.
 */
function required(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required env var: ${name}`)
  return v
}

function optional(name: string, fallback = ''): string {
  return process.env[name] ?? fallback
}

export const env = {
  get databaseUrl() {
    return required('DATABASE_URL')
  },
  get nextAuthSecret() {
    return required('NEXTAUTH_SECRET')
  },

  /** Shared with apps/realtime. Signs the 60s single-use overlay ticket. */
  get realtimeJwtSecret() {
    return required('REALTIME_JWT_SECRET')
  },
  /** HMAC key for /internal/publish and /internal/disconnect. */
  get realtimeInternalSecret() {
    return required('REALTIME_INTERNAL_SECRET')
  },
  get realtimeHttpUrl() {
    return required('REALTIME_HTTP_URL').replace(/\/$/, '')
  },

  paymentProvider: optional('PAYMENT_PROVIDER', 'mock') as 'omise' | 'mock',

  /**
   * Gate for POST /api/demo/complete-donation, which posts a SIMULATED webhook.
   * Anything other than the exact string "true" keeps the endpoint 404.
   */
  isDemoMode: process.env.DEMO_MODE === 'true',
  get mockWebhookSecret() {
    return required('MOCK_WEBHOOK_SECRET')
  },

  siteUrl: optional('NEXT_PUBLIC_SITE_URL', 'http://localhost:3000'),
} as const
