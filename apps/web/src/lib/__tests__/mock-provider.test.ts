import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A stand-in for the `MockCharge` table.
 *
 * It can show that the provider asks the right questions — a conditional
 * update rather than a read-then-write — but it cannot prove the property that
 * moved this ledger into Postgres in the first place: two simultaneous presses
 * landing on two instances. That one is the database's guarantee and is
 * verified against Neon end to end, not here.
 */
const store = vi.hoisted(() => {
  type Row = {
    providerRef: string
    amount: number
    status: 'PENDING' | 'SUCCESSFUL' | 'FAILED'
    paidAt: Date | null
    expiresAt: Date
  }
  return new Map<string, Row>()
})

vi.mock('@/lib/db', () => ({
  db: {
    mockCharge: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const ref = data.providerRef as string
        // The real column is a primary key; a silent overwrite here would hide
        // a duplicate-ref bug that Postgres would reject outright.
        if (store.has(ref)) throw new Error(`duplicate providerRef ${ref}`)
        const row = { paidAt: null, ...data } as never
        store.set(ref, row)
        return row
      },
      findUnique: async ({ where }: { where: { providerRef: string } }) =>
        store.get(where.providerRef) ?? null,
      updateMany: async ({
        where,
        data,
      }: {
        where: { providerRef: string; status?: string }
        data: Record<string, unknown>
      }) => {
        const row = store.get(where.providerRef)
        if (!row) return { count: 0 }
        if (where.status !== undefined && row.status !== where.status) return { count: 0 }
        Object.assign(row, data)
        return { count: 1 }
      },
    },
  },
}))

const { MockProvider, signMockWebhook } = await import('../payments/mock')

const SECRET = 'test-mock-secret'

function signedHeaders(rawBody: string, secret = SECRET): Headers {
  return new Headers({ 'x-mock-signature': signMockWebhook(rawBody, secret) })
}

describe('MockProvider', () => {
  beforeEach(() => {
    store.clear()
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
    await provider.markPaid(charge.providerRef)

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

    // The second call is refused by the WHERE clause, not by a prior read —
    // `status: PENDING` no longer matches once the first one settled it.
    await expect(provider.markPaid(charge.providerRef)).resolves.toBe(true)
    await expect(provider.markPaid(charge.providerRef)).resolves.toBe(false)

    const settled = await provider.retrieveCharge(charge.providerRef)
    expect(settled.status).toBe('successful')
    expect(settled.paidAt).toBeInstanceOf(Date)
  })

  /**
   * The demo route turns this into a 409. Before the ledger moved to Postgres
   * the same false meant "the server restarted since the QR was created", which
   * on Vercel happened to real visitors between two requests of one click.
   */
  it('refuses to settle a ref it never issued', async () => {
    await expect(new MockProvider().markPaid('mock_chrg_nope')).resolves.toBe(false)
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
