import { db, isUniqueViolation } from '@/lib/db'
import { checkSlipAgainstDonation, getSlipVerifier } from '@/lib/payments/slip'
import { SlipRejectedError, SlipVerifierUnavailableError, type SlipInput } from '@/lib/payments/slip-types'
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

export async function submitSlip(input: SubmitSlipInput): Promise<SubmitSlipResult> {
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
      streamer: { select: { bankCode: true, bankAccountLast4: true } },
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
  if (!donation.streamer.bankCode || !donation.streamer.bankAccountLast4) {
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
      return {
        ok: false,
        status: 422,
        code: `slip_${e.reason}`,
        message:
          e.reason === 'unreadable'
            ? 'อ่านสลิปนี้ไม่ออก กรุณาส่งภาพที่ชัดเจนกว่านี้'
            : 'ตรวจสอบสลิปนี้กับธนาคารไม่พบรายการโอน',
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
    },
    new Date(),
  )
  if (failure) {
    return { ok: false, status: failure.status, code: failure.code, message: failure.message }
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
      return {
        ok: false,
        status: 409,
        code: 'slip_already_used',
        message: 'สลิปใบนี้ถูกใช้ไปแล้ว',
      }
    }
    throw e
  }
}
