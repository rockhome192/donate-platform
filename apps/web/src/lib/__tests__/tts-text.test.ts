import { describe, expect, it } from 'vitest'
import { TTS_MAX_CHARS, escapeSsml, ttsTextFor } from '@/lib/tts/text'

/**
 * What gets said, and what gets neutralised before it is said.
 *
 * Both inputs are typed by a stranger on a public form and both end up inside
 * an XML document that a paid API parses, so the interesting cases here are
 * the ones designed to be markup rather than words.
 */

const base = { donorName: 'สมชาย', message: 'สู้ ๆ นะครับ', amount: 5_000 }

describe('ttsTextFor', () => {
  it('reads name, amount and message in the order the alert shows them', () => {
    expect(ttsTextFor(base)).toBe('สมชาย โดเนท 50 บาท พูดว่า สู้ ๆ นะครับ')
  })

  /**
   * A donation with no message is already fully described by the alert on
   * screen and the chime. Paying to have a name read alone is worse, not
   * better — and this is the branch that keeps the bill at zero for the
   * majority of donations.
   */
  it('says nothing when there is no message', () => {
    expect(ttsTextFor({ ...base, message: '' })).toBeNull()
    expect(ttsTextFor({ ...base, message: '   ' })).toBeNull()
  })

  it('falls back to a name rather than starting the sentence with silence', () => {
    expect(ttsTextFor({ ...base, donorName: '  ' })).toMatch(/^ผู้ชมนิรนาม /)
  })

  it('speaks a whole number of baht as a whole number', () => {
    // 50, not 50.00 — toFixed(2) here sounds like a robot reading a receipt.
    expect(ttsTextFor({ ...base, amount: 5_000 })).toContain('50 บาท')
    expect(ttsTextFor({ ...base, amount: 5_050 })).toContain('50.50 บาท')
  })

  it('truncates rather than paying for an essay', () => {
    const long = ttsTextFor({ ...base, message: 'ก'.repeat(1_000) })!
    expect(long.length).toBe(TTS_MAX_CHARS)
    expect(long.endsWith('…')).toBe(true)
  })

  /**
   * A single 0x00 in a message is not well-formed XML, so without this every
   * TTS request for that donation would come back 400 — one donation silently
   * losing its voice line for a reason no log would explain.
   */
  it('replaces control characters, which are not legal XML and make no sound', () => {
    const text = ttsTextFor({ ...base, message: 'ดี\u0000มาก\u0007' })!
    expect(text).not.toMatch(/[\u0000-\u0008]/)
    expect(text).toContain('ดี มาก')
  })
})

describe('escapeSsml', () => {
  it('escapes all five predefined entities, not just the two obvious ones', () => {
    expect(escapeSsml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&apos;')
  })

  /**
   * The attack this exists for: closing our own <voice> element and opening
   * another one would let a donor pick the voice, the language, or insert
   * arbitrary SSML — including <audio src> in providers that support it.
   */
  it('neutralises an attempt to close the voice element and open a new one', () => {
    const hostile = '</voice><voice name="en-US-JennyNeural">pwned'
    const escaped = escapeSsml(hostile)
    expect(escaped).not.toContain('<')
    expect(escaped).not.toContain('>')
    expect(escaped).toContain('&lt;/voice&gt;')
  })

  it('escapes the ampersand first, so an escape is not escaped twice', () => {
    // "&lt;" arriving as literal text must come out as "&amp;lt;", not "&lt;".
    expect(escapeSsml('&lt;')).toBe('&amp;lt;')
  })
})
