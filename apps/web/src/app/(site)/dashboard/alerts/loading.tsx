import {
  Skeleton,
  SkeletonField,
  SkeletonHeader,
  SkeletonPanel,
  SkeletonScreen,
} from '@/components/Skeleton'

/**
 * Mirrors AlertSettingForm. Three fields, because three is what the form has —
 * the AlertSetting table carries seven columns but only template, durationMs
 * and minAmount are read by anything.
 */
export default function AlertsLoading() {
  return (
    <SkeletonScreen label="กำลังโหลดการตั้งค่า alert">
      <header>
        <SkeletonHeader titleWidth="w-40" />
        <Skeleton className="mt-2 h-3 w-96 max-w-full" />
      </header>

      <SkeletonPanel className="mt-6">
        <div className="space-y-4 p-4 sm:p-5">
          <SkeletonField />
          <SkeletonField />
          <SkeletonField />
          <Skeleton className="h-10 w-32 rounded-control" />
        </div>
      </SkeletonPanel>
    </SkeletonScreen>
  )
}
