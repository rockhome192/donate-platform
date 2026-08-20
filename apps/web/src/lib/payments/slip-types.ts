/**
 * Slip verification port. See DESIGN.md 7.3.
 *
 * This path exists as the FALLBACK, and the reason is worth keeping next to the
 * code rather than only in the design doc: the QR printed on a Thai transfer
 * slip carries five fields — API id, sending bank, transaction ref, country and
 * a CRC — and **no amount, no account number, no name**. The CRC is ISO/IEC
 * 13239 with a public polynomial, so it is a typo detector, not a signature.
 *
 * Two consequences shape everything here:
 *
 * 1. **Offline verification is impossible.** Decoding the QR ourselves proves
 *    only that somebody can compute a checksum. The facts have to come from an
 *    upstream that actually asked the bank, which is what this port abstracts.
 *
 * 2. **A slip is evidence the payer chose to hand us**, unlike a gateway
 *    webhook, where we generated the charge and the provider tells us directly.
 *    So every fact the verifier returns is checked against what we already
 *    expected — see `slip-checks.ts`. The upstream answers "is this slip real";
 *    only we can answer "is this slip *ours*".
 */

/** What an upstream must be able to tell us about a slip. DESIGN.md 7.3. */
export type SlipFacts = {
  /** The bank's transaction reference. The dedupe key — see layer 2. */
  transRef: string
  /** satang, as the BANK has it — never read off the image */
  amount: number
  /** 3-digit Thai bank code of the sending bank, e.g. '014' */
  senderBank: string
  /** 3-digit code of the receiving bank, null if the upstream cannot say */
  receiverBankCode: string | null
  /** Last four digits of the destination account, null if unavailable */
  receiverAccountLast4: string | null
  /**
   * The destination account exactly as the upstream wrote it, masking and all.
   *
   * Diagnostics only — never compared against anything. It exists because the
   * first real slip failed layer 3 and there was no way to tell whether the
   * masking had been parsed wrong or the money had genuinely gone elsewhere.
   * A streamer whose slip donations all fail needs an answer better than
   * "mismatch", and the bank has already masked this string.
   */
  receiverAccountRaw: string | null
  /**
   * The PromptPay proxy the money was sent to — a masked phone number or id.
   *
   * This is where a PromptPay transfer's destination actually lives. A slip
   * for one carries NO receiving account and no receiving bank at all: the
   * first real slip came back with `account.value === ''`, `receivingBank ===
   * ''`, and only the receiver's name filled in. Checking the account alone
   * meant layer 3 could never pass for the payment method this app's own QR
   * tells donors to use.
   */
  receiverProxyLast4: string | null
  /** Diagnostics only, same reasoning as `receiverAccountRaw`. */
  receiverProxyRaw: string | null
  /**
   * Every form of the receiver's name the upstream gave, in no order.
   *
   * A list, not a string, because SlipOK sends the SAME name twice in two
   * scripts — `displayName` in Thai, `name` romanised. A real slip came back
   * as `["นาย พชรดนัย ต", "MR. PHATCHARADANAI T"]`. Picking one by length
   * chose the romanised form and compared it against a Thai name nobody could
   * ever match; picking by script would be a guess about how the streamer
   * typed theirs. Matching any of them is neither.
   */
  receiverNames: string[]
  transferredAt: Date
}

/**
 * Either form is accepted because the two entry points differ: a phone that
 * scanned the QR has the payload string, a browser upload has only pixels.
 */
export type SlipInput = { qrPayload: string } | { imageBase64: string }

export interface SlipVerifier {
  readonly name: 'slipok' | 'fake'
  verify(input: SlipInput): Promise<SlipFacts>
}

/**
 * The upstream said this slip is not a real transfer — forged, unreadable, or
 * unknown to the bank. Terminal: retrying the same image cannot change it.
 */
export class SlipRejectedError extends Error {
  constructor(
    message: string,
    readonly reason: SlipRejectionReason,
  ) {
    super(message)
    this.name = 'SlipRejectedError'
  }
}

/**
 * Why a slip was refused, in the upstream's own terms.
 *
 * `duplicate` and `wrong_receiver` overlap with layers 2 and 3, which we run
 * ourselves regardless — a verifier that happens to check something is not a
 * reason to stop checking it. They appear here only because SlipOK refuses
 * BEFORE returning facts, so those refusals arrive as errors rather than as
 * something our own layers can inspect.
 */
export type SlipRejectionReason =
  | 'unreadable'
  | 'not_found'
  | 'duplicate'
  | 'wrong_receiver'
  | 'wrong_amount'

/**
 * The upstream itself is down, out of quota, or unreachable — which says
 * nothing about the slip. Answered as 503 so the donor is told to try again
 * rather than told their slip is fake.
 */
export class SlipVerifierUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'SlipVerifierUnavailableError'
  }
}
