import { env } from '../env'
import {
  SlipRejectedError,
  SlipVerifierUnavailableError,
  type SlipFacts,
  type SlipInput,
  type SlipRejectionReason,
  type SlipVerifier,
} from './slip-types'

/**
 * SlipOK adapter. DESIGN.md 7.3 layer 1 — the only layer that can answer
 * "did this transfer really happen", because it is the only one that asks a
 * bank.
 *
 * Everything below was checked against the live API with a real key rather
 * than read off the docs, since the Omise adapter taught us what a spec-only
 * adapter is worth. What was confirmed by calling it:
 *
 *   - POST https://api.slipok.com/api/line/apikey/<branchId>
 *   - the key goes in `x-authorization`; a plain `Authorization` header is
 *     refused with `{"code":1002}` and a 401
 *   - errors come back as `{ code: number, message: string }` in Thai, with a
 *     real HTTP status (1008 -> 400, 1002 -> 401)
 *   - a malformed request does NOT burn quota (checked before and after)
 *   - GET .../quota returns { quota, specialQuota, overQuota, endDate }
 *
 * The success payload's shape is the documented one. See `parseFacts` for the
 * two fields in it that are NOT safe to take at face value.
 */

const BASE_URL = 'https://api.slipok.com/api/line/apikey'

/** The upstream is a payment dependency, not a page render. */
const TIMEOUT_MS = 10_000

/**
 * SlipOK's code -> our port's vocabulary.
 *
 * The split that matters is not by number, it is by WHOSE fault it is: a
 * rejection tells the donor something about their slip, everything else is our
 * problem and must never be dressed up as theirs. Quota exhausted, an expired
 * package and a bad key all land in the second group — see
 * `SlipVerifierUnavailableError`.
 */
const REJECTIONS: Record<number, SlipRejectionReason> = {
  1005: 'unreadable', // file format we cannot send anyway
  1006: 'unreadable', // corrupt image
  1007: 'unreadable', // no QR in the image
  1008: 'unreadable', // a QR, but not a payment slip
  1011: 'not_found', // expired QR, or the bank has no such transaction
  1012: 'duplicate', // SlipOK's own dedupe; ours still runs
  1013: 'wrong_amount',
  1014: 'wrong_receiver',
}

export class SlipOkVerifier implements SlipVerifier {
  readonly name = 'slipok' as const

  async verify(input: SlipInput): Promise<SlipFacts> {
    const body: Record<string, unknown> = {
      // `log: true` is what makes this layer 1 at all. Without it the call is
      // a QR parse, and a QR carries no amount and no account — the exact
      // reason DESIGN.md 7.3 says a slip cannot be verified offline. It also
      // turns on SlipOK's own duplicate check (1012).
      log: true,
    }

    if ('qrPayload' in input) body.data = input.qrPayload
    else body.files = input.imageBase64

    let res: Response
    try {
      res = await fetch(`${BASE_URL}/${env.slipokBranchId}`, {
        method: 'POST',
        headers: {
          'x-authorization': env.slipokApiKey,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: 'no-store',
      })
    } catch (e) {
      // A timeout or a DNS failure says nothing about the slip.
      throw new SlipVerifierUnavailableError('slipok unreachable', { cause: e })
    }

    const payload = (await res.json().catch(() => null)) as
      | { success?: boolean; code?: number; message?: string; data?: unknown }
      | null

    if (!res.ok || !payload) {
      const code = payload?.code
      const reason = code === undefined ? undefined : REJECTIONS[code]

      if (reason) {
        throw new SlipRejectedError(payload?.message ?? `slipok ${code}`, reason)
      }

      // 1000 (we sent nothing), 1001 (bad branch), 1002 (bad key), 1003
      // (expired package), 1004 (over quota), 1009/1010 (the bank is slow or
      // down) — every one of these is ours or the upstream's, never the
      // donor's.
      throw new SlipVerifierUnavailableError(
        `slipok ${res.status} code=${code ?? 'none'} ${payload?.message ?? ''}`.trim(),
      )
    }

    return parseFacts(payload.data)
  }
}

/**
 * The documented success shape is nested and its numbers are not in our units.
 * Two fields are worth naming:
 *
 * `amount` is **decimal baht**, not satang. Everything downstream — the
 * comparison in layer 4, `formatBaht`, the column itself — is satang, so this
 * is where the unit changes, once, and any value that will not survive the
 * conversion is treated as a broken upstream rather than rounded quietly.
 *
 * `receiver.account.value` is **masked** by the bank, and the masking pattern
 * differs between them (`xxx-x-x1234-x`, `1234xx`, and others). Taking the
 * last four digits of whatever survives is the best available reading, and it
 * is the ONE thing here that a real slip still has to confirm — until then
 * `SLIP_VERIFIER` stays on `fake` outside of that test.
 */
export function parseFacts(data: unknown): SlipFacts {
  if (typeof data !== 'object' || data === null) {
    throw new SlipVerifierUnavailableError('slipok returned no data object')
  }

  const d = data as Record<string, unknown>
  const receiver = (d.receiver ?? {}) as Record<string, unknown>
  const account = (receiver.account ?? {}) as Record<string, unknown>

  const baht = typeof d.amount === 'number' ? d.amount : Number(d.amount)
  if (!Number.isFinite(baht)) {
    throw new SlipVerifierUnavailableError(`slipok amount is not a number: ${String(d.amount)}`)
  }

  const satang = Math.round(baht * 100)
  // A rounding of more than half a satang means the upstream sent something
  // that is not a baht amount at all. Better a 503 than a donation credited
  // for a number nobody sent.
  if (Math.abs(baht * 100 - satang) > 0.001) {
    throw new SlipVerifierUnavailableError(`slipok amount has sub-satang precision: ${baht}`)
  }

  const transRef = typeof d.transRef === 'string' ? d.transRef : ''
  const transferredAt = new Date(typeof d.transTimestamp === 'string' ? d.transTimestamp : '')

  return {
    transRef,
    amount: satang,
    senderBank: typeof d.sendingBank === 'string' ? d.sendingBank : '',
    receiverBankCode: typeof d.receivingBank === 'string' ? d.receivingBank : null,
    receiverAccountLast4: lastFourDigits(account.value),
    receiverName: typeof receiver.displayName === 'string' ? receiver.displayName : null,
    transferredAt,
  }
}

/**
 * Null rather than a short string when there are not four digits to read:
 * layer 3 fails closed on null, and a two-digit "match" is not a match.
 */
export function lastFourDigits(masked: unknown): string | null {
  if (typeof masked !== 'string') return null
  const digits = masked.replace(/\D/g, '')
  return digits.length >= 4 ? digits.slice(-4) : null
}
