import { z } from 'zod'
import { requireStreamer, sessionErrorResponse } from '@/lib/api-session'
import { rateLimit } from '@/lib/rate-limit'
import {
  AVATAR_CONTENT_TYPES,
  AVATAR_MAX_BYTES,
  avatarKey,
  presignUpload,
  storageConfig,
} from '@/lib/storage'

/**
 * POST /api/me/avatar/upload-url — a short-lived ticket to PUT one avatar.
 *
 * The app hands out permission, not bandwidth. What it controls is the key
 * (namespaced under the caller's own streamer id, so nobody can write over
 * someone else's), the content type, and the exact byte count — all three are
 * signed, so R2 refuses anything that does not match. See lib/storage.ts.
 *
 * The returned URL is NOT a promise that the object exists. The client PUTs,
 * and only a successful PUT followed by a successful PATCH /api/me/profile puts
 * the URL on the row. A ticket that is never used costs nothing and expires.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'cache-control': 'no-store' } as const

/**
 * Tighter than the profile save. Each granted ticket is a writable object key,
 * and issuing them is the cheap half of an upload.
 *
 * Deliberately small. Nothing is ever deleted from the bucket, so every ticket
 * a caller redeems is storage held forever: at 20 per 10 minutes one account
 * can park 5.7 GB a day, which is the whole free tier inside two. Changing a
 * profile picture five times an hour is already more than anyone does.
 */
const RATE_LIMIT = { requests: 5, windowSeconds: 60 * 60 }

const bodySchema = z.object({
  contentType: z.string().trim().max(100),
  size: z.number().int().positive(),
})

export async function POST(req: Request) {
  const session = await requireStreamer()
  if (!session.ok) return sessionErrorResponse(session)

  const config = storageConfig()
  if (!config) {
    // 503, not 500: nothing is broken, this deployment simply has no bucket.
    return Response.json(
      { error: 'เดพลอยนี้ยังไม่ได้ตั้งค่าที่เก็บไฟล์ จึงอัปโหลดรูปไม่ได้' },
      { status: 503, headers: NO_STORE },
    )
  }

  const limit = await rateLimit(
    `avatar-url:${session.streamerId}`,
    RATE_LIMIT.requests,
    RATE_LIMIT.windowSeconds,
  )
  // Fail CLOSED here, unlike every other caller of rateLimit. The usual
  // argument for fail-open is that a limiter outage must not stop people
  // paying; it does not carry over to avatars, where nobody is harmed by
  // waiting and an uncounted burst fills a bucket that has no delete path.
  // Redis down means no new tickets.
  if (limit.verdict === 'unavailable') {
    return Response.json(
      { error: 'ระบบอัปโหลดไม่พร้อมใช้งานชั่วคราว กรุณาลองใหม่อีกครั้ง' },
      { status: 503, headers: { ...NO_STORE, 'retry-after': '60' } },
    )
  }

  if (!limit.ok) {
    return Response.json(
      { error: 'ขออัปโหลดถี่เกินไป กรุณารอสักครู่' },
      { status: 429, headers: { ...NO_STORE, 'retry-after': String(limit.retryAfter) } },
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'รูปแบบข้อมูลไม่ถูกต้อง' }, { status: 400, headers: NO_STORE })
  }

  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'ข้อมูลไม่ถูกต้อง' }, { status: 400, headers: NO_STORE })
  }

  // Normalised because a browser sends `image/jpeg; charset=...` for some files
  // and the signed header has to be the exact string the client will send.
  const contentType = parsed.data.contentType.split(';')[0]!.trim().toLowerCase()
  if (!AVATAR_CONTENT_TYPES.includes(contentType)) {
    return Response.json(
      { error: 'รองรับเฉพาะไฟล์ PNG, JPEG และ WebP' },
      { status: 415, headers: NO_STORE },
    )
  }
  if (parsed.data.size > AVATAR_MAX_BYTES) {
    return Response.json(
      { error: `ไฟล์ใหญ่เกินไป (สูงสุด ${AVATAR_MAX_BYTES / 1024 / 1024} MB)` },
      { status: 413, headers: NO_STORE },
    )
  }

  const upload = await presignUpload(
    config,
    avatarKey(session.streamerId, contentType),
    contentType,
    parsed.data.size,
  )

  return Response.json(
    { uploadUrl: upload.uploadUrl, publicUrl: upload.publicUrl, headers: upload.headers },
    { headers: NO_STORE },
  )
}
