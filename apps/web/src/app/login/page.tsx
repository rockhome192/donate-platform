import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { LoginForm } from './LoginForm'

export const metadata: Metadata = { title: 'เข้าสู่ระบบ — DONATR (demo)' }

export default function LoginPage() {
  return (
    <main className="mx-auto w-full max-w-sm px-5 py-16">
      <Link href="/" className="font-display text-xl font-bold">
        DONATR
      </Link>
      <h1 className="mt-6 font-display text-2xl font-bold">เข้าสู่ระบบสตรีมเมอร์</h1>
      <p className="mt-1.5 text-sm text-muted">จัดการหน้าโดเนทและดูรายการที่เข้ามา</p>

      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </main>
  )
}
