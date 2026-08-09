import type { Metadata } from 'next'
import { formatBaht } from '@dp/shared'
import { LiveDot, Panel, PanelHeader, StatBlock, TechLabel } from '@/components/ui'
import { requireAdmin } from '@/lib/api-session'
import { db } from '@/lib/db'
import { StreamerRow } from './StreamerRow'

/**
 * /dashboard/admin — the operator's view.
 *
 * Two panels, both fed by real tables. The v2 design draws a third thing beside
 * them, an "Audit log" of invented lines like "streamer X suspended by admin".
 * There is no audit table in this schema and nothing writes one, so inventing
 * entries would be the FOLLOWERS problem again — a panel that looks like
 * evidence and is decoration. What IS recorded, on every payment this system has
 * ever taken, is `WebhookEvent`: what arrived, when, whether it processed, and
 * what it failed with. That is a real operations feed and it takes the slot.
 *
 * The design's four invented stat tiles get the same treatment: every number
 * below is a query.
 *
 * Access is checked here against the DATABASE, not the session — see
 * requireAdmin in lib/api-session.ts for why a JWT role is not good enough for
 * the one screen that can suspend other people's accounts.
 */

export const metadata: Metadata = {
  title: 'Admin — DONATR (demo)',
  robots: { index: false, follow: false },
}
export const dynamic = 'force-dynamic'

const STREAMER_LIMIT = 50
const EVENT_LIMIT = 8

export default async function AdminPage() {
  const session = await requireAdmin()
  if (!session.ok) {
    return (
      <Panel className="px-5 py-6">
        <TechLabel className="text-danger">restricted</TechLabel>
        <p className="mt-2 text-label text-muted">{session.error}</p>
      </Panel>
    )
  }

  const [streamers, totals, paid, suspendedCount, unprocessed, events] = await Promise.all([
    db.streamer.findMany({
      orderBy: { createdAt: 'desc' },
      take: STREAMER_LIMIT,
      select: {
        id: true,
        slug: true,
        displayName: true,
        isActive: true,
        isSuspended: true,
        user: { select: { email: true } },
      },
    }),
    db.donation.groupBy({ by: ['streamerId'], where: { status: 'PAID' }, _sum: { amount: true } }),
    db.donation.aggregate({ where: { status: 'PAID' }, _sum: { amount: true }, _count: true }),
    db.streamer.count({ where: { isSuspended: true } }),
    // The reconciler's own backlog. A number that is not zero for long is the
    // single most useful signal this screen can show an operator: it means
    // money was taken and the system has not finished acting on it.
    db.webhookEvent.count({ where: { processedAt: null } }),
    db.webhookEvent.findMany({
      orderBy: { receivedAt: 'desc' },
      take: EVENT_LIMIT,
      select: {
        id: true,
        provider: true,
        eventType: true,
        receivedAt: true,
        processedAt: true,
        attempts: true,
        lastError: true,
      },
    }),
  ])

  const totalBySteamer = new Map(totals.map((t) => [t.streamerId, t._sum.amount ?? 0]))
  const streamerCount = await db.streamer.count()

  return (
    <>
      <header>
        <div className="flex flex-wrap items-center gap-2.5">
          <TechLabel className="text-danger">// admin</TechLabel>
          <span className="rounded-chip border border-danger/35 bg-danger/12 px-2 py-0.5 label-tech text-danger">
            restricted
          </span>
        </div>
        <h1 className="mt-1 font-display text-h1 font-bold">ผู้ดูแลระบบ</h1>
        <p className="mt-1 text-label text-muted">จัดการสตรีมเมอร์และตรวจสอบสถานะของ pipeline</p>
      </header>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatBlock
          label="streamers"
          value={String(streamerCount)}
          note={suspendedCount > 0 ? `ถูกระงับ ${suspendedCount}` : 'ไม่มีบัญชีถูกระงับ'}
        />
        <StatBlock label="paid donations" value={String(paid._count)} />
        <StatBlock
          label="volume"
          value={`฿${formatBaht(paid._sum.amount ?? 0).replace('.00', '')}`}
          tone="money"
          note="ยอดจำลองทั้งหมด ไม่ใช่เงินจริง"
        />
        <StatBlock
          label="webhooks pending"
          value={String(unprocessed)}
          tone={unprocessed > 0 ? 'pending' : 'ink'}
          note={unprocessed > 0 ? 'reconciler ยังตามไม่ครบ' : 'ประมวลผลครบแล้ว'}
        />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader
            label="streamers"
            right={<span className="text-meta text-faint">{streamers.length} รายการล่าสุด</span>}
          />
          <ul className="divide-y divide-line">
            {streamers.map((s) => (
              <StreamerRow
                key={s.id}
                id={s.id}
                slug={s.slug}
                displayName={s.displayName}
                email={s.user.email}
                isActive={s.isActive}
                isSuspended={s.isSuspended}
                totalSatang={totalBySteamer.get(s.id) ?? 0}
              />
            ))}
            {streamers.length === 0 && (
              <li className="px-4 py-6 text-center text-label text-muted">ยังไม่มีสตรีมเมอร์</li>
            )}
          </ul>
        </Panel>

        <Panel>
          <PanelHeader
            label="webhook events"
            right={
              <span className="flex items-center gap-2 text-meta text-faint">
                <LiveDot live={false} />
                ล่าสุด {EVENT_LIMIT} รายการ
              </span>
            }
          />
          <ul className="divide-y divide-line">
            {events.map((e) => {
              const severity = e.lastError
                ? { label: 'error', className: 'border-danger/35 bg-danger/12 text-danger' }
                : e.processedAt
                  ? { label: 'ok', className: 'border-line-strong bg-surface-2 text-muted' }
                  : { label: 'queued', className: 'border-pending/35 bg-pending/12 text-pending' }

              return (
                <li key={e.id} className="flex gap-3 px-4 py-3">
                  <span
                    className={`h-fit shrink-0 rounded-chip border px-2 py-0.5 label-tech ${severity.className}`}
                  >
                    {severity.label}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-label text-ink">
                      {e.provider} · {e.eventType}
                    </p>
                    <p className="truncate font-mono text-micro text-faint">
                      {e.receivedAt.toISOString().replace('T', ' ').slice(0, 19)} UTC
                      {e.attempts > 0 && ` · attempts ${e.attempts}`}
                    </p>
                    {e.lastError && (
                      <p className="mt-1 line-clamp-2 text-meta text-danger">{e.lastError}</p>
                    )}
                  </div>
                </li>
              )
            })}
            {events.length === 0 && (
              <li className="px-4 py-6 text-center text-label text-muted">
                ยังไม่มี webhook เข้ามา — ลองกดปุ่มจำลองการจ่ายเงินในหน้าโดเนท
              </li>
            )}
          </ul>
        </Panel>
      </div>
    </>
  )
}
