import { describe, expect, it } from 'vitest'
import { isHoneypotFilled, passwordSchema, profileSchema, registerSchema } from '../schemas'

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

describe('profileSchema', () => {
  const PROFILE = {
    displayName: 'มายด์',
    slug: 'mind',
    bio: 'สตรีมเกม',
    avatarUrl: null,
    minAmount: 2_000,
    maxAmount: 500_000,
  }

  it('accepts a full profile', () => {
    expect(profileSchema.safeParse(PROFILE).success).toBe(true)
  })

  it('lets bio and avatar be cleared with null', () => {
    const parsed = profileSchema.parse({ ...PROFILE, bio: null, avatarUrl: null })
    expect(parsed.bio).toBeNull()
    expect(parsed.avatarUrl).toBeNull()
  })

  it('requires avatarUrl to be a URL when present', () => {
    expect(profileSchema.safeParse({ ...PROFILE, avatarUrl: 'not a url' }).success).toBe(false)
    expect(
      profileSchema.safeParse({ ...PROFILE, avatarUrl: 'https://cdn.example.com/a.png' }).success,
    ).toBe(true)
  })

  it('rejects amounts that are not whole satang', () => {
    expect(profileSchema.safeParse({ ...PROFILE, minAmount: 1.5 }).success).toBe(false)
  })

  /**
   * Deliberately NOT checked here: min <= max. A partial patch may carry only
   * one of the two, and this schema cannot see the stored value of the other —
   * the route compares them against the row. See app/api/me/profile/route.ts.
   */
  it('does not compare min against max', () => {
    expect(profileSchema.safeParse({ ...PROFILE, minAmount: 900_000 }).success).toBe(true)
  })

  it('is partial-able, which is what the PATCH route relies on', () => {
    expect(profileSchema.partial().safeParse({ displayName: 'ใหม่' }).success).toBe(true)
    expect(profileSchema.partial().safeParse({}).success).toBe(true)
  })
})

describe('profileSchema — the bank account', () => {
  const base = {
    displayName: 'rockket',
    slug: 'demo',
    bio: null,
    avatarUrl: null,
    minAmount: 2_000,
    maxAmount: 10_000_000,
  }

  it('accepts a profile with no bank account at all', () => {
    // Most streamers will never set one, and slip donations are simply not
    // offered on their page.
    expect(profileSchema.safeParse(base).success).toBe(true)
  })

  it('NEVER invents a bank field a patch did not send', () => {
    // The trap this test exists for: `.partial()` does NOT suppress a
    // `.default()` in this version of Zod, so writing these fields as
    // `.nullable().default(null)` makes this parse come back carrying
    // `bankCode: null` — and every unrelated save from the profile form would
    // silently wipe the streamer's account.
    const patch = profileSchema.partial().parse({ displayName: 'rockket' })
    expect('bankCode' in patch).toBe(false)
    expect('bankAccountLast4' in patch).toBe(false)
    expect('bankAccountName' in patch).toBe(false)
  })

  it('lets an account be cleared with an explicit null', () => {
    const patch = profileSchema.partial().parse({ bankCode: null })
    expect(patch.bankCode).toBeNull()
  })

  it.each([['12'], ['1234'], ['abc'], ['']])('rejects %s as a bank code', (bankCode) => {
    expect(profileSchema.safeParse({ ...base, bankCode }).success).toBe(false)
  })

  it.each([['788'], ['77889'], ['77x8']])('rejects %s as the last four digits', (last4) => {
    expect(profileSchema.safeParse({ ...base, bankAccountLast4: last4 }).success).toBe(false)
  })

  it('accepts a well formed account', () => {
    const parsed = profileSchema.safeParse({
      ...base,
      bankCode: '004',
      bankAccountLast4: '7788',
      bankAccountName: 'PHATCHARADANAI T',
    })
    expect(parsed.success).toBe(true)
  })
})
