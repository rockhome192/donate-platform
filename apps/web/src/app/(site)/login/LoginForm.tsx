'use client'

import { useState } from 'react'
import type { Route } from 'next'
import { useRouter, useSearchParams } from 'next/navigation'
import { signIn } from 'next-auth/react'
import { ErrorNote, buttonClass } from '@/components/ui'

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
    <form onSubmit={submit} className="mt-6 space-y-4">
      <div>
        <label htmlFor="email" className="mb-1.5 block text-label font-semibold text-muted">
          อีเมล
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-control border border-line-strong bg-inset px-4 py-3 text-body text-ink placeholder:text-faint"
        />
      </div>

      <div>
        <label htmlFor="password" className="mb-1.5 block text-label font-semibold text-muted">
          รหัสผ่าน
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-control border border-line-strong bg-inset px-4 py-3 text-body text-ink"
        />
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      <button type="submit" disabled={submitting} className={buttonClass('primary', 'lg', 'w-full')}>
        {submitting ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}
      </button>

      {/* The design's "หรือ" rule. It divides two ways of getting in, which is
          what a rule is for — not spacing. */}
      <div className="flex items-center gap-3 pt-1" aria-hidden>
        <span className="h-px flex-1 bg-line" />
        <span className="text-meta text-faint">หรือ</span>
        <span className="h-px flex-1 bg-line" />
      </div>

      {/*
        Demo credentials, inline instead of in a panel of their own. They were a
        full Panel with its own header before, which made the way IN to a demo
        look heavier than the login it sits under.

        Not amber, though the design file colours these like its money token:
        amber means money in this system and a password is not money. Mono ink
        instead — these are literal credentials to be typed, which is the job
        the mono role is reserved for.
      */}
      <div className="rounded-control border border-line bg-surface-2 px-4 py-3">
        <p className="text-label text-muted">บัญชีเดโม่</p>
        {/* One per line. On a single line `break-all` split the password across
            the wrap — "dem / o1234" is not something anyone can retype. */}
        <dl className="mt-1 font-mono text-meta text-ink">
          <div className="flex gap-2">
            <dt className="shrink-0 text-faint">อีเมล</dt>
            <dd className="min-w-0 break-all">{DEMO_EMAIL}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="shrink-0 text-faint">รหัส</dt>
            <dd>{DEMO_PASSWORD}</dd>
          </div>
        </dl>
        {/* A button, not a coloured span: it performs an action, and the design
            file's version was neither focusable nor announced. */}
        <button
          type="button"
          onClick={fillDemo}
          className="mt-1.5 text-label font-semibold text-accent-text underline underline-offset-4 hover:text-ink"
        >
          กรอกให้อัตโนมัติ
        </button>
      </div>
    </form>
  )
}
