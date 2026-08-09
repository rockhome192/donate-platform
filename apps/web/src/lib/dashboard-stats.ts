import type { PrismaClient } from '@prisma/client'
import type { DayTotal } from '@/app/(site)/dashboard/DailyTotals'

/**
 * Day maths for the dashboard, kept out of the page so it can be tested.
 *
 * Everything here is in **Bangkok calendar days**, not UTC ones. A streamer
 * asking "how much did I make today" means their today. Bucketing on UTC would
 * put every donation between 00:00 and 07:00 local into the previous day —
 * which is most of a stream that ran past midnight, the exact case where the
 * number gets checked.
 */

/**
 * Thailand is UTC+7 and has observed no daylight saving since 1976, so a fixed
 * offset is exact rather than an approximation. Written as a constant with this
 * note attached because a fixed offset is normally a bug, and the next reader
 * deserves to know which of the two this is.
 */
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000

export const DASHBOARD_DAYS = 7

/** One row of the daily-totals query. `total` is satang. */
export type DailyTotalRow = { day: Date; total: bigint }

/**
 * Just enough of the client to run one raw query.
 *
 * Taking it as an argument rather than importing `db` here keeps this module
 * free of a Prisma instance — the unit tests next door import it and must not
 * open a connection — and lets the integration test pass a TRANSACTION client
 * instead, which is how the SQL below gets exercised against a real Postgres
 * without leaving rows behind in the demo database.
 */
type RawQueryClient = Pick<PrismaClient, '$queryRaw'>

/**
 * Daily totals for the last `windowStart`-onwards, bucketed by BANGKOK
 * calendar day.
 *
 * Raw SQL because Prisma's groupBy cannot group on a derived expression, and
 * doing it in JS would mean pulling every paid donation of the week across the
 * wire to add them up.
 *
 * **The double AT TIME ZONE is not a typo and is the whole correctness of this
 * query.** The column is `timestamp(3)` WITHOUT a zone holding UTC, so the
 * first conversion tells Postgres what the naive value means and the second
 * moves it to Bangkok. With only the second, every donation between 00:00 and
 * 07:00 local lands on the previous day.
 *
 * That failure is invisible to the unit tests — they only cover the JS day
 * maths — so it is pinned by `__integration__/daily-totals.int.test.ts`
 * against a real Postgres. If you are about to simplify this expression, run
 * `pnpm --filter @dp/web test:int` first.
 */
export function fetchDailyTotals(
  client: RawQueryClient,
  streamerId: string,
  windowStart: Date,
): Promise<DailyTotalRow[]> {
  return client.$queryRaw<DailyTotalRow[]>`
    SELECT (("paidAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok')::date AS day,
           SUM(amount)::bigint AS total
      FROM "Donation"
     WHERE "streamerId" = ${streamerId}
       AND status = 'PAID'
       AND "paidAt" >= ${windowStart}
     GROUP BY 1
     ORDER BY 1
  `
}

/** Midnight in Bangkok, as the UTC instant it corresponds to. */
export function bangkokDayStart(now: Date): Date {
  const shifted = new Date(now.getTime() + BANGKOK_OFFSET_MS)
  const midnightShifted = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
  )
  return new Date(midnightShifted - BANGKOK_OFFSET_MS)
}

/**
 * Midnight on the 1st of the Bangkok calendar month, as the UTC instant it
 * corresponds to.
 *
 * Same reason as `bangkokDayStart`: a "this month" total computed off a UTC
 * month boundary is wrong for the seven hours either side of it, and the
 * donations most likely to land there are the ones from a stream that ran past
 * midnight on the 1st.
 */
export function bangkokMonthStart(now: Date): Date {
  const shifted = new Date(now.getTime() + BANGKOK_OFFSET_MS)
  const firstShifted = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), 1)
  return new Date(firstShifted - BANGKOK_OFFSET_MS)
}

/** The Bangkok calendar date a UTC instant falls on, as a y/m/d key. */
export function bangkokDayKey(instant: Date): string {
  return new Date(instant.getTime() + BANGKOK_OFFSET_MS).toISOString().slice(0, 10)
}

/**
 * Expands sparse query rows into exactly DASHBOARD_DAYS consecutive buckets,
 * oldest first, ending on today.
 *
 * The database only returns days that HAVE donations, and a chart built
 * straight from those rows silently compresses a quiet week into three bars
 * sitting next to each other — which reads as three consecutive days rather
 * than a gap. The zeros have to be put back.
 */
export function buildDaySeries(
  rows: readonly { day: Date; total: number }[],
  now: Date,
  days = DASHBOARD_DAYS,
): DayTotal[] {
  const byKey = new Map(rows.map((r) => [bangkokDayKey(r.day), r.total]))
  const todayStart = bangkokDayStart(now)

  return Array.from({ length: days }, (_, i) => {
    const date = new Date(todayStart.getTime() - (days - 1 - i) * 86_400_000)
    return {
      date,
      total: byKey.get(bangkokDayKey(date)) ?? 0,
      // Carried rather than derived in the component: `date` holds the UTC
      // instant of Bangkok midnight (17:00 the day before, in UTC), so
      // `getDay()` on it answers in the RUNTIME's zone and is off by one
      // wherever that zone is not Bangkok — which is every Vercel function.
      weekday: new Date(date.getTime() + BANGKOK_OFFSET_MS).getUTCDay(),
    }
  })
}
