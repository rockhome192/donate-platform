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
    | 'receiver_name_mismatch'
    | 'receiver_name_missing'
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
  /**
   * Last four digits of the streamer's PromptPay number — the destination a
   * slip actually names when the donor paid by scanning our QR.
   */
  promptPayLast4: string | null
  /** The account holder's name as the streamer registered it. */
  accountName: string | null
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
 * Does the name on the slip belong to the person the streamer says owns the
 * account?
 *
 * Banks abbreviate. A real slip for `พชรดนัย ตั้งอั้น` came back as
 * `นาย พชรดนัย ต` — a title bolted on the front and the surname cut to one
 * character. So this cannot be an equality check, and it cannot be a
 * "contains" either, which would let `ต` match any surname on earth.
 *
 * The rule that fits the data: drop titles, then every token the slip gives us
 * must be a PREFIX of the matching token we hold, in order. `พชรดนัย ต` passes
 * against `พชรดนัย ตั้งอั้น`; `สมชาย ต` does not.
 */
/*
  Stripped from the FRONT of the whole string, before anything is split.

  Order matters and getting it wrong is silent: splitting on the dot first
  turns `น.ส.` into the two tokens `น` and `ส`, neither of which looks like a
  title any more, and the check then compares a title against a given name and
  refuses the account's real owner.
*/
const LEADING_TITLE = /^\s*(นาย|นางสาว|นาง|น\s*\.\s*ส\s*\.|ด\s*\.\s*ช\s*\.|ด\s*\.\s*ญ\s*\.|mrs?|ms|miss)\s*\.?\s*/i

export function nameMatches(slipName: string, registeredName: string): boolean {
  const tokens = (name: string) =>
    name
      .replace(LEADING_TITLE, '')
      .replace(/[.\-_]/g, ' ')
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t !== '')

  const slip = tokens(slipName)
  const registered = tokens(registeredName)

  // No tokens left after stripping titles means there is nothing to compare,
  // and nothing to compare must never read as agreement.
  if (slip.length === 0 || registered.length === 0) return false
  if (slip.length > registered.length) return false

  return slip.every((token, i) => registered[i]!.startsWith(token))
}

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
  /*
    Layer 3, and it reads TWO destinations because a slip only ever carries one
    of them.

    A plain bank transfer names a receiving bank and account. A PromptPay
    transfer — which is what this app's own QR tells every donor to make —
    names neither: the first real slip came back with `receivingBank: ''` and
    `account.value: ''`, and put the destination in the proxy instead. A check
    that only knew about accounts could never pass for the payment method the
    product recommends.

    So: whichever the slip names must match, BOTH must match when the slip
    names both, and naming neither is a refusal rather than a pass.
  */
  if (!expected.bankCode || !expected.bankAccountLast4 || !expected.promptPayLast4) {
    // FAILS CLOSED. A streamer who never registered a destination cannot have
    // layer 3 run at all, and a check that cannot run must not silently pass:
    // that would accept any genuine slip in Thailand as payment to this
    // streamer. Refusing is the safe way to be wrong, since the fix is one
    // settings form away.
    return {
      code: 'receiver_unconfigured',
      status: 409,
      message: 'สตรีมเมอร์ยังไม่ได้ตั้งค่าบัญชีปลายทาง จึงยังตรวจสลิปไม่ได้',
    }
  }

  const namesAccount = Boolean(facts.receiverAccountLast4 && facts.receiverBankCode)
  const namesProxy = Boolean(facts.receiverProxyLast4)

  // The same fail-closed rule on the other side: if the upstream could not tell
  // us where the money landed, by either route, we have verified nothing.
  if (!namesAccount && !namesProxy) {
    // A distinct code from the mismatch below, because the two need opposite
    // advice: "send a clearer photo" versus "you paid the wrong account".
    return {
      code: 'receiver_unreadable',
      status: 422,
      message: 'อ่านบัญชีปลายทางจากสลิปนี้ไม่ได้ กรุณาใช้สลิปที่ชัดเจนกว่านี้',
    }
  }

  const accountWrong =
    namesAccount &&
    (facts.receiverAccountLast4 !== expected.bankAccountLast4 ||
      facts.receiverBankCode !== expected.bankCode)

  const proxyWrong = namesProxy && facts.receiverProxyLast4 !== expected.promptPayLast4

  if (accountWrong || proxyWrong) {
    return {
      code: 'receiver_mismatch',
      status: 422,
      message: 'สลิปนี้โอนเข้าบัญชีอื่น ไม่ใช่บัญชีของสตรีมเมอร์คนนี้',
    }
  }

  /*
    The name, and on the PromptPay path it is REQUIRED rather than a bonus.

    Four digits of a phone number is not a secret and, worse, is not scarce: a
    Thai phone shop will sell you a number ending in any four digits you ask
    for. So an attacker can buy a number matching a streamer's, point PromptPay
    at their OWN account, transfer to themselves for the exact amount, and
    submit a slip that is genuine in every particular — the transfer really
    happened, the reference is fresh, the timing is theirs to choose. Layers 2,
    4, 5 and 6 all pass it. The donation settles and the streamer is paid
    nothing.

    A bank account number cannot be chosen that way, which is why the account
    path can stand on its destination alone. The proxy path cannot, so it
    leans on the one field left that an attacker cannot shop for: the name the
    money landed under.
  */
  if (facts.receiverNames.length > 0) {
    if (!expected.accountName) {
      return {
        code: 'receiver_unconfigured',
        status: 409,
        message: 'สตรีมเมอร์ยังไม่ได้ตั้งค่าชื่อบัญชี จึงยังตรวจสลิปไม่ได้',
      }
    }
    // ANY of the forms, because they are one name written two ways and the
    // streamer typed theirs in one script or the other, not both.
    if (!facts.receiverNames.some((n) => nameMatches(n, expected.accountName!))) {
      return {
        code: 'receiver_name_mismatch',
        status: 422,
        message: 'ชื่อบัญชีปลายทางในสลิปไม่ตรงกับของสตรีมเมอร์คนนี้',
      }
    }
  } else if (!namesAccount) {
    // Proxy-only AND nameless: nothing left that an attacker cannot arrange.
    return {
      code: 'receiver_name_missing',
      status: 422,
      message: 'สลิปนี้ไม่มีชื่อบัญชีปลายทาง ตรวจสอบไม่ได้',
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
