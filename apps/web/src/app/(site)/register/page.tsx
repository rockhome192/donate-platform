import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { AmbientBackdrop, Wordmark } from '@/components/ui'
import { authOptions } from '@/lib/auth'
import { RegisterForm } from './RegisterForm'

/**
 * Signup. Same frame as /login — the v2 design draws them as one screen with a
 * toggle, and two routes with identical chrome is the version of that which
 * survives a page reload and can be linked to.
 */

export const metadata: Metadata = { title: 'สมัครใช้งาน — DONATR (demo)' }

/** Reads the session cookie, so it can never be prerendered. */
export const dynamic = 'force-dynamic'

export default async function RegisterPage() {
  // Same reason as /login: an account that is already signed in is being asked
  // to create a second one. No callbackUrl here — nothing links to /register
  // with one, and signing up is never the completion of a deep link.
  const session = await getServerSession(authOptions)
  if (session?.user) redirect('/dashboard')

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
            <h1 className="font-display text-h2 font-bold">สร้างบัญชีสตรีมเมอร์</h1>
            <p className="mt-1.5 text-label text-muted">ได้หน้าโดเนทของตัวเองทันทีหลังสมัคร</p>

            <RegisterForm />

            <p className="mt-5 text-center text-label text-muted">
              มีบัญชีอยู่แล้ว?{' '}
              <Link
                href="/login"
                className="font-semibold text-accent-text underline underline-offset-4 hover:text-ink"
              >
                เข้าสู่ระบบ
              </Link>
            </p>
          </div>

          {/*
            The one thing a signup page here has to say, and it is no longer
            "the money is fake". Anyone creating an account is entitled to know
            before they type WHERE the money goes: the gateway path is
            simulated, the slip path pays them directly, and this platform is
            never in the middle of either. After they have a dashboard and a
            PromptPay id in it is too late.
          */}
          <p className="mt-5 text-center text-meta text-faint">
            ระบบสาธิต — แพลตฟอร์มไม่ถือเงินและไม่จ่ายเงินออก ·
            ยอดที่ผู้ชมโอนพร้อมสลิปเข้าบัญชีของคุณโดยตรง
          </p>
        </div>
      </main>
    </>
  )
}
