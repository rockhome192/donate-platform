import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { formatBaht } from '@dp/shared'
import { db } from '@/lib/db'
import { env } from '@/lib/env'
import { DonateForm } from './DonateForm'

/**
 * Public donation page — /{slug}. No login: a viewer who has to sign up to say
 * thanks does not say thanks.
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
    <main className="mx-auto w-full max-w-xl px-5 py-10">
      <header className="animate-fade-up text-center">
        <div className="mx-auto grid size-20 place-items-center overflow-hidden rounded-2xl border border-line2 bg-panel2 font-display text-2xl font-bold text-muted">
          {streamer.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- avatars are arbitrary R2 URLs; next/image would need a remote allowlist per host
            <img src={streamer.avatarUrl} alt="" className="size-full object-cover" />
          ) : (
            streamer.displayName.slice(0, 1)
          )}
        </div>

        <h1 className="mt-4 font-display text-2xl font-bold">{streamer.displayName}</h1>
        <p className="mt-1 font-mono text-xs tracking-widest text-faint">@{streamer.slug}</p>
        {streamer.bio && (
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted">{streamer.bio}</p>
        )}
      </header>

      {closed ? (
        <p
          role="status"
          className="mt-8 rounded-xl border border-line2 bg-panel p-5 text-center text-sm text-muted"
        >
          {streamer.isSuspended
            ? 'บัญชีนี้ถูกระงับชั่วคราว ยังรับโดเนทไม่ได้'
            : `${streamer.displayName} ปิดรับโดเนทอยู่ในขณะนี้`}
        </p>
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

      <footer className="mt-10 space-y-3 text-center">
        <p className="text-xs leading-relaxed text-faint">
          ยอดขั้นต่ำ {formatBaht(streamer.minAmount)} บาท · สูงสุด {formatBaht(streamer.maxAmount)}{' '}
          บาทต่อครั้ง
        </p>
        <p className="text-xs text-faint">
          ข้อความที่ส่งจะแสดงบนหน้าจอสตรีม — โปรดใช้ถ้อยคำสุภาพ
        </p>
        <Link href="/" className="inline-block font-mono text-[11px] tracking-widest text-faint hover:text-accent">
          DONATR
        </Link>
      </footer>
    </main>
  )
}
