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
  /**
   * Where the overlay opens its socket. Read here on the SERVER and passed to
   * the client as a prop rather than read in the browser: Next only inlines
   * `process.env.NEXT_PUBLIC_*` when it appears literally in client code, and
   * reaching it through this object would compile to `undefined` at runtime —
   * which fails as "the overlay never connects", with nothing in any log.
   *
   * Browsers refuse ws:// from an https:// page, so this must be wss:// in
   * production.
   */
  get realtimeWsUrl() {
    return required('NEXT_PUBLIC_REALTIME_WS_URL').replace(/\/$/, '')
  },

  paymentProvider: optional('PAYMENT_PROVIDER', 'mock') as 'omise' | 'mock',

  /**
   * Omise test-mode credentials. Getters, not values: PAYMENT_PROVIDER=mock is
   * the default and a mock deploy must not have to carry Omise keys at all.
   */
  get omisePublicKey() {
    return required('OMISE_PUBLIC_KEY')
  },
  get omiseSecretKey() {
    return required('OMISE_SECRET_KEY')
  },
  /** Base64 HMAC key from the Omise dashboard. Decoded before use — DESIGN.md 7.4. */
  get omiseWebhookSecret() {
    return required('OMISE_WEBHOOK_SECRET')
  },

  /**
   * SlipOK. The branch id is a path segment, not a header, and the key goes in
   * `x-authorization` — a plain `Authorization` header is refused with 1002.
   */
  get slipokApiKey() {
    return required('SLIPOK_API_KEY')
  },
  get slipokBranchId() {
    return required('SLIPOK_BRANCH_ID')
  },

  /**
   * Shared bearer for POST /api/cron/reconcile. Vercel Cron sends it as
   * `Authorization: Bearer $CRON_SECRET`; apps/realtime uses the same header.
   */
  get cronSecret() {
    return required('CRON_SECRET')
  },

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
