import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { INTERNAL_SIGNATURE_PREFIX, internalSigningPayload } from '@dp/shared'
import {
  REPLAY_WINDOW_SECONDS,
  isOriginAllowed,
  signInternalRequest,
  verifyInternalRequest,
} from '../internal.js'

const SECRET = 'shared-internal-secret'
const BODY = JSON.stringify({ streamerId: 'str_1', message: { type: 'donation.alert' } })

function at(seconds: number) {
  return { timestamp: String(seconds), now: seconds * 1000 }
}

describe('verifyInternalRequest', () => {
  it('accepts a request the sender signed', () => {
    const { timestamp, now } = at(1_800_000_000)
    const result = verifyInternalRequest({
      signature: signInternalRequest(BODY, timestamp, SECRET),
      timestamp,
      rawBody: BODY,
      secret: SECRET,
      now,
    })
    expect(result).toEqual({ ok: true })
  })

  /**
   * The contract that matters most in this file. apps/web builds its signature
   * from the same @dp/shared layout; if this receiver ever spelled it
   * differently, every alert would silently stop being delivered and only
   * /missed would cover it. Rebuilding the digest straight from the shared
   * helper here is what pins that, without importing across packages.
   */
  it('is exactly the shared layout under an HMAC', () => {
    const { timestamp } = at(1_800_000_000)
    const expected =
      INTERNAL_SIGNATURE_PREFIX +
      createHmac('sha256', SECRET).update(internalSigningPayload(timestamp, BODY)).digest('hex')

    expect(signInternalRequest(BODY, timestamp, SECRET)).toBe(expected)
    // And the layout really is <timestamp>.<body> — not the body alone, which
    // is the bug this whole scheme exists to avoid.
    expect(internalSigningPayload(timestamp, BODY)).toBe(`${timestamp}.${BODY}`)
  })

  /**
   * The 2026-08-01 fix. Signing the body alone leaves X-Timestamp free to
   * edit, so a captured request stays replayable forever and the freshness
   * window guards nothing.
   */
  it('rejects a captured request whose timestamp was moved forward', () => {
    const original = at(1_800_000_000)
    const signature = signInternalRequest(BODY, original.timestamp, SECRET)

    // Attacker replays hours later and rewrites the header to look fresh.
    const replayed = at(1_800_050_000)
    expect(
      verifyInternalRequest({
        signature,
        timestamp: replayed.timestamp,
        rawBody: BODY,
        secret: SECRET,
        now: replayed.now,
      }),
    ).toEqual({ ok: false, status: 401, reason: 'bad signature' })
  })

  it('rejects a stale but correctly signed request', () => {
    const sent = at(1_800_000_000)
    const signature = signInternalRequest(BODY, sent.timestamp, SECRET)
    const later = (REPLAY_WINDOW_SECONDS + 60) * 1000

    expect(
      verifyInternalRequest({
        signature,
        timestamp: sent.timestamp,
        rawBody: BODY,
        secret: SECRET,
        now: sent.now + later,
      }),
    ).toMatchObject({ ok: false, status: 401 })
  })

  /** A far-future timestamp is as much a forgery signal as a stale one. */
  it('rejects a timestamp from the future', () => {
    const future = at(1_800_000_000)
    const signature = signInternalRequest(BODY, future.timestamp, SECRET)

    expect(
      verifyInternalRequest({
        signature,
        timestamp: future.timestamp,
        rawBody: BODY,
        secret: SECRET,
        now: future.now - (REPLAY_WINDOW_SECONDS + 60) * 1000,
      }),
    ).toMatchObject({ ok: false, status: 401 })
  })

  it('rejects a body edited after signing', () => {
    const { timestamp, now } = at(1_800_000_000)
    const signature = signInternalRequest(BODY, timestamp, SECRET)

    expect(
      verifyInternalRequest({
        signature,
        timestamp,
        rawBody: BODY.replace('str_1', 'str_2'),
        secret: SECRET,
        now,
      }),
    ).toMatchObject({ ok: false, status: 401 })
  })

  it('rejects a signature made with a different secret', () => {
    const { timestamp, now } = at(1_800_000_000)
    expect(
      verifyInternalRequest({
        signature: signInternalRequest(BODY, timestamp, 'not-the-secret'),
        timestamp,
        rawBody: BODY,
        secret: SECRET,
        now,
      }),
    ).toMatchObject({ ok: false, status: 401 })
  })

  it('separates a malformed request from an unauthorised one', () => {
    const { timestamp, now } = at(1_800_000_000)
    expect(
      verifyInternalRequest({ signature: undefined, timestamp, rawBody: BODY, secret: SECRET, now }),
    ).toMatchObject({ ok: false, status: 400 })
    expect(
      verifyInternalRequest({
        signature: signInternalRequest(BODY, timestamp, SECRET),
        timestamp: 'not-a-number',
        rawBody: BODY,
        secret: SECRET,
        now,
      }),
    ).toMatchObject({ ok: false, status: 400 })
  })

  /** A length mismatch must be false, not a thrown timingSafeEqual. */
  it('does not throw on a truncated signature', () => {
    const { timestamp, now } = at(1_800_000_000)
    expect(() =>
      verifyInternalRequest({ signature: 'sha256=aa', timestamp, rawBody: BODY, secret: SECRET, now }),
    ).not.toThrow()
  })
})

describe('isOriginAllowed', () => {
  it('allows anything when no list is configured, so a fresh clone works', () => {
    expect(isOriginAllowed('https://anywhere.example', undefined)).toBe(true)
    expect(isOriginAllowed(undefined, undefined)).toBe(true)
  })

  it('allows only listed origins once a list exists', () => {
    const list = 'https://donatr.example, http://localhost:3000'
    expect(isOriginAllowed('https://donatr.example', list)).toBe(true)
    expect(isOriginAllowed('http://localhost:3000', list)).toBe(true)
    expect(isOriginAllowed('https://evil.example', list)).toBe(false)
  })

  it('ignores a trailing slash on either side', () => {
    expect(isOriginAllowed('https://donatr.example/', 'https://donatr.example')).toBe(true)
  })

  /** A cross-origin caller can simply omit the header; that must not pass. */
  it('refuses a missing origin once a list exists', () => {
    expect(isOriginAllowed(undefined, 'https://donatr.example')).toBe(false)
  })
})
