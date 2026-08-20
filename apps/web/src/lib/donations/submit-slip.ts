import { db, isUniqueViolation } from '@/lib/db'
import { env } from '@/lib/env'
import { checkSlipAgainstDonation, getSlipVerifier } from '@/lib/payments/slip'
import { lastFourDigits } from '@/lib/payments/slipok'
import {
  SlipRejectedError,
  SlipVerifierUnavailableError,
  type SlipInput,
  type SlipRejectionReason,
} from '@/lib/payments/slip-types'
import { rateLimit } from '@/lib/rate-limit'
import { settleDonation } from './settle'

/**
 * The slip path, end to end — the six defence layers of DESIGN.md 7.3 in the
 * order they have to run.
 *
 * The ordering is not cosmetic. Layer 6 comes first because every layer after
 * it costs something: the free SlipOK tier is 100 slips a month, and an
 * unmetered endpoint burns a streamer's whole month in one afternoon. The
 * cheap local checks come next. The upstream call — the only one that leaves
 * this machine — happens once the request has earned it. And layer 2, the
 * dedupe, comes LAST, because it is the write: nothing may claim a transRef
 * until everything else about the slip has been believed.
 */

/** Per-IP ceiling. Generous for a human, useless for a script. */
const SLIP_IP_LIMIT = 10
const SLIP_IP_WINDOW_SECONDS = 5 * 60

/** Per-streamer ceiling, which is really a ceiling on the monthly quota. */
const SLIP_STREAMER_LIMIT = 30
const SLIP_STREAMER_WINDOW_SECONDS = 60 * 60

/**
 * Diagnostics carry a real person's name and a masked phone number, so they are
 * off unless BOTH switches say otherwise.
 *
 * NODE_ENV alone was doing this job, and it is the wrong switch on its own —
 * it is shared with dozens of unrelated behaviours, and this endpoint is public
 * and unauthenticated. Anyone running `next dev` against production-like data
 * for a demo would have been serving a real name to whoever asked.
 */
const IS_PRODUCTION = process.env.NODE_ENV === 'production'
const SLIP_DEBUG = !IS_PRODUCTION && process.env.SLIP_DEBUG === 'true'

export type SubmitSlipInput = {
  donationId: string
  slip: SlipInput
  /** Already extracted by the route; never trusted for anything but bucketing. */
  clientIp: string
}

export type SubmitSlipResult =
  | { ok: true; alerted: boolean }
  | {
      ok: false
      status: 404 | 409 | 422 | 429 | 503
      code: string
      message: string
      /** Seconds, on 429 only. */
      retryAfter?: number
    }

/**
 * Refusals that reach us as an upstream error rather than as facts our own
 * layers can inspect. A verifier that refuses early saves us a check; it does
 * not get to decide what the donor is told.
 */
const SLIP_ALREADY_USED = {
  status: 409,
  code: 'slip_already_used',
  message: 'สลิปใบนี้ถูกใช้ไปแล้ว',
} as const

const REJECTION_RESPONSES = {
  unreadable: {
    status: 422,
    code: 'slip_unreadable',
    message: 'อ่านสลิปนี้ไม่ออก กรุณาส่งภาพที่ชัดเจนกว่านี้',
  },
  not_found: {
    status: 422,
    code: 'slip_not_found',
    message: 'ตรวจสอบสลิปนี้กับธนาคารไม่พบรายการโอน',
  },
  // The upstream's dedupe firing means the same thing ours does, so it gets
  // the same answer — a 409, never a 422 about an unreadable slip.
  duplicate: SLIP_ALREADY_USED,
  /*
    A DIFFERENT code from our own layer-3 mismatch, even though the donor is
    told the same thing — because the two mean opposite things to whoever has
    to fix it.

    Ours means the slip disagrees with what the streamer typed into the profile
    form. This one means SlipOK refused before we ever saw the slip: the
    receiver does not match the account registered inside the SlipOK branch
    itself (their code 1014), which is configured in SlipOK's LINE bot and
    nowhere in this app.

    They shared one code once, and it cost three rounds of debugging a check
    that had never run.
  */
  wrong_receiver: {
    status: 422,
    code: 'upstream_receiver_mismatch',
    message: 'สลิปนี้โอนเข้าบัญชีอื่น ไม่ใช่บัญชีของสตรีมเมอร์คนนี้',
  },
  wrong_amount: {
    status: 422,
    code: 'amount_mismatch',
    message: 'ยอดในสลิปไม่ตรงกับยอดของรายการนี้',
  },
} as const satisfies Record<SlipRejectionReason, { status: 409 | 422; code: string; message: string }>

export async function submitSlip(input: SubmitSlipInput): Promise<SubmitSlipResult> {
  /*
    The deployment-level switch, checked before anything else.

    Not redundant with the check in POST /api/donations: a donation created
    while the feature was on is still sitting there PENDING when it is turned
    off, and settling one of those would spend a verification and credit money
    on a deployment that has decided it does not take any. 503 rather than a
    422, because this is a fact about us.
  */
  if (!env.slipDonationsEnabled) {
    return {
      ok: false,
      status: 503,
      code: 'slip_disabled',
      message: 'ดีพลอยนี้ไม่ได้เปิดรับโอนพร้อมสลิป',
    }
  }

  // ---- Layer 6a: per-IP, before anything reads the database ----------------
  const byIp = await rateLimit(`slip:ip:${input.clientIp}`, SLIP_IP_LIMIT, SLIP_IP_WINDOW_SECONDS)
  if (!byIp.ok) {
    return {
      ok: false,
      status: 429,
      code: 'rate_limited',
      message: 'ส่งสลิปถี่เกินไป กรุณารอสักครู่แล้วลองใหม่',
      retryAfter: byIp.retryAfter,
    }
  }

  const donation = await db.donation.findUnique({
    where: { id: input.donationId },
    select: {
      id: true,
      streamerId: true,
      donorName: true,
      message: true,
      amount: true,
      status: true,
      provider: true,
      createdAt: true,
      expiresAt: true,
      streamer: {
        select: {
          bankCode: true,
          bankAccountLast4: true,
          bankAccountName: true,
          promptPayId: true,
        },
      },
    },
  })

  if (!donation) {
    return { ok: false, status: 404, code: 'not_found', message: 'ไม่พบรายการโดเนทนี้' }
  }

  if (donation.provider !== 'SLIP') {
    // A gateway donation settles through its webhook. Letting a slip settle it
    // too would mean two independent paths racing for the same row, and the
    // slip path has no charge to reconcile against.
    return {
      ok: false,
      status: 409,
      code: 'wrong_provider',
      message: 'รายการนี้ไม่ได้ชำระด้วยการโอนพร้อมสลิป',
    }
  }

  if (donation.status !== 'PENDING') {
    // Not an error the donor can fix, and deliberately not a 422: the most
    // common way to get here is a double submit of a slip that already worked.
    return {
      ok: false,
      status: 409,
      code: 'already_settled',
      message: 'รายการนี้ถูกดำเนินการไปแล้ว',
    }
  }

  if (donation.expiresAt.getTime() <= Date.now()) {
    return {
      ok: false,
      status: 409,
      code: 'expired',
      message: 'รายการนี้หมดอายุแล้ว กรุณาเริ่มรายการใหม่',
    }
  }

  // ---- Layer 3, the half that needs no slip --------------------------------
  // Whether this streamer has a destination account at all is knowable before
  // the upstream call, and a check that is going to fail closed anyway should
  // not spend one of the month's 100 verifications first. `checkSlipAgainstDonation`
  // repeats it, on purpose: it is a pure function with its own callers and must
  // stay safe on its own.
  if (
    !donation.streamer.bankCode ||
    !donation.streamer.bankAccountLast4 ||
    !donation.streamer.promptPayId
  ) {
    return {
      ok: false,
      status: 409,
      code: 'receiver_unconfigured',
      message: 'สตรีมเมอร์ยังไม่ได้ตั้งค่าบัญชีปลายทาง จึงยังตรวจสลิปไม่ได้',
    }
  }

  // ---- Layer 6b: per-streamer, i.e. per monthly quota ----------------------
  const byStreamer = await rateLimit(
    `slip:streamer:${donation.streamerId}`,
    SLIP_STREAMER_LIMIT,
    SLIP_STREAMER_WINDOW_SECONDS,
  )
  if (!byStreamer.ok) {
    return {
      ok: false,
      status: 429,
      code: 'rate_limited',
      message: 'ระบบตรวจสลิปของสตรีมเมอร์คนนี้ใช้งานหนักอยู่ กรุณาลองใหม่ภายหลัง',
      retryAfter: byStreamer.retryAfter,
    }
  }

  // ---- Layer 1: ask an upstream that actually asked the bank ---------------
  let facts
  try {
    facts = await getSlipVerifier().verify(input.slip)
  } catch (e) {
    if (e instanceof SlipRejectedError) {
      // The upstream's own words, which are the only clue to a rejection that
      // happened before any of our checks could run.
      console.warn(`[slip] upstream rejected donation ${input.donationId}: ${e.reason} — ${e.message}`)
      const response = REJECTION_RESPONSES[e.reason]
      return {
        ok: false,
        ...response,
        message: SLIP_DEBUG
          ? `${response.message} [dev: SlipOK ปฏิเสธเอง — ${e.reason}: ${e.message}]`
          : response.message,
      }
    }
    if (e instanceof SlipVerifierUnavailableError) {
      // Never told the donor their slip is fake because OUR upstream is down.
      console.error('[slip] verifier unavailable', e)
      return {
        ok: false,
        status: 503,
        code: 'verifier_unavailable',
        message: 'ระบบตรวจสลิปไม่พร้อมใช้งานชั่วคราว กรุณาลองใหม่อีกครั้ง',
      }
    }
    throw e
  }

  /*
    The port's contract, enforced at the boundary rather than trusted.

    Every field below is checked because the layer that consumes it fails OPEN
    if the value is malformed, which is the worst way for a defence to break:

      - a non-integer `amount` makes `formatBaht` throw from inside an error
        message template, surfacing as a 500;
      - an Invalid Date makes layer 5's `age` NaN, and every comparison against
        NaN is false, so BOTH the too-old and the from-future checks silently
        pass;
      - an empty `transRef` is falsy, so the settle below would drop it from the
        write and leave `slipTransRef` NULL — layer 2's dedupe disabled for that
        donation, with no error anywhere.

    A verifier that returns any of these is broken, not a slip that is invalid,
    so this is a 503 like any other upstream failure.
  */
  const contractViolation =
    !Number.isInteger(facts.amount)
      ? `non-integer amount: ${facts.amount}`
      : Number.isNaN(facts.transferredAt.getTime())
        ? 'invalid transferredAt'
        : !facts.transRef
          ? 'empty transRef'
          : null

  if (contractViolation) {
    console.error(`[slip] verifier broke its contract — ${contractViolation}`)
    return {
      ok: false,
      status: 503,
      code: 'verifier_unavailable',
      message: 'ระบบตรวจสลิปไม่พร้อมใช้งานชั่วคราว กรุณาลองใหม่อีกครั้ง',
    }
  }

  // ---- Layers 3, 4, 5: is this slip OURS -----------------------------------
  const failure = checkSlipAgainstDonation(
    facts,
    {
      amount: donation.amount,
      bankCode: donation.streamer.bankCode,
      bankAccountLast4: donation.streamer.bankAccountLast4,
      accountName: donation.streamer.bankAccountName,
      // The QR sends donors here, so this is the destination a real slip names.
      // lastFourDigits, not slice(-4): the slip's side is extracted that way,
      // and two different extractions on the two sides of one comparison is a
      // mismatch waiting for a stray character.
      promptPayLast4: lastFourDigits(donation.streamer.promptPayId),
    },
    new Date(),
  )
  if (failure) {
    /*
      Logged, because "mismatch" on its own is unactionable.

      Two very different things produce it: the masking was parsed wrong, or the
      money really did land somewhere else — which is easy to do by accident,
      since a PromptPay transfer goes to whichever account that phone number is
      registered to, and that need not be the one the streamer typed in here.
      Without both sides side by side there is no way to tell them apart.

      The account is four digits and the raw value arrives already masked by the
      bank, so this adds nothing to the log that the row does not already hold.
    */
    if (!IS_PRODUCTION && failure.code.startsWith('receiver_')) {
      console.warn(
        `[slip] receiver check failed for donation ${donation.id} — ` +
          `expected bank=${donation.streamer.bankCode} last4=${donation.streamer.bankAccountLast4}, ` +
          `slip says bank=${facts.receiverBankCode} last4=${facts.receiverAccountLast4} ` +
          `raw=${JSON.stringify(facts.receiverAccountRaw)} ` +
          `proxy=${JSON.stringify(facts.receiverProxyRaw)} proxyLast4=${facts.receiverProxyLast4} ` +
          `names=${JSON.stringify(facts.receiverNames)}`,
      )
    }
    /*
      In development the observed values ride along in the message itself.

      Not a nicety: the masking a bank puts on a slip differs per bank, so the
      first time a real slip meets this check the only way to learn what it
      actually said is to see it. A server log is easy to miss when the answer
      shows up in a browser, and every retry costs a verification out of a
      quota of a hundred. Never in production — there it would tell whoever is
      probing exactly which digits to guess next.
    */
    const message = !SLIP_DEBUG
      ? failure.message
      : `${failure.message} [dev: slip says bank=${facts.receiverBankCode} ` +
          `last4=${facts.receiverAccountLast4} raw=${JSON.stringify(facts.receiverAccountRaw)} ` +
          `proxy=${JSON.stringify(facts.receiverProxyRaw)} proxyLast4=${facts.receiverProxyLast4} ` +
          `names=${JSON.stringify(facts.receiverNames)} | expected bank=${donation.streamer.bankCode} ` +
          `last4=${donation.streamer.bankAccountLast4} ppLast4=${lastFourDigits(donation.streamer.promptPayId)} name=${JSON.stringify(donation.streamer.bankAccountName)}]`

    return { ok: false, status: failure.status, code: failure.code, message }
  }

  // ---- Layer 2: the dedupe, and the settle, in one statement ---------------
  try {
    const outcome = await settleDonation(donation, facts.transferredAt, {
      slipTransRef: facts.transRef,
    })

    if (!outcome.won) {
      // The guarded update matched nothing: a concurrent submit of the same
      // slip got there first. Same answer as the status check above, reached
      // by the path that actually closes the race.
      return {
        ok: false,
        status: 409,
        code: 'already_settled',
        message: 'รายการนี้ถูกดำเนินการไปแล้ว',
      }
    }

    return { ok: true, alerted: outcome.alerted }
  } catch (e) {
    if (isUniqueViolation(e)) {
      // `@@unique([slipTransRef])` fired: this transfer already paid for a
      // DIFFERENT donation. That is the whole point of the constraint — a
      // SELECT-then-INSERT would lose this race to a concurrent request, which
      // is precisely how one slip pays for two donations.
      return { ok: false, ...SLIP_ALREADY_USED }
    }
    throw e
  }
}
