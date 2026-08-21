import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SlipRejectedError, SlipVerifierUnavailableError } from '../payments/slip-types'
import { parseFacts, SlipOkVerifier } from '../payments/slipok'

/**
 * The SlipOK adapter.
 *
 * The request shape, the `x-authorization` header and the `{ code, message }`
 * error envelope were all confirmed against the live API with a real key
 * before any of this was written. What is on trial here is the translation:
 * SlipOK's vocabulary into ours, baht into satang, and a masked account number
 * into something layer 3 can compare — with everything ambiguous failing
 * closed rather than guessing.
 */

/** The documented success payload, with the values a real transfer would have. */
function aResponse(data: Record<string, unknown> = {}) {
  return {
    success: true,
    data: {
      success: true,
      message: 'ตรวจสอบสำเร็จ',
      receivingBank: '004',
      sendingBank: '014',
      transRef: '20260820ABCDEF1234',
      transDate: '20260820',
      transTime: '12:00:00',
      transTimestamp: '2026-08-20T12:00:00+07:00',
      sender: { displayName: 'ROCK T', name: 'ROCK T', account: { type: 'BANKAC', value: 'xxx-x-x1111-x' } },
      receiver: {
        displayName: 'PHATCHARADANAI T',
        name: 'PHATCHARADANAI T',
        account: { type: 'BANKAC', value: 'xxx-x-x7788-x' },
      },
      amount: 50,
      countryCode: 'TH',
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
    expect(parseFacts(aResponse({ amount: 20.25 }).data).amount).toBe(2_025)
  })

  it('refuses an amount with sub-satang precision instead of rounding it away', () => {
    expect(() => parseFacts(aResponse({ amount: 20.2567 }).data)).toThrow(
      SlipVerifierUnavailableError,
    )
  })

  it('refuses an amount that is not a number at all', () => {
    expect(() => parseFacts(aResponse({ amount: 'fifty' }).data)).toThrow(
      SlipVerifierUnavailableError,
    )
  })

  it('reads the last four digits out of a masked account', () => {
    expect(parseFacts(aResponse().data).receiverAccountLast4).toBe('7788')
  })

  it('keeps the bank code and the transfer time', () => {
    const facts = parseFacts(aResponse().data)
    expect(facts.receiverBankCode).toBe('004')
    expect(facts.transRef).toBe('20260820ABCDEF1234')
    expect(facts.transferredAt.toISOString()).toBe('2026-08-20T05:00:00.000Z')
  })

  it('leaves an unparseable timestamp as an Invalid Date for layer 5 to refuse', () => {
    // Not thrown here: the layer whose job it is already fails closed on this,
    // and the port contract guard in submitSlip catches it before that.
    const facts = parseFacts(aResponse({ transTimestamp: 'sometime' }).data)
    expect(Number.isNaN(facts.transferredAt.getTime())).toBe(true)
  })

  it('refuses a response with no data object', () => {
    expect(() => parseFacts(null)).toThrow(SlipVerifierUnavailableError)
  })
})

describe('SlipOkVerifier — the request', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    process.env.SLIPOK_API_KEY = 'SLIPOK-test-key'
    process.env.SLIPOK_BRANCH_ID = '99999'
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('posts to the branch url with the key in x-authorization', async () => {
    // A plain `Authorization` header is refused with 1002 — checked live.
    const fetchMock = mockFetch(200, aResponse())
    global.fetch = fetchMock

    await new SlipOkVerifier().verify({ qrPayload: 'QR123' })

    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('https://api.slipok.com/api/line/apikey/99999')
    expect(init.method).toBe('POST')
    expect(init.headers['x-authorization']).toBe('SLIPOK-test-key')
  })

  it('always sends log:true, which is what makes this layer 1 at all', async () => {
    // Without it the call is a QR parse, and a QR carries no amount and no
    // account — the whole reason a slip cannot be verified offline.
    const fetchMock = mockFetch(200, aResponse())
    global.fetch = fetchMock

    await new SlipOkVerifier().verify({ qrPayload: 'QR123' })

    expect(JSON.parse(fetchMock.mock.calls[0]?.[1].body)).toEqual({ log: true, data: 'QR123' })
  })

  it('sends an image as files rather than data', async () => {
    const fetchMock = mockFetch(200, aResponse())
    global.fetch = fetchMock

    await new SlipOkVerifier().verify({ imageBase64: 'BASE64' })

    expect(JSON.parse(fetchMock.mock.calls[0]?.[1].body)).toEqual({ log: true, files: 'BASE64' })
  })
})

describe('SlipOkVerifier — whose fault is it', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    process.env.SLIPOK_API_KEY = 'SLIPOK-test-key'
    process.env.SLIPOK_BRANCH_ID = '99999'
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it.each([
    [1006, 'unreadable'],
    [1007, 'unreadable'],
    [1008, 'unreadable'],
    [1011, 'not_found'],
    [1012, 'duplicate'],
    [1013, 'wrong_amount'],
    [1014, 'wrong_receiver'],
  ])('tells the donor about code %i', async (code, reason) => {
    global.fetch = mockFetch(400, { code, message: 'ข้อความจาก SlipOK' })

    await expect(new SlipOkVerifier().verify({ qrPayload: 'x' })).rejects.toMatchObject({
      name: 'SlipRejectedError',
      reason,
    })
  })

  it.each([
    [1000, 'we sent nothing'],
    [1001, 'wrong branch'],
    [1002, 'bad key'],
    [1003, 'expired package'],
    [1004, 'over quota'],
    [1009, 'bank data unavailable'],
    [1010, 'bank delay'],
  ])('keeps code %i (%s) as OUR problem, not the donor’s', async (code) => {
    // 503, never 422. Out of quota is the one that matters most: it is the
    // failure a busy streamer will actually hit, and it would otherwise tell
    // every paying donor their genuine slip is fake.
    global.fetch = mockFetch(400, { code, message: 'x' })

    const error = await new SlipOkVerifier()
      .verify({ qrPayload: 'x' })
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(SlipVerifierUnavailableError)
    expect(error).not.toBeInstanceOf(SlipRejectedError)
  })

  it('treats an unknown code as unavailable rather than guessing', async () => {
    global.fetch = mockFetch(400, { code: 1099, message: 'new in v2' })
    await expect(new SlipOkVerifier().verify({ qrPayload: 'x' })).rejects.toBeInstanceOf(
      SlipVerifierUnavailableError,
    )
  })

  it('treats a network failure as unavailable', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('ETIMEDOUT'))
    await expect(new SlipOkVerifier().verify({ qrPayload: 'x' })).rejects.toBeInstanceOf(
      SlipVerifierUnavailableError,
    )
  })

  it('treats an unparseable body as unavailable', async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response('<html>502</html>', { status: 502 }))
    await expect(new SlipOkVerifier().verify({ qrPayload: 'x' })).rejects.toBeInstanceOf(
      SlipVerifierUnavailableError,
    )
  })
})
