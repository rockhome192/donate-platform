import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

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

  return { ok: true, streamerId: session.user.streamerId, userId: session.user.id }
}

/** Shorthand for the failure branch, so each route spells it once. */
export function sessionErrorResponse(failure: Extract<StreamerSession, { ok: false }>): Response {
  return Response.json(
    { error: failure.error },
    { status: failure.status, headers: { 'cache-control': 'no-store' } },
  )
}
