import { describe, expect, it } from 'vitest'
import { isHoneypotFilled, passwordSchema, registerSchema } from '../schemas'

const VALID = {
  email: 'someone@example.com',
  password: 'hunter2hunter2',
  displayName: 'มายด์',
  slug: 'mind',
}

describe('passwordSchema', () => {
  it('requires eight characters', () => {
    expect(passwordSchema.safeParse('short12').success).toBe(false)
    expect(passwordSchema.safeParse('short123').success).toBe(true)
  })

  /**
   * The check that matters. bcrypt ignores everything past byte 72, so without
   * this two different long passwords hash to the same value and the user is
   * never told — a password ending in "…correcthorse" and one ending in
   * "…batterystaple" would both open the account.
   */
  it('measures the bcrypt ceiling in BYTES, not characters', () => {
    // 72 ASCII characters = 72 bytes. Allowed.
    expect(passwordSchema.safeParse('a'.repeat(72)).success).toBe(true)
    expect(passwordSchema.safeParse('a'.repeat(73)).success).toBe(false)

    // Thai is 3 bytes per character in UTF-8, so 24 characters is already the
    // whole budget — a character count would have let 72 of them through.
    expect(passwordSchema.safeParse('ก'.repeat(24)).success).toBe(true)
    expect(passwordSchema.safeParse('ก'.repeat(25)).success).toBe(false)
  })
})

describe('registerSchema', () => {
  it('accepts a well-formed signup', () => {
    expect(registerSchema.safeParse(VALID).success).toBe(true)
  })

  /**
   * User.email is unique and Postgres compares it byte for byte, so an
   * un-normalised address means "Someone@Example.com" registers a SECOND
   * account that then never matches the lowercased lookup in authorize().
   */
  it('trims and lowercases the email before validating', () => {
    const parsed = registerSchema.parse({ ...VALID, email: '  SomeOne@Example.COM ' })
    expect(parsed.email).toBe('someone@example.com')
  })

  it('rejects a malformed email', () => {
    expect(registerSchema.safeParse({ ...VALID, email: 'not-an-email' }).success).toBe(false)
  })

  it('applies the shared slug rules, reserved words included', () => {
    // Uppercase and underscores are not in the slug alphabet.
    expect(registerSchema.safeParse({ ...VALID, slug: 'Mind' }).success).toBe(false)
    expect(registerSchema.safeParse({ ...VALID, slug: 'my_name' }).success).toBe(false)
    expect(registerSchema.safeParse({ ...VALID, slug: 'ab' }).success).toBe(false)
    // A streamer holding `dashboard` would have an unreachable donate page —
    // Next resolves the static route first and nothing anywhere warns.
    expect(registerSchema.safeParse({ ...VALID, slug: 'dashboard' }).success).toBe(false)
    expect(registerSchema.safeParse({ ...VALID, slug: 'admin' }).success).toBe(false)
  })

  it('requires a display name that is not just whitespace', () => {
    expect(registerSchema.safeParse({ ...VALID, displayName: '   ' }).success).toBe(false)
  })

  /**
   * The honeypot is NOT this schema's job, and that is the fix for a real bug.
   *
   * With `website: z.string().max(0)` in here, a filled honeypot failed the
   * parse — so the route answered 400 with `field: "website"` and the message
   * "Too big: expected string to have <=0 characters", handing a bot the exact
   * input to leave alone. Worse on the client, which runs this same schema: a
   * browser autofilling the off-screen input labelled "Website" produced an
   * English error pointing at a control at left:-9999px, and signup became
   * impossible with nothing on screen to fix.
   */
  it('ignores a honeypot value instead of failing on it', () => {
    const parsed = registerSchema.safeParse({ ...VALID, website: 'http://spam' })
    expect(parsed.success).toBe(true)
    expect(parsed.data).not.toHaveProperty('website')
  })
})

describe('isHoneypotFilled', () => {
  it('is what actually catches the bot, on the raw body', () => {
    expect(isHoneypotFilled({ ...VALID, website: 'http://spam' })).toBe(true)
    expect(isHoneypotFilled({ ...VALID, website: '' })).toBe(false)
    expect(isHoneypotFilled(VALID)).toBe(false)
  })

  it('does not throw on a body that is not an object', () => {
    expect(isHoneypotFilled(null)).toBe(false)
    expect(isHoneypotFilled(undefined)).toBe(false)
    expect(isHoneypotFilled('website=spam')).toBe(false)
    expect(isHoneypotFilled([])).toBe(false)
  })
})
