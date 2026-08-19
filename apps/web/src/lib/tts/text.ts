/**
 * What the voice actually says, and the escaping that keeps it a sentence
 * rather than markup.
 *
 * Everything here is pure and unit tested, because everything here is
 * attacker-controlled: `donorName` and `message` are typed by a stranger on a
 * public form and end up inside an XML document that a paid API executes.
 */

import { SATANG_PER_BAHT } from '@dp/shared'

/**
 * Hard cap on what is sent for synthesis.
 *
 * The form already limits a message to 200 characters and a name to 40, so
 * this is not the primary guard — it is the one that still holds if either of
 * those changes, or if a row predates them. Billing is per character, so the
 * ceiling on one donation's cost should be stated somewhere the biller can see.
 */
export const TTS_MAX_CHARS = 300

/**
 * XML escaping for SSML.
 *
 * The five predefined entities, all of them. Escaping only `<` and `&` is the
 * common half-measure: an unescaped quote inside an attribute would end it, and
 * the text here is dropped between element tags where a stray `>` is enough to
 * confuse a parser that is not ours.
 */
export function escapeSsml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Control characters have no sound and no business in XML — 0x00-0x08 and
 * friends are not even well-formed there, so a single stray byte in a message
 * would turn every TTS request for that donation into a 400.
 */
function stripControlChars(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
}

export type TtsSubject = {
  donorName: string
  message: string
  /** satang */
  amount: number
}

/**
 * The sentence, in Thai, in the same order the alert reads on screen.
 *
 * The amount is spoken in baht as a whole number where it is one — "ห้าสิบบาท"
 * rather than "ห้าสิบจุดศูนย์ศูนย์บาท", which is what a naive toFixed(2) gets
 * you and which sounds like a robot reading a receipt.
 *
 * Returns null when there is nothing worth saying: a donation with no message
 * is already fully described by the alert on screen and the chime, and paying
 * to have a name read alone is a worse experience, not a better one.
 */
export function ttsTextFor(subject: TtsSubject): string | null {
  const message = stripControlChars(subject.message).trim()
  if (message.length === 0) return null

  const name = stripControlChars(subject.donorName).trim() || 'ผู้ชมนิรนาม'
  const baht = subject.amount / SATANG_PER_BAHT
  const spokenAmount = Number.isInteger(baht) ? String(baht) : baht.toFixed(2)

  const sentence = `${name} โดเนท ${spokenAmount} บาท พูดว่า ${message}`
  return sentence.length > TTS_MAX_CHARS ? `${sentence.slice(0, TTS_MAX_CHARS - 1)}…` : sentence
}
