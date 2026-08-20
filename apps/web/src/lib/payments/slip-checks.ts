import { formatBaht } from '@dp/shared'
import type { SlipFacts } from './slip-types'

/**
 * Layers 3, 4 and 5 of DESIGN.md 7.3 — the checks the upstream cannot do for
 * us, because they are about OUR expectations, not about the slip.
 *
 * A verifier answers "did this transfer really happen". It has no idea which
 * donation the payer claims it pays for, so on its own it accepts a genuine
 * slip for someone else's account (layer 3), a genuine ฿20 slip attached to a
 * ฿2,000 donation (layer 4), and a genuine slip from last March (layer 5).
 *
 * Kept free of Prisma so it stays a plain function, same reasoning as
 * `donation-rules.ts`.
 */

export type SlipCheckFailure = {
  code:
    | 'receiver_unconfigured'
    | 'receiver_unreadable'
    | 'receiver_mismatch'
    | 'amount_mismatch'
    | 'slip_unreadable_time'
    | 'slip_too_old'
    | 'slip_from_future'
  status: 409 | 422
  /** Shown to the donor, so it names the real problem. */
  message: string
}

export type ExpectedTransfer = {
  /** satang */
  amount: number
  /** The streamer's registered destination. Null when they never set one. */
  bankCode: string | null
  bankAccountLast4: string | null
}

/** A slip older than this cannot settle a donation. DESIGN.md 7.3 layer 5. */
export const SLIP_MAX_AGE_MS = 15 * 60 * 1000

/**
 * Clock skew allowance for layer 5's other direction. Bank timestamps come from
 * the bank's clock, not ours, so a slip can legitimately read a few seconds
 * ahead. Anything further ahead than this is not skew.
 */
export const SLIP_FUTURE_SKEW_MS = 2 * 60 * 1000

/**
 * Order matters, same reasoning as `checkStreamerRules`. Receiver first: if the
 * money went to a different account entirely, telling the donor about a ฿30
 * shortfall sends them to fix the wrong thing. Amount before age, because a
 * wrong amount is worth knowing even on a stale slip.
 */
export function checkSlipAgainstDonation(
  facts: SlipFacts,
  expected: ExpectedTransfer,
  now: Date,
): SlipCheckFailure | null {
  // Layer 3 — and it FAILS CLOSED. A streamer who never registered a
  // destination account cannot have layer 3 run at all, and a check that
  // cannot run must not silently pass: that would accept any genuine slip in
  // Thailand as payment to this streamer. Refusing is the safe way to be
  // wrong, since the fix is one settings form away.
  if (!expected.bankCode || !expected.bankAccountLast4) {
    return {
      code: 'receiver_unconfigured',
      status: 409,
      message: 'สตรีมเมอร์ยังไม่ได้ตั้งค่าบัญชีปลายทาง จึงยังตรวจสลิปไม่ได้',
    }
  }

  // Same fail-closed rule applied to the other side: if the upstream could not
  // tell us where the money landed, we have not verified anything.
  if (!facts.receiverAccountLast4 || !facts.receiverBankCode) {
    // A distinct code from the mismatch below, because the two need opposite
    // advice: "send a clearer photo" versus "you paid the wrong account".
    return {
      code: 'receiver_unreadable',
      status: 422,
      message: 'อ่านบัญชีปลายทางจากสลิปนี้ไม่ได้ กรุณาใช้สลิปที่ชัดเจนกว่านี้',
    }
  }

  if (
    facts.receiverAccountLast4 !== expected.bankAccountLast4 ||
    facts.receiverBankCode !== expected.bankCode
  ) {
    return {
      code: 'receiver_mismatch',
      status: 422,
      message: 'สลิปนี้โอนเข้าบัญชีอื่น ไม่ใช่บัญชีของสตรีมเมอร์คนนี้',
    }
  }

  // Layer 4. Exact match in BOTH directions, like the webhook's amount check:
  // crediting more than was sent lies to the streamer just as badly as
  // crediting less.
  if (facts.amount !== expected.amount) {
    return {
      code: 'amount_mismatch',
      status: 422,
      message: `ยอดในสลิปคือ ${formatBaht(facts.amount)} บาท แต่รายการนี้ต้องโอน ${formatBaht(expected.amount)} บาท`,
    }
  }

  // Layer 5. Without it, a slip from any past transfer to this same account
  // settles a new donation — the dedupe in layer 2 only stops the SAME slip
  // twice, not an old one used once.
  // Fails closed, for the same reason layer 3 does — and this one is easy to
  // miss: with an Invalid Date `age` is NaN, and EVERY comparison against NaN
  // is false, so both bounds below would wave the slip through. The caller
  // guards this too; a pure function with its own callers has to be safe alone.
  if (Number.isNaN(facts.transferredAt.getTime())) {
    return {
      code: 'slip_unreadable_time',
      status: 422,
      message: 'อ่านเวลาโอนจากสลิปนี้ไม่ได้',
    }
  }

  const age = now.getTime() - facts.transferredAt.getTime()

  if (age > SLIP_MAX_AGE_MS) {
    return {
      code: 'slip_too_old',
      status: 422,
      message: 'สลิปนี้เก่าเกิน 15 นาที กรุณาโอนใหม่แล้วส่งสลิปอีกครั้ง',
    }
  }

  if (age < -SLIP_FUTURE_SKEW_MS) {
    return {
      code: 'slip_from_future',
      status: 422,
      message: 'เวลาในสลิปไม่ถูกต้อง',
    }
  }

  return null
}
