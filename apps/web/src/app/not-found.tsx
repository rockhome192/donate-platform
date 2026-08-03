import type { Metadata } from 'next'
import Link from 'next/link'
import { Panel, PanelHeader, TechLabel, buttonClass } from '@/components/ui'

/**
 * There was no not-found.tsx at all, so a mistyped /{slug} — the most likely
 * bad URL this app will ever serve, since every streamer page is one — fell
 * through to Next's unstyled default. On a dark app that reads as a crash.
 *
 * Kept in the console vocabulary: a status label, the code, and the two places
 * worth going next. No apology copy, no illustration.
 */

export const metadata: Metadata = { title: 'ไม่พบหน้านี้ — DONATR (demo)' }

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-12">
      <Panel>
        <PanelHeader
          label="not found"
          right={<span className="font-mono text-meta text-faint">404</span>}
        />
        <div className="px-5 py-8">
          <h1 className="font-display text-h1 font-bold">ไม่พบหน้านี้</h1>
          <p className="mt-2.5 text-label leading-relaxed text-muted">
            ลิงก์อาจพิมพ์ผิด หรือสตรีมเมอร์คนนี้ยังไม่ได้เปิดหน้าโดเนท
            ลองตรวจชื่อผู้ใช้หลังเครื่องหมาย / อีกครั้ง
          </p>

          <div className="mt-6 flex flex-wrap gap-2.5">
            <Link href="/" className={buttonClass('primary', 'md')}>
              กลับหน้าแรก
            </Link>
            <Link href="/demo" className={buttonClass('secondary', 'md')}>
              ดูหน้าโดเนทตัวอย่าง
            </Link>
          </div>
        </div>
      </Panel>

      <p className="mt-5 text-center">
        <TechLabel>DONATR — demo</TechLabel>
      </p>
    </main>
  )
}
