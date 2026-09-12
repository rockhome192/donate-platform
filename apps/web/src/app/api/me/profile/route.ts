import { profileSchema, promptPayPayload } from '@dp/shared'
import { requireStreamer, sessionErrorResponse } from '@/lib/api-session'
import { db, uniqueViolationTargets } from '@/lib/db'
import { rateLimit } from '@/lib/rate-limit'
import { avatarKeyFromUrl, deleteObject, ownsAvatarUrl, storageConfig } from '@/lib/storage'

/**
 * PATCH /api/me/profile — the streamer's own public identity.
 *
 * Partial like /api/me/alert-setting, and for the same reason: an absent key
 * means "leave it alone", which a whole-object PUT cannot express without the
 * client having to send back fields it never showed the user.
 *
 * The min/max check is the part worth reading. Both bounds live on the same
 * row, a patch may carry only ONE of them, and the Zod schema cannot see the
 * stored value of the other — so the comparison has to happen here, against the
 * row as it currently is. Without this, saving a minimum of ฿500 on a streamer
 * whose maximum is ฿100 leaves a page where no amount at all is acceptable and
 * every donation attempt fails layer-2 validation with no way to tell why.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'cache-control': 'no-store' } as const

/** A form save by an authenticated streamer, same budget as the alert settings. */
const RATE_LIMIT = { requests: 30, windowSeconds: 60 }

const PROFILE_SELECT = {
  slug: true,
  displayName: true,
  bio: true,
  avatarUrl: true,
  minAmount: true,
  maxAmount: true,
  bankCode: true,
  bankAccountLast4: true,
  bankAccountName: true,
  promptPayId: true,
} as const

export async function PATCH(req: Request) {
  const session = await requireStreamer()
  if (!session.ok) return sessionErrorResponse(session)

  const limit = await rateLimit(
    `profile:${session.streamerId}`,
    RATE_LIMIT.requests,
    RATE_LIMIT.windowSeconds,
  )
  if (!limit.ok) {
    return Response.json(
      { error: 'บันทึกถี่เกินไป กรุณารอสักครู่' },
      { status: 429, headers: { ...NO_STORE, 'retry-after': String(limit.retryAfter) } },
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'รูปแบบข้อมูลไม่ถูกต้อง' }, { status: 400, headers: NO_STORE })
  }

  const parsed = profileSchema.partial().safeParse(body)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return Response.json(
      { error: first?.message ?? 'ข้อมูลไม่ถูกต้อง', field: first?.path.join('.') },
      { status: 400, headers: NO_STORE },
    )
  }

  const patch = parsed.data
  if (Object.keys(patch).length === 0) {
    return Response.json({ error: 'ไม่มีข้อมูลที่จะบันทึก' }, { status: 400, headers: NO_STORE })
  }

  const current = await db.streamer.findUnique({
    where: { id: session.streamerId },
    select: {
      // Read for the delete-on-replace below, not for any of the validation.
      avatarUrl: true,
      minAmount: true,
      maxAmount: true,
      bankCode: true,
      bankAccountLast4: true,
      bankAccountName: true,
      promptPayId: true,
    },
  })
  if (!current) {
    // The session says this streamer exists and the row does not — the account
    // was deleted mid-session. 403 rather than 404: the request is well formed,
    // the caller simply no longer owns anything.
    return Response.json({ error: 'ไม่พบโปรไฟล์สตรีมเมอร์' }, { status: 403, headers: NO_STORE })
  }

  /**
   * An avatar may only ever be one THIS streamer uploaded.
   *
   * The column is a URL and the schema only checks that it parses, so without
   * this a streamer could PATCH in any address on the internet and every
   * visitor to their donate page would silently fetch it — handing a third
   * party the IP and user-agent of everyone who opens the page, and handing the
   * streamer a way to swap the image for anything at any time, after the fact.
   *
   * Checking the bucket alone was not enough either: avatar URLs are public and
   * sit in the page source of every donate page, so "on our bucket" let anyone
   * paste a rival's avatar in and impersonate them. ownsAvatarUrl also demands
   * the key be under this caller's own namespace. POST /api/me/avatar is the
   * only path that writes to the bucket at all — it is also where the bytes are
   * checked against the type they claim — and this is what makes it the only
   * source of a URL that can be saved here.
   */
  if (patch.avatarUrl) {
    const storage = storageConfig()
    if (!storage || !ownsAvatarUrl(storage, session.streamerId, patch.avatarUrl)) {
      return Response.json(
        { error: 'รูปโปรไฟล์ต้องอัปโหลดผ่านระบบเท่านั้น', field: 'avatarUrl' },
        { status: 400, headers: NO_STORE },
      )
    }
  }

  const minAmount = patch.minAmount ?? current.minAmount
  const maxAmount = patch.maxAmount ?? current.maxAmount
  if (minAmount > maxAmount) {
    return Response.json(
      {
        error: 'ยอดขั้นต่ำต้องไม่มากกว่ายอดสูงสุด',
        // Point at the field the caller actually sent. A patch carrying only
        // maxAmount blamed minAmount, which is a field that is not on screen.
        field: patch.maxAmount !== undefined && patch.minAmount === undefined ? 'maxAmount' : 'minAmount',
      },
      { status: 400, headers: NO_STORE },
    )
  }

  /*
    Two pairs, each all-or-nothing, and they are not equally important.

    A partial PATCH can carry one field and the schema cannot see the stored
    value of its partner, so both comparisons run against the row as it
    currently is.

      promptPayId + bankAccountName  — what it takes to receive at all. The
        donate page prints a PromptPay QR, and layer 3 of DESIGN.md 7.3 leans
        on the account NAME for that path, because four digits of a phone
        number can be bought from a phone shop and a name cannot.

      bankCode + bankAccountLast4    — OPTIONAL, and only read when a donor
        ignores the QR and transfers to the account by hand. This used to be
        required with the other two, which meant every streamer typed an
        account number into a check that their own donors would never reach.

    Half a pair is still refused: a streamer who saved one of two would see
    slip donations offered and every one refused, with nothing on the form to
    explain why.
  */
  const bank = {
    bankCode: patch.bankCode !== undefined ? patch.bankCode : current.bankCode,
    bankAccountLast4:
      patch.bankAccountLast4 !== undefined ? patch.bankAccountLast4 : current.bankAccountLast4,
    bankAccountName:
      patch.bankAccountName !== undefined ? patch.bankAccountName : current.bankAccountName,
    promptPayId: patch.promptPayId !== undefined ? patch.promptPayId : current.promptPayId,
  }

  if (Boolean(bank.promptPayId) !== Boolean(bank.bankAccountName)) {
    return Response.json(
      {
        error: 'กรอกทั้งเบอร์พร้อมเพย์และชื่อบัญชี หรือเว้นว่างทั้งคู่',
        field: bank.promptPayId ? 'bankAccountName' : 'promptPayId',
      },
      { status: 400, headers: NO_STORE },
    )
  }

  if (Boolean(bank.bankCode) !== Boolean(bank.bankAccountLast4)) {
    return Response.json(
      {
        error: 'กรอกทั้งธนาคารและเลขบัญชี 4 ตัวท้าย หรือเว้นว่างทั้งคู่',
        field: bank.bankCode ? 'bankAccountLast4' : 'bankCode',
      },
      { status: 400, headers: NO_STORE },
    )
  }

  /*
    A PromptPay id that cannot become a QR is worse than none: the donate page
    would offer the option and then render nothing to scan. `promptPayPayload`
    returns null for exactly the ids it cannot encode, so ask it rather than
    re-implementing its rules here.
  */
  if (bank.promptPayId) {
    const usable = promptPayPayload(
      { type: 'phone', value: bank.promptPayId },
      100,
    )
    if (!usable) {
      return Response.json(
        {
          error: 'เบอร์พร้อมเพย์ไม่ถูกต้อง ต้องเป็นเบอร์มือถือ 10 หลัก (06 / 08 / 09)',
          field: 'promptPayId',
        },
        { status: 400, headers: NO_STORE },
      )
    }
  }

  try {
    const streamer = await db.streamer.update({
      where: { id: session.streamerId },
      data: patch,
      select: PROFILE_SELECT,
    })

    /*
      The picture this save replaced, deleted.

      avatarKey() gives every upload a random name, so without this the bucket
      keeps a copy of every profile picture a streamer has ever had and nothing
      ever looks at them again. Nothing else in this app deletes from the
      bucket, which is why the upload ticket is rationed as tightly as it is.

      AFTER the update, never before: the delete is irreversible and the update
      is the thing that can still fail (a taken slug, a dead connection). Losing
      the old picture on a save that did not happen would leave the streamer
      with neither.

      Not awaited into the response either — `deleteObject` swallows its own
      failures, and a profile save must not turn into a 500 because a bucket was
      slow. An object left behind is exactly what the sweep is for.

      The test is `!== undefined`, not truthiness: REMOVING a picture sends
      avatarUrl: null, which is just as much a replacement of the old object as
      sending a new URL is. Reading it as "no avatar in this patch" left the old
      file sitting in the bucket until a sweep found it.
    */
    if (
      patch.avatarUrl !== undefined &&
      current.avatarUrl &&
      current.avatarUrl !== patch.avatarUrl
    ) {
      const storage = storageConfig()
      const stale = storage && avatarKeyFromUrl(storage, session.streamerId, current.avatarUrl)
      if (storage && stale) void deleteObject(storage, stale)
    }

    return Response.json({ streamer }, { headers: NO_STORE })
  } catch (e) {
    if (uniqueViolationTargets(e).includes('slug')) {
      return Response.json(
        { error: 'ลิงก์นี้มีคนใช้แล้ว ลองชื่ออื่น', field: 'slug' },
        { status: 409, headers: NO_STORE },
      )
    }
    throw e
  }
}
