import { STOP_MESSAGE } from '@/lib/overlay/reconnect'

/**
 * The 404 for the OBS branch. Without this file the overlay would fall through
 * to app/not-found.tsx, which is a full site page — sticky amber DEMO banner,
 * heading, two buttons — and that would render inside a live broadcast.
 *
 * The trigger is not exotic. A streamer rotates their overlayToken (a feature,
 * DESIGN.md 8.3), the old URL is still sitting in the OBS Browser Source, and
 * the next time OBS restarts it loads this page. Verified in a real browser
 * before this file existed: "DEMO MODE / ระบบสาธิต ไม่รับเงินจริง ... ไม่พบหน้านี้"
 * rendered on the overlay.
 *
 * The wording is deliberately the same string the CLIENT shows when a live
 * socket is rejected as token-invalid (lib/overlay/reconnect.ts). The two paths
 * are different — a dead token at page load versus one rotated mid-stream — but
 * they are the same situation to the person reading it, and telling them two
 * different things about one problem is how support tickets are made.
 */
export default function OverlayNotFound() {
  return (
    <div className="h-dvh w-full overflow-hidden">
      <div
        role="alert"
        className="absolute top-[6%] left-[4%] w-[min(30rem,80%)] rounded-panel border border-danger/50 bg-canvas/90 px-5 py-4"
      >
        <p className="label-tech text-danger">overlay url invalid</p>
        <p className="mt-1.5 text-label text-ink">{STOP_MESSAGE['token-invalid']}</p>
      </div>
    </div>
  )
}
