import type { ReactNode } from 'react'

/**
 * Shared component grammar for the console system.
 *
 * Before this file every screen re-spelled its own button and card out of raw
 * utilities, which is why the same "secondary button" had three different
 * paddings and the dashboard's cards did not match the donate page's. Variants
 * here are named after the JOB (primary / secondary / quiet), never after the
 * treatment, so a visual change stays a one-line change.
 *
 * These are plain functions and server components on purpose — no 'use client'.
 * Nothing here holds state, and the pages that use them are mostly server
 * components; making them client components would drag the whole tree over.
 */

type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'money'
type ButtonSize = 'sm' | 'md' | 'lg'

const VARIANT: Record<ButtonVariant, string> = {
  // Red is action. White on this fill measures 4.72:1 — the v2 mockup's own
  // darker red, which is why it passes where the mockup's brighter fill did
  // not. What keeps it apart from an error is form, not hue: this is a solid
  // block, and an error is a bordered translucent panel (see ErrorNote).
  primary: 'bg-accent text-white hover:bg-accent-hover',
  // The hover border uses the lighter accent: the fill red against
  // --color-surface-2 is only 3.47:1, marginal for a non-text cue.
  secondary:
    'border border-line-strong bg-surface-2 text-ink hover:border-accent-text hover:text-ink',
  quiet: 'text-muted underline underline-offset-4 hover:text-ink',
  // Amber is money. The only button that gets it is one that commits an
  // amount, so "confirm ฿150" never wears the same colour as "delete".
  money: 'bg-money text-money-ink hover:bg-money-soft',
}

const SIZE: Record<ButtonSize, string> = {
  sm: 'px-3.5 py-2 text-label',
  md: 'px-5 py-2.5 text-label',
  lg: 'px-6 py-3.5 text-body',
}

/**
 * Returns the class string rather than wrapping an element: half these buttons
 * are `next/link` and half are `<button>`, and a component that has to forward
 * both prop sets earns nothing over a shared string.
 */
export function buttonClass(
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'md',
  extra = '',
): string {
  return [
    'inline-flex items-center justify-center gap-2 rounded-control font-semibold',
    'transition-colors disabled:cursor-not-allowed disabled:opacity-55',
    VARIANT[variant],
    SIZE[size],
    extra,
  ]
    .filter(Boolean)
    .join(' ')
}

/**
 * The wordmark, with the mark the v2 design gives it.
 *
 * Three screens spelled DONATR three different ways before this — plain display
 * type on the landing, a bare link on login, a mono TechLabel in the donate
 * footer — so the one element that should be identical everywhere was the only
 * one that never was.
 *
 * The mark is the design file's own: a signal arc rising off a dot. It says
 * broadcast, which is the product, and it survives at 26px where a glyph would
 * not. The arc uses --color-accent-text rather than the fill red: it is a 2.4px
 * stroke, and the fill red reaches only 4.16:1 on the canvas where the bright
 * one gets 5.53:1 — comfortably clear of the 3:1 a meaningful graphic needs.
 */
export function Wordmark({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const box = { sm: 'size-6.5', md: 'size-8', lg: 'size-9.5' }[size]
  const glyph = { sm: 15, md: 18, lg: 21 }[size]
  const text = { sm: 'text-label', md: 'text-h3', lg: 'text-h2' }[size]

  return (
    <span className="inline-flex items-center gap-2.5">
      <span
        className={`grid ${box} shrink-0 place-items-center rounded-chip border border-line-strong bg-surface-2`}
      >
        <svg width={glyph} height={glyph} viewBox="0 0 24 24" fill="none" aria-hidden>
          <circle cx="7" cy="17" r="2.6" fill="currentColor" />
          <path
            d="M7 10.6a6.4 6.4 0 0 1 6.4 6.4"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
          <path
            d="M7 5a12 12 0 0 1 12 12"
            className="stroke-accent-text"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
        </svg>
      </span>
      <span className={`font-display ${text} font-bold tracking-tight`}>DONATR</span>
    </span>
  )
}

/**
 * Dot grid plus a red bloom at the top edge, for the public screens. See the
 * `dot-grid` note in globals.css for why the console screens do not get this.
 *
 * Fixed, not absolute: the donate page grows past the viewport once the QR
 * arrives, and an absolutely-positioned bloom would scroll away and take the
 * page's whole top edge with it.
 */
export function AmbientBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
      <div className="dot-grid absolute inset-0" />
      <div className="absolute inset-x-0 top-0 h-[46vh] bg-[radial-gradient(60%_100%_at_50%_0%,rgba(255,59,78,0.13),transparent_70%)]" />
    </div>
  )
}

export function Panel({
  children,
  className = '',
  as: Tag = 'section',
}: {
  children: ReactNode
  className?: string
  as?: 'section' | 'div' | 'article'
}) {
  return (
    <Tag className={`rounded-panel border border-line bg-surface ${className}`}>{children}</Tag>
  )
}

/**
 * Panel header. The rule holding the whole console together: every panel
 * announces itself with a technical label on the left and, optionally, live
 * state on the right. Same anatomy on every surface.
 */
export function PanelHeader({ label, right }: { label: string; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
      <span className="label-tech text-faint">{label}</span>
      {right}
    </div>
  )
}

/** Latin-only technical label. See the `label-tech` note in globals.css. */
export function TechLabel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`label-tech text-faint ${className}`}>{children}</span>
}

/**
 * A dot that pulses only when something is actually live. `live={false}` keeps
 * the dot and drops the animation, because "not connected" is information the
 * viewer needs, not an element to hide.
 */
export function LiveDot({ live, tone = 'live' }: { live: boolean; tone?: 'live' | 'accent' | 'money' }) {
  const colour = { live: 'bg-live', accent: 'bg-accent', money: 'bg-money' }[tone]
  return (
    <span
      aria-hidden
      className={`inline-block size-1.5 shrink-0 rounded-full ${live ? `${colour} animate-livedot` : 'bg-faint'}`}
    />
  )
}

/**
 * The product motif: the path a donation takes, drawn as a track.
 *
 * This is the one piece of chrome the design earns — DESIGN.md 6.2 makes these
 * states the actual contract (alertedAt is the source of truth for "done"), so
 * showing the sequence is showing the product, not decorating it.
 */
export function StatusTrack({
  steps,
  currentIndex,
  failed = false,
}: {
  steps: readonly string[]
  /** -1 = nothing reached yet. */
  currentIndex: number
  failed?: boolean
}) {
  return (
    <ol className="flex items-center gap-1.5" aria-label="สถานะรายการ">
      {steps.map((step, i) => {
        const reached = i <= currentIndex
        const isCurrent = i === currentIndex
        const tone = failed && isCurrent ? 'bg-danger' : reached ? 'bg-money' : 'bg-line-strong'
        return (
          <li key={step} className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span
              className={`h-0.5 w-full rounded-full ${tone} ${reached ? 'animate-track' : ''}`}
            />
            {/* The label carries the state in words. Reduced motion and
                colour-blind users lose nothing by the bar alone. */}
            <span
              className={`label-tech truncate ${
                failed && isCurrent ? 'text-danger' : reached ? 'text-money' : 'text-faint'
              }`}
            >
              {step}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

/**
 * Error surface, and the load-bearing half of the decision to bring red back
 * as the action colour.
 *
 * --color-danger now shares a hue with --color-accent, so nothing about the
 * colour distinguishes this from a primary button — the SHAPE does. A button
 * is a saturated solid block with white type on it; this is a 12%-opacity
 * wash behind a 45%-opacity border, with a written "!" and the message in
 * plain ink. Keep that contrast intact: give this a solid fill and the two
 * roles collapse into each other again.
 */
export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="flex items-start gap-2.5 rounded-control border border-danger/45 bg-danger/12 px-4 py-3 text-label text-ink"
    >
      <span aria-hidden className="mt-px font-mono font-bold text-danger">
        !
      </span>
      <span className="min-w-0">{children}</span>
    </p>
  )
}

export function StatBlock({
  label,
  value,
  tone = 'ink',
  note,
}: {
  label: string
  value: string
  tone?: 'ink' | 'money' | 'pending'
  note?: string
}) {
  const colour = { ink: 'text-ink', money: 'text-money', pending: 'text-pending' }[tone]
  return (
    <div className="rounded-panel border border-line bg-surface px-4 py-3.5">
      <TechLabel>{label}</TechLabel>
      <p className={`mt-1.5 font-numeric text-h1 font-bold tabular-nums ${colour}`}>{value}</p>
      {note && <p className="mt-1 text-meta text-faint">{note}</p>}
    </div>
  )
}
