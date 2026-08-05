import { formatBaht } from '@dp/shared'
import { Panel, PanelHeader } from '@/components/ui'

/**
 * Seven daily totals — the only chart in the console.
 *
 * Form: the data's job is magnitude across seven discrete days, which is a bar
 * chart and nothing cleverer. Seven is few enough that every bar carries its
 * own value, so there is no hover layer to miss, nothing breaks without JS,
 * and a screen reader gets the numbers from the same markup a sighted reader
 * does.
 *
 * Colour: one series, so there is no categorical palette here and no legend —
 * the panel title names the series. The bars are amber because they are money,
 * and money is amber everywhere in this system. Notably the v2 mockup painted
 * today's bar in the ACTION colour; that is the one swap the system forbids,
 * because an amount wearing the action colour starts reading as a command.
 *
 * Today is still distinguished, just not by hue: it is the only partial bar on
 * the chart — the day is not over — so it is drawn open at the top and its
 * label says so in words. Shape and text, never colour alone.
 */

export type DayTotal = {
  /** The UTC instant of midnight on this Bangkok calendar day. */
  date: Date
  /** satang */
  total: number
  /** 0 = Sunday, already resolved in Bangkok time — see buildDaySeries. */
  weekday: number
}

const WEEKDAY = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'] as const

/** Bars shorter than this are invisible; a day with income must never look empty. */
const MIN_BAR_PERCENT = 3

export function DailyTotals({ days }: { days: readonly DayTotal[] }) {
  const peak = Math.max(...days.map((d) => d.total), 1)
  const week = days.reduce((sum, d) => sum + d.total, 0)

  return (
    <Panel>
      <PanelHeader
        label="ยอดโดเนท 7 วัน"
        right={
          <span className="font-numeric text-meta tabular-nums text-money">
            ฿{formatBaht(week)}
          </span>
        }
      />

      <div className="p-4">
        {week === 0 ? (
          <p className="py-8 text-center text-label text-muted">ยังไม่มียอดใน 7 วันที่ผ่านมา</p>
        ) : (
          <ol className="flex h-44 items-end gap-1.5">
            {days.map((day, i) => {
              const isToday = i === days.length - 1
              const percent =
                day.total === 0 ? 0 : Math.max(MIN_BAR_PERCENT, (day.total / peak) * 100)

              return (
                <li key={day.date.toISOString()} className="flex h-full min-w-0 flex-1 flex-col justify-end gap-1.5">
                  <p className="text-center font-numeric text-micro tabular-nums text-muted">
                    {day.total === 0 ? '—' : formatBaht(day.total).replace('.00', '')}
                  </p>

                  {/* Rounded only at the top: the bar is anchored to a baseline
                      and rounding the foot would lift it off its own axis. */}
                  <div
                    className={`w-full rounded-t-[4px] ${
                      isToday ? 'border-t-2 border-dashed border-money bg-money/35' : 'bg-money'
                    }`}
                    style={{ height: `${percent}%` }}
                  >
                    <span className="sr-only">
                      {day.date.toLocaleDateString('th-TH', {
                        dateStyle: 'medium',
                        // Explicit, for the same reason weekday is precomputed:
                        // the runtime's zone is UTC in production.
                        timeZone: 'Asia/Bangkok',
                      })}{' '}
                      — ฿{formatBaht(day.total)}
                      {isToday ? ' (ยังไม่จบวัน)' : ''}
                    </span>
                  </div>

                  <p
                    aria-hidden
                    className={`truncate text-center text-micro ${
                      isToday ? 'font-semibold text-ink' : 'text-faint'
                    }`}
                  >
                    {isToday ? 'วันนี้' : WEEKDAY[day.weekday]}
                  </p>
                </li>
              )
            })}
          </ol>
        )}

        <p className="mt-3 border-t border-line pt-3 text-meta text-faint">
          นับเฉพาะรายการที่จ่ายแล้ว ตามวันแบบเวลาไทย — แท่งขวาสุดยังไม่จบวัน
        </p>
      </div>
    </Panel>
  )
}
