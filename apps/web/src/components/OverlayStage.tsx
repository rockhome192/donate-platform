'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AlertCard } from '@/components/AlertCard'
import { LiveDot, StatusTrack, TechLabel } from '@/components/ui'

/**
 * The landing page's centrepiece: the alert arriving, in the framed stage the
 * v2 design file draws for it.
 *
 * A still picture of an alert is the one thing every competitor's landing page
 * already has, and it misses what the product is — the arrival, and the fact
 * that the three pipeline stages complete before anything reaches the screen.
 * So the track advances in step with the animation rather than beside it.
 *
 * COMPOSITION IS THE DESIGN FILE'S. Its stage is a self-contained dark box:
 * dot grid, four accent corner brackets, a status row across the top, then the
 * alert and the queued item stacked IN FLOW beneath it. The previous build had
 * the alert absolutely positioned on a 16:9 OBS checkerboard with the panel
 * header outside the frame, which is a different picture — this is the one the
 * user drew.
 *
 * Three things in that drawing did not survive, for the reason that has held on
 * this page since part one — it may not claim something the product does not do:
 *
 * - **"OBS · CONNECTED" and the "LIVE" chip.** Nothing here is connected to
 *   anything. The row keeps its anatomy and says what is true instead.
 * - **The GOAL TODAY progress bar.** There is no goal anywhere in the schema. A
 *   sample donation is sample DATA and says so; a goal bar advertises a FEATURE.
 *   The status track takes its slot, which is the same shape doing a real job.
 * - **The amber offset shadow.** Amber means money in this system. The offset
 *   block is kept in accent, matching the CTA directly above it.
 *
 * PROGRESSIVE ENHANCEMENT, deliberately. The server renders the finished state:
 * alert visible, track complete. JavaScript then *rewinds* to the idle state and
 * plays. The reverse — hiding the content in CSS and revealing it on mount — is
 * what left a previous project blank on phones where hydration failed, and it
 * fails silently, which is the worst kind.
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
 * happens on a stream. A single alert playing once and leaving an empty stage
 * for the rest of the visit is the least true version of this panel, not the
 * most: it shows a stream where exactly one person ever donated.
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

/** The four framing brackets, as border edges rather than four bespoke divs. */
const CORNERS = [
  { key: 'tl', className: 'top-3 left-3 rounded-tl-[4px] border-t-2 border-l-2' },
  { key: 'tr', className: 'top-3 right-3 rounded-tr-[4px] border-t-2 border-r-2' },
  { key: 'bl', className: 'bottom-3 left-3 rounded-bl-[4px] border-b-2 border-l-2' },
  { key: 'br', className: 'bottom-3 right-3 rounded-br-[4px] border-r-2 border-b-2' },
] as const

/**
 * What the alert slot says while no alert is on screen.
 *
 * These are the pipeline's real stages, not filler: a donation genuinely sits
 * at PENDING until a webhook confirms it, and genuinely does not reach the
 * overlay until after that. `static` and `alerted` never reach this map — the
 * alert itself is showing then — but every stage is listed so adding one later
 * cannot silently render an empty string.
 */
const IDLE_CAPTION: Record<Stage, string> = {
  static: 'รอโดเนทถัดไป…',
  idle: 'รอโดเนทถัดไป…',
  pending: 'มีคนสร้าง QR แล้ว — รอชำระเงิน',
  paid: 'webhook ยืนยันว่าจ่ายแล้ว — กำลังส่งขึ้นจอ',
  alerted: 'รอโดเนทถัดไป…',
  leaving: 'รอโดเนทถัดไป…',
  gone: 'รอโดเนทถัดไป…',
}

/** Quiet stage between two donations. Long enough to read as a gap, not a stall. */
const GAP_MS = 1_800
const CYCLE_MS = 5_700 + GAP_MS

export function OverlayStage() {
  // Starts at the finished state so a viewer without JS, or with a broken
  // hydration, still sees a complete, sensible panel.
  const [stage, setStage] = useState<Stage>('static')
  const [enhanced, setEnhanced] = useState(false)
  const [sample, setSample] = useState(0)
  const [paused, setPaused] = useState(false)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const stageRef = useRef<HTMLDivElement>(null)
  /**
   * Read by the IntersectionObserver, which must not restart a paused loop when
   * the panel scrolls back into view. A ref rather than state because the
   * observer is created once and would otherwise capture the value it was built
   * with — the classic stale closure, and here it presents as "pause works
   * until you scroll away and back".
   */
  const pausedRef = useRef(false)

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

  const pause = useCallback(() => {
    pausedRef.current = true
    setPaused(true)
    // Holds the frame that is on screen. `stage` is left exactly as it is.
    clearTimers()
  }, [clearTimers])

  const resume = useCallback(() => {
    pausedRef.current = false
    setPaused(false)
    play()
  }, [play])

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
        // A deliberate pause outranks visibility: scrolling away and back must
        // not restart something the viewer stopped on purpose.
        if (visible && !pausedRef.current) play()
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
  // Whoever is up after this one — the queued row below is showing the real
  // next item in the cycle, not a fixed placeholder.
  const next = SAMPLES[(sample + 1) % SAMPLES.length]!

  return (
    <div
      ref={stageRef}
      className="dot-grid relative mx-auto flex min-h-[19.5rem] w-full max-w-3xl flex-col overflow-hidden rounded-panel border border-line-strong bg-inset p-5 shadow-[10px_10px_0_rgba(255,59,78,0.12)] sm:p-6"
    >
      {CORNERS.map((corner) => (
        <span key={corner.key} aria-hidden className={`absolute size-5 border-accent ${corner.className}`} />
      ))}

      {/* The design's status row. Same anatomy — state on the left, a chip on
          the right — carrying what this panel can honestly report. */}
      <div className="relative flex items-center justify-between gap-3">
        <span className="flex items-center gap-2">
          <LiveDot live={false} />
          <TechLabel>OBS browser source</TechLabel>
        </span>
        <span className="label-tech rounded-chip bg-accent px-2.5 py-1 text-white">demo</span>
      </div>

      {/*
        The alert and the queue sit in normal flow, as the design draws them.
        min-h on the wrapper holds the box open through the idle gap so the page
        does not shift every 7.5 seconds — an animation that reflows the section
        below it is worse than no animation.
      */}
      <div className="relative mt-5 min-h-[8.75rem]">
        {/*
          The gap between two donations is 3 of every 7.5 seconds, and on the
          design's flat panel — unlike the old checkerboard, which read as an
          empty OBS canvas on its own — a blank slot for that long reads as a
          component that failed to load.
          It is filled with what the pipeline is doing at that exact moment,
          which is the same thing the track underneath is reporting. So the
          quiet half of the cycle now says something instead of going dark.
        */}
        {!showAlert && (
          <div className="flex min-h-[4.75rem] items-center gap-3 rounded-panel border border-dashed border-line-strong px-4 py-3.5">
            <LiveDot live={stage === 'pending' || stage === 'paid'} tone="money" />
            <p className="text-label text-faint">{IDLE_CAPTION[stage]}</p>
          </div>
        )}

        {showAlert && (
          <>
            <AlertCard
              headline={
                <>
                  {current.name} โดเนท{' '}
                  <span className="font-numeric tabular-nums">{current.amount}</span>
                </>
              }
              message={current.message}
              className={
                stage === 'alerted'
                  ? 'animate-alert-in'
                  : stage === 'leaving'
                    ? 'animate-alert-out'
                    : ''
              }
            />

            {/*
              The design's second, dimmer row reading "กำลังจะเด้ง". Not
              decoration and not invented — the overlay really does hold a queue
              and play one alert at a time (AlertQueue, DESIGN.md 8.2), so this
              is the only place on the page that shows the product's actual
              behaviour under two donations at once.
            */}
            <div className="mt-2.5 flex items-center gap-3 rounded-control border border-line bg-surface-2/85 px-4 py-2.5">
              <span
                aria-hidden
                className="grid size-9 shrink-0 place-items-center rounded-chip bg-white/6 text-label"
              >
                ⭐
              </span>
              <p className="truncate text-meta text-muted">
                {next.name} โดเนท{' '}
                <span className="font-numeric font-semibold tabular-nums text-money">
                  {next.amount}
                </span>{' '}
                · กำลังจะเด้ง
              </p>
            </div>
          </>
        )}
      </div>

      {/* GOAL TODAY's slot, doing a real job. Label left, control right, exactly
          the row the design puts here. */}
      <div className="relative mt-auto pt-5">
        <div className="flex items-center justify-between gap-3 pb-2">
          <TechLabel>pipeline</TechLabel>
          {/*
            A pause, not a replay. This loops indefinitely at 7.5s, and WCAG
            2.2.2 asks for a way to stop anything that moves automatically for
            more than five seconds — a button that RESTARTS the loop is the one
            thing that does not satisfy it. Pausing holds the current frame
            rather than clearing it, so stopping mid-alert leaves the alert on
            screen to be read at leisure, which is the actual reason someone
            reaches for this.

            Only offered once JS is driving: without it the panel is already at
            its finished state and nothing is moving.
          */}
          {enhanced && (
            <button
              type="button"
              onClick={() => (paused ? resume() : pause())}
              aria-pressed={paused}
              className="label-tech rounded-chip border border-line-strong px-2.5 py-1 text-muted transition-colors hover:border-accent-text hover:text-ink"
            >
              {paused ? '▶ เล่นต่อ' : '❙❙ หยุด'}
            </button>
          )}
        </div>
        <StatusTrack steps={TRACK} currentIndex={TRACK_INDEX[stage]} />
      </div>

      <p className="relative mt-4 text-micro leading-relaxed text-faint">
        ภาพจำลอง — ชื่อ ยอดเงิน และข้อความเป็นข้อมูลสมมติ ทุกโดเนทเดินผ่านสามสถานะนี้: สร้าง QR
        แล้วรอชำระ, webhook ยืนยันว่าจ่ายจริง, แล้วจึงยิงขึ้นจอ
      </p>
    </div>
  )
}
