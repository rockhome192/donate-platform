/**
 * Deleting the avatars nothing points at any more.
 *
 * `avatarKey()` gives every upload a random name — it has to, because a fixed
 * name per streamer is served stale from every cache in between for as long as
 * the CDN says so. The cost of that is an object per upload, forever, and the
 * profile save only ever knows about the one it is replacing. Everything else
 * that reaches the bucket is invisible to it: a ticket redeemed and then
 * abandoned (the browser tab closed between the PUT and the save), a streamer
 * who uploaded four pictures before picking one, a row deleted with its object
 * left behind.
 *
 * So this is the second half of the pair. The profile save deletes what it
 * replaces, which handles ordinary use; this finds what no row has ever named.
 *
 * EVERY RULE HERE FAILS TOWARDS KEEPING THE FILE. An avatar wrongly deleted is
 * a blank face on the page whose whole job is asking an audience for money, and
 * it cannot be undone; an avatar wrongly kept costs 200KB and is caught on the
 * next run. The planner is pure and separately tested for the same reason.
 */

import { db } from '@/lib/db'
import {
  deleteObject,
  isAvatarKey,
  listObjects,
  publicUrlToKey,
  storageConfig,
  type StorageConfig,
  type StoredObject,
} from '@/lib/storage'

export const AVATAR_PREFIX = 'avatars/'

/**
 * How long an object is protected for being new, regardless of anything else.
 *
 * The race this closes: a streamer PUTs an avatar and then reads the form for
 * ten minutes before saving. Between those two moments the object exists and no
 * row names it, which is indistinguishable from an orphan. An hour is far more
 * than the gap and far less than the interval a sweep runs on.
 */
export const SWEEP_GRACE_MS = 60 * 60 * 1000

/** Why an object survived, or null if it did not. */
export type KeepReason = 'in-use' | 'too-new' | 'not-ours'

export type SweepPlan = {
  remove: StoredObject[]
  kept: Record<KeepReason, number>
  /** Bytes the removals would free. Reported so a dry run says what it is worth. */
  bytes: number
}

/**
 * Decide, without touching anything.
 *
 * @param inUse every key named by a row, however that row came to name it.
 *              Wider than "keys this streamer owns" on purpose — see
 *              publicUrlToKey.
 */
export function planAvatarSweep(
  objects: readonly StoredObject[],
  inUse: ReadonlySet<string>,
  now: Date,
  graceMs: number = SWEEP_GRACE_MS,
): SweepPlan {
  const plan: SweepPlan = {
    remove: [],
    kept: { 'in-use': 0, 'too-new': 0, 'not-ours': 0 },
    bytes: 0,
  }

  for (const object of objects) {
    // The decision is the same whichever order these run in; the COUNTERS are
    // not, and the counters are how a dry run is read. Strongest claim first:
    // 'not-ours' holds at any age, so checking it below the grace period would
    // file a young stranger key under 'too-new' and imply it becomes deletable
    // in an hour. It never does.
    const reason: KeepReason | null = inUse.has(object.key)
      ? 'in-use'
      : !isAvatarKey(object.key)
        ? 'not-ours'
        : now.getTime() - object.lastModified.getTime() < graceMs
          ? 'too-new'
          : null

    if (reason) {
      plan.kept[reason]++
      continue
    }
    plan.remove.push(object)
    plan.bytes += object.size
  }

  return plan
}

/** Every key any streamer's avatarUrl names, whether or not that row should have named it. */
async function keysInUse(config: StorageConfig): Promise<Set<string>> {
  const rows = await db.streamer.findMany({
    where: { avatarUrl: { not: null } },
    select: { avatarUrl: true },
  })

  const keys = new Set<string>()
  for (const row of rows) {
    const key = row.avatarUrl && publicUrlToKey(config, row.avatarUrl)
    if (key) keys.add(key)
  }
  return keys
}

export type SweepResult = SweepPlan & {
  deleted: number
  failed: number
  dryRun: boolean
}

/**
 * List, plan, and — unless this is a dry run — delete.
 *
 * Dry by default. The caller has to say `dryRun: false` in as many words, which
 * is the only protection a maintenance script has against being run with the
 * wrong environment loaded.
 *
 * Throws when there is no bucket configured. A sweep is not an optional feature
 * that degrades quietly like the upload button; being asked to clean a bucket
 * that this process cannot see is a misconfiguration, and reporting "0 deleted"
 * would read as "nothing to do".
 */
export async function sweepAvatars(
  { dryRun = true, now = new Date() }: { dryRun?: boolean; now?: Date } = {},
): Promise<SweepResult> {
  const config = storageConfig()
  if (!config) throw new Error('[sweep] no R2 configuration — refusing to report an empty bucket')

  // Listed BEFORE the rows are read, so the window between the two can only
  // add rows, never objects. A row saved during the sweep protects a key that
  // is already in the listing; an object uploaded during the sweep is simply
  // not seen this time. Reading the rows first would invert that and let a
  // fresh upload be deleted by a listing taken after it.
  const objects = await listObjects(config, AVATAR_PREFIX)
  const inUse = await keysInUse(config)

  const plan = planAvatarSweep(objects, inUse, now)
  if (dryRun) return { ...plan, deleted: 0, failed: 0, dryRun: true }

  let deleted = 0
  let failed = 0
  for (const object of plan.remove) {
    // One at a time rather than Promise.all: this runs at most once a day
    // against a bucket measured in hundreds of objects, and a burst of parallel
    // deletes against a rate limit is a way to turn a tidy-up into an outage.
    if (await deleteObject(config, object.key)) deleted++
    else failed++
  }

  return { ...plan, deleted, failed, dryRun: false }
}
