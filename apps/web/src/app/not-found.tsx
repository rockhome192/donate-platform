import type { Metadata } from 'next'
import Link from 'next/link'
import { DemoBanner } from '@/components/DemoBanner'
import { Panel, PanelHeader, TechLabel, buttonClass } from '@/components/ui'

/**
 * There was no not-found.tsx at all, so a mistyped /{slug} — the most likely
 * bad URL this app will ever serve, since every streamer page is one — fell
 * through to Next's unstyled default. On a dark app that reads as a crash.
 *
 * Kept in the console vocabulary: a status label, the code, and the two places
 * worth going next. No apology copy, no illustration.
 *
 * This one file stays at the app root rather than inside (site), because it has
 * to answer BOTH cases: notFound() thrown from a route in the group, and a URL
 * that matched no route at all. Only a root not-found covers the second. The
 * cost is that it renders outside SiteLayout and so must carry the DEMO banner
 * itself — a 404 is still a page of this project, and the banner is not
 * optional on any of them (DESIGN.md 0).
 */

export const metadata: Metadata = { title: 'ไม่พบหน้านี้ — DONATR (demo)' }

export default function NotFound() {
  return (
    <>
      <DemoBanner />
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
    </>
  )
}
