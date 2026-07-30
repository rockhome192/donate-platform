import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { formatBaht } from '@dp/shared'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'

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
      <main className="mx-auto max-w-2xl px-6 py-16">
        <p className="rounded-xl border border-line2 bg-panel p-6 text-sm text-muted">
          บัญชีนี้ยังไม่มีโปรไฟล์สตรีมเมอร์
        </p>
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
    // Totals count PAID only. A PENDING row is somebody who opened a QR and
    // walked away; adding it to "รายได้" would be inventing money.
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
    <main className="mx-auto w-full max-w-4xl px-5 py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] tracking-[0.14em] text-faint">DASHBOARD</p>
          <h1 className="mt-1 font-display text-2xl font-bold">{streamer.displayName}</h1>
        </div>
        <Link
          href={`/${streamer.slug}`}
          className="rounded-xl border border-line2 bg-panel px-4 py-2.5 text-sm font-semibold text-ink hover:border-accent"
        >
          เปิดหน้าโดเนท /{streamer.slug}
        </Link>
      </header>

      <section className="mt-6 grid gap-3 sm:grid-cols-3">
        <Stat label="ยอดรวม (จำลอง)" value={`฿${formatBaht(total)}`} tone="money" />
        <Stat label="จำนวนครั้ง" value={String(paidCount)} />
        <Stat label="เฉลี่ยต่อครั้ง" value={paidCount > 0 ? `฿${formatBaht(average)}` : '—'} />
      </section>

      {pendingCount > 0 && (
        <p className="mt-3 text-xs text-faint">
          มีอีก {pendingCount} รายการที่ยังไม่ชำระ — ไม่ถูกนับในยอดรวม
        </p>
      )}

      <section className="mt-8">
        <h2 className="font-display text-lg font-semibold">รายการล่าสุด</h2>

        {donations.length === 0 ? (
          <p className="mt-3 rounded-xl border border-line bg-panel p-6 text-center text-sm text-muted">
            ยังไม่มีโดเนท — ลองเปิดหน้าโดเนทแล้วส่งดูได้เลย
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-panel">
            {donations.map((d) => (
              <li key={d.id} className="flex items-start gap-4 p-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-ink">{d.donorName}</p>
                  {d.message && (
                    <p className="mt-0.5 truncate text-sm text-muted">{d.message}</p>
                  )}
                  <p className="mt-1 font-mono text-[11px] text-faint">
                    {d.createdAt.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p
                    className={`font-numeric text-lg font-bold ${
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

        {donations.length === PAGE_SIZE && (
          <p className="mt-3 text-center text-xs text-faint">
            แสดง {PAGE_SIZE} รายการล่าสุด — หน้าถัดไปมาใน M4
          </p>
        )}
      </section>
    </main>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'money' }) {
  return (
    <div className="rounded-2xl border border-line bg-panel p-5">
      <p className="font-mono text-[11px] tracking-[0.12em] text-faint">{label}</p>
      <p
        className={`mt-2 font-numeric text-2xl font-bold ${tone === 'money' ? 'text-money' : 'text-ink'}`}
      >
        {value}
      </p>
    </div>
  )
}

const STATUS_LABEL: Record<string, { text: string; className: string }> = {
  PAID: { text: 'จ่ายแล้ว', className: 'text-money' },
  PENDING: { text: 'รอชำระ', className: 'text-faint' },
  EXPIRED: { text: 'หมดอายุ', className: 'text-faint' },
  FAILED: { text: 'ไม่สำเร็จ', className: 'text-danger' },
  REFUNDED: { text: 'คืนเงิน', className: 'text-faint' },
}

function StatusPill({ status }: { status: string }) {
  const meta = STATUS_LABEL[status] ?? { text: status, className: 'text-faint' }
  return <p className={`mt-0.5 font-mono text-[10px] tracking-widest ${meta.className}`}>{meta.text}</p>
}
