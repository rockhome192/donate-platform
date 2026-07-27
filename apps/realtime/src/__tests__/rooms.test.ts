import { beforeEach, describe, expect, it } from 'vitest'
import { CloseCode } from '@dp/shared'
import { SocketRegistry, type Closable } from '../rooms.js'

class FakeSocket implements Closable {
  closedWith: number | null = null
  close(code: number) {
    this.closedWith = code
  }
}

describe('SocketRegistry', () => {
  let reg: SocketRegistry

  beforeEach(() => {
    reg = new SocketRegistry(5)
  })

  it('admits up to the quota', () => {
    for (let i = 0; i < 5; i++) {
      expect(reg.admit('s1', new FakeSocket()).ok).toBe(true)
    }
    expect(reg.size('s1')).toBe(5)
  })

  /**
   * Regression guard for the livelock the design review caught. Read together
   * with shared/realtime.test.ts, which pins QUOTA_FULL as non-retryable:
   * refusing the newcomer only avoids the loop if the newcomer also stays away.
   */
  it('refuses the 6th socket and leaves the first five untouched', () => {
    const live = Array.from({ length: 5 }, () => new FakeSocket())
    for (const s of live) reg.admit('s1', s)

    const newcomer = new FakeSocket()
    const result = reg.admit('s1', newcomer)

    expect(result).toEqual({
      ok: false,
      code: CloseCode.QUOTA_FULL,
      reason: 'already 5 overlays connected',
    })
    // Nobody already on air got kicked.
    expect(live.every((s) => s.closedWith === null)).toBe(true)
    expect(reg.size('s1')).toBe(5)
    expect(reg.sockets('s1')).not.toContain(newcomer)
  })

  it('frees a slot on remove so a later connect succeeds', () => {
    const first = new FakeSocket()
    reg.admit('s1', first)
    for (let i = 0; i < 4; i++) reg.admit('s1', new FakeSocket())
    expect(reg.admit('s1', new FakeSocket()).ok).toBe(false)

    reg.remove('s1', first)
    expect(reg.admit('s1', new FakeSocket()).ok).toBe(true)
  })

  it('keeps streamers isolated', () => {
    for (let i = 0; i < 5; i++) reg.admit('s1', new FakeSocket())
    expect(reg.admit('s2', new FakeSocket()).ok).toBe(true)
    expect(reg.size('s1')).toBe(5)
    expect(reg.size('s2')).toBe(1)
  })

  it('disconnectAll closes only that streamer with the given code', () => {
    const a = new FakeSocket()
    const b = new FakeSocket()
    const other = new FakeSocket()
    reg.admit('s1', a)
    reg.admit('s1', b)
    reg.admit('s2', other)

    expect(reg.disconnectAll('s1', CloseCode.BAD_TICKET)).toBe(2)
    expect(a.closedWith).toBe(CloseCode.BAD_TICKET)
    expect(b.closedWith).toBe(CloseCode.BAD_TICKET)
    expect(other.closedWith).toBeNull()
    expect(reg.size('s1')).toBe(0)
    expect(reg.size('s2')).toBe(1)
  })

  it('does not leak empty rooms', () => {
    const s = new FakeSocket()
    reg.admit('s1', s)
    reg.remove('s1', s)
    expect(reg.totalConnections()).toBe(0)
    expect(reg.size('s1')).toBe(0)
  })

  it('tolerates removing a socket that was never admitted', () => {
    expect(() => reg.remove('nobody', new FakeSocket())).not.toThrow()
  })
})
