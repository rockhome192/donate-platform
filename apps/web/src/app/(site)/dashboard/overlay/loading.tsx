import {
  Skeleton,
  SkeletonHeader,
  SkeletonPanel,
  SkeletonScreen,
} from '@/components/Skeleton'

/** Two panels: the overlay URL with its controls, then the OBS instructions. */
export default function OverlayLoading() {
  return (
    <SkeletonScreen label="กำลังโหลดหน้า overlay">
      <header>
        <SkeletonHeader titleWidth="w-52" />
        <Skeleton className="mt-2 h-3 w-96 max-w-full" />
      </header>

      <div className="mt-6 space-y-5">
        <SkeletonPanel>
          <div className="space-y-3 p-4 sm:p-5">
            {/* The URL field, which is the point of the screen. */}
            <Skeleton className="h-10 w-full rounded-control" />
            <div className="flex flex-wrap gap-2">
              <Skeleton className="h-9 w-28 rounded-control" />
              <Skeleton className="h-9 w-36 rounded-control" />
            </div>
          </div>
        </SkeletonPanel>

        <SkeletonPanel>
          <ol className="space-y-3 p-4 sm:p-5">
            {[0, 1, 2, 3].map((i) => (
              <li key={i} className="flex gap-3">
                <Skeleton className="size-6 shrink-0 rounded-chip" />
                <Skeleton className="mt-1 h-3 w-full max-w-md" />
              </li>
            ))}
          </ol>
        </SkeletonPanel>
      </div>
    </SkeletonScreen>
  )
}
