import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { MockChargeStatus } from '@prisma/client'
import { formatBaht } from '@dp/shared'
import { db } from '@/lib/db'
import type {
  ChargeStatus,
  CreateChargeInput,
  CreateChargeResult,
  PaymentProvider,
  RetrieveChargeResult,
} from './types'

/**
 * MockProvider — the default provider, and the one the demo button drives.
 *
 * Omise has no public API for marking a test charge paid; it is a button on
 * their dashboard (DESIGN.md 4.3). So "somebody paid" has to come from
 * somewhere else in a demo, and that somewhere is here.
 *
 * Everything downstream of this class stays real: signature verification, the
 * WebhookEvent unique-insert, after(), the retrieve-don't-trust rule, the
 * publish. Only the answer to "who says the money arrived" is substituted.
 */

/**
 * The ledger's own vocabulary is the PROVIDER's, not this app's.
 *
 * The column is a Prisma enum (uppercase, like every other enum in the schema)
 * while the port speaks Omise's lowercase words, so the two meet here in one
 * place rather than leaking either spelling across the seam.
 */
const TO_CHARGE_STATUS: Record<MockChargeStatus, ChargeStatus> = {
  PENDING: 'pending',
  SUCCESSFUL: 'successful',
  FAILED: 'failed',
}

export class MockProvider implements PaymentProvider {
  readonly name = 'mock' as const

  async createCharge(input: CreateChargeInput): Promise<CreateChargeResult> {
    const providerRef = `mock_chrg_${randomBytes(9).toString('hex')}`

    await db.mockCharge.create({
      data: {
        providerRef,
        amount: input.amount,
        status: 'PENDING',
        expiresAt: input.expiresAt,
      },
    })

    return {
      providerRef,
      qrImageUrl: placeholderQr(input.amount),
      expiresAt: input.expiresAt,
    }
  }

  async retrieveCharge(providerRef: string): Promise<RetrieveChargeResult> {
    const charge = await db.mockCharge.findUnique({
      where: { providerRef },
      select: { amount: true, status: true, paidAt: true },
    })

    // Unknown ref: a real provider 404s here and the caller must not read that
    // as "unpaid and fine". Failing loud beats inventing a pending charge.
    if (!charge) throw new Error(`mock charge not found: ${providerRef}`)

    return {
      status: TO_CHARGE_STATUS[charge.status],
      amount: charge.amount,
      paidAt: charge.paidAt,
    }
  }

  /**
   * HMAC-SHA256 keyed by MOCK_WEBHOOK_SECRET, so a simulated event can never be
   * signed with the Omise secret or the other way round. timingSafeEqual, not
   * ===, per DESIGN.md 8.3.1.
   *
   * Narrower than the real Omise scheme on purpose: it signs the body alone,
   * with no timestamp and so no replay window. What makes that acceptable is
   * that the synthetic event's id is inside the signed body — replaying a
   * captured request reproduces the same WebhookEvent primary key and is
   * absorbed as a duplicate. The replay guard is the ledger, not the clock.
   */
  verifyWebhookSignature(rawBody: string, headers: Headers): boolean {
    const secret = process.env.MOCK_WEBHOOK_SECRET
    if (!secret) return false

    const provided = headers.get('x-mock-signature')
    if (!provided) return false

    const expected = signMockWebhook(rawBody, secret)
    const a = Buffer.from(provided)
    const b = Buffer.from(expected)
    // Length differs -> unequal, but compare something anyway so the timing of
    // a wrong-length signature matches a right-length one.
    if (a.length !== b.length) {
      timingSafeEqual(b, b)
      return false
    }
    return timingSafeEqual(a, b)
  }

  /**
   * Flips a mock charge to successful. Called only by the demo endpoint, which
   * 404s unless DEMO_MODE=true — see DESIGN.md 4.3. Returns false if the ref is
   * unknown or already settled, so a double click cannot produce two payments.
   *
   * One conditional UPDATE, not read-then-write. The old version checked the
   * status and then assigned, which is a race that a single-threaded Map made
   * invisible; against a database two simultaneous clicks would both read
   * PENDING and both return true, and the pipeline would process two payments
   * for one charge. `status: 'PENDING'` in the WHERE moves the check into the
   * same statement as the write, so exactly one of them can match a row.
   */
  async markPaid(providerRef: string): Promise<boolean> {
    const { count } = await db.mockCharge.updateMany({
      where: { providerRef, status: 'PENDING' },
      data: { status: 'SUCCESSFUL', paidAt: new Date() },
    })
    return count === 1
  }
}

export function signMockWebhook(rawBody: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`
}

/**
 * A placeholder that is deliberately NOT a scannable QR code.
 *
 * Rendering a real-looking QR here would be the one thing DESIGN.md section 0
 * forbids: something a visitor could mistake for a way to send real money. It
 * says what it is, in Thai, on the image itself.
 */
function placeholderQr(amountSatang: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240" role="img" aria-label="QR จำลอง ไม่สามารถสแกนได้">
  <rect width="240" height="240" rx="14" fill="#f4f5fa"/>
  <g fill="#0c0d13">
    <rect x="22" y="22" width="52" height="52" rx="6" fill="none" stroke="#0c0d13" stroke-width="9"/>
    <rect x="166" y="22" width="52" height="52" rx="6" fill="none" stroke="#0c0d13" stroke-width="9"/>
    <rect x="22" y="166" width="52" height="52" rx="6" fill="none" stroke="#0c0d13" stroke-width="9"/>
    <rect x="38" y="38" width="20" height="20"/>
    <rect x="182" y="38" width="20" height="20"/>
    <rect x="38" y="182" width="20" height="20"/>
  </g>
  <text x="120" y="120" text-anchor="middle" font-family="monospace" font-size="15" font-weight="700" fill="#e02234">DEMO QR</text>
  <text x="120" y="142" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#5a5d70">สแกนไม่ได้ ไม่ใช่ QR จริง</text>
  <text x="120" y="196" text-anchor="middle" font-family="monospace" font-size="13" fill="#0c0d13">${formatBaht(amountSatang)} THB</text>
</svg>`

  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`
}
