import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { mapStatus, verifyOmiseSignature } from '../payments/omise'

/**
 * The signature check is the whole security boundary of the webhook route:
 * everything past it is trusted enough to be written to the database. It is
 * also the only part of OmiseProvider that can be tested without a network.
 *
 * Spec checked against docs.omise.co/api-webhooks on 2026-08-01 — HMAC-SHA256
 * over `<timestamp>.<raw body>`, keyed by the BASE64-DECODED secret, hex out.
 */

const SECRET_B64 = Buffer.from('omise-webhook-secret').toString('base64')
const BODY = '{"id":"evnt_test_1","key":"charge.complete","data":{"id":"chrg_test_1"}}'

function sign(body: string, timestamp: string, secretB64 = SECRET_B64): string {
  return createHmac('sha256', Buffer.from(secretB64, 'base64'))
    .update(`${timestamp}.${body}`)
    .digest('hex')
}

function headers(signature: string, timestamp: string): Headers {
  return new Headers({
    'omise-signature': signature,
    'omise-signature-timestamp': timestamp,
  })
}

const NOW = new Date('2026-08-01T10:00:00.000Z')
const TS = String(Math.floor(NOW.getTime() / 1000))

describe('verifyOmiseSignature', () => {
  it('accepts a correctly signed body', () => {
    expect(verifyOmiseSignature(BODY, headers(sign(BODY, TS), TS), SECRET_B64, NOW)).toBe(true)
  })

  /**
   * The reason the route reads req.text() instead of req.json(): a body that
   * round-trips through JSON.parse and back is a different byte string, and
   * would fail here even though nobody tampered with it.
   */
  it('rejects a body altered after signing', () => {
    const tampered = BODY.replace('chrg_test_1', 'chrg_test_evil')
    expect(verifyOmiseSignature(tampered, headers(sign(BODY, TS), TS), SECRET_B64, NOW)).toBe(false)
  })

  it('rejects a signature made with another secret', () => {
    const otherSecret = Buffer.from('not-the-secret').toString('base64')
    const sig = sign(BODY, TS, otherSecret)
    expect(verifyOmiseSignature(BODY, headers(sig, TS), SECRET_B64, NOW)).toBe(false)
  })

  /**
   * The timestamp is inside the signed payload, so a replayer cannot simply
   * swap in a fresh one — but an untouched replay of a genuine old delivery
   * still has to be refused.
   */
  it('rejects a signature older than the tolerance window', () => {
    const old = String(Math.floor(NOW.getTime() / 1000) - 400)
    expect(verifyOmiseSignature(BODY, headers(sign(BODY, old), old), SECRET_B64, NOW)).toBe(false)
  })

  it('rejects a timestamp far in the future too', () => {
    const ahead = String(Math.floor(NOW.getTime() / 1000) + 400)
    expect(verifyOmiseSignature(BODY, headers(sign(BODY, ahead), ahead), SECRET_B64, NOW)).toBe(false)
  })

  /**
   * During a secret rotation Omise sends both signatures, comma separated.
   * Checking only the first would reject every webhook in that window.
   */
  it('accepts either signature while a secret is being rotated', () => {
    const oldSecret = Buffer.from('previous-secret').toString('base64')
    const both = `${sign(BODY, TS, oldSecret)}, ${sign(BODY, TS)}`
    expect(verifyOmiseSignature(BODY, headers(both, TS), SECRET_B64, NOW)).toBe(true)

    const neither = `${sign(BODY, TS, oldSecret)}, ${sign('other', TS, oldSecret)}`
    expect(verifyOmiseSignature(BODY, headers(neither, TS), SECRET_B64, NOW)).toBe(false)
  })

  it('rejects a request with no signature headers at all', () => {
    expect(verifyOmiseSignature(BODY, new Headers(), SECRET_B64, NOW)).toBe(false)
    expect(verifyOmiseSignature(BODY, headers(sign(BODY, TS), ''), SECRET_B64, NOW)).toBe(false)
  })

  it('rejects a non-numeric timestamp instead of treating it as 0', () => {
    expect(verifyOmiseSignature(BODY, headers(sign(BODY, 'abc'), 'abc'), SECRET_B64, NOW)).toBe(false)
  })

  it('refuses to verify against an empty secret', () => {
    expect(verifyOmiseSignature(BODY, headers(sign(BODY, TS), TS), '', NOW)).toBe(false)
  })
})

describe('mapStatus', () => {
  it('maps the settled-negative statuses onto failed', () => {
    // 'expired' and 'reversed' are not "still waiting" — treating them as
    // pending would keep the reconciler retrying a charge that is over.
    expect(mapStatus('failed')).toBe('failed')
    expect(mapStatus('expired')).toBe('failed')
    expect(mapStatus('reversed')).toBe('failed')
  })

  it('maps successful and pending straight through', () => {
    expect(mapStatus('successful')).toBe('successful')
    expect(mapStatus('pending')).toBe('pending')
  })

  it('throws on a status it does not know rather than guessing', () => {
    // A new Omise status must surface as a failed webhook the reconciler
    // retries and a human sees, not as a silent "not paid yet".
    expect(() => mapStatus('something_new')).toThrow(/unknown omise charge status/)
  })
})
