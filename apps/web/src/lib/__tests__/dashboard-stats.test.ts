import { describe, expect, it } from 'vitest'
import {
  bangkokDayKey,
  bangkokDayStart,
  bangkokMonthStart,
  buildDaySeries,
} from '@/lib/dashboard-stats'

/**
 * The chart's day maths, which is entirely about a timezone the test runner
 * does not run in. Every assertion below fails if the code reverts to UTC days
 * or to the runtime's local zone — the two ways this silently goes wrong on
 * Vercel while looking perfect on a laptop in Bangkok.
 */

describe('bangkokDayStart', () => {
  it('rolls the day over at 17:00 UTC, not at midnight UTC', () => {
    // 16:59 UTC is still 23:59 on the 5th in Bangkok.
    expect(bangkokDayStart(new Date('2026-08-05T16:59:59Z')).toISOString()).toBe(
      '2026-08-04T17:00:00.000Z',
    )
    // 17:00 UTC is 00:00 on the 6th.
    expect(bangkokDayStart(new Date('2026-08-05T17:00:00Z')).toISOString()).toBe(
      '2026-08-05T17:00:00.000Z',
    )
  })

  /**
   * The case the whole thing exists for: a stream running past midnight. On UTC
   * days this donation would be filed under yesterday, and the streamer would
   * see "฿0 today" while money was arriving.
   */
  it('files a 01:00 Bangkok donation under the new day', () => {
    const oneAmBangkok = new Date('2026-08-05T18:00:00Z')
    expect(bangkokDayKey(oneAmBangkok)).toBe('2026-08-06')
  })

  it('is idempotent — the start of a day is its own day start', () => {
    const start = bangkokDayStart(new Date('2026-08-05T09:00:00Z'))
    expect(bangkokDayStart(start).toISOString()).toBe(start.toISOString())
  })
})

describe('bangkokMonthStart', () => {
  /**
   * Feeds the THIS MONTH tile on the public donate page. The seven hours either
   * side of a UTC month boundary are the whole point: a donation at 01:00 on
   * the 1st in Bangkok is still the previous month in UTC, and would be missing
   * from a tile the streamer checks precisely because a new month started.
   */
  it('starts the month at 17:00 UTC on the last day of the previous one', () => {
    expect(bangkokMonthStart(new Date('2026-08-09T09:00:00Z')).toISOString()).toBe(
      '2026-07-31T17:00:00.000Z',
    )
  })

  it('counts a 01:00 Bangkok donation on the 1st as this month', () => {
    const oneAmOnTheFirst = new Date('2026-07-31T18:00:00Z') // 01:00 Bangkok, 1 Aug
    expect(oneAmOnTheFirst >= bangkokMonthStart(oneAmOnTheFirst)).toBe(true)
    expect(bangkokDayKey(oneAmOnTheFirst)).toBe('2026-08-01')
  })

  it('excludes 23:59 Bangkok on the last day of the previous month', () => {
    const now = new Date('2026-08-09T09:00:00Z')
    const lastMinuteOfJuly = new Date('2026-07-31T16:59:59Z')
    expect(lastMinuteOfJuly >= bangkokMonthStart(now)).toBe(false)
  })

  it('handles the January rollover without falling into month -1', () => {
    expect(bangkokMonthStart(new Date('2026-01-15T09:00:00Z')).toISOString()).toBe(
      '2025-12-31T17:00:00.000Z',
    )
  })
})

describe('buildDaySeries', () => {
  const now = new Date('2026-08-05T09:00:00Z') // 16:00 Bangkok on the 5th

  it('always returns seven consecutive days ending today', () => {
    const series = buildDaySeries([], now)
    expect(series).toHaveLength(7)
    expect(series.map((d) => bangkokDayKey(d.date))).toEqual([
      '2026-07-30',
      '2026-07-31',
      '2026-08-01',
      '2026-08-02',
      '2026-08-03',
      '2026-08-04',
      '2026-08-05',
    ])
  })

  /**
   * The database returns only days that had donations. Rendering those rows
   * directly puts three scattered days side by side, which reads as three
   * consecutive ones — a quiet week drawn as a busy one.
   */
  it('puts the empty days back in, in the right slots', () => {
    const series = buildDaySeries(
      [
        { day: new Date('2026-07-31T00:00:00Z'), total: 5_000 },
        { day: new Date('2026-08-05T00:00:00Z'), total: 12_000 },
      ],
      now,
    )
    expect(series.map((d) => d.total)).toEqual([0, 5_000, 0, 0, 0, 0, 12_000])
  })

  it('resolves the weekday in Bangkok, not in the runtime zone', () => {
    // 2026-08-05 is a Wednesday in Bangkok.
    const series = buildDaySeries([], now)
    expect(series.at(-1)!.weekday).toBe(3)
    expect(series[0]!.weekday).toBe(4) // 2026-07-30, a Thursday
  })

  it('ignores a row outside the window rather than shifting the series', () => {
    const series = buildDaySeries(
      [{ day: new Date('2026-07-01T00:00:00Z'), total: 99_999 }],
      now,
    )
    expect(series).toHaveLength(7)
    expect(series.every((d) => d.total === 0)).toBe(true)
  })
})
