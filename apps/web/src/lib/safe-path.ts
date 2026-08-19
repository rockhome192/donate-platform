/**
 * Resolve the candidate against a throwaway origin and check it stayed there.
 *
 * A `startsWith('/') && !startsWith('//')` pair looks equivalent and is not:
 * browsers normalise backslashes to slashes for http(s), so `/\evil.com`
 * survives that check and then resolves as the protocol-relative
 * `//evil.com`. Letting the URL parser decide removes the whole family of
 * those tricks instead of blocking them one at a time.
 *
 * Lives in lib/ rather than beside the login form because both sides of the
 * login route need it now: the form, which is a client component, and the page
 * itself, which is a server component and cannot call a function imported from
 * a `'use client'` module — that import yields a client reference, not the
 * function.
 */
export function isSameSitePath(candidate: string): boolean {
  if (!candidate.startsWith('/')) return false
  try {
    return new URL(candidate, 'https://donatr.invalid').origin === 'https://donatr.invalid'
  } catch {
    return false
  }
}
