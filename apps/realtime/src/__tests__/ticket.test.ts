import { SignJWT } from 'jose'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  TICKET_AUDIENCE,
  TICKET_CLOCK_TOLERANCE_SECONDS,
  TICKET_ISSUER,
  TICKET_TTL_SECONDS,
} from '@dp/shared'
import { SeenTickets, verifyTicket } from '../ticket.js'

const SECRET = 'test-secret-shared-with-web'
const key = (s: string) => new TextEncoder().encode(s)

/** Mirrors apps/web/src/lib/realtime/ticket.ts. If these drift, nothing connects. */
async function issue(
  overrides: {
    sub?: string
    jti?: string
    issuer?: string
    audience?: string
    secret?: string
    issuedAt?: number
    ttl?: number
    alg?: 'HS256' | 'HS512'
  } = {},
) {
  const iat = overrides.issuedAt ?? Math.floor(Date.now() / 1000)
  return new SignJWT({})
    .setProtectedHeader({ alg: overrides.alg ?? 'HS256', typ: 'JWT' })
    .setIssuer(overrides.issuer ?? TICKET_ISSUER)
    .setAudience(overrides.audience ?? TICKET_AUDIENCE)
    .setSubject(overrides.sub ?? 'str_1')
    .setJti(overrides.jti ?? crypto.randomUUID())
    .setIssuedAt(iat)
    .setExpirationTime(iat + (overrides.ttl ?? TICKET_TTL_SECONDS))
    .sign(key(overrides.secret ?? SECRET))
}

describe('verifyTicket', () => {
  let seen: SeenTickets

  beforeEach(() => {
    seen = new SeenTickets()
  })

  it('admits a ticket signed by the web app', async () => {
    const result = await verifyTicket(await issue(), SECRET, seen)
    expect(result).toMatchObject({ ok: true, streamerId: 'str_1' })
  })

  it('rejects an empty ticket without touching the seen set', async () => {
    expect(await verifyTicket('', SECRET, seen)).toEqual({ ok: false, reason: 'invalid' })
    expect(seen.size).toBe(0)
  })

  it('rejects a ticket signed with a different secret', async () => {
    const ticket = await issue({ secret: 'someone-elses-secret' })
    expect(await verifyTicket(ticket, SECRET, seen)).toEqual({ ok: false, reason: 'invalid' })
  })

  /**
   * The pair the web side pins. Without them a ticket would also satisfy any
   * other token type that ever shares REALTIME_JWT_SECRET.
   */
  it('rejects a foreign issuer or audience', async () => {
    expect(await verifyTicket(await issue({ issuer: 'somebody-else' }), SECRET, seen)).toEqual({
      ok: false,
      reason: 'invalid',
    })
    expect(await verifyTicket(await issue({ audience: 'somebody-else' }), SECRET, seen)).toEqual({
      ok: false,
      reason: 'invalid',
    })
  })

  /** Pinning HS256 is what stops a token signed with any other supported alg. */
  it('rejects an algorithm the web app never signs with', async () => {
    const ticket = await issue({ alg: 'HS512' })
    expect(await verifyTicket(ticket, SECRET, seen)).toEqual({ ok: false, reason: 'invalid' })
  })

  it('rejects an expired ticket', async () => {
    const now = Date.now()
    const ticket = await issue({ issuedAt: Math.floor(now / 1000) - 300 })
    expect(await verifyTicket(ticket, SECRET, seen, now)).toEqual({ ok: false, reason: 'invalid' })
  })

  /**
   * Vercel and Railway do not share a clock, and a 60s ticket cannot absorb
   * much drift. Zero tolerance would reject every ticket at once during a
   * small skew, which looks exactly like an outage.
   */
  it('tolerates small clock skew in both directions', async () => {
    const now = Date.now()
    const nowSec = Math.floor(now / 1000)

    const justExpired = await issue({ issuedAt: nowSec - TICKET_TTL_SECONDS - 2 })
    expect(await verifyTicket(justExpired, SECRET, seen, now)).toMatchObject({ ok: true })

    const fromTheFuture = await issue({ issuedAt: nowSec + 3 })
    expect(await verifyTicket(fromTheFuture, SECRET, seen, now)).toMatchObject({ ok: true })
  })

  /**
   * The point of the jti: DESIGN.md 8.3 assumes an overlay URL will be shown on
   * stream, so a ticket that leaked must not open a second socket.
   */
  it('burns the ticket — a replay is refused', async () => {
    const ticket = await issue()
    expect(await verifyTicket(ticket, SECRET, seen)).toMatchObject({ ok: true })
    expect(await verifyTicket(ticket, SECRET, seen)).toEqual({ ok: false, reason: 'replayed' })
  })

  /**
   * A garbage ticket must not be able to write into server memory — otherwise
   * anyone can grow the set without ever holding a valid signature.
   */
  it('does not record a jti from an unverified ticket', async () => {
    await verifyTicket(await issue({ secret: 'wrong' }), SECRET, seen)
    await verifyTicket('not-even-a-jwt', SECRET, seen)
    expect(seen.size).toBe(0)
  })

  it('keeps two different tickets independent', async () => {
    expect(await verifyTicket(await issue(), SECRET, seen)).toMatchObject({ ok: true })
    expect(await verifyTicket(await issue(), SECRET, seen)).toMatchObject({ ok: true })
    expect(seen.size).toBe(2)
  })
})

describe('SeenTickets', () => {
  it('forgets a jti only after its expiry plus the clock tolerance', () => {
    const seen = new SeenTickets()
    const now = 1_000_000
    const forgetAfter = now + (TICKET_TTL_SECONDS + TICKET_CLOCK_TOLERANCE_SECONDS) * 1000

    expect(seen.claim('a', forgetAfter, now)).toBe(true)
    expect(seen.claim('a', forgetAfter, forgetAfter - 1)).toBe(false)
    // Past the window the entry is swept and the jti could be reused — which is
    // safe, because a ticket that old no longer verifies anyway.
    expect(seen.claim('a', forgetAfter, forgetAfter + 1)).toBe(true)
  })

  it('prunes expired entries rather than growing forever', () => {
    const seen = new SeenTickets()
    for (let i = 0; i < 50; i++) seen.claim(`t${i}`, 1_000 + i, 500)
    expect(seen.size).toBe(50)
    seen.prune(2_000)
    expect(seen.size).toBe(0)
  })
})
