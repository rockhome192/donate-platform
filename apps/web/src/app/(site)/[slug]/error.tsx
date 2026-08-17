'use client'

import { useEffect } from 'react'
import { AmbientBackdrop, Wordmark, buttonClass } from '@/components/ui'

/**
 * What a VIEWER sees when the donate page throws — someone who followed a link
 * from a stream, has no account here, and no reason to try twice.
 *
 * Deliberately different in tone from the dashboard's: no digest, no mention of
 * a database. Neither means anything to this person, and a hash on screen reads
 * as "this site is broken" to someone who was about to send money. What they
 * get is the one useful action and an honest sentence.
 *
 * A missing streamer is NOT this — an unknown slug calls notFound() and renders
 * not-found.tsx. Reaching this file means something actually failed.
 */
export default function DonateError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[donate] render failed', error)
  }, [error])

  return (
    <>
      <AmbientBackdrop />
      <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-5 py-5">
        <div className="inline-flex w-fit items-center py-1">
          <Wordmark size="sm" />
        </div>

        <main className="flex flex-1 items-center">
          <article className="w-full rounded-panel border border-line bg-surface px-6 py-8 text-center">
            <h1 className="font-display text-h2 font-bold">เปิดหน้านี้ไม่สำเร็จ</h1>
            <p className="mx-auto mt-3 max-w-sm text-label text-muted">
              ตอนนี้โหลดหน้าโดเนทไม่ได้ ลองใหม่อีกครั้งได้เลย ถ้ายังไม่ได้ ลองกลับมาใหม่ในอีกสักครู่
            </p>
            <button
              type="button"
              onClick={reset}
              className={buttonClass('primary', 'md', 'mt-6 w-full sm:w-auto')}
            >
              ลองอีกครั้ง
            </button>
          </article>
        </main>
      </div>
    </>
  )
}
