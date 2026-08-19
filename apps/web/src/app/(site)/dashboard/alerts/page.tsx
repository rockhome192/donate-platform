import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { Panel, TechLabel } from '@/components/ui'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { isTtsConfigured } from '@/lib/tts'
import { AlertSettingForm } from './AlertSettingForm'

/**
 * /dashboard/alerts — how an alert looks and when it fires.
 *
 * Split from the old combined settings page because the two halves answer
 * different questions on different days: this one is tuned once and revisited
 * when the template feels stale, while the overlay page is opened in a hurry,
 * usually because a URL leaked mid-stream. Sharing a screen made the urgent
 * half sit under a form.
 */

export const metadata: Metadata = {
  title: 'ตั้งค่า Alert — DONATR (demo)',
  robots: { index: false, follow: false },
}
export const dynamic = 'force-dynamic'

/** Mirrors the Prisma defaults, for a streamer whose AlertSetting row does not exist yet. */
const DEFAULTS = {
  template: '{name} โดเนท {amount} บาท',
  durationMs: 6_000,
  minAlertAmount: 2_000,
  soundUrl: null,
  soundVolume: 70,
  ttsEnabled: false,
}

export default async function AlertsPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user) redirect('/login?callbackUrl=/dashboard/alerts')

  const streamerId = session.user.streamerId
  if (!streamerId) {
    return (
      <Panel className="px-5 py-6">
        <TechLabel>no streamer profile</TechLabel>
        <p className="mt-2 text-label text-muted">บัญชีนี้ยังไม่มีโปรไฟล์สตรีมเมอร์</p>
      </Panel>
    )
  }

  const setting = await db.alertSetting.findUnique({
    where: { streamerId },
    select: {
      template: true,
      durationMs: true,
      minAlertAmount: true,
      soundUrl: true,
      soundVolume: true,
      ttsEnabled: true,
    },
  })

  return (
    <>
      <header>
        <TechLabel>// alerts</TechLabel>
        <h1 className="mt-1 font-display text-h1 font-bold">ตั้งค่า Alert</h1>
        <p className="mt-1 text-label text-muted">
          ข้อความและเวลาที่ alert จะขึ้นบนจอสตรีม — ค่าที่บันทึกจะส่งถึง overlay ที่เปิดอยู่ทันที
        </p>
      </header>

      <div className="mt-6">
        {/*
          Whether the deployment can speak at all is a server fact — it needs an
          Azure key and a bucket — so it is decided here rather than guessed in
          the browser. With neither, the switch renders disabled and says why,
          which is the honest version of a control that would otherwise save
          happily and never make a sound.
        */}
        <AlertSettingForm initial={setting ?? DEFAULTS} ttsAvailable={isTtsConfigured()} />
      </div>
    </>
  )
}
