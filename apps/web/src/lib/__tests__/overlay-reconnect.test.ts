import { describe, expect, it } from 'vitest'
import { CloseCode } from '@dp/shared'
import { afterClose, afterTicket } from '@/lib/overlay/reconnect'

/** Pins the jitter so a delay can be asserted exactly. 0 => the 50% floor. */
const noJitter = { random: () => 0 }

describe('afterClose', () => {
  it('retries a bad ticket, because that is usually just expiry', () => {
    expect(afterClose(CloseCode.BAD_TICKET, 0, noJitter)).toMatchObject({ action: 'retry' })
  })

  it('retries an abnormal close — a dropped connection reports 1006', () => {
    expect(afterClose(1006, 0, noJitter)).toMatchObject({ action: 'retry' })
  })

  it('retries a server restart', () => {
    expect(afterClose(CloseCode.SERVICE_RESTART, 0, noJitter)).toMatchObject({ action: 'retry' })
  })

  /**
   * The livelock DESIGN.md 8.1 was rewritten to prevent. The server rejects the
   * NEWCOMER rather than evicting a live overlay, so a newcomer that retries is
   * knocking on a door that will never open -- and with six tabs open they
   * would rotate-kill each other forever.
   */
  it('STOPS on a full quota', () => {
    expect(afterClose(CloseCode.QUOTA_FULL, 0)).toEqual({
      action: 'stop',
      reason: 'quota-full',
    })
  })

  it('STOPS on suspension, which the streamer cannot undo', () => {
    expect(afterClose(CloseCode.SUSPENDED, 0)).toEqual({ action: 'stop', reason: 'suspended' })
  })

  it('grows the delay with each consecutive failure', () => {
    const delayAt = (attempt: number) => {
      const decision = afterClose(1006, attempt, noJitter)
      if (decision.action !== 'retry') throw new Error(`expected retry, got ${decision.action}`)
      return decision.delayMs
    }

    expect([0, 1, 2, 3].map(delayAt)).toEqual([500, 1000, 2000, 4000])
  })

  it('caps the delay so a long outage does not push retries an hour apart', () => {
    const late = afterClose(1006, 20, noJitter)
    expect(late).toMatchObject({ action: 'retry', delayMs: 15_000 })
  })
})

describe('afterTicket', () => {
  it('connects on 200', () => {
    expect(afterTicket(200, undefined, 0)).toEqual({ action: 'connect' })
  })

  /**
   * The second livelock (DESIGN.md 8.5). A rotated overlayToken closes the
   * socket with 4001 -- the SAME code as an expired ticket -- because the
   * realtime service never reads the database and genuinely cannot tell them
   * apart. Only /ticket knows, and it says so with 404. Retrying here would
   * loop until it exhausted the rate limit added for exactly this case.
   */
  it('STOPS on 404, the rotated-token case', () => {
    expect(afterTicket(404, undefined, 0)).toEqual({ action: 'stop', reason: 'token-invalid' })
  })

  it('STOPS on 401', () => {
    expect(afterTicket(401, undefined, 0)).toEqual({ action: 'stop', reason: 'token-invalid' })
  })

  it('STOPS on 403, the suspended case', () => {
    expect(afterTicket(403, undefined, 0)).toEqual({ action: 'stop', reason: 'suspended' })
  })

  it('retries a 500 — the web app being down is not a refusal', () => {
    expect(afterTicket(500, undefined, 0, noJitter)).toMatchObject({ action: 'retry' })
  })

  it('retries status 0, which is what the caller passes for a network failure', () => {
    expect(afterTicket(0, undefined, 0, noJitter)).toMatchObject({ action: 'retry' })
  })

  it('never comes back sooner than Retry-After asked', () => {
    // Backoff at attempt 0 is 500ms; the server asked for 12s and wins.
    expect(afterTicket(429, 12, 0, noJitter)).toMatchObject({ action: 'retry', delayMs: 12_000 })
  })

  it('keeps the longer backoff when Retry-After is shorter than it', () => {
    // Attempt 10 is capped at 30s (15s at this jitter); a 1s Retry-After must
    // not reset a client that has been failing for minutes.
    expect(afterTicket(429, 1, 10, noJitter)).toMatchObject({ delayMs: 15_000 })
  })

  it('advances the attempt counter so the next wait is longer', () => {
    const first = afterTicket(500, undefined, 0, noJitter)
    expect(first).toMatchObject({ attempt: 1 })
  })
})
