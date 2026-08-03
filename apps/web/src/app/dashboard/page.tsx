import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { formatBaht } from '@dp/shared'
import { Panel, PanelHeader, StatBlock, TechLabel, buttonClass } from '@/components/ui'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'

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

export default async function DashboardPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user) redirect('/login?callbackUrl=/dashboard')

  const streamerId = session.user.streamerId
  // An admin account has no Streamer row. Rather than crash on a null id, say
  // so — the admin views land in a later milestone.
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

  const [streamer, donations, paidTotal, paidCount, pendingCount] = await Promise.all([
    db.streamer.findUnique({
      where: { id: streamerId },
      select: { slug: true, displayName: true, minAmount: true, maxAmount: true },
    }),
    db.donation.findMany({
      where: { streamerId },
      orderBy: { createdAt: 'desc' },
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
    db.donation.aggregate({
      where: { streamerId, status: 'PAID' },
      _sum: { amount: true },
    }),
    db.donation.count({ where: { streamerId, status: 'PAID' } }),
    db.donation.count({ where: { streamerId, status: 'PENDING' } }),
  ])

  if (!streamer) redirect('/login')

  const total = paidTotal._sum.amount ?? 0
  const average = paidCount > 0 ? Math.round(total / paidCount) : 0

  return (
    <div className="mx-auto w-full max-w-4xl px-5 py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <TechLabel>dashboard</TechLabel>
          <h1 className="mt-1 font-display text-h1 font-bold">{streamer.displayName}</h1>
        </div>
        <Link href={`/${streamer.slug}`} className={buttonClass('secondary', 'sm')}>
          เปิดหน้าโดเนท /{streamer.slug}
        </Link>
      </header>

      <section className="mt-6 grid gap-3 sm:grid-cols-3">
        <StatBlock label="ยอดรวม (จำลอง)" value={`฿${formatBaht(total)}`} tone="money" />
        <StatBlock label="จำนวนครั้ง" value={String(paidCount)} />
        <StatBlock
          label="เฉลี่ยต่อครั้ง"
          value={paidCount > 0 ? `฿${formatBaht(average)}` : '—'}
          note={paidCount === 0 ? 'ยังไม่มีรายการที่จ่ายแล้ว' : undefined}
        />
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
                {donations.length}
              </span>
            ) : undefined
          }
        />

        {donations.length === 0 ? (
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

      {donations.length === PAGE_SIZE && (
        <p className="mt-3 text-center text-meta text-faint">
          แสดง {PAGE_SIZE} รายการล่าสุด — หน้าถัดไปมาใน M4
        </p>
      )}
    </div>
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
