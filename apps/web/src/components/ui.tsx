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
  // Violet is action, and it no longer shares a hue with an error message the
  // way the old red did. White on this fill measures 5.7:1.
  primary: 'bg-accent text-white hover:bg-accent-hover',
  // The hover border uses the lighter accent: the fill violet against
  // --color-surface-2 is only about 3:1, marginal for a non-text cue.
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
 * Error surface. Tinted fill + border + a written prefix, never hue alone —
 * --color-danger is deliberately close to --color-accent, so treatment is what
 * tells an error apart from a button.
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
