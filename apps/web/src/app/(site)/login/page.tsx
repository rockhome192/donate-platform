import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { AmbientBackdrop, Wordmark } from '@/components/ui'
import { LoginForm } from './LoginForm'

/**
 * Streamer sign-in.
 *
 * The v2 design centres this in the viewport rather than hanging it off the top
 * edge, and it is right for the reason centring is usually wrong: there is one
 * thing to do here and nothing below the fold, so the page has no sequence to
 * establish. Every other screen in this system stays top-aligned.
 */

export const metadata: Metadata = { title: 'เข้าสู่ระบบ — DONATR (demo)' }

export default function LoginPage() {
  return (
    <>
      <AmbientBackdrop />
      <main className="grid min-h-dvh place-items-center px-5 py-12">
        <div className="w-full max-w-sm animate-fade-up">
          {/* py-1 lifts this off 72x23, under the 24px minimum touch target. */}
          <Link href="/" className="flex justify-center py-1">
            <Wordmark size="lg" />
          </Link>

          <div className="mt-7 rounded-panel border border-line bg-surface px-5 py-6 sm:px-6">
            <h1 className="font-display text-h2 font-bold">เข้าสู่ระบบสตรีมเมอร์</h1>
            <p className="mt-1.5 text-label text-muted">จัดการหน้าโดเนทและดูรายการที่เข้ามา</p>

            <Suspense fallback={null}>
              <LoginForm />
            </Suspense>

            {/* The design's auth toggle. It links somewhere real now — until
                registration existed this line was deliberately absent, because a
                link to a page that does not exist is the same defect as an
                invented statistic, just one that fails later on a click. */}
            <p className="mt-5 text-center text-label text-muted">
              ยังไม่มีบัญชี?{' '}
              <Link
                href="/register"
                className="font-semibold text-accent-text underline underline-offset-4 hover:text-ink"
              >
                สมัครใช้งาน
              </Link>
            </p>
          </div>

          <p className="mt-5 text-center text-meta text-faint">
            ระบบสาธิต — ไม่รับเงินจริง และไม่มีการจ่ายเงินออกจริง
          </p>
        </div>
      </main>
    </>
  )
}
