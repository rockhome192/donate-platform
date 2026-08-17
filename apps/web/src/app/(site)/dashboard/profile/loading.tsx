import {
  Skeleton,
  SkeletonField,
  SkeletonHeader,
  SkeletonPanel,
  SkeletonScreen,
} from '@/components/Skeleton'

/** Mirrors ProfileForm: the identity panel, with the live preview beside it. */
export default function ProfileLoading() {
  return (
    <SkeletonScreen label="กำลังโหลดโปรไฟล์">
      <header>
        <SkeletonHeader titleWidth="w-44" />
        <Skeleton className="mt-2 h-3 w-72 max-w-full" />
      </header>

      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <SkeletonPanel>
          <div className="space-y-4 p-4 sm:p-5">
            <div className="flex items-center gap-4">
              <Skeleton className="size-16 shrink-0 rounded-panel" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-3 w-40" />
                <Skeleton className="h-2.5 w-56 max-w-full" />
              </div>
            </div>
            <SkeletonField />
            <SkeletonField />
            <SkeletonField controlHeight="h-20" />
            <div className="grid gap-3 sm:grid-cols-2">
              <SkeletonField />
              <SkeletonField />
            </div>
            <Skeleton className="h-10 w-32 rounded-control" />
          </div>
        </SkeletonPanel>

        <SkeletonPanel>
          <div className="p-4">
            <Skeleton className="h-24 w-full rounded-panel" />
            <Skeleton className="-mt-7 ml-4 size-15 rounded-panel" />
            <Skeleton className="mt-3 h-4 w-32" />
            <Skeleton className="mt-2 h-2.5 w-full" />
            <Skeleton className="mt-1.5 h-2.5 w-2/3" />
          </div>
        </SkeletonPanel>
      </div>
    </SkeletonScreen>
  )
}
