import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The gate on every /api/me/* route.
 *
 * The case worth a test is the ADMIN one. An admin has a perfectly valid
 * session and no Streamer row, so `session.user.streamerId` is null — and
 * Prisma does not throw on `where: { id: null }`, it matches nothing. A route
 * that skipped this check would return 200, write nothing, and look like it
 * worked.
 */

const getServerSession = vi.fn()
const findUniqueUser = vi.fn()
const findUniqueStreamer = vi.fn()

vi.mock('next-auth', () => ({ getServerSession: () => getServerSession() }))
// Stubbed so importing the gate does not drag in Prisma and bcrypt; the gate
// only ever passes authOptions through.
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/db', () => ({
  db: {
    user: { findUnique: (...a: unknown[]) => findUniqueUser(...a) },
    streamer: { findUnique: (...a: unknown[]) => findUniqueStreamer(...a) },
  },
}))

const { requireAdmin, requireStreamer, sessionErrorResponse } = await import('@/lib/api-session')

beforeEach(() => {
  getServerSession.mockReset()
  findUniqueUser.mockReset()
  findUniqueStreamer.mockReset()
  // The common case: a live, unsuspended streamer.
  findUniqueStreamer.mockResolvedValue({ isSuspended: false })
})

describe('requireStreamer', () => {
  it('passes the streamerId through from the session, never from the request', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'usr_1', streamerId: 'str_1' } })
    await expect(requireStreamer()).resolves.toEqual({
      ok: true,
      streamerId: 'str_1',
      userId: 'usr_1',
    })
  })

  it('401s an anonymous caller', async () => {
    getServerSession.mockResolvedValue(null)
    await expect(requireStreamer()).resolves.toMatchObject({ ok: false, status: 401 })
  })

  /**
   * 403, not 401: signing in again would change nothing. This account is
   * authenticated and simply is not a streamer.
   */
  it('403s a signed-in account with no streamer profile', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'usr_admin', streamerId: null } })
    await expect(requireStreamer()).resolves.toMatchObject({ ok: false, status: 403 })
  })

  /**
   * The admin screen's button says "ระงับบัญชี". Before this check the flag
   * only closed the public donate page and the overlay — the account could
   * still edit its profile, take a different slug, rotate its overlay token and
   * fire test alerts, which is not what an operator reading that button
   * believes they just did.
   */
  it('403s a suspended streamer, whatever the session says', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'usr_1', streamerId: 'str_1' } })
    findUniqueStreamer.mockResolvedValue({ isSuspended: true })

    await expect(requireStreamer()).resolves.toMatchObject({
      ok: false,
      status: 403,
      error: 'บัญชีนี้ถูกระงับชั่วคราว',
    })
  })

  it('reads the suspension from the database, not the token', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'usr_1', streamerId: 'str_1' } })
    await requireStreamer()
    // A streamer suspended mid-session keeps a valid JWT this app cannot
    // revoke, so the flag has to be re-read on every call.
    expect(findUniqueStreamer).toHaveBeenCalledWith({
      where: { id: 'str_1' },
      select: { isSuspended: true },
    })
  })

  it('403s when the streamer row has been deleted', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'usr_1', streamerId: 'str_gone' } })
    findUniqueStreamer.mockResolvedValue(null)
    await expect(requireStreamer()).resolves.toMatchObject({ ok: false, status: 403 })
  })

  it('does not query at all for an account with no streamer profile', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'usr_admin', streamerId: null } })
    await requireStreamer()
    expect(findUniqueStreamer).not.toHaveBeenCalled()
  })

  it('renders the failure as a no-store JSON response', async () => {
    getServerSession.mockResolvedValue(null)
    const failure = await requireStreamer()
    if (failure.ok) throw new Error('expected a failure')

    const res = sessionErrorResponse(failure)
    expect(res.status).toBe(401)
    // The body of a 401 is not sensitive, but caching any /api/me/* answer
    // would be — a shared cache could hand one streamer another's response.
    expect(res.headers.get('cache-control')).toBe('no-store')
    await expect(res.json()).resolves.toEqual({ error: 'ต้องเข้าสู่ระบบก่อน' })
  })
})

/**
 * The gate on the only screen that can suspend other people's accounts.
 *
 * The reason it is not `session.user.role === 'ADMIN'` is the case in the last
 * test here: the role is written into a JWT once, at sign-in, and this app has
 * no way to revoke that token. An account demoted from ADMIN would keep every
 * admin power until it happened to sign in again — which could be never.
 */
describe('requireAdmin', () => {
  it('admits an account the database says is an admin', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'usr_admin' } })
    findUniqueUser.mockResolvedValue({ role: 'ADMIN' })

    await expect(requireAdmin()).resolves.toEqual({ ok: true, userId: 'usr_admin' })
    expect(findUniqueUser).toHaveBeenCalledWith({
      where: { id: 'usr_admin' },
      select: { role: true },
    })
  })

  it('401s an anonymous caller without touching the database', async () => {
    getServerSession.mockResolvedValue(null)
    await expect(requireAdmin()).resolves.toMatchObject({ ok: false, status: 401 })
    expect(findUniqueUser).not.toHaveBeenCalled()
  })

  it('403s a signed-in streamer', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'usr_1' } })
    findUniqueUser.mockResolvedValue({ role: 'STREAMER' })
    await expect(requireAdmin()).resolves.toMatchObject({ ok: false, status: 403 })
  })

  it('403s when the user row has gone', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'usr_deleted' } })
    findUniqueUser.mockResolvedValue(null)
    await expect(requireAdmin()).resolves.toMatchObject({ ok: false, status: 403 })
  })

  it('believes the database over a session that still claims ADMIN', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'usr_demoted', role: 'ADMIN' } })
    findUniqueUser.mockResolvedValue({ role: 'STREAMER' })
    await expect(requireAdmin()).resolves.toMatchObject({ ok: false, status: 403 })
  })
})
