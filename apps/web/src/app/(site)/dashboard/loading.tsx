import {
  Skeleton,
  SkeletonHeader,
  SkeletonPanel,
  SkeletonRow,
  SkeletonScreen,
  SkeletonStat,
} from '@/components/Skeleton'

/**
 * The overview. This is the one screen where the wait is worth covering: it
 * runs the daily-totals aggregate plus the paginated list, and measured warm
 * against the real database it is the slowest of the console screens.
 *
 * It stands in for the page only — the shell around it (sidebar, the account
 * block at its foot) is rendered by dashboard/layout.tsx, which sits OUTSIDE
 * this boundary and stays on screen untouched. That is the whole reason this
 * reads as a page loading rather than the app restarting.
 */
export default function DashboardLoading() {
  return (
    <SkeletonScreen label="กำลังโหลดภาพรวม">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <SkeletonHeader />
        <Skeleton className="h-9 w-48 rounded-control" />
      </header>

      <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SkeletonStat />
        <SkeletonStat />
        <SkeletonStat />
        <SkeletonStat />
      </section>

      <SkeletonPanel className="mt-5">
        <div className="p-4">
          {/* Same h-44 row of bottom-aligned bars as DailyTotals, at fixed
              heights: a placeholder must not imply a shape the data might not
              have, but it does have to occupy the height, or the panels below
              it jump when the real chart arrives. */}
          <ol className="flex h-44 items-end gap-1.5">
            {/* Keyed by index, not by the height class: this is a fixed list of
                seven bars that never reorders, and two of the seven share a
                height — so the class is not unique and React rightly complains
                about it. */}
            {['h-1/3', 'h-1/2', 'h-1/4', 'h-2/3', 'h-2/5', 'h-3/5', 'h-1/3'].map((h, i) => (
              <li key={i} className="flex h-full min-w-0 flex-1 flex-col justify-end gap-1.5">
                <Skeleton className={`w-full rounded-chip ${h}`} />
              </li>
            ))}
          </ol>
        </div>
      </SkeletonPanel>

      <SkeletonPanel className="mt-8">
        <ul>
          {[0, 1, 2, 3, 4].map((i) => (
            <SkeletonRow key={i} />
          ))}
        </ul>
      </SkeletonPanel>
    </SkeletonScreen>
  )
}
