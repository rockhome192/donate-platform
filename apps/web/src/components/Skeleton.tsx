import type { ReactNode } from 'react'

/**
 * Loading placeholders for the server-rendered screens.
 *
 * These are deliberately dumb: no state, no effects, no client boundary. They
 * render inside `loading.tsx`, which Next renders on the SERVER in place of a
 * page that has not finished, so anything needing `useState` could not be used
 * here at all. The 200ms delay before any of it becomes visible lives in CSS
 * for the same reason — see the skeleton block in globals.css.
 *
 * The rule for writing one: match the real screen's box model, not its
 * prettiness. A placeholder in the wrong place costs more than none, because
 * the content jumping into position afterwards is the exact thing a skeleton
 * exists to prevent.
 */

/** One placeholder block. Size it with the same utilities the real thing uses. */
export function Skeleton({ className = '' }: { className?: string }) {
  return <span aria-hidden className={`skeleton ${className}`} />
}

/**
 * Wraps a whole loading screen.
 *
 * `role="status"` with an off-screen label, because every block inside is
 * aria-hidden: without this a screen reader is handed a silent page and no
 * reason to think anything is happening. `aria-busy` says the same thing to
 * anything reading the tree programmatically.
 */
export function SkeletonScreen({
  children,
  label,
}: {
  children: ReactNode
  label: string
}) {
  return (
    <div role="status" aria-busy="true" className="skeleton-screen">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  )
}

/*
 * The sizes below are measured off the rendered pages, not guessed — a tech
 * label is 16px, an h1 38px, a StatBlock 120px, a panel header row 39px, a
 * donation row 74px. The first version of this file stacked plausible-looking
 * heights and came out ~47px short per stat tile, which pushed everything
 * under it up: the page then jumped DOWN when the data arrived, which is the
 * exact defect a skeleton is supposed to remove.
 *
 * Where a block's height comes from text, the container carries a min-height
 * taken from the real element. That survives font and line-height changes; a
 * hand-summed stack of child heights does not.
 */

/** The header every console screen opens with: a tech label over a title. */
export function SkeletonHeader({ titleWidth = 'w-56' }: { titleWidth?: string }) {
  return (
    <div className="min-h-16">
      <Skeleton className="h-4 w-24" />
      <Skeleton className={`mt-1 h-9 ${titleWidth}`} />
    </div>
  )
}

/** Mirrors StatBlock in components/ui.tsx — label, number, note. */
export function SkeletonStat() {
  return (
    <div className="min-h-30 rounded-panel border border-line bg-surface px-4 py-3.5">
      <Skeleton className="h-4 w-20" />
      <Skeleton className="mt-1.5 h-9 w-28" />
      <Skeleton className="mt-1 h-4 w-16" />
    </div>
  )
}

/**
 * Mirrors Panel + PanelHeader. The header row keeps its real border so the
 * panel still reads as a panel while empty, rather than as one grey slab.
 */
export function SkeletonPanel({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`overflow-hidden rounded-panel border border-line bg-surface ${className}`}>
      <div className="flex min-h-10 items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <Skeleton className="h-4 w-28" />
      </div>
      {children}
    </section>
  )
}

/** A stack of form rows: label above, control below. Controls are 48px tall. */
export function SkeletonField({ controlHeight = 'h-12' }: { controlHeight?: string }) {
  return (
    <div>
      <Skeleton className="h-4 w-28" />
      <Skeleton className={`mt-2 w-full rounded-control ${controlHeight}`} />
    </div>
  )
}

/** One row in a list panel — a donation, a streamer, a webhook event. */
export function SkeletonRow({ trailingWidth = 'w-20' }: { trailingWidth?: string }) {
  return (
    <li className="flex min-h-18 items-center justify-between gap-4 border-b border-line px-4 py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="mt-2 h-3 w-20" />
      </div>
      <Skeleton className={`h-5 ${trailingWidth}`} />
    </li>
  )
}
