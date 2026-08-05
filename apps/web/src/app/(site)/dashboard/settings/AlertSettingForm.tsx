'use client'

import { useState } from 'react'
import { SATANG_PER_BAHT, TEST_ALERT_SAMPLE, formatBaht, type AlertSettingPayload } from '@dp/shared'
import { ErrorNote, Panel, PanelHeader, TechLabel, buttonClass } from '@/components/ui'
import { renderAlertTemplate } from '@/lib/overlay/queue'

/**
 * Alert settings — DESIGN.md 4.2.
 *
 * Three fields, and only three, because those are the three the system
 * actually reads: `template` and `durationMs` in the overlay, `minAlertAmount`
 * in the webhook processor. AlertSetting also carries soundUrl, imageUrl,
 * ttsEnabled and profanityFilter, and none of them is consumed anywhere yet
 * (sound/image and TTS are Phase 2, DESIGN.md 2.2). Rendering a control for a
 * column nothing reads would be a switch that quietly does nothing — the sort
 * of thing a demo is judged on, and the sort of thing DESIGN.md 0 rules out.
 *
 * The preview is the real renderer (`renderAlertTemplate`, unit tested and
 * shared with the overlay) over the same sample the test-alert button fires,
 * so what is previewed here is what appears on stream.
 */

type Props = {
  initial: Pick<AlertSettingPayload, 'template' | 'durationMs' | 'minAlertAmount'>
}

const TEMPLATE_MAX = 120

/** Seconds in the UI, milliseconds on the wire. The schema bounds are 2-20s. */
const DURATION_MIN_S = 2
const DURATION_MAX_S = 20

export function AlertSettingForm({ initial }: Props) {
  const [template, setTemplate] = useState(initial.template)
  const [durationS, setDurationS] = useState(String(initial.durationMs / 1_000))
  const [minAlertBaht, setMinAlertBaht] = useState(String(initial.minAlertAmount / SATANG_PER_BAHT))

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const dirty =
    template !== initial.template ||
    Number(durationS) * 1_000 !== initial.durationMs ||
    Number(minAlertBaht) * SATANG_PER_BAHT !== initial.minAlertAmount

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setNotice(null)

    const durationMs = Math.round(Number(durationS) * 1_000)
    const minAlertAmount = Math.round(Number(minAlertBaht) * SATANG_PER_BAHT)

    // Rounded rather than validated to the satang, unlike a donation amount:
    // this is a display threshold, not money that moves, so half a satang of
    // slop costs nobody anything. The server still enforces the real bounds.
    if (!Number.isFinite(durationMs) || !Number.isFinite(minAlertAmount)) {
      setError('ตัวเลขไม่ถูกต้อง')
      return
    }

    setSaving(true)
    try {
      const res = await fetch('/api/me/alert-setting', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ template, durationMs, minAlertAmount }),
      })
      const body = (await res.json().catch(() => null)) as {
        overlayNotified?: boolean
        delivered?: number | null
        error?: string
        detail?: string
      } | null

      if (!res.ok) {
        setError(body?.detail ? `${body.error} — ${body.detail}` : (body?.error ?? `บันทึกไม่สำเร็จ (${res.status})`))
        return
      }

      // The save and the push to the overlay are separate outcomes and are
      // reported separately. Claiming "saved" when the overlay is still
      // rendering the old template is how a streamer ends up debugging OBS
      // over a problem that is not there.
      setNotice(
        body?.overlayNotified
          ? body.delivered
            ? `บันทึกแล้ว — overlay ที่เปิดอยู่ ${body.delivered} จออัปเดตทันที`
            : 'บันทึกแล้ว (ยังไม่มี overlay เปิดอยู่ — จะใช้ค่าใหม่ตอนเปิดครั้งหน้า)'
          : 'บันทึกแล้ว แต่แจ้ง overlay ไม่สำเร็จ — overlay ที่เปิดค้างอยู่จะยังใช้ค่าเดิมจนกว่าจะต่อใหม่',
      )
    } catch {
      setError('เชื่อมต่อไม่ได้')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Panel as="section">
      <PanelHeader label="alert settings" />
      <form onSubmit={save} className="space-y-5 p-4">
        <div>
          <label htmlFor="template" className="mb-1.5 block text-label text-muted">
            ข้อความ alert
          </label>
          <input
            id="template"
            type="text"
            required
            maxLength={TEMPLATE_MAX}
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            className="w-full rounded-control border border-line-strong bg-inset px-4 py-3 font-mono text-label text-ink"
          />
          <p className="mt-1.5 text-meta text-faint">
            ใช้ <code className="font-mono text-accent-text">{'{name}'}</code> แทนชื่อผู้โดเนท และ{' '}
            <code className="font-mono text-accent-text">{'{amount}'}</code> แทนจำนวนเงิน — คำอื่นใน
            ปีกกาจะแสดงตามที่พิมพ์
          </p>
        </div>

        <div>
          <TechLabel>preview</TechLabel>
          <div className="mt-1.5 rounded-control bg-gradient-to-br from-money-soft to-money px-4 py-3.5 text-money-ink">
            <p className="truncate font-display text-h3 font-bold">
              {renderAlertTemplate(template, TEST_ALERT_SAMPLE)}
            </p>
            <p className="truncate text-label opacity-85">{TEST_ALERT_SAMPLE.message}</p>
          </div>
          <p className="mt-1.5 text-meta text-faint">
            ตัวอย่างจากโดเนทสมมติ ฿{formatBaht(TEST_ALERT_SAMPLE.amount)} — ปุ่ม
            &ldquo;ทดสอบ alert&rdquo; ยิงรายการเดียวกันนี้ไปที่ OBS
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="duration" className="mb-1.5 block text-label text-muted">
              แสดงนานกี่วินาที
            </label>
            <input
              id="duration"
              type="number"
              required
              min={DURATION_MIN_S}
              max={DURATION_MAX_S}
              step={0.5}
              value={durationS}
              onChange={(e) => setDurationS(e.target.value)}
              className="w-full rounded-control border border-line-strong bg-inset px-4 py-3 font-numeric text-body tabular-nums text-ink"
            />
            <p className="mt-1.5 text-meta text-faint">
              {DURATION_MIN_S}–{DURATION_MAX_S} วินาที — ค่าใหม่จะเริ่มใช้กับ alert อันถัดไป
            </p>
          </div>

          <div>
            <label htmlFor="minAlert" className="mb-1.5 block text-label text-muted">
              ยอดขั้นต่ำที่จะเด้ง alert (บาท)
            </label>
            <input
              id="minAlert"
              type="number"
              required
              min={0}
              step={1}
              value={minAlertBaht}
              onChange={(e) => setMinAlertBaht(e.target.value)}
              className="w-full rounded-control border border-line-strong bg-inset px-4 py-3 font-numeric text-body tabular-nums text-ink"
            />
            <p className="mt-1.5 text-meta text-faint">
              ต่ำกว่านี้ยัง<span className="text-money">บันทึกเป็นรายได้ตามปกติ</span> แค่ไม่ขึ้นบนจอ
            </p>
          </div>
        </div>

        {error && <ErrorNote>{error}</ErrorNote>}
        {notice && (
          <p role="status" className="text-label text-muted">
            {notice}
          </p>
        )}

        <div className="flex items-center gap-3 border-t border-line pt-4">
          <button
            type="submit"
            disabled={saving || !dirty}
            className={buttonClass('primary', 'md')}
          >
            {saving ? 'กำลังบันทึก…' : 'บันทึก'}
          </button>
          {!dirty && !saving && <span className="text-meta text-faint">ยังไม่มีการแก้ไข</span>}
        </div>

        <p className="border-t border-line pt-4 text-meta text-faint">
          เสียง รูปภาพ และ TTS อยู่ใน Phase 2 — ยังไม่มีช่องให้ตั้งค่าที่นี่ เพราะระบบยังไม่ได้อ่านค่าพวกนั้น
        </p>
      </form>
    </Panel>
  )
}
