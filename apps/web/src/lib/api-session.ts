import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'

/**
 * The session gate every `/api/me/*` route sits behind.
 *
 * It exists to make one distinction impossible to get wrong: **signed in** and
 * **owns a Streamer row** are not the same condition. An ADMIN account has a
 * valid session and no streamer, so a route that reads `session.user.streamerId`
 * without checking gets `null` — and `where: { id: null }` does not throw in
 * Prisma, it simply matches nothing. Every such route would then look like it
 * worked and silently change nobody's settings.
 *
 * The streamerId comes from the JWT, which this app signed. It is never read
 * from the request body or a query parameter, so no route below can be talked
 * into writing to another streamer's row.
 */

export type StreamerSession =
  | { ok: true; streamerId: string; userId: string }
  | { ok: false; status: 401 | 403; error: string }

export async function requireStreamer(): Promise<StreamerSession> {
  const session = await getServerSession(authOptions)

  if (!session?.user) {
    return { ok: false, status: 401, error: 'ต้องเข้าสู่ระบบก่อน' }
  }
  if (!session.user.streamerId) {
    // 403, not 401: signing in again would change nothing. This account is
    // authenticated and simply is not a streamer.
    return { ok: false, status: 403, error: 'บัญชีนี้ยังไม่มีโปรไฟล์สตรีมเมอร์' }
  }

  /**
   * Suspension has to be enforced HERE, not only on the public side.
   *
   * `isSuspended` was read by the donate page, the donation rules and the
   * overlay ticket gate — so a suspended streamer's page closed and their
   * overlay stopped — but by nothing on this path. That left an account the
   * admin screen labels "ระงับบัญชี" still able to edit its profile, take a
   * different slug, rotate its overlay token and fire test alerts. An operator
   * reading that button has every reason to believe the account is off.
   *
   * Read from the database rather than the session for the same reason as
   * requireAdmin: the JWT is written once at sign-in and this app cannot revoke
   * it, so a streamer suspended mid-session would keep every one of those
   * powers until they happened to sign in again.
   */
  const streamer = await db.streamer.findUnique({
    where: { id: session.user.streamerId },
    select: { isSuspended: true },
  })
  if (!streamer) {
    return { ok: false, status: 403, error: 'ไม่พบโปรไฟล์สตรีมเมอร์' }
  }
  if (streamer.isSuspended) {
    return { ok: false, status: 403, error: 'บัญชีนี้ถูกระงับชั่วคราว' }
  }

  return { ok: true, streamerId: session.user.streamerId, userId: session.user.id }
}

export type AdminSession =
  | { ok: true; userId: string }
  | { ok: false; status: 401 | 403; error: string }

/**
 * The gate on everything under /api/admin and /dashboard/admin.
 *
 * **The role is read from the database, not from the session.** `token.role` is
 * written once at sign-in into a JWT this app cannot revoke, so an account
 * demoted from ADMIN would keep every admin power until it happened to sign in
 * again — which could be never. One indexed lookup by primary key is a small
 * price for the guard on the only screen that can suspend other people's
 * accounts.
 */
export async function requireAdmin(): Promise<AdminSession> {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return { ok: false, status: 401, error: 'ต้องเข้าสู่ระบบก่อน' }
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { role: true },
  })
  if (user?.role !== 'ADMIN') {
    return { ok: false, status: 403, error: 'ต้องเป็นผู้ดูแลระบบเท่านั้น' }
  }

  return { ok: true, userId: session.user.id }
}

/** Shorthand for the failure branch, so each route spells it once. */
export function sessionErrorResponse(
  failure: Extract<StreamerSession | AdminSession, { ok: false }>,
): Response {
  return Response.json(
    { error: failure.error },
    { status: failure.status, headers: { 'cache-control': 'no-store' } },
  )
}
