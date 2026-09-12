import { requireStreamer, sessionErrorResponse } from '@/lib/api-session'
import { IMAGE_SNIFF_BYTES, sniffImageType } from '@/lib/images'
import { rateLimit } from '@/lib/rate-limit'
import {
  AVATAR_CONTENT_TYPES,
  AVATAR_MAX_BYTES,
  avatarKey,
  putObject,
  storageConfig,
} from '@/lib/storage'

/**
 * POST /api/me/avatar — the bytes of one profile picture, checked and stored.
 *
 * The body is the file itself, raw, with its type in the content-type header.
 * No multipart: there is exactly one part, and parsing a envelope format to
 * find it would be work in exchange for nothing.
 *
 * THIS REPLACED A PRESIGNED-URL HANDOFF, and the reason is the only reason
 * worth relaying the bytes at all. The old route handed the browser a URL that
 * R2 would accept, with the content type and the byte count signed into it. Both
 * of those are things the UPLOADER SAYS. A signature makes them binding, not
 * true — a browser fills File.type in from the filename, so anything renamed to
 * .png arrived as image/png, and the bucket is public, which made the avatar
 * folder a file host for whatever anyone cared to park there.
 *
 * Reading the first twelve bytes is the whole answer, and it is only available
 * to something the bytes travel through. See lib/images.ts.
 *
 * What that costs is one Vercel invocation carrying at most 2MB, against a
 * 4.5MB body limit — checked before committing to this, because the file it
 * replaced says in its own header comment that relaying uploads was not an
 * option. For a 400MB video it would not be. For an avatar it is not close.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'cache-control': 'no-store' } as const

/**
 * Deliberately small, and now the ceiling on writes to the bucket rather than
 * on tickets to write.
 *
 * Nothing is deleted from that bucket on the donation side of the app, and an
 * avatar is only cleaned up when it is replaced or swept. Five an hour is more
 * often than anyone changes a profile picture, and at 2MB apiece it caps one
 * account at 10MB an hour.
 */
const RATE_LIMIT = { requests: 5, windowSeconds: 60 * 60 }

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
    `avatar:${session.streamerId}`,
    RATE_LIMIT.requests,
    RATE_LIMIT.windowSeconds,
  )
  // Fail CLOSED here, unlike every other caller of rateLimit. The usual
  // argument for fail-open is that a limiter outage must not stop people
  // paying; it does not carry over to avatars, where nobody is harmed by
  // waiting and an uncounted burst fills a bucket that has no delete path.
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

  // Normalised because a browser sends `image/jpeg; charset=...` for some files,
  // and some non-Chromium browsers capitalise.
  const declared = (req.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
  if (!AVATAR_CONTENT_TYPES.includes(declared)) {
    return Response.json(
      { error: 'รองรับเฉพาะไฟล์ PNG, JPEG และ WebP' },
      { status: 415, headers: NO_STORE },
    )
  }

  let body: ArrayBuffer
  try {
    body = await req.arrayBuffer()
  } catch {
    return Response.json({ error: 'อ่านไฟล์ไม่สำเร็จ' }, { status: 400, headers: NO_STORE })
  }

  const bytes = new Uint8Array(body)
  // Measured, not declared. The old route could only ask the client how big the
  // file was and sign the answer; here the body is in hand.
  if (bytes.byteLength === 0) {
    return Response.json({ error: 'ไม่พบไฟล์' }, { status: 400, headers: NO_STORE })
  }
  if (bytes.byteLength > AVATAR_MAX_BYTES) {
    return Response.json(
      { error: `ไฟล์ใหญ่เกินไป (สูงสุด ${AVATAR_MAX_BYTES / 1024 / 1024} MB)` },
      { status: 413, headers: NO_STORE },
    )
  }

  /*
    The check the presigned handoff could not make.

    The type is read out of the file and compared to the one the request claims,
    and BOTH halves matter. A mismatch is the renamed-executable case. But an
    unrecognised file — null — is refused too, because "these bytes are not a
    PNG, a JPEG or a WebP" is the same answer as "this is not an image" for
    something about to be served from a public bucket under our name.

    Compared rather than trusted, so the stored content type is the one the
    bytes support: a JPEG saved as .png would otherwise be served with a header
    contradicting its own contents.
  */
  const actual = sniffImageType(bytes.subarray(0, IMAGE_SNIFF_BYTES))
  if (actual !== declared) {
    return Response.json(
      { error: 'ไฟล์นี้ไม่ใช่รูปภาพ PNG, JPEG หรือ WebP จริง' },
      { status: 415, headers: NO_STORE },
    )
  }

  const publicUrl = await putObject(
    config,
    avatarKey(session.streamerId, actual),
    actual,
    body,
    `avatar streamer=${session.streamerId}`,
  )
  if (!publicUrl) {
    // 502, not 500: this app did its part and the bucket did not answer. The
    // streamer can retry, and nothing has been written to their profile.
    return Response.json(
      { error: 'อัปโหลดไม่สำเร็จ — ลองใหม่อีกครั้ง' },
      { status: 502, headers: NO_STORE },
    )
  }

  // The URL still has to be saved through PATCH /api/me/profile. An upload is
  // not a decision: the streamer may pick a different picture, or close the tab.
  return Response.json({ publicUrl }, { headers: NO_STORE })
}
