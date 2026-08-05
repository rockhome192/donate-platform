'use client'

import { useEffect, useState } from 'react'
import { ErrorNote, Panel, PanelHeader, TechLabel, buttonClass } from '@/components/ui'

/**
 * The overlay source panel — DESIGN.md 4.2 steps 2-5.
 *
 * Every control here treats the overlay URL as what it is: a credential that
 * grants a live view of the streamer's donations to anyone holding it.
 *
 *  - **Hidden by default.** This page is opened on the same machine that is
 *    streaming, and quite often while capturing that screen. A settings page
 *    that renders the token in plain text is one alt-tab away from being the
 *    exact accident the rotate button exists to clean up. Copy works without
 *    revealing it.
 *  - **Rotate asks twice.** It kills every open overlay, and an unlucky click
 *    during a live stream should not be able to do that silently.
 *  - **Test alert reports the delivered count**, not just success. "0 sockets"
 *    is the answer to "why did nothing appear in OBS" and it is otherwise
 *    indistinguishable from a broken overlay.
 */

type Props = { initialToken: string }

export function OverlaySourcePanel({ initialToken }: Props) {
  const [token, setToken] = useState(initialToken)
  const [revealed, setRevealed] = useState(false)
  const [origin, setOrigin] = useState('')

  const [copied, setCopied] = useState(false)
  const [confirmingRotate, setConfirmingRotate] = useState(false)
  const [busy, setBusy] = useState<'rotate' | 'test' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  /**
   * Composed in the browser rather than from NEXT_PUBLIC_SITE_URL. The value a
   * streamer pastes into OBS has to work, and the origin they are looking at
   * is the one that certainly does — a misconfigured site URL would otherwise
   * hand out a copy button that produces a dead link, silently.
   *
   * After mount, because the server has no window and rendering the URL during
   * SSR would be a hydration mismatch.
   */
  useEffect(() => setOrigin(window.location.origin), [])

  const overlayUrl = origin ? `${origin}/overlay/${token}` : ''
  const masked = `${origin || '…'}/overlay/${'•'.repeat(12)}`

  async function copy() {
    if (!overlayUrl) return
    setError(null)
    try {
      await navigator.clipboard.writeText(overlayUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2_000)
    } catch {
      // Clipboard access can be refused outright (permissions, a non-secure
      // origin). Saying so beats a button that appears to do nothing — and
      // revealing the field gives them a way to select it by hand.
      setError('คัดลอกอัตโนมัติไม่ได้ กด "แสดง URL" แล้วคัดลอกเอง')
      setRevealed(true)
    }
  }

  async function rotate() {
    setBusy('rotate')
    setError(null)
    setNotice(null)
    setConfirmingRotate(false)
    try {
      const res = await fetch('/api/me/overlay/rotate', { method: 'POST' })
      const body = (await res.json().catch(() => null)) as {
        overlayToken?: string
        closedSockets?: number | null
        realtimeReachable?: boolean
        error?: string
      } | null

      if (!res.ok || !body?.overlayToken) {
        setError(body?.error ?? `เปลี่ยนโทเคนไม่สำเร็จ (${res.status})`)
        return
      }

      setToken(body.overlayToken)
      setRevealed(false)
      setNotice(
        body.realtimeReachable
          ? `เปลี่ยนโทเคนแล้ว — ปิด overlay เดิมไป ${body.closedSockets} จอ ต้องเอา URL ใหม่ไปใส่ OBS`
          : 'เปลี่ยนโทเคนแล้ว แต่ติดต่อเซิร์ฟเวอร์ realtime ไม่ได้ — overlay เดิมที่เปิดค้างอยู่อาจยังรับ alert ต่อจนกว่าเซิร์ฟเวอร์จะรีสตาร์ต',
      )
    } catch {
      setError('เชื่อมต่อไม่ได้')
    } finally {
      setBusy(null)
    }
  }

  async function testAlert() {
    setBusy('test')
    setError(null)
    setNotice(null)
    try {
      const res = await fetch('/api/me/test-alert', { method: 'POST' })
      const body = (await res.json().catch(() => null)) as {
        delivered?: number
        error?: string
      } | null

      if (!res.ok) {
        setError(body?.error ?? `ยิง alert ทดสอบไม่สำเร็จ (${res.status})`)
        return
      }
      setNotice(
        body?.delivered
          ? `ส่งไปที่ overlay แล้ว ${body.delivered} จอ`
          : 'ส่งสำเร็จ แต่ยังไม่มี overlay เปิดอยู่ — เปิด Browser Source ใน OBS ก่อนแล้วลองใหม่',
      )
    } catch {
      setError('เชื่อมต่อไม่ได้')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Panel>
      <PanelHeader label="overlay source" />
      <div className="space-y-4 p-4">
        <div>
          <TechLabel>browser source url</TechLabel>
          <p
            className="mt-1.5 rounded-control border border-line-strong bg-inset px-3.5 py-3 font-mono text-meta break-all text-ink"
            // Hidden from assistive tech while masked: the dots are decoration,
            // and reading them out is noise.
            aria-hidden={!revealed}
          >
            {revealed ? overlayUrl || '…' : masked}
          </p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <button type="button" onClick={copy} className={buttonClass('primary', 'sm')}>
              {copied ? 'คัดลอกแล้ว ✓' : 'คัดลอก URL'}
            </button>
            <button
              type="button"
              onClick={() => setRevealed((v) => !v)}
              className={buttonClass('secondary', 'sm')}
            >
              {revealed ? 'ซ่อน URL' : 'แสดง URL'}
            </button>
          </div>
        </div>

        <p className="rounded-control border border-danger/45 bg-danger/12 px-3.5 py-3 text-label text-ink">
          <span className="font-semibold text-danger">อย่าเปิด URL นี้ให้เห็นบนสตรีม</span> — ใครที่เห็น
          จะดูโดเนททั้งหมดของคุณแบบเรียลไทม์ได้ ถ้าหลุดออกไปแล้ว กด &ldquo;เปลี่ยนโทเคน&rdquo; ทันที
        </p>

        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <button
            type="button"
            onClick={testAlert}
            disabled={busy !== null}
            className={buttonClass('secondary', 'sm')}
          >
            {busy === 'test' ? 'กำลังส่ง…' : 'ทดสอบ alert'}
          </button>

          {confirmingRotate ? (
            <>
              <span className="text-label text-muted">แน่ใจไหม? overlay ที่เปิดอยู่จะถูกตัดทั้งหมด</span>
              <button
                type="button"
                onClick={rotate}
                disabled={busy !== null}
                className={buttonClass('primary', 'sm')}
              >
                ยืนยันเปลี่ยน
              </button>
              <button
                type="button"
                onClick={() => setConfirmingRotate(false)}
                className={buttonClass('quiet', 'sm')}
              >
                ยกเลิก
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingRotate(true)}
              disabled={busy !== null}
              className={buttonClass('secondary', 'sm')}
            >
              {busy === 'rotate' ? 'กำลังเปลี่ยน…' : 'เปลี่ยนโทเคน'}
            </button>
          )}
        </div>

        {notice && (
          <p role="status" className="text-label text-muted">
            {notice}
          </p>
        )}
        {error && <ErrorNote>{error}</ErrorNote>}
      </div>
    </Panel>
  )
}
