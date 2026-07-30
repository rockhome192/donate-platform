'use client'

import { useState } from 'react'
import type { Route } from 'next'
import { useRouter, useSearchParams } from 'next/navigation'
import { signIn } from 'next-auth/react'

const DEMO_EMAIL = 'demo@donate-platform.local'
const DEMO_PASSWORD = 'demo1234'

/**
 * Resolve the candidate against a throwaway origin and check it stayed there.
 *
 * A `startsWith('/') && !startsWith('//')` pair looks equivalent and is not:
 * browsers normalise backslashes to slashes for http(s), so `/\evil.com`
 * survives that check and then resolves as the protocol-relative
 * `//evil.com`. Letting the URL parser decide removes the whole family of
 * those tricks instead of blocking them one at a time.
 */
export function isSameSitePath(candidate: string): boolean {
  if (!candidate.startsWith('/')) return false
  try {
    return new URL(candidate, 'https://donatr.invalid').origin === 'https://donatr.invalid'
  } catch {
    return false
  }
}

export function LoginForm() {
  const router = useRouter()
  const params = useSearchParams()
  // Only ever a same-site path: an attacker-supplied absolute URL here turns
  // login into an open redirect.
  const rawCallback = params.get('callbackUrl') ?? '/dashboard'
  const callbackUrl = isSameSitePath(rawCallback) ? rawCallback : '/dashboard'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)

    const res = await signIn('credentials', { email, password, redirect: false, callbackUrl })

    setSubmitting(false)
    if (!res || res.error) {
      // Deliberately not "no such account" vs "wrong password" — that difference
      // tells someone which emails are registered.
      setError('อีเมลหรือรหัสผ่านไม่ถูกต้อง')
      return
    }
    // typedRoutes cannot check a value that only exists at runtime. The cast is
    // safe because callbackUrl was narrowed to a same-site path above; a bad
    // one lands on /dashboard rather than off-site.
    router.push(callbackUrl as Route)
    router.refresh()
  }

  function fillDemo() {
    setEmail(DEMO_EMAIL)
    setPassword(DEMO_PASSWORD)
  }

  return (
    <form onSubmit={submit} className="mt-8 space-y-4">
      <div>
        <label htmlFor="email" className="mb-1.5 block text-sm text-muted">
          อีเมล
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-xl border border-line2 bg-bg px-4 py-3 text-ink placeholder:text-faint focus:border-accent focus:outline-none"
        />
      </div>

      <div>
        <label htmlFor="password" className="mb-1.5 block text-sm text-muted">
          รหัสผ่าน
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-xl border border-line2 bg-bg px-4 py-3 text-ink focus:border-accent focus:outline-none"
        />
      </div>

      {error && (
        <p role="alert" className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-xl bg-accent px-6 py-3.5 font-display font-bold text-white hover:bg-accent2 disabled:opacity-60"
      >
        {submitting ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}
      </button>

      <div className="rounded-xl border border-line bg-panel p-4 text-center">
        <p className="text-xs text-faint">บัญชีสาธิตสำหรับทดลองใช้</p>
        <p className="mt-1 font-mono text-xs text-muted">
          {DEMO_EMAIL} / {DEMO_PASSWORD}
        </p>
        <button
          type="button"
          onClick={fillDemo}
          className="mt-3 text-sm font-semibold text-accent hover:underline"
        >
          กรอกให้อัตโนมัติ
        </button>
      </div>
    </form>
  )
}
