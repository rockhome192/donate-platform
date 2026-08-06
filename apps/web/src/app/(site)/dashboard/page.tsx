import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { formatBaht } from '@dp/shared'
import { Panel, PanelHeader, StatBlock, TechLabel, buttonClass } from '@/components/ui'
import { authOptions } from '@/lib/auth'
import {
  DASHBOARD_DAYS,
  bangkokDayStart,
  buildDaySeries,
  fetchDailyTotals,
} from '@/lib/dashboard-stats'
import { db } from '@/lib/db'
import { DailyTotals } from './DailyTotals'

/**
 * Streamer console. This is the surface the instrumentation direction is really
 * for: the person reading it is running a stream and wants state at a glance.
 *
 * Every number here is a query result. Totals count PAID only — a PENDING row
 * is somebody who opened a QR and walked away, and adding it to "รายได้" would
 * be inventing money.
 */

export const metadata: Metadata = { title: 'Dashboard — DONATR (demo)' }
export const dynamic = 'force-dynamic'

const PAGE_SIZE = 20

/**
 * Offset pagination, not a cursor.
 *
 * A cursor would survive rows being inserted while the streamer reads page 2 —
 * with `skip` a donation arriving mid-read shifts everything down by one and
 * can show the same row twice. That is the right trade here anyway: the list is
 * ordered newest-first, so drift only ever affects the boundary of a page the
 * reader is walking backwards through, and `?page=3` is a link they can share,
 * bookmark and go back to. A cursor buys correctness this screen does not need
 * and costs a URL that means nothing on its own.
 */
function parsePage(raw: string | string[] | undefined): number {
  const n = Number(Array.isArray(raw) ? raw[0] : raw)
  return Number.isInteger(n) && n > 1 ? n : 1
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

export default async function DashboardPage({ searchParams }: Props) {
  const session = await getServerSession(authOptions)
  if (!session?.user) redirect('/login?callbackUrl=/dashboard')

  const streamerId = session.user.streamerId
  // An admin account has no Streamer row. Rather than crash on a null id, say
  // so — the admin views land in a later milestone.
  if (!streamerId) {
    return (
      <Panel className="px-5 py-6">
        <TechLabel>no streamer profile</TechLabel>
        <p className="mt-2 text-label text-muted">บัญชีนี้ยังไม่มีโปรไฟล์สตรีมเมอร์</p>
      </Panel>
    )
  }

  const page = parsePage((await searchParams).page)
  const now = new Date()
  const todayStart = bangkokDayStart(now)
  const windowStart = new Date(todayStart.getTime() - (DASHBOARD_DAYS - 1) * 86_400_000)

  const [
    streamer,
    donations,
    totalCount,
    paidTotal,
    paidCount,
    pendingCount,
    todayTotal,
    donorNames,
    dailyRows,
  ] = await Promise.all([
    db.streamer.findUnique({
      where: { id: streamerId },
      select: { slug: true, displayName: true, minAmount: true, maxAmount: true },
    }),
    db.donation.findMany({
      where: { streamerId },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        donorName: true,
        message: true,
        amount: true,
        status: true,
        createdAt: true,
      },
    }),
    db.donation.count({ where: { streamerId } }),
    db.donation.aggregate({
      where: { streamerId, status: 'PAID' },
      _sum: { amount: true },
    }),
    db.donation.count({ where: { streamerId, status: 'PAID' } }),
    db.donation.count({ where: { streamerId, status: 'PENDING' } }),
    db.donation.aggregate({
      where: { streamerId, status: 'PAID', paidAt: { gte: todayStart } },
      _sum: { amount: true },
    }),
    // There are no viewer accounts, so "how many people" is unanswerable and
    // this counts distinct NAMES instead. The label on the tile says exactly
    // that — two different people who both typed "มายด์" are one row here, and
    // calling it a supporter count would be inventing a number.
    db.donation.groupBy({
      by: ['donorName'],
      where: { streamerId, status: 'PAID' },
    }),
    // Bucketed by Bangkok calendar day, in raw SQL — see fetchDailyTotals for
    // why, and for the one expression in it that must not be simplified.
    fetchDailyTotals(db, streamerId, windowStart),
  ])

  if (!streamer) redirect('/login')

  const total = paidTotal._sum.amount ?? 0
  const today = todayTotal._sum.amount ?? 0
  const average = paidCount > 0 ? Math.round(total / paidCount) : 0
  const lastPage = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const firstIndex = (page - 1) * PAGE_SIZE

  // SUM() comes back as bigint; the chart works in plain numbers. Safe here —
  // a day's satang total cannot approach Number.MAX_SAFE_INTEGER.
  const days = buildDaySeries(
    dailyRows.map((r) => ({ day: r.day, total: Number(r.total) })),
    now,
  )

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <TechLabel>// overview</TechLabel>
          <h1 className="mt-1 font-display text-h1 font-bold">{streamer.displayName}</h1>
        </div>
        {/* The nav owns getting around now; what stays here is the one action
            a streamer takes FROM this screen — hand the link to a viewer. */}
        <Link href={`/${streamer.slug}`} className={buttonClass('secondary', 'sm')}>
          เปิดหน้าโดเนท /{streamer.slug}
        </Link>
      </header>

      <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatBlock
          label="ยอดวันนี้"
          value={`฿${formatBaht(today)}`}
          tone="money"
          note="ตามเวลาไทย"
        />
        <StatBlock
          label="ยอดรวมทั้งหมด"
          value={`฿${formatBaht(total)}`}
          tone="money"
          note={`${paidCount} รายการ`}
        />
        <StatBlock
          label="ชื่อผู้โดเนทไม่ซ้ำ"
          value={String(donorNames.length)}
          note="นับจากชื่อที่กรอก ไม่ใช่บัญชีผู้ใช้"
        />
        <StatBlock
          label="เฉลี่ยต่อครั้ง"
          value={paidCount > 0 ? `฿${formatBaht(average)}` : '—'}
          note={paidCount === 0 ? 'ยังไม่มีรายการที่จ่ายแล้ว' : undefined}
        />
      </section>

      <section className="mt-5">
        <DailyTotals days={days} />
      </section>

      {pendingCount > 0 && (
        <p className="mt-3 flex items-center gap-2 text-meta text-faint">
          <span aria-hidden className="inline-block size-1.5 rounded-full bg-pending" />
          มีอีก{' '}
          <span className="font-numeric tabular-nums text-pending">{pendingCount}</span> รายการที่ยังไม่ชำระ
          — ไม่ถูกนับในยอดรวม
        </p>
      )}

      <Panel className="mt-8 overflow-hidden">
        <PanelHeader
          label="รายการล่าสุด"
          right={
            donations.length > 0 ? (
              <span className="font-mono text-micro tabular-nums text-faint">
                {firstIndex + 1}–{firstIndex + donations.length} / {totalCount}
              </span>
            ) : undefined
          }
        />

        {donations.length === 0 ? (
          // A page past the end is reachable by editing the URL or by rows
          // being deleted, and "ยังไม่มีโดเนท" would be a lie there — the
          // streamer has donations, just not on this page.
          page > 1 ? (
            <div className="px-5 py-10 text-center">
              <p className="text-label text-muted">ไม่มีรายการในหน้านี้</p>
              <Link href="/dashboard" className={buttonClass('secondary', 'sm', 'mt-5')}>
                กลับหน้าแรกของรายการ
              </Link>
            </div>
          ) : (
            <div className="px-5 py-10 text-center">
              <p className="text-label text-muted">ยังไม่มีโดเนท</p>
              <p className="mt-1.5 text-meta text-faint">
                เปิดหน้าโดเนทแล้วลองส่งดู รายการจะขึ้นที่นี่ทันที
              </p>
              <Link
                href={`/${streamer.slug}`}
                className={buttonClass('secondary', 'sm', 'mt-5')}
              >
                เปิดหน้าโดเนท
              </Link>
            </div>
          )
        ) : (
          <ul className="divide-y divide-line">
            {donations.map((d) => (
              <li key={d.id} className="flex items-start gap-4 px-4 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-ink">{d.donorName}</p>
                  {d.message && <p className="mt-0.5 truncate text-label text-muted">{d.message}</p>}
                  <p className="mt-1 font-mono text-micro tabular-nums text-faint">
                    {d.createdAt.toLocaleString('th-TH', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p
                    className={`font-numeric text-h3 font-bold tabular-nums ${
                      d.status === 'PAID' ? 'text-money' : 'text-faint'
                    }`}
                  >
                    ฿{formatBaht(d.amount)}
                  </p>
                  <StatusPill status={d.status} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {lastPage > 1 && (
        <nav className="mt-4 flex items-center justify-between gap-3" aria-label="หน้ารายการ">
          {page > 1 ? (
            <Link
              href={page === 2 ? '/dashboard' : `/dashboard?page=${page - 1}`}
              className={buttonClass('secondary', 'sm')}
            >
              ← ใหม่กว่า
            </Link>
          ) : (
            // A disabled span rather than a hidden element: the row keeps its
            // shape, so the "older" button does not jump sideways between pages.
            <span aria-hidden />
          )}

          <span className="font-mono text-micro tabular-nums text-faint">
            {page} / {lastPage}
          </span>

          {page < lastPage ? (
            <Link href={`/dashboard?page=${page + 1}`} className={buttonClass('secondary', 'sm')}>
              เก่ากว่า →
            </Link>
          ) : (
            <span aria-hidden />
          )}
        </nav>
      )}
    </>
  )
}

/**
 * The old map sent PENDING, EXPIRED and REFUNDED all to --color-faint, so three
 * different outcomes were indistinguishable. Each now has its own role, and the
 * word is always present — the colour is reinforcement, never the only signal.
 */
const STATUS_LABEL: Record<string, { text: string; className: string }> = {
  PAID: { text: 'จ่ายแล้ว', className: 'text-money' },
  PENDING: { text: 'รอชำระ', className: 'text-pending' },
  EXPIRED: { text: 'หมดอายุ', className: 'text-faint' },
  FAILED: { text: 'ไม่สำเร็จ', className: 'text-danger' },
  REFUNDED: { text: 'คืนเงิน', className: 'text-muted' },
}

function StatusPill({ status }: { status: string }) {
  const meta = STATUS_LABEL[status] ?? { text: status, className: 'text-faint' }
  return <p className={`mt-0.5 label-tech ${meta.className}`}>{meta.text}</p>
}
