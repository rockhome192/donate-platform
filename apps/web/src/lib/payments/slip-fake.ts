import { SlipRejectedError, type SlipFacts, type SlipInput, type SlipVerifier } from './slip-types'

/**
 * The stand-in for a real slip upstream, so the six defence layers can be
 * built and tested before an account exists — same role MockProvider plays for
 * the gateway path.
 *
 * It is NOT a simulation of a bank. It decodes a payload this codebase invents,
 * which is the honest thing for it to be: nothing here should ever be mistaken
 * for evidence that the SlipOK adapter works. That evidence can only come from
 * a real slip and a real API key.
 */

/** `fake:<transRef>:<satang>:<receiverBank>:<last4>:<isoTransferredAt>` */
export function encodeFakeSlip(facts: SlipFacts): string {
  return [
    'fake',
    facts.transRef,
    String(facts.amount),
    facts.receiverBankCode ?? '',
    facts.receiverAccountLast4 ?? '',
    facts.transferredAt.toISOString(),
  ].join(':')
}

export class FakeSlipVerifier implements SlipVerifier {
  readonly name = 'fake' as const

  async verify(input: SlipInput): Promise<SlipFacts> {
    if (!('qrPayload' in input)) {
      // A real upstream reads pixels. This one cannot, and pretending it can
      // would let an image path ship untested against anything real.
      throw new SlipRejectedError('fake verifier accepts qrPayload only', 'unreadable')
    }

    const parts = input.qrPayload.split(':')
    // The ISO timestamp contains colons of its own, so rejoin the tail.
    if (parts[0] !== 'fake' || parts.length < 6) {
      throw new SlipRejectedError('not a fake-slip payload', 'unreadable')
    }

    const [, transRef, amount, receiverBankCode, receiverAccountLast4, ...rest] = parts
    const transferredAt = new Date(rest.join(':'))

    if (!transRef || !Number.isInteger(Number(amount)) || Number.isNaN(transferredAt.getTime())) {
      throw new SlipRejectedError('malformed fake-slip payload', 'unreadable')
    }

    return {
      transRef,
      amount: Number(amount),
      senderBank: '014',
      receiverBankCode: receiverBankCode || null,
      receiverAccountLast4: receiverAccountLast4 || null,
      receiverName: null,
      transferredAt,
    }
  }
}
