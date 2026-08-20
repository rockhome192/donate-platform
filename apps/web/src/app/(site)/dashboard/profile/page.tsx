import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { Panel, TechLabel } from '@/components/ui'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { isObjectStorageConfigured } from '@/lib/storage'
import { ProfileForm } from './ProfileForm'

/**
 * /dashboard/profile — the only screen where the streamer's public identity can
 * be changed.
 *
 * Until this existed, displayName, slug, bio, avatar and the donation bounds
 * were seed-only: a real account created through /register was stuck with
 * whatever it typed at signup forever, and the bounds could not be moved at all.
 *
 * The session check is here as well as in the layout, deliberately — a layout in
 * Next.js is not a security boundary, it does not re-run on client-side
 * navigation between sibling routes.
 */

export const metadata: Metadata = {
  title: 'โปรไฟล์ — DONATR (demo)',
  robots: { index: false, follow: false },
}
export const dynamic = 'force-dynamic'

export default async function ProfilePage() {
  const session = await getServerSession(authOptions)
  if (!session?.user) redirect('/login?callbackUrl=/dashboard/profile')

  const streamerId = session.user.streamerId
  if (!streamerId) {
    return (
      <Panel className="px-5 py-6">
        <TechLabel>no streamer profile</TechLabel>
        <p className="mt-2 text-label text-muted">
          บัญชีนี้ไม่มีโปรไฟล์สตรีมเมอร์ — บัญชีผู้ดูแลระบบไม่มีหน้าโดเนทของตัวเอง
        </p>
      </Panel>
    )
  }

  const streamer = await db.streamer.findUnique({
    where: { id: streamerId },
    select: {
      slug: true,
      displayName: true,
      bio: true,
      avatarUrl: true,
      minAmount: true,
      bankCode: true,
      bankAccountLast4: true,
      bankAccountName: true,
      maxAmount: true,
    },
  })
  if (!streamer) redirect('/dashboard')

  return (
    <>
      <header>
        <TechLabel>// profile</TechLabel>
        <h1 className="mt-1 font-display text-h1 font-bold">แก้ไขโปรไฟล์</h1>
        <p className="mt-1 text-label text-muted">ข้อมูลนี้จะแสดงบนหน้าโดเนทสาธารณะของคุณ</p>
      </header>

      <div className="mt-6">
        <ProfileForm initial={streamer} uploadsEnabled={isObjectStorageConfigured()} />
      </div>
    </>
  )
}
