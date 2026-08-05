'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { LiveDot, PanelHeader, StatusTrack } from '@/components/ui'

/**
 * The landing page's centrepiece: the alert arriving, on the transparent OBS
 * stage it actually lives on.
 *
 * A still picture of an alert is the one thing every competitor's landing page
 * already has, and it misses what the product is — the arrival, and the fact
 * that the three pipeline stages complete before anything reaches the screen.
 * So the track advances in step with the animation rather than beside it.
 *
 * PROGRESSIVE ENHANCEMENT, deliberately. The server renders the finished
 * state: alert visible, track complete. JavaScript then *rewinds* to the idle
 * state and plays. The reverse — hiding the content in CSS and revealing it on
 * mount — is what left a previous project blank on phones where hydration
 * failed, and it fails silently, which is the worst kind.
 *
 * Everything shown is labelled sample data. Nothing here reports a real
 * connection — this panel is a representation, not a live socket, and says so
 * in its own header.
 */

type Stage = 'static' | 'idle' | 'pending' | 'paid' | 'alerted' | 'leaving' | 'gone'

const TRACK = ['pending', 'paid', 'alerted'] as const

/** currentIndex for StatusTrack at each stage. */
const TRACK_INDEX: Record<Stage, number> = {
  static: 2,
  idle: -1,
  pending: 0,
  paid: 1,
  alerted: 2,
  leaving: 2,
  gone: 2,
}

/**
 * Sample donations, cycled one per pass.
 *
 * The alert leaves at the end of its duration because that is what a real one
 * does — and then the NEXT donation arrives, because that is also what really
 * happens on a stream. A single alert playing once and leaving an empty
 * checkerboard for the rest of the visit is the least true version of this
 * panel, not the most: it shows a stream where exactly one person ever
 * donated.
 *
 * A different donor each pass is what keeps this from being decoration. The
 * motion rule in globals.css is that movement reports causality — a loop
 * replaying one identical alert would report nothing, while a queue of
 * different arrivals is the product's actual behaviour under load.
 *
 * Names, amounts and messages are the sample set from the v2 design file, and
 * the stage labels them as invented in its own caption.
 */
const SAMPLES = [
  { name: 'มายด์', amount: '฿150', message: 'สู้ ๆ นะคะ ชอบสตรีมมาก 💜' },
  { name: 'บอส', amount: '฿50', message: 'มาส่งกำลังใจครับ' },
  { name: 'ป่าน', amount: '฿100', message: 'ขอเพลงหน่อยค่ะ' },
  { name: 'เจได', amount: '฿300', message: 'GG well played' },
] as const

const SEQUENCE: ReadonlyArray<[Stage, number]> = [
  ['pending', 0],
  ['paid', 650],
  ['alerted', 1300],
  ['leaving', 5300],
  ['gone', 5700],
]

/** Quiet stage between two donations. Long enough to read as a gap, not a stall. */
const GAP_MS = 1_800
const CYCLE_MS = 5_700 + GAP_MS

export function OverlayStage() {
  // Starts at the finished state so a viewer without JS, or with a broken
  // hydration, still sees a complete, sensible panel.
  const [stage, setStage] = useState<Stage>('static')
  const [enhanced, setEnhanced] = useState(false)
  const [sample, setSample] = useState(0)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const stageRef = useRef<HTMLDivElement>(null)

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout)
    timers.current = []
  }, [])

  const play = useCallback(() => {
    clearTimers()
    setStage('idle')
    // A frame of idle first, so replaying restarts the animation instead of
    // the browser seeing an unchanged class and skipping it.
    timers.current = SEQUENCE.map(([next, at]) => setTimeout(() => setStage(next), at + 40))
    // The next donation. Scheduled from here rather than chained off the last
    // stage so one cleared timer array stops the whole cycle — a loop that
    // reschedules itself from inside a callback outlives its own cleanup.
    timers.current.push(
      setTimeout(() => {
        setSample((i) => (i + 1) % SAMPLES.length)
        play()
      }, CYCLE_MS),
    )
  }, [clearTimers])

  useLayoutEffect(() => {
    // Respect the OS setting before anything moves. Reduced motion keeps the
    // finished state, which still says everything the animation would.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    setEnhanced(true)
    setStage('idle')
  }, [])

  useEffect(() => {
    if (!enhanced || !stageRef.current) return

    /**
     * Runs only while on screen. Starting on first sight is the original
     * reason for this — an animation that finished before the visitor scrolled
     * to it has communicated nothing — but now that the cycle repeats, the
     * observer also has to STOP it. A landing page quietly running timers and
     * repaints against a panel nobody is looking at is a battery cost with no
     * viewer attached, and on a phone that is the difference people feel.
     */
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.some((e) => e.isIntersecting)
        if (visible) play()
        else clearTimers()
      },
      { threshold: 0.4 },
    )
    observer.observe(stageRef.current)
    return () => observer.disconnect()
  }, [enhanced, play, clearTimers])

  useEffect(() => clearTimers, [clearTimers])

  const showAlert = stage === 'static' || stage === 'alerted' || stage === 'leaving'
  const current = SAMPLES[sample]!

  return (
    <>
      <PanelHeader
        label="OBS Browser Source"
        right={
          <span className="flex items-center gap-2 text-meta text-faint">
            <LiveDot live={false} />
            ตัวอย่าง — ยังไม่ได้เชื่อมต่อจริง
          </span>
        }
      />

      {/*
        16:9 is the canvas an overlay is composited onto, and the alert anchors
        to a corner of it rather than floating in the middle. But a true 16:9 at
        this container's width is ~550px tall, which leaves most of the panel as
        empty texture and pushes the headline under the fold — the same void the
        old centred card had, just patterned.

        max-h caps it into a letterbox of the TOP of the stream canvas, which is
        exactly the band the alert lives in. Phones keep the real ratio, since
        16:9 of 350px is only ~200px tall and needs no crop.
      */}
      <div
        ref={stageRef}
        className="obs-checker relative aspect-video max-h-80 w-full overflow-hidden border-b border-line"
      >
        {showAlert && (
          <div
            className={`absolute top-[8%] left-[4%] flex w-[min(24rem,72%)] items-center gap-3 rounded-panel bg-gradient-to-br from-money-soft to-money px-4 py-3 text-money-ink shadow-xl shadow-black/50 ${
              stage === 'alerted' ? 'animate-alert-in' : ''
            } ${stage === 'leaving' ? 'animate-alert-out' : ''}`}
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-control bg-black/10 text-h3">
              🎉
            </span>
            <div className="min-w-0">
              <p className="truncate font-display text-label font-bold sm:text-h3">
                {current.name} โดเนท{' '}
                <span className="font-numeric tabular-nums">{current.amount}</span>
              </p>
              <p className="truncate text-meta opacity-80 sm:text-label">{current.message}</p>
            </div>
          </div>
        )}

        <p className="absolute right-3 bottom-2.5 left-3 text-center text-micro text-faint">
          ภาพจำลอง — ชื่อ ยอดเงิน และข้อความเป็นข้อมูลสมมติ
          <span className="hidden sm:inline"> · ตารางคือพื้นโปร่งใสแบบที่ OBS แสดง</span>
        </p>
      </div>

      <div className="px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="min-w-[15rem] flex-1">
            <StatusTrack steps={TRACK} currentIndex={TRACK_INDEX[stage]} />
          </div>

          {/* Only offered once JS is driving. Without it the panel is already
              at its finished state and there is nothing to replay. */}
          {enhanced && (
            <button
              type="button"
              onClick={play}
              className="label-tech shrink-0 rounded-chip border border-line-strong px-3 py-2 text-muted transition-colors hover:border-accent-text hover:text-ink"
            >
              ▶ เล่นอีกครั้ง
            </button>
          )}
        </div>

        <p className="mt-3 text-meta leading-relaxed text-faint">
          ทุกโดเนทเดินผ่านสามสถานะนี้ — สร้าง QR แล้วรอชำระ, webhook ยืนยันว่าจ่ายจริง,
          แล้วจึงยิงขึ้นจอ ถ้า overlay หลุดตอน alert ออก ระบบเก็บไว้ให้แล้วส่งซ้ำตอนต่อกลับ
        </p>
      </div>
    </>
  )
}
