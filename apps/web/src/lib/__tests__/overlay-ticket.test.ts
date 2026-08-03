import { jwtVerify } from 'jose'
import { describe, expect, it } from 'vitest'
import {
  TICKET_AUDIENCE,
  TICKET_ISSUER,
  TICKET_TTL_SECONDS,
  ticketOutcome,
} from '@dp/shared'
import {
  checkOverlayGate,
  overlayTicketRateKey,
  signOverlayTicket,
} from '@/lib/realtime/ticket'

const SECRET = 'test-secret-not-a-real-one'
const key = (s: string) => new TextEncoder().encode(s)

const streamer = { id: 'str_1', isActive: true, isSuspended: false }

describe('checkOverlayGate', () => {
  it('admits a live streamer', () => {
    expect(checkOverlayGate(streamer)).toEqual({ ok: true, streamerId: 'str_1' })
  })

  /**
   * The rotate case. A rotated token matches no row, and 404 is what tells the
   * client to stop instead of looping until it trips the rate limit on this
   * same endpoint — the second livelock in DESIGN.md 8.5.
   */
  it('404s an unknown or rotated token, and that means stop', () => {
    const gate = checkOverlayGate(null)
    expect(gate).toMatchObject({ ok: false, status: 404 })
    expect(ticketOutcome(404)).toEqual({ action: 'stop', reason: 'token-invalid' })
  })

  it('403s a suspended streamer, and that also means stop', () => {
    const gate = checkOverlayGate({ ...streamer, isSuspended: true })
    expect(gate).toMatchObject({ ok: false, status: 403 })
    expect(ticketOutcome(403)).toEqual({ action: 'stop', reason: 'suspended' })
  })

  /**
   * Deliberate: isActive is the streamer's own temporary switch, and refusing
   * would be a terminal 403 that leaves the overlay dead until OBS restarts.
   * No donation can exist while it is off, so the socket just carries nothing.
   */
  it('still issues to an inactive streamer', () => {
    expect(checkOverlayGate({ ...streamer, isActive: false })).toEqual({
      ok: true,
      streamerId: 'str_1',
    })
  })

  it('checks suspension even when inactive', () => {
    expect(
      checkOverlayGate({ ...streamer, isActive: false, isSuspended: true }),
    ).toMatchObject({ status: 403 })
  })
})

describe('overlayTicketRateKey', () => {
  it('never contains the token itself', () => {
    const token = 'clv0verlaytoken0000000'
    expect(overlayTicketRateKey(token)).not.toContain(token)
  })

  it('is stable per token and distinct across tokens', () => {
    expect(overlayTicketRateKey('a')).toBe(overlayTicketRateKey('a'))
    expect(overlayTicketRateKey('a')).not.toBe(overlayTicketRateKey('b'))
  })
})

describe('signOverlayTicket', () => {
  it('produces a ticket the realtime side can verify offline', async () => {
    const { ticket, expiresInSeconds } = await signOverlayTicket('str_1', SECRET)

    const { payload, protectedHeader } = await jwtVerify(ticket, key(SECRET), {
      issuer: TICKET_ISSUER,
      audience: TICKET_AUDIENCE,
    })

    expect(protectedHeader.alg).toBe('HS256')
    expect(payload.sub).toBe('str_1')
    expect(payload.jti).toBeTruthy()
    expect(expiresInSeconds).toBe(TICKET_TTL_SECONDS)
    expect(payload.exp! - payload.iat!).toBe(TICKET_TTL_SECONDS)
  })

  /**
   * The jti is what makes a ticket single-use. If it ever repeated, the WS
   * server's seen-set would reject the second legitimate connect — the failure
   * would look like a flaky network, not a bug.
   */
  it('never reuses a jti', async () => {
    const seen = new Set<string>()
    for (let i = 0; i < 200; i++) {
      const { jti } = await signOverlayTicket('str_1', SECRET)
      expect(seen.has(jti)).toBe(false)
      seen.add(jti)
    }
  })

  it('is rejected by a different secret', async () => {
    const { ticket } = await signOverlayTicket('str_1', SECRET)
    await expect(jwtVerify(ticket, key('another-secret'))).rejects.toThrow()
  })

  /**
   * Guards the pair of claims the realtime verifier will pin. Without them a
   * ticket would also satisfy any other token type that ever shares this secret.
   */
  it('is rejected when the audience does not match', async () => {
    const { ticket } = await signOverlayTicket('str_1', SECRET)
    await expect(
      jwtVerify(ticket, key(SECRET), { audience: 'someone-else' }),
    ).rejects.toThrow()
  })

  it('is expired 61 seconds later', async () => {
    const minuteAgo = Date.now() - 61_000
    const { ticket } = await signOverlayTicket('str_1', SECRET, { now: () => minuteAgo })

    await expect(
      jwtVerify(ticket, key(SECRET), { issuer: TICKET_ISSUER, audience: TICKET_AUDIENCE }),
    ).rejects.toThrow()
  })

  it('is still valid within its window', async () => {
    const halfWayIn = Date.now() - 30_000
    const { ticket } = await signOverlayTicket('str_1', SECRET, { now: () => halfWayIn })

    const { payload } = await jwtVerify(ticket, key(SECRET), {
      issuer: TICKET_ISSUER,
      audience: TICKET_AUDIENCE,
    })
    expect(payload.sub).toBe('str_1')
  })
})
