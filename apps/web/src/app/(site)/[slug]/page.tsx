import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { formatBaht } from '@dp/shared'
import { Panel, TechLabel } from '@/components/ui'
import { db } from '@/lib/db'
import { env } from '@/lib/env'
import { DonateForm } from './DonateForm'

/**
 * Public donation page — /{slug}. No login: a viewer who has to sign up to say
 * thanks does not say thanks.
 *
 * This is the one surface in the console system that stays a transactional
 * form. The streamer's screens can wear instrumentation; a viewer with a phone
 * and thirty seconds gets sequence, stable controls and visible state instead.
 * The identity block is a compact bar rather than the old centred stack, so the
 * amount — the thing being decided — starts near the top of the viewport.
 */

type Params = { params: Promise<{ slug: string }> }

async function loadStreamer(slug: string) {
  return db.streamer.findUnique({
    where: { slug },
    select: {
      slug: true,
      displayName: true,
      bio: true,
      avatarUrl: true,
      isActive: true,
      isSuspended: true,
      minAmount: true,
      maxAmount: true,
    },
  })
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params
  const streamer = await loadStreamer(slug)
  if (!streamer) return { title: 'ไม่พบหน้านี้ — DONATR' }

  return {
    title: `ส่งโดเนทให้ ${streamer.displayName} — DONATR (demo)`,
    description: streamer.bio ?? `หน้าโดเนทของ ${streamer.displayName} — ระบบสาธิต ไม่รับเงินจริง`,
  }
}

export default async function DonatePage({ params }: Params) {
  const { slug } = await params
  const streamer = await loadStreamer(slug)
  if (!streamer) notFound()

  const closed = streamer.isSuspended || !streamer.isActive

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col px-5 py-8">
      <header className="flex animate-fade-up items-center gap-3.5">
        <div className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-panel border border-line-strong bg-surface-2 font-display text-h2 font-bold text-muted">
          {streamer.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- avatars are arbitrary R2 URLs; next/image would need a remote allowlist per host
            <img src={streamer.avatarUrl} alt="" className="size-full object-cover" />
          ) : (
            streamer.displayName.slice(0, 1)
          )}
        </div>
        <div className="min-w-0">
          <h1 className="truncate font-display text-h2 font-bold">{streamer.displayName}</h1>
          <p className="mt-0.5 font-mono text-meta text-faint">@{streamer.slug}</p>
        </div>
      </header>

      {streamer.bio && (
        <p className="mt-3 text-label leading-relaxed text-muted">{streamer.bio}</p>
      )}

      <main className="flex-1">
        {closed ? (
          <Panel className="mt-7 px-5 py-6 text-center">
            <TechLabel>ปิดรับชั่วคราว</TechLabel>
            <p role="status" className="mt-2 text-label text-muted">
              {streamer.isSuspended
                ? 'บัญชีนี้ถูกระงับชั่วคราว ยังรับโดเนทไม่ได้'
                : `${streamer.displayName} ปิดรับโดเนทอยู่ในขณะนี้`}
            </p>
          </Panel>
        ) : (
          <DonateForm
            slug={streamer.slug}
            displayName={streamer.displayName}
            minAmount={streamer.minAmount}
            maxAmount={streamer.maxAmount}
            // Read on the server so the button cannot appear on a deploy where
            // the endpoint behind it 404s.
            demoMode={env.isDemoMode}
          />
        )}
      </main>

      {/* The min/max line that used to live here now sits under the amount
          field in DonateForm, where the rule can be read before it is broken. */}
      <footer className="mt-10 space-y-2 border-t border-line pt-5 text-meta text-faint">
        <p>ข้อความที่ส่งจะแสดงบนหน้าจอสตรีม — โปรดใช้ถ้อยคำสุภาพ</p>
        {/* py-2 is not decoration: the label alone measured 50x22, under the
            24px minimum touch target. */}
        {/* accent-text, not accent: this label is 11px, and the fill red only
            reaches 4.16:1 on the canvas — under AA for text that size. The
            same split as everywhere else: fills fill, type types. */}
        <Link href="/" className="inline-flex items-center py-2">
          <TechLabel className="hover:text-accent-text">DONATR</TechLabel>
        </Link>
      </footer>
    </div>
  )
}
