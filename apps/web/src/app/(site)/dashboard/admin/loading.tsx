import {
  Skeleton,
  SkeletonHeader,
  SkeletonPanel,
  SkeletonRow,
  SkeletonScreen,
  SkeletonStat,
} from '@/components/Skeleton'

/** Four stat tiles over the streamer list and the webhook-event list. */
export default function AdminLoading() {
  return (
    <SkeletonScreen label="กำลังโหลดหน้าผู้ดูแลระบบ">
      <header>
        <SkeletonHeader titleWidth="w-48" />
        <Skeleton className="mt-2 h-3 w-80 max-w-full" />
      </header>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SkeletonStat />
        <SkeletonStat />
        <SkeletonStat />
        <SkeletonStat />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        {[0, 1].map((panel) => (
          <SkeletonPanel key={panel}>
            <ul>
              {[0, 1, 2, 3].map((row) => (
                <SkeletonRow key={row} trailingWidth="w-16" />
              ))}
            </ul>
          </SkeletonPanel>
        ))}
      </div>
    </SkeletonScreen>
  )
}
