import { env } from '../env'
import { lastFourDigits } from './slip-checks'
import {
  SlipRejectedError,
  SlipVerifierUnavailableError,
  type SlipFacts,
  type SlipInput,
  type SlipRejectionReason,
  type SlipVerifier,
} from './slip-types'

/**
 * EasySlip adapter. Same layer 1 role as `slipok.ts`, and it exists for one
 * reason the port itself cannot express: **SlipOK is receiver-bound and this
 * is not.**
 *
 * A SlipOK branch has ONE bank account, configured in their LINE bot and
 * nowhere in this app, and a slip paid into any other account is refused
 * upstream with 1014 before our own checks ever run. That is fine for a shop
 * verifying payments to itself. It is fatal for a platform: the second
 * streamer who signs up fills in their own account, and every genuine donation
 * to them comes back "สลิปนี้โอนเข้าบัญชีอื่น".
 *
 * EasySlip v2 has no such binding, and the docs are unambiguous about it
 * (document.easyslip.com, read 2026-08-21):
 *
 *   - `POST /verify/bank` takes `payload` / `image` / `base64` / `url` and
 *     nothing else that is required. There is NO receiver field in the request.
 *   - Its error-code reference has no receiver-mismatch code at all — no
 *     equivalent of 1014 anywhere in the table.
 *   - Matching a receiver is opt-in (`matchAccount`), and "no match" is
 *     `matchedAccount: null` in a 200, not an error.
 *
 * So the receiver check stays where it belongs: ours, in `slip-checks.ts`,
 * against the account the streamer registered in their own profile. This
 * adapter's job is only to report what the bank said.
 *
 * NOT YET RUN AGAINST THE LIVE API. Everything here is read off the docs, and
 * the Omise adapter is the standing reminder of what a spec-only adapter is
 * worth — see `parseFacts` for the one field a real slip still has to settle
 * before `SLIP_VERIFIER=easyslip` can be trusted in production.
 */

const VERIFY_URL = 'https://api.easyslip.com/v2/verify/bank'

/** The upstream is a payment dependency, not a page render. Same as SlipOK. */
const TIMEOUT_MS = 10_000

/**
 * EasySlip's code -> our port's vocabulary.
 *
 * Split by WHOSE fault it is, not by HTTP status — the same rule `slipok.ts`
 * follows. Only codes the DONOR can act on belong here; anything about our
 * key, our quota or our request is a `SlipVerifierUnavailableError`, because
 * telling someone who just moved real money that their slip is fake, when the
 * truth is that we ran out of quota, is the worst failure this path has.
 *
 * Deliberately absent:
 *
 *   `SLIP_PENDING` — a Bangkok Bank transfer less than five minutes old that
 *   the bank has not published yet. It is the one 404 that is NOT terminal, so
 *   mapping it here would be a lie in the other direction: the donor would be
 *   told their transfer does not exist at the exact moment when trying again
 *   is the correct advice. It falls through to unavailable, which answers 503
 *   and says "try again".
 *
 *   `VALIDATION_ERROR`, `URL_*` — we build the request, so these are bugs in
 *   this file. `IMAGE_URL_UNREACHABLE` in particular can never be the donor's
 *   doing: this adapter never sends `url`.
 */
const REJECTIONS: Record<string, SlipRejectionReason> = {
  SLIP_NOT_FOUND: 'not_found', // forged, or the bank has no such transaction
  INVALID_IMAGE_FORMAT: 'unreadable', // corrupt, or not an image at all
  INVALID_IMAGE_TYPE: 'unreadable',
  IMAGE_SIZE_TOO_LARGE: 'unreadable', // over 4MB decoded; a smaller photo works
}

export class EasySlipVerifier implements SlipVerifier {
  readonly name = 'easyslip' as const

  async verify(input: SlipInput): Promise<SlipFacts> {
    const body: Record<string, unknown> = {
      /*
        Not for the dedupe — layer 2 is ours and settles on a unique index no
        upstream can race. This is here for the QUOTA, and v2's table is
        explicit about it: a slip this branch has already verified comes back
        from cache with `isDuplicate: true` and is NOT counted.

        Which is the shape of the traffic this endpoint actually gets. A donor
        whose first submit failed layer 4 on a typo'd amount resubmits the same
        photo; without this, every retry of an already-verified slip spends
        another verification out of the streamer's month.

        `isDuplicate` itself is then ignored on purpose. A repeat verification
        is not evidence the slip was already SPENT — only our own row can say
        that, and it does.
      */
      checkDuplicate: true,
      /*
        `matchAccount` is left OFF, and that is the entire point of choosing
        this vendor. Turning it on would ask EasySlip to compare the receiver
        against accounts registered under OUR key — recreating, in software,
        the single-account limit we moved off SlipOK to escape.

        Their matcher is also an 85%-similarity name match. Layer 3 needs a
        rule it can explain to the streamer whose donation was refused;
        `nameMatches` is that rule, and a threshold inside someone else's
        service is not.
      */
    }

    // Both accepted; the API takes bare base64 or a data: URI, and the client
    // strips the prefix before it ever reaches us.
    if ('qrPayload' in input) body.payload = input.qrPayload
    else body.base64 = input.imageBase64

    let res: Response
    try {
      res = await fetch(VERIFY_URL, {
        method: 'POST',
        headers: {
          // A plain bearer, unlike SlipOK's `x-authorization`.
          authorization: `Bearer ${env.easyslipApiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: 'no-store',
      })
    } catch (e) {
      // A timeout or a DNS failure says nothing about the slip.
      throw new SlipVerifierUnavailableError('easyslip unreachable', { cause: e })
    }

    const payload = (await res.json().catch(() => null)) as
      | { success?: boolean; data?: unknown; error?: { code?: string; message?: string } }
      | null

    if (!res.ok || !payload?.success) {
      const code = payload?.error?.code
      const reason = code === undefined ? undefined : REJECTIONS[code]

      if (reason) {
        throw new SlipRejectedError(payload?.error?.message ?? `easyslip ${code}`, reason)
      }

      throw new SlipVerifierUnavailableError(
        `easyslip ${res.status} code=${code ?? 'none'} ${payload?.error?.message ?? ''}`.trim(),
      )
    }

    return parseFacts(payload.data)
  }
}

/**
 * v2's success shape, flattened into the port's facts.
 *
 * The facts live under `data.rawSlip`. Its siblings — `matchedAccount`,
 * `isAmountMatched`, `isDuplicate` — are EasySlip's opinions about our order,
 * and this app forms its own in `slip-checks.ts`. Only `rawSlip` is evidence.
 *
 * Three fields deserve naming:
 *
 * `amount.amount` is **decimal baht**. Everything downstream is satang, so the
 * unit changes here, once, and a value that will not survive the conversion is
 * a broken upstream rather than something to round quietly — same rule and
 * same reasoning as the SlipOK adapter. `amount.local` is ignored: every slip
 * this app can receive is a domestic transfer made from the Thai PromptPay QR
 * it printed itself, and layer 4's exact match would refuse anything else.
 *
 * `account.name` arrives as `{ th?, en? }` — the same person in two scripts,
 * which is what `receiverNames` is a LIST for. EasySlip's own example shows a
 * receiver with only `th` set, so neither may be assumed present.
 *
 * `account.proxy.account` is the masked PromptPay id, and it is the one thing
 * here that a real slip still has to confirm. `lastFourDigits` reads the four
 * digits a bank left visible, which is right for every masking SlipOK returned
 * (`xxx-x-x7788-x` -> `7788`). EasySlip's docs example masks a phone as
 * `08xxxxxxxx89`, and if a real response looks like that, digit-stripping
 * yields `0889` — a leading `08` plus two real digits, which is not a last
 * four and can never equal the streamer's. That reads as a mismatch, which is
 * the wrong accusation to make at a donor who paid correctly.
 *
 * It is left alone regardless, because the extraction MUST stay identical on
 * both sides of layer 3's comparison — `submit-slip.ts` runs the streamer's
 * own number through this same function — and because a doc example is not
 * evidence about a bank. Confirm it with SLIP_DEBUG=true on the first real
 * slip, which prints both sides, before this verifier goes near production.
 */
export function parseFacts(data: unknown): SlipFacts {
  if (typeof data !== 'object' || data === null) {
    throw new SlipVerifierUnavailableError('easyslip returned no data object')
  }

  const rawSlip = (data as Record<string, unknown>).rawSlip
  if (typeof rawSlip !== 'object' || rawSlip === null) {
    throw new SlipVerifierUnavailableError('easyslip returned no rawSlip object')
  }

  const raw = rawSlip as Record<string, unknown>
  const sender = (raw.sender ?? {}) as Record<string, unknown>
  const receiver = (raw.receiver ?? {}) as Record<string, unknown>
  const account = (receiver.account ?? {}) as Record<string, unknown>
  const bankAccount = (account.bank ?? {}) as Record<string, unknown>
  const proxy = (account.proxy ?? {}) as Record<string, unknown>
  const names = (account.name ?? {}) as Record<string, unknown>

  const amount = (raw.amount ?? {}) as Record<string, unknown>
  const baht = typeof amount.amount === 'number' ? amount.amount : Number(amount.amount)
  if (!Number.isFinite(baht)) {
    throw new SlipVerifierUnavailableError(
      `easyslip amount is not a number: ${String(amount.amount)}`,
    )
  }

  const satang = Math.round(baht * 100)
  // More than half a satang of rounding means this is not a baht amount at
  // all. Better a 503 than a donation credited for a number nobody sent.
  if (Math.abs(baht * 100 - satang) > 0.001) {
    throw new SlipVerifierUnavailableError(`easyslip amount has sub-satang precision: ${baht}`)
  }

  return {
    transRef: typeof raw.transRef === 'string' ? raw.transRef : '',
    amount: satang,
    senderBank: bankId(sender),
    // A PromptPay slip names no receiving bank, and layer 3 reads null as "the
    // slip does not name an account" — so an empty string must become null or
    // the account branch of that check runs on nothing.
    receiverBankCode: bankId(receiver) || null,
    receiverAccountLast4: lastFourDigits(bankAccount.account),
    receiverAccountRaw: typeof bankAccount.account === 'string' ? bankAccount.account : null,
    receiverProxyLast4: lastFourDigits(proxy.account),
    receiverProxyRaw: typeof proxy.account === 'string' ? proxy.account : null,
    // Both scripts, unranked — `nameMatches` is tried against each, because the
    // streamer typed their name in one of them and we cannot know which.
    receiverNames: [names.th, names.en]
      .filter((n): n is string => typeof n === 'string')
      .map((n) => n.trim())
      .filter((n) => n !== ''),
    // ISO 8601 with a +07:00 offset. An unparseable one becomes an Invalid
    // Date, which layer 5 refuses outright rather than comparing.
    transferredAt: new Date(typeof raw.date === 'string' ? raw.date : ''),
  }
}

/** The 3-digit Thai bank code, e.g. '004'. Same alphabet as SlipOK's. */
function bankId(party: Record<string, unknown>): string {
  const bank = (party.bank ?? {}) as Record<string, unknown>
  return typeof bank.id === 'string' ? bank.id : ''
}
