/**
 * Resolve the candidate against a throwaway origin and check it stayed there.
 *
 * A `startsWith('/') && !startsWith('//')` pair looks equivalent and is not:
 * browsers normalise backslashes to slashes for http(s), so `/\evil.com`
 * survives that check and then resolves as the protocol-relative
 * `//evil.com`. Letting the URL parser decide removes the whole family of
 * those tricks instead of blocking them one at a time.
 *
 * Two callers, which is why it lives in shared rather than beside either of
 * them: the login route uses it on `callbackUrl`, and `alertSettingSchema`
 * uses it on `soundUrl`, where a bundled sound is a path and an uploaded one
 * is an absolute URL.
 */
export function isSameSitePath(candidate: string): boolean {
  if (!candidate.startsWith('/')) return false
  try {
    return new URL(candidate, 'https://donatr.invalid').origin === 'https://donatr.invalid'
  } catch {
    return false
  }
}
