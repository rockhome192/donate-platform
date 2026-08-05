import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { Panel, TechLabel } from '@/components/ui'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { AlertSettingForm } from './AlertSettingForm'
import { OverlaySourcePanel } from './OverlaySourcePanel'

/**
 * /dashboard/settings — DESIGN.md 4.2.
 *
 * Server-rendered because both panels start from database state and there is
 * nothing to fetch on the client; the two children go interactive only for the
 * actions that write.
 *
 * force-dynamic and no caching are not optional here: the page renders the
 * overlay token, and a cached copy of this HTML is a cached copy of a
 * credential.
 */

export const metadata: Metadata = {
  title: 'ตั้งค่า overlay — DONATR (demo)',
  robots: { index: false, follow: false },
}
export const dynamic = 'force-dynamic'

/** Mirrors the Prisma defaults, for a streamer whose AlertSetting row does not exist yet. */
const DEFAULTS = { template: '{name} โดเนท {amount} บาท', durationMs: 6_000, minAlertAmount: 2_000 }

export default async function SettingsPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user) redirect('/login?callbackUrl=/dashboard/settings')

  const streamerId = session.user.streamerId
  if (!streamerId) {
    return (
      <main className="mx-auto max-w-2xl px-5 py-16">
        <Panel className="px-5 py-6">
          <TechLabel>no streamer profile</TechLabel>
          <p className="mt-2 text-label text-muted">บัญชีนี้ยังไม่มีโปรไฟล์สตรีมเมอร์</p>
        </Panel>
      </main>
    )
  }

  const streamer = await db.streamer.findUnique({
    where: { id: streamerId },
    select: {
      displayName: true,
      overlayToken: true,
      alertSetting: { select: { template: true, durationMs: true, minAlertAmount: true } },
    },
  })
  if (!streamer) redirect('/login')

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <TechLabel>settings</TechLabel>
          <h1 className="mt-1 font-display text-h1 font-bold">ตั้งค่า overlay</h1>
          <p className="mt-1 text-label text-muted">{streamer.displayName}</p>
        </div>
        <Link href="/dashboard" className="text-label text-muted underline underline-offset-4 hover:text-ink">
          ← กลับหน้า dashboard
        </Link>
      </header>

      <div className="mt-6 space-y-5">
        <OverlaySourcePanel initialToken={streamer.overlayToken} />
        <AlertSettingForm initial={streamer.alertSetting ?? DEFAULTS} />
      </div>
    </div>
  )
}
