import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { env } from '@/lib/env'
import { OverlayClient } from './OverlayClient'

/**
 * GET /overlay/{overlayToken} — the page a streamer pastes into an OBS Browser
 * Source. DESIGN.md 8.3.
 *
 * This is the "long-lived token" half of the two-token scheme. It buys exactly
 * one thing: the right to load this page and ask for a 60-second ticket. It
 * grants no session, reads no other streamer's data, and can be rotated from
 * the dashboard the moment it appears on stream by accident.
 *
 * Rendered dynamically, never cached. A cached overlay page would serve a
 * rotated token's HTML to whoever asked next.
 */

type Params = { params: Promise<{ token: string }> }

export const dynamic = 'force-dynamic'

/**
 * noindex is not politeness. This URL is a credential, and a search engine that
 * finds one has published a stranger's overlay to everybody.
 */
export const metadata: Metadata = {
  title: 'DONATR overlay',
  robots: { index: false, follow: false, nocache: true },
}

export default async function OverlayPage({ params }: Params) {
  const { token } = await params

  const streamer = await db.streamer.findUnique({
    where: { overlayToken: token },
    select: {
      id: true,
      isSuspended: true,
      alertSetting: { select: { template: true, durationMs: true } },
    },
  })

  // Covers both "never existed" and "was rotated" — after a rotate the old
  // token matches no row, which is the same thing from here.
  if (!streamer) notFound()

  // A suspended streamer gets a page that says so and never opens a socket.
  // The socket would be closed 4002 anyway; refusing here saves the round trip
  // and, more importantly, is the only way the streamer ever sees WHY.
  //
  // isActive is NOT checked. That switch is the streamer's own "my page is
  // closed right now", it can flip back at any moment, and an overlay that
  // refused to run because of it would stay dead until OBS was restarted.
  return (
    <OverlayClient
      token={token}
      suspended={streamer.isSuspended}
      wsUrl={env.realtimeWsUrl}
      template={streamer.alertSetting?.template ?? '{name} โดเนท {amount} บาท'}
      durationMs={streamer.alertSetting?.durationMs ?? 6000}
    />
  )
}
