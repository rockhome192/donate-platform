import { Skeleton, SkeletonField, SkeletonScreen } from '@/components/Skeleton'
import { AmbientBackdrop, Wordmark } from '@/components/ui'

/**
 * The public donate page — the one screen a stranger arrives on cold, from a
 * link in a stream description, with no idea whether the site is slow or
 * broken. Worth covering even though it is a single query, because there is no
 * previous page to fall back to: a direct hit renders nothing at all until the
 * streamer row comes back.
 *
 * The wordmark and the backdrop are real, not placeholders. They need no data,
 * and rendering them immediately means the visitor sees a page that belongs to
 * someone rather than a grey rectangle.
 */
export default function DonateLoading() {
  return (
    <>
      <AmbientBackdrop />
      <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-5 py-5">
        <div className="inline-flex w-fit items-center py-1">
          <Wordmark size="sm" />
        </div>

        <main className="flex-1">
          <SkeletonScreen label="กำลังโหลดหน้าโดเนท">
            <article className="mt-4 overflow-hidden rounded-panel border border-line bg-surface">
              {/* The banner is a gradient, not data. Keeping it means the card
                  has its real silhouette while the profile inside is still
                  unknown — and the avatar still breaks its bottom edge in the
                  right place, so nothing shifts when the real one lands. */}
              <div className="h-28 bg-[linear-gradient(120deg,var(--color-accent),#a01d38_70%,#4a1220)] opacity-45" />

              <div className="relative px-5 pb-6 sm:px-6">
                <div className="flex items-end gap-3.5">
                  <Skeleton className="-mt-9 size-19 shrink-0 rounded-panel border-3 border-surface" />
                  {/* min-h so the row is as tall as name + slug really are; the
                      avatar is bottom-aligned to it, so a short row lifts the
                      avatar off the banner edge where the real one sits. */}
                  <div className="min-h-16 min-w-0 flex-1">
                    <Skeleton className="h-6 w-40" />
                    <Skeleton className="mt-2 h-3.5 w-20" />
                  </div>
                </div>

                <Skeleton className="mt-4 h-4 w-3/4" />

                {/* This month / donations / donors — the real dl's three cells. */}
                <div className="mt-4 grid grid-cols-3 gap-2">
                  {[0, 1, 2].map((i) => (
                    <div
                      key={i}
                      className="min-h-18 rounded-chip border border-line bg-surface-2 px-3 py-3"
                    >
                      <Skeleton className="mx-auto h-6 w-16" />
                      <Skeleton className="mx-auto mt-2 h-3 w-14" />
                    </div>
                  ))}
                </div>

                <div className="mt-5 border-t border-line pt-5">
                  <Skeleton className="h-6 w-64 max-w-full" />

                  <div className="mt-4 space-y-6">
                    <SkeletonField />
                    <SkeletonField controlHeight="h-18" />

                    <div>
                      <Skeleton className="h-4 w-28" />
                      {/* The five preset chips, then the amount field. */}
                      <div className="mt-2 flex gap-2">
                        {[0, 1, 2, 3, 4].map((i) => (
                          <Skeleton key={i} className="h-10 flex-1 rounded-control" />
                        ))}
                      </div>
                      <Skeleton className="mt-3 h-15 w-full rounded-control" />
                      <Skeleton className="mt-2 h-3 w-52 max-w-full" />
                    </div>

                    <Skeleton className="h-13 w-full rounded-control" />
                  </div>
                </div>
              </div>
            </article>
          </SkeletonScreen>
        </main>
      </div>
    </>
  )
}
