import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EasySlipVerifier, parseFacts } from '../payments/easyslip'
import { SlipRejectedError, SlipVerifierUnavailableError } from '../payments/slip-types'

/**
 * The EasySlip adapter.
 *
 * Unlike `slipok.test.ts`, none of this was confirmed against the live API —
 * the shapes come from document.easyslip.com, read 2026-08-21. So these tests
 * are honest about what they prove: they pin the TRANSLATION (their vocabulary
 * into ours, baht into satang, two name scripts into a list) and the
 * whose-fault-is-it split. They prove nothing about whether the upstream
 * really answers this way, and a green run here is not permission to point
 * production at it.
 *
 * The one behaviour worth stating outright, because it is why this adapter
 * exists: EasySlip has NO receiver binding, so there is no `wrong_receiver`
 * rejection to test for. The receiver check is ours, in `slip-checks.ts`.
 */

/** The documented v2 success envelope, with a PromptPay transfer's values. */
function aResponse(rawSlip: Record<string, unknown> = {}, data: Record<string, unknown> = {}) {
  return {
    success: true,
    message: 'Bank slip verified successfully',
    data: {
      isDuplicate: false,
      matchedAccount: null,
      amountInSlip: 50,
      rawSlip: {
        payload: '00450000000000',
        transRef: '20260820ABCDEF1234',
        date: '2026-08-20T12:00:00+07:00',
        countryCode: 'TH',
        amount: { amount: 50, local: { amount: 50, currency: 'THB' } },
        fee: 0,
        ref1: '',
        ref2: '',
        ref3: '',
        sender: {
          bank: { id: '014', name: 'ไทยพาณิชย์', short: 'SCB' },
          account: {
            name: { th: 'นาย ผู้โอน ทดสอบ', en: 'MR. SENDER TEST' },
            bank: { type: 'BANKAC', account: 'xxx-x-x1111-x' },
          },
        },
        receiver: {
          bank: { id: '004', name: 'กสิกรไทย', short: 'KBANK' },
          account: {
            name: { th: 'นาย พชรดนัย ต', en: 'MR. PHATCHARADANAI T' },
            bank: { type: 'BANKAC', account: 'xxx-x-x7788-x' },
          },
          merchantId: null,
        },
        ...rawSlip,
      },
      ...data,
    },
  }
}

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  )
}

describe('parseFacts — units and masking', () => {
  it('converts decimal baht into satang, because everything else is satang', () => {
    // The single most dangerous field in the payload: `amount` is 50, and the
    // donation it has to match is 5000.
    expect(parseFacts(aResponse().data).amount).toBe(5_000)
  })

  it('handles a baht amount with satang in it', () => {
    expect(parseFacts(aResponse({ amount: { amount: 20.25 } }).data).amount).toBe(2_025)
  })

  it('refuses an amount with sub-satang precision instead of rounding it away', () => {
    expect(() => parseFacts(aResponse({ amount: { amount: 20.2567 } }).data)).toThrow(
      SlipVerifierUnavailableError,
    )
  })

  it('refuses an amount that is not a number at all', () => {
    expect(() => parseFacts(aResponse({ amount: { amount: 'fifty' } }).data)).toThrow(
      SlipVerifierUnavailableError,
    )
  })

  it('reads the facts out of rawSlip, not out of EasySlip’s own verdicts', () => {
    // `amountInSlip`, `isAmountMatched` and `matchedAccount` are the upstream
    // answering questions we never asked it. Only rawSlip is evidence.
    const facts = parseFacts(
      aResponse({}, { amountInSlip: 999, isAmountMatched: false, matchedAccount: null }).data,
    )
    expect(facts.amount).toBe(5_000)
  })

  it('reads the last four digits out of a masked account', () => {
    expect(parseFacts(aResponse().data).receiverAccountLast4).toBe('7788')
  })

  it('keeps the receiving bank code and the transfer time', () => {
    const facts = parseFacts(aResponse().data)
    expect(facts.receiverBankCode).toBe('004')
    expect(facts.senderBank).toBe('014')
    expect(facts.transRef).toBe('20260820ABCDEF1234')
    expect(facts.transferredAt.toISOString()).toBe('2026-08-20T05:00:00.000Z')
  })

  it('keeps both name scripts, because the streamer typed theirs in one of them', () => {
    expect(parseFacts(aResponse().data).receiverNames).toEqual([
      'นาย พชรดนัย ต',
      'MR. PHATCHARADANAI T',
    ])
  })

  it('survives a receiver whose name has only one script', () => {
    // EasySlip's own example shows exactly this — `th` set, no `en`.
    const facts = parseFacts(
      aResponse({
        receiver: {
          bank: { id: '004' },
          account: { name: { th: 'บริษัท ตัวอย่าง จำกัด' }, bank: { account: 'xxx-x-x7788-x' } },
        },
      }).data,
    )
    expect(facts.receiverNames).toEqual(['บริษัท ตัวอย่าง จำกัด'])
  })

  it('reads a PromptPay transfer, which names a proxy and no account', () => {
    // The payment method this app's own QR tells every donor to use. Layer 3
    // has a whole branch for it, and it only runs if these two fields arrive.
    const facts = parseFacts(
      aResponse({
        receiver: {
          bank: { id: '004' },
          account: {
            name: { th: 'นาย พชรดนัย ต' },
            proxy: { type: 'MSISDN', account: 'xxx-xxx-6789' },
          },
        },
      }).data,
    )
    expect(facts.receiverProxyLast4).toBe('6789')
    expect(facts.receiverProxyRaw).toBe('xxx-xxx-6789')
    expect(facts.receiverAccountLast4).toBeNull()
  })

  it('turns a missing receiving bank into null rather than an empty string', () => {
    // Layer 3 reads null as "the slip does not name an account". An empty
    // string is truthy nowhere useful and falsy everywhere dangerous.
    const facts = parseFacts(
      aResponse({ receiver: { account: { name: { th: 'x' }, proxy: { account: '1234' } } } }).data,
    )
    expect(facts.receiverBankCode).toBeNull()
  })

  it('leaves an unparseable timestamp as an Invalid Date for layer 5 to refuse', () => {
    // Not thrown here: the layer whose job it is already fails closed on this,
    // and the port contract guard in submitSlip catches it before that.
    const facts = parseFacts(aResponse({ date: 'sometime' }).data)
    expect(Number.isNaN(facts.transferredAt.getTime())).toBe(true)
  })

  it('refuses a response with no data object', () => {
    expect(() => parseFacts(null)).toThrow(SlipVerifierUnavailableError)
  })

  it('refuses a response whose data carries no rawSlip', () => {
    // A 200 with the envelope but no facts is a broken upstream, not a bad
    // slip — everything downstream would read undefined as "not named".
    expect(() => parseFacts({ isDuplicate: false, matchedAccount: null })).toThrow(
      SlipVerifierUnavailableError,
    )
  })
})

describe('EasySlipVerifier — the request', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    process.env.EASYSLIP_API_KEY = 'easyslip-test-key'
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('posts to the v2 verify url with a plain bearer', async () => {
    const fetchMock = mockFetch(200, aResponse())
    global.fetch = fetchMock

    await new EasySlipVerifier().verify({ qrPayload: 'QR123' })

    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('https://api.easyslip.com/v2/verify/bank')
    expect(init.method).toBe('POST')
    expect(init.headers.authorization).toBe('Bearer easyslip-test-key')
  })

  it('never asks EasySlip to match the receiver', async () => {
    // The whole reason this adapter exists. `matchAccount: true` would compare
    // the receiver against accounts registered under OUR key, which is the
    // single-account limit we left SlipOK to escape.
    const fetchMock = mockFetch(200, aResponse())
    global.fetch = fetchMock

    await new EasySlipVerifier().verify({ qrPayload: 'QR123' })

    const body = JSON.parse(fetchMock.mock.calls[0]?.[1].body)
    expect(body.matchAccount).toBeUndefined()
    expect(body.matchAmount).toBeUndefined()
  })

  it('sends a QR payload as payload', async () => {
    const fetchMock = mockFetch(200, aResponse())
    global.fetch = fetchMock

    await new EasySlipVerifier().verify({ qrPayload: 'QR123' })

    expect(JSON.parse(fetchMock.mock.calls[0]?.[1].body)).toEqual({
      checkDuplicate: true,
      payload: 'QR123',
    })
  })

  it('sends an image as base64', async () => {
    const fetchMock = mockFetch(200, aResponse())
    global.fetch = fetchMock

    await new EasySlipVerifier().verify({ imageBase64: 'BASE64' })

    expect(JSON.parse(fetchMock.mock.calls[0]?.[1].body)).toEqual({
      checkDuplicate: true,
      base64: 'BASE64',
    })
  })

  it('accepts a cached duplicate as a normal answer', async () => {
    // checkDuplicate is on for the QUOTA, not for the dedupe — a resubmitted
    // photo comes back from cache without spending a verification. Layer 2 is
    // ours and settles on a unique index, so `isDuplicate` decides nothing.
    global.fetch = mockFetch(200, aResponse({}, { isDuplicate: true }))

    const facts = await new EasySlipVerifier().verify({ qrPayload: 'QR123' })
    expect(facts.transRef).toBe('20260820ABCDEF1234')
  })
})

describe('EasySlipVerifier — whose fault is it', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    process.env.EASYSLIP_API_KEY = 'easyslip-test-key'
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it.each([
    ['SLIP_NOT_FOUND', 'not_found'],
    ['INVALID_IMAGE_FORMAT', 'unreadable'],
    ['INVALID_IMAGE_TYPE', 'unreadable'],
    ['IMAGE_SIZE_TOO_LARGE', 'unreadable'],
  ])('tells the donor about %s', async (code, reason) => {
    global.fetch = mockFetch(404, { success: false, error: { code, message: 'from easyslip' } })

    await expect(new EasySlipVerifier().verify({ qrPayload: 'x' })).rejects.toMatchObject({
      name: 'SlipRejectedError',
      reason,
    })
  })

  it('does NOT tell the donor a pending Bangkok Bank slip does not exist', async () => {
    // SLIP_PENDING is the one 404 that is not terminal: the transfer is under
    // five minutes old and the bank has not published it yet. Calling it
    // not_found would refuse a real transfer at the exact moment when trying
    // again is the right advice.
    global.fetch = mockFetch(404, {
      success: false,
      error: { code: 'SLIP_PENDING', message: 'Bangkok Bank slip is pending' },
    })

    const error = await new EasySlipVerifier().verify({ qrPayload: 'x' }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(SlipVerifierUnavailableError)
    expect(error).not.toBeInstanceOf(SlipRejectedError)
  })

  it.each([
    ['MISSING_API_KEY', 'we sent no key'],
    ['INVALID_API_KEY', 'bad key'],
    ['QUOTA_EXCEEDED', 'out of quota'],
    ['RATE_LIMIT_EXCEEDED', 'too fast'],
    ['IP_NOT_ALLOWED', 'whitelist'],
    ['BRANCH_INACTIVE', 'branch switched off'],
    ['SERVICE_BANNED', 'terms'],
    ['VALIDATION_ERROR', 'we built a bad request'],
    ['API_SERVER_ERROR', 'their upstream'],
  ])('keeps %s (%s) as OUR problem, not the donor’s', async (code) => {
    // 503, never 422. Out of quota is the one that matters most: it is the
    // failure a busy streamer will actually hit, and it would otherwise tell
    // every paying donor their genuine slip is fake.
    global.fetch = mockFetch(403, { success: false, error: { code, message: 'x' } })

    const error = await new EasySlipVerifier().verify({ qrPayload: 'x' }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(SlipVerifierUnavailableError)
    expect(error).not.toBeInstanceOf(SlipRejectedError)
  })

  it('treats an unknown code as unavailable rather than guessing', async () => {
    global.fetch = mockFetch(400, { success: false, error: { code: 'NEW_IN_V3', message: 'x' } })
    await expect(new EasySlipVerifier().verify({ qrPayload: 'x' })).rejects.toBeInstanceOf(
      SlipVerifierUnavailableError,
    )
  })

  it('refuses a 200 whose body says success:false', async () => {
    // The envelope carries the verdict, not the status line, so a 200 alone is
    // not agreement.
    global.fetch = mockFetch(200, { success: false, error: { code: 'SLIP_NOT_FOUND' } })
    await expect(new EasySlipVerifier().verify({ qrPayload: 'x' })).rejects.toBeInstanceOf(
      SlipRejectedError,
    )
  })

  it('treats a network failure as unavailable', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('ETIMEDOUT'))
    await expect(new EasySlipVerifier().verify({ qrPayload: 'x' })).rejects.toBeInstanceOf(
      SlipVerifierUnavailableError,
    )
  })

  it('treats an unparseable body as unavailable', async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response('<html>502</html>', { status: 502 }))
    await expect(new EasySlipVerifier().verify({ qrPayload: 'x' })).rejects.toBeInstanceOf(
      SlipVerifierUnavailableError,
    )
  })
})
