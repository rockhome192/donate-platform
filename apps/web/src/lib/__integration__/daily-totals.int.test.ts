import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PrismaClient } from '@prisma/client'
import { afterAll, describe, expect, it } from 'vitest'
import {
  DASHBOARD_DAYS,
  bangkokDayKey,
  bangkokDayStart,
  buildDaySeries,
  fetchDailyTotals,
} from '@/lib/dashboard-stats'

/**
 * The dashboard's daily-totals SQL, against a real Postgres.
 *
 * The unit tests next door cover the JS day maths and nothing else. They pass
 * just as happily if the SQL's double `AT TIME ZONE` is cut to one — which is
 * the exact edit a future reader is most likely to make, since it looks
 * redundant. That mistake files every donation between 00:00 and 07:00 Bangkok
 * under the previous day, i.e. most of a stream that ran past midnight, and no
 * unit test in this repo can see it. Only Postgres can answer whether the
 * expression is right, so this file asks Postgres.
 *
 * **Nothing is written to the database.** Every case runs inside a transaction
 * that is rolled back, because the only Postgres available here is the live
 * demo one.
 */

// Vitest does not load .env; Prisma would then read an undefined URL.
const envPath = fileURLToPath(new URL('../../../.env', import.meta.url))
if (existsSync(envPath)) process.loadEnvFile(envPath)

/*
 * The DIRECT (non-pooled) endpoint. Neon's pooled URL goes through PgBouncer in
 * transaction mode, which cannot hold an interactive transaction open across
 * several round trips — the rollback harness below depends on exactly that.
 */
const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL
if (!url) {
  console.warn(
    '[daily-totals.int] no DIRECT_URL/DATABASE_URL — skipping. These tests need a real Postgres.',
  )
}

const db = url ? new PrismaClient({ datasources: { db: { url } } }) : null
afterAll(async () => {
  await db?.$disconnect()
})

/** Thrown to unwind the transaction once the assertions have their data. */
class Rollback extends Error {
  constructor(readonly value: unknown) {
    super('rollback')
  }
}

/**
 * Seeds a streamer with the given paid/unpaid donations, runs the query, and
 * rolls everything back. Returns whatever `body` returned.
 */
async function inRolledBackTx<T>(body: (tx: TxClient) => Promise<T>): Promise<T> {
  try {
    await db!.$transaction(
      async (tx) => {
        throw new Rollback(await body(tx))
      },
      { timeout: 25_000, maxWait: 15_000 },
    )
  } catch (e) {
    if (e instanceof Rollback) return e.value as T
    throw e // a real failure, including a failed assertion inside the tx
  }
  throw new Error('unreachable: the transaction body always throws Rollback')
}

type TxClient = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]

/** A streamer that exists only for the life of one transaction. */
async function seedStreamer(tx: TxClient, tag: string) {
  const unique = `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const user = await tx.user.create({
    data: { email: `${unique}@int.test`, passwordHash: 'x' },
  })
  return tx.streamer.create({
    data: { userId: user.id, slug: unique, displayName: `int ${tag}` },
  })
}

type Row = { paidAt: string | null; amount: number; status?: 'PAID' | 'PENDING' }

async function seedDonations(tx: TxClient, streamerId: string, rows: Row[]) {
  for (const r of rows) {
    await tx.donation.create({
      data: {
        streamerId,
        donorName: 'int',
        amount: r.amount,
        provider: 'MOCK',
        status: r.status ?? 'PAID',
        paidAt: r.paidAt ? new Date(r.paidAt) : null,
        expiresAt: new Date('2030-01-01T00:00:00Z'),
      },
    })
  }
}

// 16:00 Bangkok on 6 Aug. Fixed, so the window below is fixed too.
const NOW = new Date('2026-08-06T09:00:00Z')
const TODAY_START = bangkokDayStart(NOW)
const WINDOW_START = new Date(TODAY_START.getTime() - (DASHBOARD_DAYS - 1) * 86_400_000)

describe.skipIf(!db)('fetchDailyTotals against a real Postgres', () => {
  /**
   * The case the double AT TIME ZONE exists for. Both donations are on the same
   * UTC day; in Bangkok they are on opposite sides of midnight. Cutting the
   * expression to a single conversion puts them both on 5 Aug and this fails.
   */
  it('splits a stream that ran past midnight on the BANGKOK day boundary', async () => {
    const rows = await inRolledBackTx(async (tx) => {
      const streamer = await seedStreamer(tx, 'midnight')
      await seedDonations(tx, streamer.id, [
        { paidAt: '2026-08-05T16:59:59Z', amount: 10_000 }, // 23:59 on the 5th
        { paidAt: '2026-08-05T18:00:00Z', amount: 25_000 }, // 01:00 on the 6th
        { paidAt: '2026-08-05T19:30:00Z', amount: 5_000 }, // 02:30 on the 6th
      ])
      return fetchDailyTotals(tx, streamer.id, WINDOW_START)
    })

    expect(
      rows.map((r) => ({ day: bangkokDayKey(r.day), total: Number(r.total) })),
    ).toEqual([
      { day: '2026-08-05', total: 10_000 },
      { day: '2026-08-06', total: 30_000 }, // the two after midnight, summed
    ])
  })

  /**
   * The multi-tenant leak, asked of the database rather than of the code. The
   * WHERE clause is a bound parameter, so this also proves the binding works
   * at all — a query that ignored it would return B's row here.
   */
  it('never returns another streamer’s money', async () => {
    const { mine, theirs } = await inRolledBackTx(async (tx) => {
      const a = await seedStreamer(tx, 'a')
      const b = await seedStreamer(tx, 'b')
      await seedDonations(tx, a.id, [{ paidAt: '2026-08-05T18:00:00Z', amount: 10_000 }])
      await seedDonations(tx, b.id, [{ paidAt: '2026-08-05T18:00:00Z', amount: 999_999 }])
      return {
        mine: await fetchDailyTotals(tx, a.id, WINDOW_START),
        theirs: await fetchDailyTotals(tx, b.id, WINDOW_START),
      }
    })

    expect(mine.map((r) => Number(r.total))).toEqual([10_000])
    expect(theirs.map((r) => Number(r.total))).toEqual([999_999])
  })

  it('counts PAID only, and only inside the window', async () => {
    const rows = await inRolledBackTx(async (tx) => {
      const streamer = await seedStreamer(tx, 'filters')
      await seedDonations(tx, streamer.id, [
        { paidAt: '2026-08-05T18:00:00Z', amount: 10_000 },
        // Somebody who opened a QR and walked away. Carries a paidAt here on
        // purpose: only the status filter can exclude it.
        { paidAt: '2026-08-05T18:00:00Z', amount: 700_000, status: 'PENDING' },
        // Paid, but a day older than the seven the chart shows.
        { paidAt: '2026-07-30T10:00:00Z', amount: 800_000 },
      ])
      return fetchDailyTotals(tx, streamer.id, WINDOW_START)
    })

    expect(rows.map((r) => Number(r.total))).toEqual([10_000])
  })

  /**
   * The round trip the unit tests cannot reach: Postgres returns `day` as a
   * `date`, and `buildDaySeries` matches it by Bangkok day key. If the driver
   * ever hands that column back at local midnight instead of UTC midnight, the
   * bar lands one slot off and only this test notices.
   */
  it('feeds buildDaySeries rows that land in the right slots', async () => {
    const rows = await inRolledBackTx(async (tx) => {
      const streamer = await seedStreamer(tx, 'series')
      await seedDonations(tx, streamer.id, [
        { paidAt: '2026-08-05T16:59:59Z', amount: 10_000 }, // 5 Aug, Bangkok
        { paidAt: '2026-08-05T18:00:00Z', amount: 30_000 }, // 6 Aug, Bangkok
      ])
      return fetchDailyTotals(tx, streamer.id, WINDOW_START)
    })

    const series = buildDaySeries(
      rows.map((r) => ({ day: r.day, total: Number(r.total) })),
      NOW,
    )
    expect(series.map((d) => bangkokDayKey(d.date))).toEqual([
      '2026-07-31',
      '2026-08-01',
      '2026-08-02',
      '2026-08-03',
      '2026-08-04',
      '2026-08-05',
      '2026-08-06',
    ])
    expect(series.map((d) => d.total)).toEqual([0, 0, 0, 0, 0, 10_000, 30_000])
  })

  it('returns nothing rather than a zero row for a streamer with no donations', async () => {
    const rows = await inRolledBackTx(async (tx) => {
      const streamer = await seedStreamer(tx, 'empty')
      return fetchDailyTotals(tx, streamer.id, WINDOW_START)
    })

    expect(rows).toEqual([])
  })

  /** The harness itself: if this fails, the tests above are polluting Neon. */
  it('leaves nothing behind — the transaction really rolls back', async () => {
    const slug = await inRolledBackTx(async (tx) => {
      const streamer = await seedStreamer(tx, 'rollback-check')
      return streamer.slug
    })

    expect(await db!.streamer.findUnique({ where: { slug } })).toBeNull()
  })
})
