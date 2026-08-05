import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { Panel, TechLabel } from '@/components/ui'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { OverlaySourcePanel } from './OverlaySourcePanel'
import { ObsSteps } from './ObsSteps'

/**
 * /dashboard/overlay — the OBS browser source, its URL, and the two buttons
 * that matter when something has gone wrong on air.
 *
 * force-dynamic and no caching are not optional: this page renders the overlay
 * token, and a cached copy of this HTML is a cached copy of a credential.
 */

export const metadata: Metadata = {
  title: 'Overlay สำหรับ OBS — DONATR (demo)',
  robots: { index: false, follow: false },
}
export const dynamic = 'force-dynamic'

export default async function OverlaySetupPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user) redirect('/login?callbackUrl=/dashboard/overlay')

  const streamerId = session.user.streamerId
  if (!streamerId) {
    return (
      <Panel className="px-5 py-6">
        <TechLabel>no streamer profile</TechLabel>
        <p className="mt-2 text-label text-muted">บัญชีนี้ยังไม่มีโปรไฟล์สตรีมเมอร์</p>
      </Panel>
    )
  }

  const streamer = await db.streamer.findUnique({
    where: { id: streamerId },
    select: { overlayToken: true },
  })
  if (!streamer) redirect('/login')

  return (
    <>
      <header>
        <TechLabel>// overlay</TechLabel>
        <h1 className="mt-1 font-display text-h1 font-bold">Overlay สำหรับ OBS</h1>
        <p className="mt-1 text-label text-muted">
          URL นี้คือกุญแจของหน้า alert — ใครถือก็ดูโดเนทของคุณแบบเรียลไทม์ได้
        </p>
      </header>

      <div className="mt-6 space-y-5">
        <OverlaySourcePanel initialToken={streamer.overlayToken} />
        <ObsSteps />
      </div>
    </>
  )
}
