import { describe, expect, it } from 'vitest'
import { isSameSitePath } from '../safe-path'

/**
 * The login callbackUrl guard, and now the alert-sound guard too. Everything
 * it sees is attacker-controlled — a query parameter on /login, a JSON body on
 * PATCH /api/me/alert-setting — so the interesting cases are the ones that LOOK
 * like a local path.
 */
describe('isSameSitePath', () => {
  it('accepts ordinary local paths', () => {
    expect(isSameSitePath('/dashboard')).toBe(true)
    expect(isSameSitePath('/demo')).toBe(true)
    expect(isSameSitePath('/dashboard?tab=history#top')).toBe(true)
  })

  it('rejects absolute URLs', () => {
    expect(isSameSitePath('https://evil.com')).toBe(false)
    expect(isSameSitePath('javascript:alert(1)')).toBe(false)
  })

  it('rejects protocol-relative URLs', () => {
    expect(isSameSitePath('//evil.com')).toBe(false)
  })

  /**
   * The case the first version of this guard let through: it starts with a
   * single slash, so a startsWith check passes it, and then the browser
   * normalises the backslash and lands on //evil.com.
   */
  it('rejects the backslash variant of a protocol-relative URL', () => {
    expect(isSameSitePath('/\\evil.com')).toBe(false)
    expect(isSameSitePath('/\\/evil.com')).toBe(false)
  })

  it('rejects an empty or relative value rather than guessing', () => {
    expect(isSameSitePath('')).toBe(false)
    expect(isSameSitePath('dashboard')).toBe(false)
  })
})
