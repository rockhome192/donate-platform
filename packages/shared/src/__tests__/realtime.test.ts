import { describe, expect, it } from 'vitest'
import { CloseCode, shouldReconnect, ticketOutcome } from '../realtime.js'

describe('shouldReconnect', () => {
  it('retries on a recoverable close', () => {
    expect(shouldReconnect(CloseCode.BAD_TICKET)).toBe(true)
    expect(shouldReconnect(CloseCode.SERVICE_RESTART)).toBe(true)
  })

  it('stops permanently when the streamer is suspended', () => {
    expect(shouldReconnect(CloseCode.SUSPENDED)).toBe(false)
  })

  /**
   * Regression guard for the livelock in the first draft: quota was enforced by
   * evicting the OLDEST socket while 4003 was documented as retryable, so six
   * overlays would kill each other in a loop forever.
   *
   * The rule now: the newcomer is refused and must not come back.
   */
  it('stops permanently on QUOTA_FULL so overlays cannot rotate-kill each other', () => {
    expect(shouldReconnect(CloseCode.QUOTA_FULL)).toBe(false)
  })

  it('retries on an abnormal close (network drop = 1006)', () => {
    expect(shouldReconnect(1006)).toBe(true)
    expect(shouldReconnect(1001)).toBe(true)
  })
})

describe('ticketOutcome', () => {
  it('connects on 200', () => {
    expect(ticketOutcome(200)).toEqual({ action: 'connect' })
  })

  /**
   * Second livelock, same shape as the 4003 one above but a layer down.
   *
   * Rotating the token closes live sockets with 4001, which shouldReconnect
   * (correctly) calls retryable — an expired ticket is the common case. But the
   * overlayToken sitting in the OBS URL is now dead, so every reconnect asks
   * /ticket again and gets 404 again, forever, against the very rate limit that
   * endpoint carries. The status has to be the thing that stops it.
   */
  it('stops permanently when the token was rotated away', () => {
    expect(ticketOutcome(404)).toEqual({ action: 'stop', reason: 'token-invalid' })
    expect(ticketOutcome(401)).toEqual({ action: 'stop', reason: 'token-invalid' })
  })

  it('stops permanently when the streamer is suspended', () => {
    expect(ticketOutcome(403)).toEqual({ action: 'stop', reason: 'suspended' })
  })

  it('honours Retry-After on 429 instead of the usual backoff', () => {
    expect(ticketOutcome(429, 12)).toEqual({ action: 'retry', retryAfterMs: 12_000 })
    expect(ticketOutcome(429)).toEqual({ action: 'retry' })
  })

  it('retries when the web app is merely broken, not refusing', () => {
    expect(ticketOutcome(500)).toEqual({ action: 'retry' })
    expect(ticketOutcome(502)).toEqual({ action: 'retry' })
    expect(ticketOutcome(0)).toEqual({ action: 'retry' })
  })
})
