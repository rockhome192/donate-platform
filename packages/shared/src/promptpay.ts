/**
 * The Thai QR (PromptPay) payload, built from scratch.
 *
 * This is the one QR in the codebase that is REAL. The gateway path's QR is a
 * deliberate fake that says so on its face, because nothing is charged there
 * (DESIGN.md 0). The slip path is the opposite: the money genuinely moves, by
 * hand, from the donor's banking app — so a scannable QR there is the honest
 * thing rather than the forbidden one.
 *
 * Why generate it instead of showing an account number: the streamer's account
 * is stored as four digits (DESIGN.md 7.3), which nobody can transfer to. And
 * layer 4 refuses a slip whose amount is off by a satang, so asking a donor to
 * type the amount by hand is asking them to lose money to a typo. A QR carries
 * the amount, so there is nothing to mistype.
 *
 * Structure is EMVCo TLV — `<2-digit tag><2-digit length><value>` — with the
 * PromptPay fields nested inside tag 29.
 */

/**
 * EMVCo tag-length-value.
 *
 * The length field is exactly two digits, so a value of 100 characters or more
 * cannot be expressed — it would silently write a length of "100" and shift
 * every field after it, producing a QR that scans as garbage or, worse, as a
 * different amount. Every value here is bounded well under that, so this throws
 * rather than tolerating a case that would mean the caller is already wrong.
 */
function tlv(tag: string, value: string): string {
  if (value.length > 99) throw new RangeError(`EMVCo value too long for tag ${tag}`)
  return `${tag}${String(value.length).padStart(2, '0')}${value}`
}

/**
 * CRC-16/CCITT-FALSE — polynomial 0x1021, initial value 0xFFFF, no final XOR.
 *
 * The same checksum the slip's own mini-QR carries, and worth repeating what
 * DESIGN.md 7.3 says about it: this is a typo detector, not a signature. It
 * proves nothing about who sent what. It is here because the spec requires it.
 */
export function crc16(input: string): string {
  let crc = 0xffff
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

/**
 * A mobile number, and only a mobile number. Any local format; digits are all
 * that matter.
 *
 * The spec also allows a national id on tag 02, and this module deliberately
 * cannot build one. A PromptPay QR carries its payee id in cleartext — it has
 * to, or a bank cannot read it — and the donate page hands that QR to anyone
 * who creates a donation, with no login and no payment. A phone number leaking
 * that way is a nuisance a streamer already accepts by putting a QR on stream.
 * A national id leaking that way is identity documents. There is no column for
 * one and no code path to one.
 */
export type PromptPayTarget = { type: 'phone'; value: string }

/**
 * Normalises a Thai mobile number into the 13-digit form the spec wants:
 * country code 0066 followed by the number without its leading zero.
 */
export function promptPayPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '')
  // 0812345678 -> 812345678, and an already-prefixed 66812345678 too.
  const local = digits.startsWith('66') ? digits.slice(2) : digits.replace(/^0/, '')
  if (local.length !== 9) return null
  // Thai mobile prefixes are 06, 08 and 09. Counting digits alone accepts a
  // landline or a typo and produces a QR that scans and then fails at the
  // bank — after the streamer has already put it on their donate page.
  if (!/^[689]/.test(local)) return null
  return `0066${local}`
}

/**
 * @param amountSatang the exact amount, which is what makes layer 4 survivable
 * @returns the payload string to encode as a QR, or null if the target is not
 *   a usable PromptPay id — null rather than a throw because the caller's job
 *   is to hide the option, not to crash the page.
 */
export function promptPayPayload(target: PromptPayTarget, amountSatang: number): string | null {
  const account = promptPayPhone(target.value)
  if (!account) return null
  if (!Number.isInteger(amountSatang) || amountSatang <= 0) return null

  // Tag 01 is the mobile-number slot; tag 02 would be the national id, which
  // this module has no way to reach.
  const merchant = tlv('00', 'A000000677010111') + tlv('01', account)

  const body =
    tlv('00', '01') +
    // 12 = dynamic. A static QR (11) is the reusable one printed on a counter;
    // this one carries an amount and is meant for exactly one transfer.
    tlv('01', '12') +
    tlv('29', merchant) +
    tlv('53', '764') +
    tlv('54', (amountSatang / 100).toFixed(2)) +
    tlv('58', 'TH')

  // The CRC is computed over the payload INCLUDING its own tag and length,
  // with the four checksum characters not yet appended.
  return `${body}6304${crc16(`${body}6304`)}`
}
