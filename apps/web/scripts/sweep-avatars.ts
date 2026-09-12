/**
 * Delete the avatars in R2 that no profile points at.
 *
 *   pnpm --filter @dp/web sweep:avatars            # say what would go
 *   pnpm --filter @dp/web sweep:avatars --delete   # actually delete it
 *
 * Dry by default, and the flag is spelled out rather than `-f`, because the
 * damage a wrong run does is measured in blank faces on donate pages. Read the
 * dry run before passing it.
 *
 * Needs the same R2_* and DATABASE_URL the app uses. Pointing it at a bucket
 * and a database that do not belong together is the one mistake no guard in
 * here can catch: every key would look unreferenced, and the sweep would
 * cheerfully delete the lot. Check which .env is loaded before --delete.
 */

import { sweepAvatars } from '@/lib/avatars/sweep'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

async function main() {
  const dryRun = !process.argv.includes('--delete')

  const result = await sweepAvatars({ dryRun })

  const kept = result.kept
  console.log(
    `kept ${kept['in-use']} in use, ${kept['too-new']} too new, ${kept['not-ours']} not ours`,
  )

  if (result.remove.length === 0) {
    console.log('nothing to remove')
    return
  }

  for (const object of result.remove) {
    console.log(`  ${object.key}  ${formatBytes(object.size)}  ${object.lastModified.toISOString()}`)
  }

  if (dryRun) {
    console.log(
      `\nwould remove ${result.remove.length} objects, freeing ${formatBytes(result.bytes)}`,
    )
    console.log('re-run with --delete to do it')
    return
  }

  console.log(`\ndeleted ${result.deleted}, freed ${formatBytes(result.bytes)}`)
  if (result.failed > 0) {
    // Not a crash: the next run picks them up, and the ones that did go are
    // already gone. A non-zero exit is how a cron job says "look at me".
    console.error(`${result.failed} could not be deleted — see the warnings above`)
    process.exitCode = 1
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
