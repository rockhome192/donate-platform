import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { TechLabel } from '@/components/ui'
import { LoginForm } from './LoginForm'

export const metadata: Metadata = { title: 'เข้าสู่ระบบ — DONATR (demo)' }

export default function LoginPage() {
  return (
    <main className="mx-auto w-full max-w-sm px-5 py-14">
      {/* py-1 lifts this off 72x23, under the 24px minimum touch target. */}
      <Link href="/" className="inline-flex items-center py-1 font-display text-h3 font-bold">
        DONATR
      </Link>
      <div className="mt-8">
        <TechLabel>streamer sign in</TechLabel>
        <h1 className="mt-1.5 font-display text-h1 font-bold">เข้าสู่ระบบสตรีมเมอร์</h1>
        <p className="mt-1.5 text-label text-muted">จัดการหน้าโดเนทและดูรายการที่เข้ามา</p>
      </div>

      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </main>
  )
}
