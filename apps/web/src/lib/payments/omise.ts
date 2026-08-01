import { createHmac, timingSafeEqual } from 'node:crypto'
import { env } from '../env'
import {
  ProviderUnavailableError,
  type ChargeStatus,
  type CreateChargeInput,
  type CreateChargeResult,
  type PaymentProvider,
  type RetrieveChargeResult,
} from './types'

/**
 * OmiseProvider — PromptPay charges against Omise test mode (DESIGN.md 7.2).
 *
 * Verified against the docs 2026-08-01, because every one of these is a detail
 * that silently half-works if guessed:
 *   - source creation authenticates with the PUBLIC key, charge creation with
 *     the SECRET key. Same host, different credential.
 *   - the QR lives at charge.source.scannable_code.image.download_uri
 *   - webhook signature is HMAC-SHA256 over `<timestamp>.<raw body>`, keyed by
 *     the BASE64-DECODED secret, hex encoded, in the Omise-Signature header
 *   - during secret rotation Omise-Signature carries TWO signatures, comma
 *     separated, and either one is valid
 *
 * Nothing here decides that money arrived. It reports what Omise says; the
 * webhook pipeline decides what to do about it.
 */

const API = 'https://api.omise.co'

/** Reject a webhook whose signature timestamp is older than this — replay guard. */
const SIGNATURE_TOLERANCE_SECONDS = 300

type OmiseCharge = {
  id: string
  status: string
  amount: number
  paid_at: string | null
  expires_at: string | null
  source?: {
    scannable_code?: { image?: { download_uri?: string } }
  }
}

export class OmiseProvider implements PaymentProvider {
  readonly name = 'omise' as const

  async createCharge(input: CreateChargeInput): Promise<CreateChargeResult> {
    // Step 1 — a source is the payment method plus the amount, and it is the
    // only call that uses the public key.
    const source = await post<{ id: string }>(
      '/sources',
      env.omisePublicKey,
      {
        amount: String(input.amount),
        currency: input.currency,
        type: 'promptpay',
      },
      'create source',
    )

    // Step 2 — the charge is what the viewer actually pays, and what the
    // webhook will later refer to.
    const charge = await post<OmiseCharge>(
      '/charges',
      env.omiseSecretKey,
      {
        amount: String(input.amount),
        currency: input.currency,
        source: source.id,
        // Omise caps this at 24h ahead; ours is 15 minutes, well inside.
        expires_at: input.expiresAt.toISOString(),
        // The thread back from a charge to our row when a human has to look.
        'metadata[donationId]': input.donationId,
        description: `DONATR demo donation ${input.donationId}`,
      },
      'create charge',
    )

    const qrImageUrl = charge.source?.scannable_code?.image?.download_uri
    if (!qrImageUrl) {
      // The charge exists and is payable, so this is not ProviderUnavailable —
      // it is a shape we did not expect, and the caller must treat the charge
      // as live (see the ORPHANED CHARGE path in POST /api/donations).
      throw new Error(`omise charge ${charge.id} has no scannable_code image`)
    }

    return {
      providerRef: charge.id,
      qrImageUrl,
      // Omise owns this clock. If it disagrees with what we asked for, its
      // answer is the one the viewer's QR actually obeys.
      expiresAt: charge.expires_at ? new Date(charge.expires_at) : input.expiresAt,
    }
  }

  async retrieveCharge(providerRef: string): Promise<RetrieveChargeResult> {
    const charge = await get<OmiseCharge>(`/charges/${encodeURIComponent(providerRef)}`)

    return {
      status: mapStatus(charge.status),
      amount: charge.amount,
      paidAt: charge.paid_at ? new Date(charge.paid_at) : null,
    }
  }

  verifyWebhookSignature(rawBody: string, headers: Headers): boolean {
    return verifyOmiseSignature(rawBody, headers, env.omiseWebhookSecret)
  }
}

/**
 * Omise's five statuses collapsed onto the three the app models.
 *
 * `expired` and `reversed` land in 'failed' deliberately: from the donation's
 * point of view the only question is "did this money arrive", and for both the
 * answer is no and will stay no. Leaving them unmapped would make an unknown
 * status read as pending and keep the reconciler retrying forever.
 */
export function mapStatus(omiseStatus: string): ChargeStatus {
  switch (omiseStatus) {
    case 'successful':
      return 'successful'
    case 'pending':
      return 'pending'
    case 'failed':
    case 'expired':
    case 'reversed':
      return 'failed'
    default:
      throw new Error(`unknown omise charge status: ${omiseStatus}`)
  }
}

/**
 * Exported for tests: the signature check is the one piece of this file that
 * can be verified without a network, and it is the piece an attacker attacks.
 *
 * @param secretBase64 the webhook secret exactly as the dashboard shows it
 */
export function verifyOmiseSignature(
  rawBody: string,
  headers: Headers,
  secretBase64: string,
  now: Date = new Date(),
): boolean {
  const timestamp = headers.get('omise-signature-timestamp')
  const signatureHeader = headers.get('omise-signature')
  if (!timestamp || !signatureHeader) return false

  const ts = Number(timestamp)
  if (!Number.isFinite(ts)) return false

  // Replay guard. Math.abs, not "older than": a clock ahead of ours is just as
  // much a sign the timestamp was not produced by this exchange.
  const skewSeconds = Math.abs(now.getTime() / 1000 - ts)
  if (skewSeconds > SIGNATURE_TOLERANCE_SECONDS) return false

  const secret = Buffer.from(secretBase64, 'base64')
  if (secret.length === 0) return false

  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')

  // Rotation sends both the old and the new signature. Check every one rather
  // than the first, or every webhook during a rotation window is rejected.
  return signatureHeader
    .split(',')
    .map((s) => s.trim())
    .some((candidate) => constantTimeEquals(candidate, expected))
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) {
    // Still do the work, so a wrong-length signature does not return faster
    // than a wrong-value one.
    timingSafeEqual(bufB, bufB)
    return false
  }
  return timingSafeEqual(bufA, bufB)
}

function authHeader(key: string): string {
  return `Basic ${Buffer.from(`${key}:`).toString('base64')}`
}

async function post<T>(
  path: string,
  key: string,
  form: Record<string, string>,
  what: string,
): Promise<T> {
  return request<T>(path, { method: 'POST', body: new URLSearchParams(form) }, key, what)
}

async function get<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'GET' }, env.omiseSecretKey, `retrieve ${path}`)
}

async function request<T>(
  path: string,
  init: { method: string; body?: BodyInit },
  key: string,
  what: string,
): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        authorization: authHeader(key),
        ...(init.body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
      },
      // A payment gateway that has not answered in 15s is not going to.
      signal: AbortSignal.timeout(15_000),
      cache: 'no-store',
    })
  } catch (cause) {
    throw new ProviderUnavailableError(`omise unreachable during ${what}`, { cause })
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    // 5xx and 429 are "ask again later"; a 4xx is our own bad request and
    // retrying it changes nothing.
    if (res.status >= 500 || res.status === 429) {
      throw new ProviderUnavailableError(`omise ${res.status} during ${what}: ${detail.slice(0, 300)}`)
    }
    throw new Error(`omise ${res.status} during ${what}: ${detail.slice(0, 300)}`)
  }

  return (await res.json()) as T
}
