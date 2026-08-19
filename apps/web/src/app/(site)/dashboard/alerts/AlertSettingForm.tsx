'use client'

import { useRef, useState } from 'react'
import { TTS_MAX_CHARS } from '@/lib/tts/text'
import {
  DEFAULT_ALERT_SOUND,
  SATANG_PER_BAHT,
  TEST_ALERT_SAMPLE,
  formatBaht,
  type AlertSettingPayload,
} from '@dp/shared'
import { ErrorNote, Panel, PanelHeader, TechLabel, buttonClass } from '@/components/ui'
import { renderAlertTemplate } from '@/lib/overlay/queue'

/**
 * Alert settings — DESIGN.md 4.2.
 *
 * Every control here drives a column the system actually reads: `template` and
 * `durationMs` in the overlay, `minAlertAmount` in the webhook processor,
 * `soundUrl`/`soundVolume` in the overlay's audio, and `ttsEnabled` in the
 * settle path that synthesises the voice line. imageUrl and profanityFilter are
 * still unread (Phase 2, DESIGN.md 2.2) and still have no control — a switch
 * that quietly does nothing is the sort of thing a demo is judged on, and the
 * sort of thing DESIGN.md 0 rules out.
 *
 * The preview is the real renderer (`renderAlertTemplate`, unit tested and
 * shared with the overlay) over the same sample the test-alert button fires,
 * so what is previewed here is what appears on stream.
 */

type Props = {
  initial: Pick<
    AlertSettingPayload,
    'template' | 'durationMs' | 'minAlertAmount' | 'soundUrl' | 'soundVolume'
  > & { ttsEnabled: boolean }
  /**
   * Whether this deployment has a speech key and a bucket. Decided on the
   * server; without both, the switch is disabled rather than absent, because
   * "this build cannot do it" and "you have it turned off" are different
   * answers to the same question.
   */
  ttsAvailable: boolean
}

const TEMPLATE_MAX = 120

/** Seconds in the UI, milliseconds on the wire. The schema bounds are 2-20s. */
const DURATION_MIN_S = 2
const DURATION_MAX_S = 20

export function AlertSettingForm({ initial, ttsAvailable }: Props) {
  const [template, setTemplate] = useState(initial.template)
  const [durationS, setDurationS] = useState(String(initial.durationMs / 1_000))
  const [minAlertBaht, setMinAlertBaht] = useState(String(initial.minAlertAmount / SATANG_PER_BAHT))
  // null in the column is the whole of "off" — see alertSettingSchema. The
  // checkbox writes the bundled path back, so turning it off and on again is
  // not a way to lose a sound you chose.
  const [soundOn, setSoundOn] = useState(initial.soundUrl !== null)
  const [soundVolume, setSoundVolume] = useState(initial.soundVolume)
  const [ttsEnabled, setTtsEnabled] = useState(initial.ttsEnabled)
  const previewRef = useRef<HTMLAudioElement | null>(null)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const soundUrl = soundOn ? (initial.soundUrl ?? DEFAULT_ALERT_SOUND) : null

  const dirty =
    template !== initial.template ||
    Number(durationS) * 1_000 !== initial.durationMs ||
    Number(minAlertBaht) * SATANG_PER_BAHT !== initial.minAlertAmount ||
    soundUrl !== initial.soundUrl ||
    soundVolume !== initial.soundVolume ||
    ttsEnabled !== initial.ttsEnabled

  /**
   * Plays the sound at the volume currently on the slider, here in the
   * dashboard, so the streamer can set the level without going to OBS and
   * spending a real alert on it. A click is a user gesture, so autoplay policy
   * never enters into it on this page — unlike the overlay, which is why the
   * overlay leans on OBS having autoplay enabled in its browser source.
   */
  function preview() {
    const el = (previewRef.current ??= new Audio())
    el.src = soundUrl ?? DEFAULT_ALERT_SOUND
    el.volume = soundVolume / 100
    el.currentTime = 0
    void el.play().catch(() => setError('เบราว์เซอร์เล่นเสียงไม่ได้'))
  }

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
        body: JSON.stringify({
          template,
          durationMs,
          minAlertAmount,
          soundUrl,
          soundVolume,
          ttsEnabled,
        }),
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

        <div className="border-t border-line pt-5">
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={soundOn}
              onChange={(e) => setSoundOn(e.target.checked)}
              className="size-4 accent-accent"
            />
            <span className="text-label text-ink">เปิดเสียงตอน alert เด้ง</span>
          </label>

          <div className={soundOn ? 'mt-3' : 'mt-3 opacity-45'}>
            <label htmlFor="soundVolume" className="mb-1.5 block text-label text-muted">
              ระดับเสียง <span className="font-numeric tabular-nums text-ink">{soundVolume}%</span>
              <span className="ml-1 text-faint">(ใช้กับเสียงพูด TTS ด้วย)</span>
            </label>
            <div className="flex items-center gap-3">
              <input
                id="soundVolume"
                type="range"
                min={0}
                max={100}
                step={5}
                disabled={!soundOn}
                value={soundVolume}
                onChange={(e) => setSoundVolume(Number(e.target.value))}
                className="h-1.5 min-w-0 flex-1 accent-accent"
              />
              <button
                type="button"
                onClick={preview}
                disabled={!soundOn}
                className={buttonClass('secondary', 'sm')}
              >
                ลองฟัง
              </button>
            </div>
            <p className="mt-1.5 text-meta text-faint">
              เสียงจะดังจาก Browser Source ใน OBS — อย่าลืมติ๊ก{' '}
              <span className="text-muted">Control audio via OBS</span> ที่ตัว source
              ถ้าอยากคุมระดับเสียงในมิกเซอร์ของ OBS เอง
            </p>
          </div>
        </div>

        <div className="border-t border-line pt-5">
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={ttsEnabled && ttsAvailable}
              disabled={!ttsAvailable}
              onChange={(e) => setTtsEnabled(e.target.checked)}
              className="size-4 accent-accent"
            />
            <span className={`text-label ${ttsAvailable ? 'text-ink' : 'text-faint'}`}>
              อ่านข้อความโดเนทออกเสียง (TTS)
            </span>
          </label>
          <p className="mt-2 text-meta text-faint">
            {ttsAvailable ? (
              <>
                อ่านเฉพาะโดเนทที่<span className="text-muted">จ่ายสำเร็จแล้ว</span>และ
                <span className="text-muted">มีข้อความ</span> ยาวเกิน {TTS_MAX_CHARS} ตัวอักษรจะถูกตัด
                — เสียงพูดจะดังต่อจากเสียงเตือนโดยใช้ระดับเสียงด้านบน ถ้าตั้งไว้ 0% จะไม่สร้างเสียงพูดเลย
              </>
            ) : (
              <>ยังใช้ไม่ได้บนดีพลอยนี้ — ต้องตั้งค่า AZURE_SPEECH_KEY / AZURE_SPEECH_REGION และ bucket ก่อน</>
            )}
          </p>
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
          รูปภาพประกอบ alert อยู่ใน Phase 2 — ยังไม่มีช่องให้ตั้งค่าที่นี่ เพราะระบบยังไม่ได้อ่านค่านั้น
        </p>
      </form>
    </Panel>
  )
}
