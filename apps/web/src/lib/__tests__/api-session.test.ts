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

vi.mock('next-auth', () => ({ getServerSession: () => getServerSession() }))
// Stubbed so importing the gate does not drag in Prisma and bcrypt; the gate
// only ever passes authOptions through.
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

const { requireStreamer, sessionErrorResponse } = await import('@/lib/api-session')

beforeEach(() => getServerSession.mockReset())

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
