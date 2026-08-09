'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { signIn } from 'next-auth/react'
import { registerSchema } from '@dp/shared'
import { ErrorNote, buttonClass } from '@/components/ui'

/**
 * Signup. Creates the account, then signs in with the same credentials.
 *
 * Two requests rather than one because NextAuth stays the only thing that ever
 * issues a session — see the note in app/api/register/route.ts. The cost is a
 * state this has to handle honestly: the account CAN be created and the sign-in
 * still fail (a dropped connection between the two). Sending the user to /login
 * with a message beats a generic error, because "สมัครไม่สำเร็จ" would be false
 * and they would try again and hit "อีเมลนี้ถูกใช้ไปแล้ว" on their own email.
 */

/**
 * Suggests a slug from what they typed as a display name.
 *
 * Latin letters and digits only, which is what streamerSlugSchema allows — a
 * Thai display name produces nothing here, and the field is then left for them
 * to fill rather than pre-filled with garbage.
 */
function suggestSlug(displayName: string): string {
  return displayName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
}

export function RegisterForm() {
  const router = useRouter()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [slug, setSlug] = useState('')
  // Set once the user edits the slug themselves, so the display name stops
  // overwriting a deliberate choice on every keystroke.
  const [slugTouched, setSlugTouched] = useState(false)
  const [honeypot, setHoneypot] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const effectiveSlug = slugTouched ? slug : suggestSlug(displayName)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const parsed = registerSchema.safeParse({
      email,
      password,
      displayName,
      slug: effectiveSlug,
    })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง')
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // The honeypot rides alongside the validated fields rather than through
        // the schema: the server checks it on the raw body, and keeping it out
        // of registerSchema is what stops an autofilled off-screen input from
        // producing an error the user can neither read nor fix.
        body: JSON.stringify({ ...parsed.data, website: honeypot }),
      })
      const body = await res.json().catch(() => null)

      if (!res.ok) {
        setError(body?.error ?? 'สมัครไม่สำเร็จ กรุณาลองใหม่')
        return
      }

      const signedIn = await signIn('credentials', {
        email: parsed.data.email,
        password: parsed.data.password,
        redirect: false,
      })

      if (!signedIn || signedIn.error) {
        setError('สร้างบัญชีแล้ว แต่เข้าสู่ระบบอัตโนมัติไม่สำเร็จ — กรุณาเข้าสู่ระบบเอง')
        return
      }

      router.push('/dashboard')
      router.refresh()
    } catch {
      setError('เชื่อมต่อไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
      <div>
        <label htmlFor="displayName" className={LABEL}>
          ชื่อที่แสดง
        </label>
        <input
          id="displayName"
          maxLength={40}
          required
          placeholder="ชื่อที่ผู้ชมเห็นบนหน้าโดเนท"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          className={FIELD}
        />
      </div>

      <div>
        <label htmlFor="slug" className={LABEL}>
          ลิงก์หน้าโดเนท
        </label>
        <div className="flex items-center overflow-hidden rounded-control border border-line-strong bg-inset">
          <span className="shrink-0 pl-4 font-mono text-label text-faint">/</span>
          <input
            id="slug"
            required
            maxLength={30}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="your-name"
            value={effectiveSlug}
            onChange={(e) => {
              setSlugTouched(true)
              setSlug(e.target.value.toLowerCase())
            }}
            className="w-full bg-transparent py-3 pr-4 pl-1 font-mono text-body text-ink outline-none placeholder:text-faint"
          />
        </div>
        <p className="mt-1.5 text-meta text-faint">
          a–z, 0–9 และ – เท่านั้น · เปลี่ยนภายหลังได้ในหน้าโปรไฟล์
        </p>
      </div>

      <div>
        <label htmlFor="email" className={LABEL}>
          อีเมล
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={FIELD}
        />
      </div>

      <div>
        <label htmlFor="password" className={LABEL}>
          รหัสผ่าน
        </label>
        <input
          id="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={FIELD}
        />
        <p className="mt-1.5 text-meta text-faint">อย่างน้อย 8 ตัวอักษร</p>
      </div>

      {/* Honeypot: off-screen rather than display:none, which some bots skip. */}
      <div aria-hidden className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="website">Website</label>
        <input
          id="website"
          tabIndex={-1}
          autoComplete="off"
          value={honeypot}
          onChange={(e) => setHoneypot(e.target.value)}
        />
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      <button type="submit" disabled={submitting} className={buttonClass('primary', 'lg', 'w-full')}>
        {submitting ? 'กำลังสร้างบัญชี…' : 'สร้างบัญชี'}
      </button>
    </form>
  )
}

const FIELD =
  'w-full rounded-control border border-line-strong bg-inset px-4 py-3 text-body text-ink placeholder:text-faint'
const LABEL = 'mb-1.5 block text-label font-semibold text-muted'
