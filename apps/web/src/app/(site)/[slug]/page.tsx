import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { formatBaht } from '@dp/shared'
import { AmbientBackdrop, TechLabel, Wordmark } from '@/components/ui'
import { bangkokMonthStart } from '@/lib/dashboard-stats'
import { db } from '@/lib/db'
import { env } from '@/lib/env'
import { DonateForm } from './DonateForm'

/**
 * Public donation page — /{slug}. No login: a viewer who has to sign up to say
 * thanks does not say thanks.
 *
 * Rebuilt to the v2 design file's composition. The whole thing is ONE card now
 * — gradient banner, avatar breaking its bottom edge, bio, a three-tile stat
 * row, and then the form (or the QR, or the receipt) inside the same body. The
 * previous build had the profile in a card and the form in two separate panels
 * below it, which read as a profile page that happened to have a form under it
 * rather than as one transaction.
 *
 * Three things in the design did not survive, all for the reason that has held
 * across this redesign — this page may not claim something that is not true:
 *
 * - **The verified ✓ badge.** Nothing verifies anyone. A checkmark on a page
 *   that takes money is not decoration, it is a claim, and it would be false.
 * - **The FOLLOWERS tile.** There is no follower concept in the schema and no
 *   viewer accounts to count. The other two tiles are real queries, so the third
 *   is a real one too: all-time paid donations.
 * - **Amber brackets and an amber drop shadow.** Amber means money in this
 *   system and nothing else; spending it on framing is how a load-bearing colour
 *   stops being load-bearing. The shapes stay, in white and accent.
 */

type Params = { params: Promise<{ slug: string }> }

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
      promptPayId: true,
      bankCode: true,
      bankAccountLast4: true,
      bankAccountName: true,
      maxAmount: true,
    },
  })
}

/**
 * The three tiles. Every number is queried — the design's invented ones are
 * what the FOLLOWERS note above is about.
 *
 * DONORS counts distinct donor NAMES, not people: donorName is free text on a
 * page with no accounts, so two viewers who both type "มายด์" are one row here.
 * That is the honest reading of the number and why the tile is labelled DONORS
 * rather than SUPPORTERS.
 */
async function loadStats(streamerId: string) {
  const paid = { streamerId, status: 'PAID' } as const

  const [month, total, donors] = await Promise.all([
    db.donation.aggregate({
      where: { ...paid, paidAt: { gte: bangkokMonthStart(new Date()) } },
      _sum: { amount: true },
    }),
    db.donation.count({ where: paid }),
    // COUNT(DISTINCT) in SQL, not `groupBy(...).length`. groupBy sends one row
    // per distinct name across the wire to produce a single integer, and this is
    // an uncached page that every anonymous viewer hits — it would be the
    // largest result set on the site, fetched to be thrown away.
    db.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(DISTINCT "donorName")::bigint AS count
        FROM "Donation"
       WHERE "streamerId" = ${streamerId}
         AND status = 'PAID'
    `,
  ])

  return {
    monthSatang: month._sum.amount ?? 0,
    totalCount: total,
    donorCount: Number(donors[0]?.count ?? 0),
  }
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
  const stats = await loadStats(streamer.id)

  return (
    <>
      <AmbientBackdrop />
      <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-5 py-5">
        <Link href="/" className="inline-flex w-fit items-center py-1">
          <Wordmark size="sm" />
        </Link>

        <main className="flex-1">
          <article className="mt-4 animate-fade-up overflow-hidden rounded-panel border border-line bg-surface shadow-[8px_8px_0_rgba(255,59,78,0.10)]">
            {/* The banner. Its one job is to put the avatar against something
                other than the same grey as the card, so the profile reads as a
                profile rather than as the form's first field. */}
            {/* No dot-grid utility over this. That utility sets background-SIZE
                as well as background-image, and stacking it on an arbitrary
                gradient leaves the size behind after the gradient wins the
                image — which tiles the whole 120deg ramp every 24px and renders
                as quilting. The pattern below is written as one shorthand
                instead, so both layers keep their own size. */}
            <div className="relative h-28 bg-[radial-gradient(rgba(255,255,255,0.14)_1px,transparent_1px),linear-gradient(120deg,var(--color-accent),#a01d38_70%,#4a1220)] bg-[length:16px_16px,auto]">
              {/* The design's two top brackets, in white rather than amber. */}
              <span
                aria-hidden
                className="absolute top-3 left-3 size-4.5 rounded-tl-[4px] border-t-2 border-l-2 border-white/70"
              />
              <span
                aria-hidden
                className="absolute top-3 right-3 size-4.5 rounded-tr-[4px] border-t-2 border-r-2 border-white/70"
              />
              <span
                className={`absolute top-11 right-3 flex items-center gap-1.5 rounded-chip bg-black/40 px-2.5 py-1 label-tech ${
                  closed ? 'text-white/80' : 'text-white'
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
            <div className="relative px-5 pb-6 sm:px-6">
              {/* The pull is on the AVATAR, not on the row. Lifting the whole
                  row took the name up with it, so a display-weight heading
                  straddled the gradient's bottom edge — half on red, half on
                  panel. Only the avatar is meant to break the banner line. */}
              <div className="flex items-end gap-3.5">
                <div className="-mt-9 grid size-19 shrink-0 place-items-center overflow-hidden rounded-panel border-3 border-surface bg-surface-2 font-display text-h1 font-bold text-muted">
                  {streamer.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- avatars are arbitrary R2 URLs; next/image would need a remote allowlist per host
                    <img src={streamer.avatarUrl} alt="" className="size-full object-cover" />
                  ) : (
                    streamer.displayName.slice(0, 1)
                  )}
                </div>
                <div className="min-w-0 pt-2.5 pb-1">
                  <h1 className="truncate font-display text-h2 font-bold">
                    {streamer.displayName}
                  </h1>
                  <p className="truncate font-mono text-meta text-faint">/{streamer.slug}</p>
                </div>
              </div>

              {streamer.bio && (
                <p className="mt-3.5 text-label leading-relaxed text-muted">{streamer.bio}</p>
              )}

              <dl className="mt-4 grid grid-cols-3 gap-2">
                <StatTile
                  label="this month"
                  value={`฿${formatBaht(stats.monthSatang).replace('.00', '')}`}
                  tone="money"
                />
                <StatTile label="donations" value={String(stats.totalCount)} />
                <StatTile label="donors" value={String(stats.donorCount)} />
              </dl>

              <div className="mt-5 border-t border-line pt-5">
                {closed ? (
                  <div className="py-4 text-center">
                    <TechLabel>ปิดรับชั่วคราว</TechLabel>
                    <p role="status" className="mt-2 text-label text-muted">
                      {streamer.isSuspended
                        ? 'บัญชีนี้ถูกระงับชั่วคราว ยังรับโดเนทไม่ได้'
                        : `${streamer.displayName} ปิดรับโดเนทอยู่ในขณะนี้`}
                    </p>
                  </div>
                ) : (
                  <DonateForm
                    slug={streamer.slug}
                    displayName={streamer.displayName}
                    minAmount={streamer.minAmount}
                    maxAmount={streamer.maxAmount}
                    // Read on the server so the button cannot appear on a deploy
                    // where the endpoint behind it 404s.
                    demoMode={env.isDemoMode}
                    /*
                      All three or nothing — the route enforces the same rule on
                      save. Passing a partial account would offer the slip
                      option on the page and have layer 3 refuse every slip it
                      produced, which costs a viewer real money to discover.
                    */
                    slipAccount={
                      streamer.bankCode &&
                      streamer.bankAccountLast4 &&
                      streamer.bankAccountName &&
                      streamer.promptPayId
                        ? {
                            bankCode: streamer.bankCode,
                            last4: streamer.bankAccountLast4,
                            name: streamer.bankAccountName,
                          }
                        : null
                    }
                  />
                )}
              </div>
            </div>
          </article>
        </main>

        <footer className="mt-8 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line pt-5 text-meta text-faint">
          <p>ข้อความที่ส่งจะแสดงบนหน้าจอสตรีม — โปรดใช้ถ้อยคำสุภาพ</p>
          <TechLabel>demo · ไม่รับเงินจริง</TechLabel>
        </footer>
      </div>
    </>
  )
}

function StatTile({
  label,
  value,
  tone = 'ink',
}: {
  label: string
  value: string
  tone?: 'ink' | 'money'
}) {
  return (
    // flex-col-reverse, not a reordered source: inside a dl the dt has to come
    // before its dd, and the design puts the value on top.
    <div className="flex flex-col-reverse rounded-control border border-line bg-surface-2 px-2 py-2.5 text-center">
      <dt className="mt-1 label-tech text-faint">{label}</dt>
      <dd
        className={`truncate font-numeric text-h3 font-bold tabular-nums ${
          tone === 'money' ? 'text-money' : 'text-ink'
        }`}
      >
        {value}
      </dd>
    </div>
  )
}
