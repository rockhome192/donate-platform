import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { formatBaht } from '@dp/shared'
import { AmbientBackdrop, Panel, TechLabel, Wordmark } from '@/components/ui'
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
 *
 * The v2 design gives it a profile card with a gradient banner, and that card
 * is here — it answers "am I on the right person's page" in one glance, which
 * the old flat header did not. Three of its parts did not survive:
 *
 * - **FOLLOWERS / SUPPORTERS tiles.** There is no follower concept in the
 *   schema and no viewer accounts to count. Same rejection as the dashboard's.
 * - **A verified ✓ badge.** Nothing verifies anyone. A checkmark on a page that
 *   takes money is not decoration — it is a claim, and it would be false.
 * - **Amber corner brackets and an amber drop shadow.** Amber means money in
 *   this system and nothing else; spending it on framing is how a load-bearing
 *   colour stops being load-bearing.
 *
 * What replaced the tiles is queried: the most recent people who actually did
 * this. Those donations were already read aloud on stream by the alert, so the
 * page reveals nothing the streamer had not already published — and it answers
 * the question the invented follower count was reaching for, which is whether
 * anyone else is here.
 */

type Params = { params: Promise<{ slug: string }> }

const RECENT_LIMIT = 3

async function loadStreamer(slug: string) {
  return db.streamer.findUnique({
    where: { slug },
    select: {
      id: true,
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

  const recent = await db.donation.findMany({
    where: { streamerId: streamer.id, status: 'PAID' },
    orderBy: { paidAt: 'desc' },
    take: RECENT_LIMIT,
    // No message and no id: this is a public page, and the smallest set that
    // answers "is anyone else here" is the right one to hand an anonymous
    // visitor. The message is on the streamer's screen, not on this one.
    select: { donorName: true, amount: true, paidAt: true },
  })

  return (
    <>
      <AmbientBackdrop />
      <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col px-5 py-7">
        <Link href="/" className="inline-flex w-fit items-center py-1">
          <Wordmark size="sm" />
        </Link>

        <article className="mt-4 animate-fade-up overflow-hidden rounded-panel border border-line bg-surface">
          {/* The banner. Its one job is to put the avatar against something
              other than the same grey as the card, so the profile reads as a
              profile rather than as the form's first field. */}
          {/* No dot-grid over this. That utility sets background-SIZE as well as
              background-image, and stacking it on an arbitrary gradient leaves
              the size behind after the gradient wins the image — which tiles the
              whole 120deg ramp every 24px and renders as quilting. */}
          <div className="relative h-24 bg-[linear-gradient(120deg,var(--color-accent),#a01d38_70%,#4a1220)]">
            <span
              className={`absolute top-3 right-3 flex items-center gap-1.5 rounded-chip px-2.5 py-1 label-tech ${
                closed ? 'bg-black/35 text-white/80' : 'bg-black/35 text-white'
              }`}
            >
              {/* Not "LIVE". Nothing here knows whether a stream is running —
                  this reports isActive, which is the switch the streamer owns
                  and the only thing the page can honestly say. */}
              <span
                aria-hidden
                className={`inline-block size-1.5 rounded-full ${
                  closed ? 'bg-white/50' : 'bg-live animate-livedot'
                }`}
              />
              {closed ? 'ปิดรับ' : 'เปิดรับโดเนท'}
            </span>
          </div>

          {/* `relative` is load-bearing: the banner above is positioned, and a
              positioned sibling paints over in-flow content no matter what the
              tree order says. Without this the avatar and the streamer's name
              sit UNDER the gradient, cut in half by it. */}
          <div className="relative px-5 pb-5 sm:px-6">
            {/* The pull is on the AVATAR, not on the row. Lifting the whole row
                took the name up with it, so a display-weight heading straddled
                the gradient's bottom edge — half on red, half on panel. Only the
                avatar is meant to break the banner line. */}
            <div className="flex items-end gap-3.5">
              <div className="-mt-9 grid size-18 shrink-0 place-items-center overflow-hidden rounded-panel border-3 border-surface bg-surface-2 font-display text-h1 font-bold text-muted">
                {streamer.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- avatars are arbitrary R2 URLs; next/image would need a remote allowlist per host
                  <img src={streamer.avatarUrl} alt="" className="size-full object-cover" />
                ) : (
                  streamer.displayName.slice(0, 1)
                )}
              </div>
              <div className="min-w-0 pt-2.5 pb-0.5">
                <h1 className="truncate font-display text-h2 font-bold">{streamer.displayName}</h1>
                <p className="truncate font-mono text-meta text-faint">/{streamer.slug}</p>
              </div>
            </div>

            {streamer.bio && (
              <p className="mt-3.5 text-label leading-relaxed text-muted">{streamer.bio}</p>
            )}

            {recent.length > 0 && (
              <div className="mt-4 border-t border-line pt-3.5">
                <TechLabel>recent</TechLabel>
                <ul className="mt-2 space-y-1.5">
                  {recent.map((d) => (
                    <li
                      key={`${d.donorName}-${d.paidAt?.getTime() ?? 0}`}
                      className="flex items-baseline justify-between gap-3 text-label"
                    >
                      <span className="truncate text-muted">{d.donorName}</span>
                      {/* Same trailing-satang trim the dashboard chart uses:
                          th-TH separates thousands with a comma, so the only
                          dot in the string is the decimal one. */}
                      <span className="shrink-0 font-numeric font-semibold tabular-nums text-money">
                        ฿{formatBaht(d.amount).replace('.00', '')}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </article>

        <main className="flex-1">
          {closed ? (
            <Panel className="mt-5 px-5 py-6 text-center">
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
        <footer className="mt-10 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line pt-5 text-meta text-faint">
          <p>ข้อความที่ส่งจะแสดงบนหน้าจอสตรีม — โปรดใช้ถ้อยคำสุภาพ</p>
          <TechLabel>demo · ไม่รับเงินจริง</TechLabel>
        </footer>
      </div>
    </>
  )
}
