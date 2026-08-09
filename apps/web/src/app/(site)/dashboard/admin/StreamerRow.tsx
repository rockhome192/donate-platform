'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatBaht } from '@dp/shared'

/**
 * One row of the admin streamer list, with the only write this screen performs.
 *
 * Optimism is deliberately absent. Suspending someone also has to kick their
 * live overlay sockets, and that call can fail on its own while the database
 * write succeeds — so the row waits for the server's answer and then reports
 * BOTH outcomes. Flipping the switch instantly and hoping would hide exactly
 * the failure an operator is on this screen to catch.
 */

type Props = {
  id: string
  slug: string
  displayName: string
  email: string
  isActive: boolean
  isSuspended: boolean
  /** satang */
  totalSatang: number
}

export function StreamerRow({
  id,
  slug,
  displayName,
  email,
  isActive,
  isSuspended,
  totalSatang,
}: Props) {
  const router = useRouter()
  const [suspended, setSuspended] = useState(isSuspended)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  /**
   * Suspending closes a live donate page and kicks an OBS source mid-stream,
   * from one click in a list of fifty rows that all look alike. Two clicks, in
   * the row itself rather than through `confirm()` — a native dialog cannot say
   * whose account it is about, and "OK / Cancel" over a list is exactly how the
   * wrong row gets picked.
   */
  const [confirming, setConfirming] = useState(false)

  const status = suspended
    ? { label: 'suspended', className: 'border-danger/35 bg-danger/12 text-danger', dot: 'bg-danger' }
    : isActive
      ? { label: 'open', className: 'border-live/35 bg-live/12 text-live', dot: 'bg-live' }
      : { label: 'closed', className: 'border-line-strong bg-surface-2 text-muted', dot: 'bg-faint' }

  async function toggle() {
    const next = !suspended
    setBusy(true)
    setNote(null)
    setConfirming(false)
    try {
      const res = await fetch(`/api/admin/streamers/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ isSuspended: next }),
      })
      const body = await res.json().catch(() => null)

      if (!res.ok) {
        setNote(body?.error ?? `ทำรายการไม่สำเร็จ (${res.status})`)
        return
      }

      setSuspended(next)
      if (next) {
        // Three outcomes, not two. `false` is the one that matters — the row is
        // written, the account is suspended for every new request, and their
        // overlay is still on air. `null` means this deployment has no realtime
        // service at all, where warning about stranded overlays would be a
        // sentence about something that cannot exist.
        setNote(
          body?.realtimeReachable === false
            ? 'ระงับแล้ว แต่ติดต่อ realtime ไม่ได้ — overlay ที่เปิดอยู่ยังรับ alert ต่อ'
            : body?.realtimeReachable === null
              ? 'ระงับแล้ว — หน้าโดเนทปิดทันที (เดพลอยนี้ยังไม่ได้ต่อ realtime)'
              : `ระงับแล้ว · ปิด overlay ${body?.closedSockets ?? 0} จอ`,
        )
      } else {
        setNote('ยกเลิกการระงับแล้ว')
      }
      router.refresh()
    } catch {
      setNote('เชื่อมต่อไม่ได้')
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
      <span
        aria-hidden
        className="grid size-9 shrink-0 place-items-center rounded-chip border border-line-strong bg-surface-2 font-display text-label font-bold text-muted"
      >
        {displayName.slice(0, 1)}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-label font-semibold text-ink">{displayName}</span>
          <span className={`rounded-chip border px-2 py-0.5 label-tech ${status.className}`}>
            {status.label}
          </span>
        </div>
        <p className="truncate font-mono text-micro text-faint">
          /{slug} · {email} ·{' '}
          <span className="text-money">฿{formatBaht(totalSatang).replace('.00', '')}</span>
        </p>
        {note && (
          <p role="status" className="mt-1 text-meta text-muted">
            {note}
          </p>
        )}
      </div>

      {/* Unsuspending is reversible by the same button and needs no confirm. */}
      {confirming ? (
        <span className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={toggle}
            className="rounded-control border border-danger/45 bg-danger/16 px-3 py-1.5 text-meta font-semibold text-danger transition-colors hover:bg-danger/24 disabled:cursor-not-allowed disabled:opacity-55"
          >
            {busy ? '…' : `ยืนยันระงับ ${displayName}`}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="text-meta text-muted underline underline-offset-4 hover:text-ink"
          >
            ยกเลิก
          </button>
        </span>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => (suspended ? void toggle() : setConfirming(true))}
          className={`shrink-0 rounded-control border px-3 py-1.5 text-meta font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-55 ${
            suspended
              ? 'border-line-strong bg-surface-2 text-ink hover:border-accent-text'
              : 'border-danger/45 bg-danger/10 text-danger hover:bg-danger/16'
          }`}
        >
          {busy ? '…' : suspended ? 'ยกเลิกระงับ' : 'ระงับบัญชี'}
        </button>
      )}
    </li>
  )
}
