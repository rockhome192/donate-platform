import { describe, expect, it } from 'vitest'
import { CloseCode, shouldReconnect } from '../realtime.js'

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
