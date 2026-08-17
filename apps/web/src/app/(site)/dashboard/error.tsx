'use client'

import { useEffect } from 'react'
import { Panel, PanelHeader, TechLabel, buttonClass } from '@/components/ui'

/**
 * What a streamer sees when a console screen throws.
 *
 * Without this file the answer is Next's own error page: in production, a bare
 * "Application error: a client-side exception has occurred" on an empty white
 * document, with the console shell gone. On a portfolio demo that reads as a
 * dead site rather than a bad minute.
 *
 * The likely cause here is not a bug at all — it is the database. This runs on
 * a free-tier Postgres that suspends itself when idle, so a first request after
 * a quiet spell can time out while the machine wakes. That failure is worth
 * retrying, and `reset()` re-renders the segment rather than reloading the tab,
 * so the retry costs one query instead of a whole page.
 *
 * Errors in dashboard/layout.tsx are NOT caught here — a boundary cannot catch
 * the layout it lives inside. That one falls through to the root.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // The user is never shown the message: it can carry a connection string, a
    // column name, a slice of a query. The server log already has the real one,
    // keyed by digest.
    console.error('[dashboard] render failed', error)
  }, [error])

  return (
    <>
      <header>
        <TechLabel className="text-danger">// error</TechLabel>
        <h1 className="mt-1 font-display text-h1 font-bold">หน้านี้โหลดไม่สำเร็จ</h1>
      </header>

      <Panel className="mt-6">
        <PanelHeader label="what happened" />
        <div className="space-y-4 p-4 sm:p-5">
          <p className="text-label text-muted">
            เกิดข้อผิดพลาดระหว่างดึงข้อมูล ส่วนใหญ่เป็นเรื่องชั่วคราว — ฐานข้อมูลของเดโม่นี้จะหยุดทำงานเองเมื่อ
            ไม่มีคนใช้ คำขอแรกหลังจากนั้นจึงอาจรอจนหมดเวลา ลองใหม่อีกครั้งมักจะผ่าน
          </p>
          <p className="text-meta text-faint">
            ข้อมูลโดเนทของคุณไม่ได้หายไปไหน หน้านี้แค่แสดงผลไม่สำเร็จเท่านั้น
          </p>

          <div className="flex flex-wrap items-center gap-2.5">
            <button type="button" onClick={reset} className={buttonClass('primary', 'sm')}>
              ลองอีกครั้ง
            </button>
            <a href="/dashboard" className={buttonClass('secondary', 'sm')}>
              กลับหน้าภาพรวม
            </a>
          </div>

          {/* The digest is the only thing that ties this screen to a line in the
              server log, and it is safe to print — it is a hash, not a message. */}
          {error.digest && (
            <p className="border-t border-line pt-3 font-mono text-micro text-faint">
              digest: {error.digest}
            </p>
          )}
        </div>
      </Panel>
    </>
  )
}
