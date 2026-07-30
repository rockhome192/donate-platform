import { beforeEach, describe, expect, it } from 'vitest'
import { MockProvider, signMockWebhook, __resetMockCharges } from '../payments/mock'

const SECRET = 'test-mock-secret'

function signedHeaders(rawBody: string, secret = SECRET): Headers {
  return new Headers({ 'x-mock-signature': signMockWebhook(rawBody, secret) })
}

describe('MockProvider', () => {
  beforeEach(() => {
    __resetMockCharges()
    process.env.MOCK_WEBHOOK_SECRET = SECRET
  })

  it('creates a pending charge and hands back a ref plus a QR', async () => {
    const provider = new MockProvider()
    const expiresAt = new Date(Date.now() + 900_000)

    const charge = await provider.createCharge({
      donationId: 'don_1',
      amount: 5_000,
      currency: 'THB',
      expiresAt,
    })

    expect(charge.providerRef).toMatch(/^mock_chrg_/)
    expect(charge.expiresAt).toEqual(expiresAt)
    expect(await provider.retrieveCharge(charge.providerRef)).toMatchObject({
      status: 'pending',
      amount: 5_000,
      paidAt: null,
    })
  })

  /**
   * The placeholder must not look scannable. DESIGN.md section 0 forbids
   * anything a visitor could mistake for a way to send real money.
   */
  it('renders a QR placeholder that says it is not real', async () => {
    const provider = new MockProvider()
    const charge = await provider.createCharge({
      donationId: 'don_1',
      amount: 5_000,
      currency: 'THB',
      expiresAt: new Date(),
    })

    const svg = Buffer.from(charge.qrImageUrl.split(',')[1]!, 'base64').toString('utf8')
    expect(svg).toContain('DEMO QR')
    expect(svg).toContain('ไม่ใช่ QR จริง')
  })

  it('throws rather than reporting "pending" for a ref it never issued', async () => {
    await expect(new MockProvider().retrieveCharge('mock_chrg_nope')).rejects.toThrow()
  })

  it('reports the amount it was given, not one supplied later', async () => {
    const provider = new MockProvider()
    const charge = await provider.createCharge({
      donationId: 'don_1',
      amount: 12_345,
      currency: 'THB',
      expiresAt: new Date(),
    })
    provider.markPaid(charge.providerRef)

    // DESIGN.md 7.1: the processor reads the amount back from the provider and
    // ignores whatever a webhook body claims.
    expect((await provider.retrieveCharge(charge.providerRef)).amount).toBe(12_345)
  })

  it('settles a charge once and refuses the second attempt', async () => {
    const provider = new MockProvider()
    const charge = await provider.createCharge({
      donationId: 'don_1',
      amount: 5_000,
      currency: 'THB',
      expiresAt: new Date(),
    })

    expect(provider.markPaid(charge.providerRef)).toBe(true)
    expect(provider.markPaid(charge.providerRef)).toBe(false)

    const settled = await provider.retrieveCharge(charge.providerRef)
    expect(settled.status).toBe('successful')
    expect(settled.paidAt).toBeInstanceOf(Date)
  })

  describe('verifyWebhookSignature', () => {
    const body = JSON.stringify({ id: 'evt_1', key: 'charge.complete' })

    it('accepts a body signed with the mock secret', () => {
      expect(new MockProvider().verifyWebhookSignature(body, signedHeaders(body))).toBe(true)
    })

    it('rejects a body that was tampered with after signing', () => {
      const headers = signedHeaders(body)
      const tampered = JSON.stringify({ id: 'evt_1', key: 'charge.complete', amount: 999 })
      expect(new MockProvider().verifyWebhookSignature(tampered, headers)).toBe(false)
    })

    it('rejects a signature made with a different secret', () => {
      expect(
        new MockProvider().verifyWebhookSignature(body, signedHeaders(body, 'other-secret')),
      ).toBe(false)
    })

    it('rejects a missing signature header', () => {
      expect(new MockProvider().verifyWebhookSignature(body, new Headers())).toBe(false)
    })

    it('rejects a signature of the wrong length without throwing', () => {
      const headers = new Headers({ 'x-mock-signature': 'sha256=short' })
      expect(new MockProvider().verifyWebhookSignature(body, headers)).toBe(false)
    })

    /** No secret configured must mean "verify nothing", never "accept everything". */
    it('rejects everything when MOCK_WEBHOOK_SECRET is unset', () => {
      delete process.env.MOCK_WEBHOOK_SECRET
      expect(new MockProvider().verifyWebhookSignature(body, signedHeaders(body))).toBe(false)
    })
  })
})
