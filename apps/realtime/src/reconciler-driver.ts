/**
 * Drives the web app's reconciler every few minutes.
 *
 * Why this lives here and not in Vercel Cron: Hobby-plan crons are capped at
 * once per DAY (verified 2026-08-01 — a more frequent expression fails at
 * deploy time), and a donation whose after() crashed must not wait 24 hours to
 * be rescued. This service is a long-lived process on Railway, so an interval
 * is free and honest. The daily Vercel cron stays as the backstop for when this
 * process is the thing that is down.
 *
 * It carries no payment logic on purpose — it is a clock with an HTTP client.
 * All the reconciling happens in apps/web, which is the side that has Prisma
 * and the provider keys.
 */

const DEFAULT_INTERVAL_MS = 5 * 60_000

export type ReconcilerDriver = { stop: () => void }

export function startReconcilerDriver(): ReconcilerDriver | null {
  const webUrl = process.env.WEB_APP_URL?.replace(/\/$/, '')
  const secret = process.env.CRON_SECRET

  if (!webUrl || !secret) {
    console.warn('[reconciler-driver] WEB_APP_URL / CRON_SECRET unset — not scheduling')
    return null
  }

  const intervalMs = Number(process.env.RECONCILE_INTERVAL_MS ?? DEFAULT_INTERVAL_MS)

  const tick = async () => {
    try {
      const res = await fetch(`${webUrl}/api/cron/reconcile`, {
        method: 'POST',
        headers: { authorization: `Bearer ${secret}` },
        // Longer than the route's own batch work, shorter than the interval —
        // overlapping runs would process the same events twice.
        signal: AbortSignal.timeout(30_000),
      })

      if (!res.ok) {
        console.warn(`[reconciler-driver] web responded ${res.status}`)
        return
      }

      const report = (await res.json()) as { picked?: number; expired?: number; stuck?: number }
      // Quiet when there is nothing to say: a line every 5 minutes forever
      // buries the lines that matter.
      if (report.picked || report.expired || report.stuck) {
        console.log('[reconciler-driver]', JSON.stringify(report))
      }
    } catch (e) {
      // A missed cycle costs 5 minutes, not correctness — the next one picks up
      // exactly the same rows.
      console.warn('[reconciler-driver] cycle failed', e)
    }
  }

  const timer = setInterval(() => void tick(), intervalMs)
  // Do not hold the process open on this alone; the HTTP server owns the loop.
  timer.unref?.()

  console.log(`[reconciler-driver] every ${Math.round(intervalMs / 1000)}s -> ${webUrl}`)

  return { stop: () => clearInterval(timer) }
}
