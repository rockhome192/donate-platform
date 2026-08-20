import { formatBaht } from '@dp/shared'

/**
 * Layer 2 validation. See DESIGN.md 7.1.1.
 *
 * Layer 1 (the Zod schema in @dp/shared) is static: at parse time it does not
 * know which streamer the request is for, so it can only check shape and the
 * absolute system bounds. Every per-streamer rule has to run here, after the
 * row is loaded.
 *
 * Forgetting this file is exactly how minAmount ends up declared in the schema
 * and never read once — which is T7 (1-baht donation spam) left wide open.
 *
 * Kept free of Prisma and Request so it can be tested as a plain function.
 */

export type StreamerRules = {
  displayName: string
  isActive: boolean
  isSuspended: boolean
  /** satang */
  minAmount: number
  /** satang */
  maxAmount: number
}

export type RuleFailure = {
  status: 404 | 409 | 422
  /** Shown to the viewer, so it names the real limit rather than "invalid amount". */
  message: string
  field?: 'amount'
}

/**
 * Order matters: account state is checked before the amount. Telling somebody
 * their 20 baht is below the minimum, and only then that the streamer is not
 * accepting donations at all, wastes their second attempt.
 */
export function checkStreamerRules(
  amountSatang: number,
  streamer: StreamerRules,
): RuleFailure | null {
  if (streamer.isSuspended) {
    return { status: 409, message: 'บัญชีนี้ถูกระงับชั่วคราว ยังรับโดเนทไม่ได้' }
  }

  if (!streamer.isActive) {
    return { status: 409, message: `${streamer.displayName} ปิดรับโดเนทอยู่ในขณะนี้` }
  }

  // A streamer with min > max cannot be donated to at all. That is a settings
  // bug, not a viewer mistake, so it does not read as one.
  if (streamer.minAmount > streamer.maxAmount) {
    return { status: 409, message: 'การตั้งค่าจำนวนเงินของสตรีมเมอร์ไม่ถูกต้อง ยังรับโดเนทไม่ได้' }
  }

  if (amountSatang < streamer.minAmount) {
    return {
      status: 422,
      field: 'amount',
      message: `${streamer.displayName} รับโดเนทขั้นต่ำ ${formatBaht(streamer.minAmount)} บาท`,
    }
  }

  if (amountSatang > streamer.maxAmount) {
    return {
      status: 422,
      field: 'amount',
      message: `${streamer.displayName} รับโดเนทสูงสุด ${formatBaht(streamer.maxAmount)} บาท ต่อครั้ง`,
    }
  }

  return null
}

/** How long a viewer gets to pay before the charge is abandoned. */
export const DONATION_TTL_MS = 15 * 60_000

/**
 * The slip path gets longer, and the reason is a donor losing real money.
 *
 * A QR is scanned in the same breath as it appears, so fifteen minutes is
 * generous. A bank transfer is not: the donor leaves the page, opens their
 * banking app, maybe logs in again, types an account number. Fifteen minutes
 * from the moment the page was opened is easy to miss.
 *
 * And missing it is not a wasted click like it is on the QR path — the money
 * has already left their account by then, to the right account, for the right
 * amount, provable by a slip we would refuse for a reason that has nothing to
 * do with the transfer. Layer 5 still holds the slip itself to fifteen minutes
 * after the TRANSFER (DESIGN.md 7.3), which is the clock that actually guards
 * anything; this one only decides how long the donor has to get started.
 */
export const SLIP_DONATION_TTL_MS = 45 * 60_000

export function donationExpiry(now: Date = new Date(), method: 'gateway' | 'slip' = 'gateway'): Date {
  return new Date(now.getTime() + (method === 'slip' ? SLIP_DONATION_TTL_MS : DONATION_TTL_MS))
}
