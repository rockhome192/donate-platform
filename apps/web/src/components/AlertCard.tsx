import type { ReactNode } from 'react'

/**
 * The alert itself — the one thing this product actually makes.
 *
 * It is rendered in two places that must never drift apart: the landing page's
 * sample stage, and the real OBS overlay. They had two separate copies of the
 * markup before, so the thing a visitor was shown on the landing page was not
 * the thing that would appear on their stream. Now there is one.
 *
 * Amber, always. This is a confirmed amount arriving, which is the money role
 * at its most literal — the v2 design file agrees, and it is the one colour
 * decision in this system that has never moved.
 */

type Props = {
  /** Already rendered from the streamer's template, or composed for a sample. */
  headline: ReactNode
  message?: string
  /**
   * `stage` is the landing page's letterboxed panel; `overlay` is a 1920x1080
   * browser source seen from across a room, so everything steps up a size.
   */
  size?: 'stage' | 'overlay'
  className?: string
}

export function AlertCard({ headline, message, size = 'stage', className = '' }: Props) {
  const overlay = size === 'overlay'

  return (
    <div
      className={`flex items-center rounded-panel bg-gradient-to-br from-money-soft to-money text-money-ink ${
        overlay
          ? 'gap-4 px-6 py-5 shadow-[0_24px_60px_-20px_rgba(255,176,32,0.55)]'
          : 'gap-3.5 px-4 py-3.5 shadow-lg shadow-black/40'
      } ${className}`}
    >
      {/*
        A tinted well rather than a bare emoji. The emoji alone floated against
        the gradient at every size, and on the overlay it has to survive being
        composited over arbitrary game footage.
      */}
      <span
        aria-hidden
        className={`grid shrink-0 place-items-center rounded-control bg-black/12 ${
          overlay ? 'size-16 text-display' : 'size-11 text-h2'
        }`}
      >
        🎉
      </span>
      <div className="min-w-0">
        <p className={`truncate font-display font-bold ${overlay ? 'text-h2' : 'text-h3'}`}>
          {headline}
        </p>
        {message && (
          // Rendered as a text node, never dangerouslySetInnerHTML: on the
          // overlay this is attacker-controlled text running on the streamer's
          // own machine, in a source that is on the broadcast.
          <p className={`truncate opacity-80 ${overlay ? 'mt-1 text-body' : 'text-label'}`}>
            {message}
          </p>
        )}
      </div>
    </div>
  )
}
