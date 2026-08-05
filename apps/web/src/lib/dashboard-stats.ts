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
