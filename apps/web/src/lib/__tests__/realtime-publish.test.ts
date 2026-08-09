import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CloseCode, INTERNAL_SIGNATURE_PREFIX, internalSigningPayload } from '@dp/shared'
import { disconnectOverlays, isRealtimeConfigured, publishToOverlay } from '@/lib/realtime/publish'

/**
 * The web -> realtime hop (DESIGN.md 8.3.1).
 *
 * What makes this worth unit testing is the failure mode, not the happy path:
 * every mistake available here is silent. A signature over the wrong bytes, a
 * timestamp outside the MAC, a rejected POST swallowed as success — none of
 * them throws, none of them shows up in the UI, and the symptom is "alerts
 * sometimes do not appear", weeks later, on somebody else's machine.
 */

const URL_BASE = 'https://realtime.test'
const SECRET = 'internal-secret-not-a-real-one'

const SAMPLE = {
  type: 'donation.alert' as const,
  data: {
    id: 'don_1',
    donorName: 'สมชาย',
    message: 'สู้ ๆ',
    amount: 5_000,
    createdAt: '2026-08-05T00:00:00.000Z',
  },
}

type Captured = { url: string; init: RequestInit }

function mockFetch(response: { ok: boolean; status?: number; body?: unknown }) {
  const calls: Captured[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return {
        ok: response.ok,
        status: response.status ?? (response.ok ? 200 : 500),
        json: async () => response.body,
      } as Response
    }),
  )
  return calls
}

beforeEach(() => {
  process.env.REALTIME_HTTP_URL = URL_BASE
  process.env.REALTIME_INTERNAL_SECRET = SECRET
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.REALTIME_HTTP_URL
  delete process.env.REALTIME_INTERNAL_SECRET
})

/**
 * The distinction the admin screen's suspension message rests on.
 *
 * `disconnectOverlays` answers `null` for two situations that are not the same
 * thing: the service is configured and did not respond, and there is no service
 * on this deployment at all. Reporting the second as the first tells an operator
 * that a suspended streamer's overlays are still on air when no overlay can
 * exist — which is exactly the kind of false claim this project forbids, and it
 * would have fired on EVERY suspension until M2a is deployed.
 */
describe('isRealtimeConfigured', () => {
  it('is true only when both variables are set', () => {
    expect(isRealtimeConfigured()).toBe(true)

    delete process.env.REALTIME_HTTP_URL
    expect(isRealtimeConfigured()).toBe(false)

    process.env.REALTIME_HTTP_URL = URL_BASE
    delete process.env.REALTIME_INTERNAL_SECRET
    expect(isRealtimeConfigured()).toBe(false)
  })

  it('separates "no service here" from "service did not answer"', async () => {
    // Configured but refusing: null, and the caller should warn.
    mockFetch({ ok: false, status: 500 })
    expect(isRealtimeConfigured()).toBe(true)
    await expect(disconnectOverlays('str_1')).resolves.toBeNull()

    // Not configured: also null, but the caller must NOT warn about stranded
    // sockets — this is the only signal that tells the two apart.
    delete process.env.REALTIME_HTTP_URL
    delete process.env.REALTIME_INTERNAL_SECRET
    expect(isRealtimeConfigured()).toBe(false)
    await expect(disconnectOverlays('str_1')).resolves.toBeNull()
  })
})

describe('publishToOverlay', () => {
  it('signs the exact bytes it sends, with the timestamp inside the MAC', async () => {
    const calls = mockFetch({ ok: true, body: { delivered: 2 } })
    await publishToOverlay('str_1', SAMPLE)

    const { init } = calls[0]!
    const headers = init.headers as Record<string, string>
    const sentBody = init.body as string
    const timestamp = headers['x-timestamp']!

    // Recomputed over the CAPTURED body string rather than over a fresh
    // JSON.stringify of the same object. That is the whole point: the receiver
    // verifies the raw bytes off the wire, so a sender that signs one
    // serialisation and transmits another fails every request — and a test that
    // re-serialises would agree with the bug.
    const expected =
      INTERNAL_SIGNATURE_PREFIX +
      createHmac('sha256', SECRET)
        .update(internalSigningPayload(timestamp, sentBody))
        .digest('hex')

    expect(headers['x-signature']).toBe(expected)
    expect(JSON.parse(sentBody)).toEqual({ streamerId: 'str_1', message: SAMPLE })
    expect(calls[0]!.url).toBe(`${URL_BASE}/internal/publish`)
  })

  /**
   * 0 is a success. It means the streamer has no overlay open — the single most
   * useful thing the test-alert button can say, and the reason this returns a
   * count instead of a boolean.
   */
  it('returns the delivered count, including zero', async () => {
    mockFetch({ ok: true, body: { delivered: 0 } })
    await expect(publishToOverlay('str_1', SAMPLE)).resolves.toBe(0)
  })

  it('returns null — not 0 — when the service refuses', async () => {
    mockFetch({ ok: false, status: 401 })
    await expect(publishToOverlay('str_1', SAMPLE)).resolves.toBeNull()
  })

  it('returns null rather than throwing when the service is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED') }))
    // A publish failure must never propagate into the payment path: the money
    // arrived, and only a screen effect was lost (DESIGN.md 8.3.1).
    await expect(publishToOverlay('str_1', SAMPLE)).resolves.toBeNull()
  })

  it('is a no-op when realtime is not configured at all', async () => {
    delete process.env.REALTIME_HTTP_URL
    const calls = mockFetch({ ok: true, body: { delivered: 1 } })
    await expect(publishToOverlay('str_1', SAMPLE)).resolves.toBeNull()
    expect(calls).toHaveLength(0)
  })
})

describe('disconnectOverlays', () => {
  /**
   * BAD_TICKET, not a terminal code. An overlay already moved to the new URL
   * has to be able to come back; the 404 it gets from /ticket is what stops one
   * still holding the old token. The WS service cannot tell those apart because
   * it never reads the database, so the same code has to serve both.
   */
  it('defaults to 4001 and posts to /internal/disconnect', async () => {
    const calls = mockFetch({ ok: true, body: { closed: 3 } })
    await expect(disconnectOverlays('str_1')).resolves.toBe(3)

    expect(calls[0]!.url).toBe(`${URL_BASE}/internal/disconnect`)
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      streamerId: 'str_1',
      code: CloseCode.BAD_TICKET,
    })
  })

  it('carries an explicit code when one is given', async () => {
    const calls = mockFetch({ ok: true, body: { closed: 0 } })
    await disconnectOverlays('str_1', CloseCode.SUSPENDED)
    expect(JSON.parse(calls[0]!.init.body as string).code).toBe(CloseCode.SUSPENDED)
  })

  /**
   * The distinction the rotate endpoint reports to the streamer in words: a
   * failed disconnect means the old sockets are STILL RECEIVING ALERTS, which
   * is the opposite of "0 sockets were open".
   */
  it('returns null when the service could not be told, never 0', async () => {
    mockFetch({ ok: false, status: 500 })
    await expect(disconnectOverlays('str_1')).resolves.toBeNull()
  })
})
