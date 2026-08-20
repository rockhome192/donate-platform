'use client'

import { useEffect, useState } from 'react'
import { bankName, createDonationSchema, formatBaht, toBaht, toSatang } from '@dp/shared'
import { ErrorNote, StatusTrack, TechLabel, buttonClass } from '@/components/ui'

/**
 * Three screens in one component: the form, the QR it turns into, and the
 * receipt.
 *
 * The same Zod schema runs here and in the route handler — layer 1 of
 * DESIGN.md 7.1.1. Client-side it exists to give instant feedback, NOT to
 * protect anything: the server re-parses every field regardless, and the
 * per-streamer limits are only ever enforced there.
 *
 * Laid out to the v2 design file: all three states live INSIDE the profile card
 * (see page.tsx), bare rather than in panels of their own, because the card is
 * already the frame. What the design leaves out and this keeps is the status
 * track — it takes the slot of the design's own "รอยืนยันการชำระเงินอัตโนมัติ…"
 * line and does the same job with more of the truth in it.
 *
 * One line of the design is gone outright: "🔒 ชำระผ่าน PromptPay ปลอดภัย ·
 * ไม่เก็บข้อมูลบัตร". Nothing is charged here, so a padlock and a security
 * claim would be the single most misleading sentence on the site.
 */

type Props = {
  slug: string
  displayName: string
  /** satang */
  minAmount: number
  /** satang */
  maxAmount: number
  /** DEMO_MODE=true on the server. Shows the simulated-payment button. */
  demoMode: boolean
  /**
   * The streamer's registered destination account, or null when they have not
   * set one. Null is what closes the slip path: DESIGN.md 7.3 layer 3 cannot
   * run without it, so offering the option would take a real transfer nobody
   * could ever verify.
   */
  slipAccount: SlipAccount | null
}

export type SlipAccount = {
  bankCode: string
  last4: string
  name: string
}

type Created =
  | {
      method: 'gateway'
      donationId: string
      qrImageUrl: string
      amount: number
      expiresAt: string
    }
  | {
      method: 'slip'
      donationId: string
      amount: number
      expiresAt: string
      bankAccount: SlipAccount
    }

type PollStatus = 'PENDING' | 'PAID' | 'FAILED' | 'EXPIRED' | 'REFUNDED'

const PRESET_BAHT = [20, 50, 100, 300, 500]
const TRACK = ['pending', 'paid', 'alerted'] as const

const FIELD =
  'w-full rounded-control border border-line-strong bg-inset px-4 py-3 text-body text-ink placeholder:text-faint'
const FIELD_LABEL = 'mb-1.5 block text-label font-semibold text-muted'

export function DonateForm(props: Props) {
  const [created, setCreated] = useState<Created | null>(null)

  if (created?.method === 'slip') {
    return (
      <SlipPanel
        created={created}
        displayName={props.displayName}
        onRestart={() => setCreated(null)}
      />
    )
  }
  if (created) {
    return (
      <QrPanel
        created={created}
        displayName={props.displayName}
        demoMode={props.demoMode}
        onRestart={() => setCreated(null)}
      />
    )
  }
  return <AmountForm {...props} onCreated={setCreated} />
}

function AmountForm({
  slug,
  displayName,
  minAmount,
  maxAmount,
  slipAccount,
  onCreated,
}: Props & { onCreated: (c: Created) => void }) {
  const [amountText, setAmountText] = useState(String(toBaht(minAmount)))
  const [donorName, setDonorName] = useState('')
  const [message, setMessage] = useState('')
  const [honeypot, setHoneypot] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [method, setMethod] = useState<'gateway' | 'slip'>('gateway')

  const presets = PRESET_BAHT.map((b) => b * 100).filter((s) => s >= minAmount && s <= maxAmount)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    let amount: number
    try {
      // toSatang throws on anything finer than a satang rather than rounding it
      // away — see packages/shared/src/money.ts
      amount = toSatang(Number(amountText))
    } catch {
      setError('จำนวนเงินไม่ถูกต้อง ใส่ทศนิยมได้ไม่เกิน 2 ตำแหน่ง')
      return
    }

    const parsed = createDonationSchema.safeParse({
      slug,
      donorName: donorName.trim() || 'ผู้ชมนิรนาม',
      message,
      amount,
      // A streamer can turn the slip path off between page load and submit, and
      // the route refuses it then — but never send a method the page was not
      // showing an option for.
      method: slipAccount ? method : 'gateway',
      website: honeypot,
    })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง')
      return
    }

    // Checked here purely so the viewer hears about it before a round trip. The
    // server checks again against the row it loads, which is the check that counts.
    if (amount < minAmount) {
      setError(`${displayName} รับโดเนทขั้นต่ำ ${formatBaht(minAmount)} บาท`)
      return
    }
    if (amount > maxAmount) {
      setError(`${displayName} รับโดเนทสูงสุด ${formatBaht(maxAmount)} บาท ต่อครั้ง`)
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch('/api/donations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(parsed.data),
      })
      const body = await res.json()

      if (!res.ok) {
        setError(body?.error ?? 'ส่งโดเนทไม่สำเร็จ กรุณาลองใหม่')
        return
      }
      onCreated(body as Created)
    } catch {
      setError('เชื่อมต่อไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={submit} className="animate-fade-up" noValidate>
      <p className="mb-4 font-display text-h3 font-bold">ส่งกำลังใจให้ {displayName}</p>

      <div className="mb-4">
        <label htmlFor="donorName" className={FIELD_LABEL}>
          ชื่อของคุณ
        </label>
        <input
          id="donorName"
          name="donorName"
          maxLength={40}
          placeholder="ผู้ชมนิรนาม"
          value={donorName}
          onChange={(e) => setDonorName(e.target.value)}
          className={FIELD}
        />
      </div>

      <div className="mb-4">
        <label htmlFor="message" className={`${FIELD_LABEL} flex items-baseline justify-between gap-2`}>
          <span>
            ข้อความ <span className="font-normal text-faint">(ไม่บังคับ)</span>
          </span>
          <span className="font-numeric text-meta tabular-nums text-faint">
            {message.length}/200
          </span>
        </label>
        <textarea
          id="message"
          name="message"
          rows={2}
          maxLength={200}
          placeholder="ฝากข้อความถึงสตรีมเมอร์…"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className={`${FIELD} resize-none`}
        />
      </div>

      <label htmlFor="amount" className={FIELD_LABEL}>
        จำนวนเงิน (บาท)
      </label>

      {/* Grid, not flex-wrap: five chips at 390px wrapped 4+1 and left ฿500
          orphaned on its own row. A fixed-column grid breaks evenly at any
          preset count the streamer's min/max leaves behind. */}
      {presets.length > 0 && (
        <div className="mb-2.5 grid grid-cols-3 gap-2 sm:grid-cols-5">
          {presets.map((satang) => {
            const active = toSatangSafe(amountText) === satang
            return (
              <button
                key={satang}
                type="button"
                onClick={() => setAmountText(String(toBaht(satang)))}
                aria-pressed={active}
                className={`rounded-chip border px-2 py-2.5 font-numeric text-label font-bold tabular-nums transition-colors ${
                  active
                    ? // Amber, not red. A chosen amount is money; an earlier
                      // build painted it with the brand action colour and broke
                      // the system's own role rule.
                      'border-money bg-money text-money-ink'
                    : 'border-line-strong bg-surface-2 text-muted hover:border-money hover:text-ink'
                }`}
              >
                ฿{toBaht(satang).toLocaleString('th-TH')}
              </button>
            )
          })}
        </div>
      )}

      <div className="flex items-center gap-3 rounded-control border border-line-strong bg-inset px-4 py-1">
        <span aria-hidden className="font-numeric text-h2 text-money">
          ฿
        </span>
        <input
          id="amount"
          name="amount"
          type="number"
          inputMode="decimal"
          step="0.01"
          min={toBaht(minAmount)}
          max={toBaht(maxAmount)}
          required
          value={amountText}
          onChange={(e) => setAmountText(e.target.value)}
          className="w-full bg-transparent py-2.5 font-numeric text-h1 font-bold tabular-nums text-ink outline-none"
        />
      </div>

      {/*
        The bounds belong here, beside the field they bind. They used to sit in
        the page footer, roughly a thousand pixels below the input — so the rule
        was only ever read after it had already been broken, in the error
        message. A limit you find out about by tripping over it is not a limit
        you were told.
      */}
      <p className="mt-2 label-tech text-faint">
        min ฿{formatBaht(minAmount)} · max ฿{formatBaht(maxAmount)}
      </p>

      {slipAccount && (
        <div className="mt-5">
          <span className={FIELD_LABEL}>วิธีชำระ</span>
          <div className="grid grid-cols-2 gap-2">
            <MethodChoice
              checked={method === 'gateway'}
              onSelect={() => setMethod('gateway')}
              title="QR พร้อมเพย์"
              detail="สแกนจ่าย ระบบรู้เองทันที"
            />
            <MethodChoice
              checked={method === 'slip'}
              onSelect={() => setMethod('slip')}
              title="โอนเอง + แนบสลิป"
              detail="โอนผ่านแอปธนาคาร แล้วอัปสลิป"
            />
          </div>
        </div>
      )}

      {/* Honeypot: off-screen rather than display:none, which some bots skip. */}
      <div aria-hidden className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="website">Website</label>
        <input
          id="website"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          value={honeypot}
          onChange={(e) => setHoneypot(e.target.value)}
        />
      </div>

      {error && (
        <div className="mt-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        className={buttonClass('primary', 'lg', 'mt-5 w-full')}
      >
        {submitting ? 'กำลังสร้าง QR…' : 'สร้าง QR PromptPay →'}
      </button>

      <p className="mt-3 text-center text-meta text-faint">
        โปรเจกต์สาธิต — QR สแกนไม่ได้จริง และไม่มีการตัดเงินใด ๆ
      </p>
    </form>
  )
}

function QrPanel({
  created,
  displayName,
  demoMode,
  onRestart,
}: {
  created: Extract<Created, { method: 'gateway' }>
  displayName: string
  demoMode: boolean
  onRestart: () => void
}) {
  const [status, setStatus] = useState<PollStatus>('PENDING')
  const [secondsLeft, setSecondsLeft] = useState(() => secondsUntil(created.expiresAt))
  const [simulating, setSimulating] = useState(false)
  const [demoError, setDemoError] = useState<string | null>(null)

  // Countdown is local; the server's expiresAt stays the authority on whether
  // the charge is actually dead.
  useEffect(() => {
    const tick = setInterval(() => setSecondsLeft(secondsUntil(created.expiresAt)), 1_000)
    return () => clearInterval(tick)
  }, [created.expiresAt])

  // Stop polling once the answer is final, and once the charge is past its
  // expiry — the server reports EXPIRED from then on and nothing will change.
  const stopped = status !== 'PENDING' || secondsLeft <= 0

  useEffect(() => {
    if (stopped) return

    let cancelled = false
    const poll = async () => {
      try {
        const res = await fetch(`/api/donations/${created.donationId}/status`, {
          cache: 'no-store',
        })
        if (!res.ok || cancelled) return
        const body = (await res.json()) as { status: PollStatus }
        if (!cancelled) setStatus(body.status)
      } catch {
        // Offline for a moment: the next tick tries again. Nothing to show the
        // viewer, who can see the QR either way.
      }
    }

    const timer = setInterval(poll, 3_000)
    void poll()
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [created.donationId, stopped])

  async function simulatePayment() {
    setSimulating(true)
    setDemoError(null)
    try {
      const res = await fetch('/api/demo/complete-donation', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ donationId: created.donationId }),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => null)
        setDemoError(body?.error ?? `จำลองไม่สำเร็จ (${res.status})`)
        return
      }
      // No optimistic PAID here. The status only flips once the webhook has
      // actually walked the pipeline, and the poll above is what reports it —
      // faking it in the UI would hide the very thing the demo is showing.
    } catch {
      setDemoError('เชื่อมต่อไม่ได้')
    } finally {
      setSimulating(false)
    }
  }

  const failed = status === 'EXPIRED' || status === 'FAILED' || secondsLeft <= 0

  if (status === 'PAID') {
    return (
      <section className="animate-fade-up text-center">
        <div
          aria-hidden
          className="mx-auto grid size-17 place-items-center rounded-full border border-money/40 bg-money/14 text-h1"
        >
          ✅
        </div>
        <h2 className="mt-4 font-display text-h2 font-bold">ขอบคุณสำหรับการโดเนท!</h2>
        <p className="mt-2 text-label text-muted">
          <span className="font-numeric font-bold tabular-nums text-money">
            ฿{formatBaht(created.amount)}
          </span>{' '}
          ถูกส่งถึง {displayName} แล้ว — เป็นการจำลอง ไม่มีเงินจริงเคลื่อนไหว
        </p>

        {/* The design says "🔔 alert กำลังเด้งบนหน้าจอสตรีม". This page cannot
            see that: whether the overlay actually displayed it is recorded in
            alertedAt on the streamer's side. So `alerted` stays unreached and
            the note says why. */}
        <div className="mt-5 rounded-control border border-line bg-surface-2 px-4 py-3.5 text-left">
          <StatusTrack steps={TRACK} currentIndex={1} />
          <p className="mt-2.5 text-micro text-faint">
            ขั้น alerted เกิดบนจอสตรีมเมอร์ — หน้านี้มองไม่เห็น จึงไม่แสดงว่าสำเร็จ
          </p>
        </div>

        <button
          type="button"
          onClick={onRestart}
          className={buttonClass('secondary', 'md', 'mt-5')}
        >
          โดเนทอีกครั้ง
        </button>
      </section>
    )
  }

  if (failed) {
    return (
      <section className="animate-fade-up text-center">
        <h2 className="font-display text-h2 font-bold">
          {status === 'FAILED' ? 'การชำระเงินไม่สำเร็จ' : 'QR หมดอายุแล้ว'}
        </h2>
        <p className="mt-2 text-label text-muted">ไม่มีการตัดเงินเกิดขึ้น สร้างรายการใหม่ได้เลย</p>

        <div className="mt-5 rounded-control border border-line bg-surface-2 px-4 py-3.5 text-left">
          <StatusTrack steps={TRACK} currentIndex={0} failed />
        </div>

        <button
          type="button"
          onClick={onRestart}
          className={buttonClass('primary', 'lg', 'mt-5 w-full')}
        >
          เริ่มใหม่
        </button>
      </section>
    )
  }

  return (
    <section className="animate-fade-up text-center">
      <span className="inline-flex items-center gap-2 rounded-chip border border-line-strong px-3 py-1.5">
        <TechLabel className="text-accent-text">scan to pay</TechLabel>
        <span className="text-meta text-muted">
          · หมดอายุใน{' '}
          <span className="font-numeric font-semibold tabular-nums text-ink">
            {formatCountdown(secondsLeft)}
          </span>
        </span>
      </span>

      <div className="mx-auto mt-4 w-fit max-w-full rounded-panel bg-white p-4">
        <p className="mb-3 font-mono text-meta font-bold tracking-wide text-[#0a4ea3]">
          THAI QR · PROMPTPAY
        </p>
        {/* eslint-disable-next-line @next/next/no-img-element -- data: URI from the mock provider; next/image cannot optimise it */}
        <img
          src={created.qrImageUrl}
          alt="QR สำหรับชำระเงิน (จำลอง)"
          width={190}
          height={190}
          className="mx-auto block size-[190px]"
        />
      </div>

      <p className="mt-4 text-label text-muted">
        ยอดชำระ{' '}
        <b className="font-numeric text-h1 font-bold tabular-nums text-money">
          ฿{formatBaht(created.amount)}
        </b>
      </p>
      <p className="mt-1 text-meta text-faint">
        QR นี้ <strong className="font-semibold text-ink">สแกนไม่ได้จริง</strong> —
        โปรเจกต์นี้ไม่รับเงินจริง
      </p>

      <div className="mt-4 rounded-control border border-line bg-surface-2 px-4 py-3.5 text-left">
        <StatusTrack steps={TRACK} currentIndex={0} />
      </div>

      {/*
        The interview button. It says "simulated" because that is what it is:
        Omise has no API to settle a test charge, so the demo posts a synthetic
        webhook signed with MOCK_WEBHOOK_SECRET through the real pipeline —
        signature check, idempotent insert, after(), retrieve, PAID.
        DESIGN.md 4.3 forbids labelling this "pay".
      */}
      {demoMode && (
        <div className="mt-4">
          <button
            type="button"
            disabled={simulating}
            onClick={simulatePayment}
            className="w-full rounded-control border border-dashed border-money bg-money/10 px-4 py-3 text-label font-semibold text-money transition-colors hover:bg-money/16 disabled:cursor-not-allowed disabled:opacity-55"
          >
            {simulating ? 'กำลังส่ง webhook จำลอง…' : '⚡ จำลองการจ่ายเงิน (simulated webhook)'}
          </button>
          <p className="mt-2 label-tech text-faint">demo mode · synthetic webhook</p>
          {demoError && (
            <div className="mt-3 text-left">
              <ErrorNote>{demoError}</ErrorNote>
            </div>
          )}
        </div>
      )}

      <button type="button" onClick={onRestart} className={buttonClass('quiet', 'sm', 'mt-4')}>
        ← แก้ไขจำนวนเงิน
      </button>
    </section>
  )
}

function toSatangSafe(baht: string): number | null {
  try {
    return toSatang(Number(baht))
  } catch {
    return null
  }
}

function secondsUntil(iso: string): number {
  return Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 1000))
}

function formatCountdown(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function MethodChoice({
  checked,
  onSelect,
  title,
  detail,
}: {
  checked: boolean
  onSelect: () => void
  title: string
  detail: string
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={checked}
      className={`rounded-control border px-3 py-2.5 text-left transition-colors ${
        checked ? 'border-accent bg-inset' : 'border-line-strong bg-surface hover:border-line'
      }`}
    >
      <span className="block text-label font-semibold text-ink">{title}</span>
      <span className="mt-0.5 block text-meta text-faint">{detail}</span>
    </button>
  )
}

/**
 * The slip flow: transfer by hand, then hand us the proof.
 *
 * Two things are said out loud here that the QR flow never has to say. The
 * amount must match to the satang, because layer 4 refuses anything else and
 * "close enough" is not a thing a bank slip can be. And the slip has to be
 * recent, because layer 5 refuses one older than fifteen minutes — a rule that
 * is invisible until it fires, and by then the donor has already paid.
 *
 * There is no polling here, unlike QrPanel. The verification IS the response:
 * by the time this request comes back the donation has either settled or been
 * refused, so there is nothing to wait for.
 */
function SlipPanel({
  created,
  displayName,
  onRestart,
}: {
  created: Extract<Created, { method: 'slip' }>
  displayName: string
  onRestart: () => void
}) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ alerted: boolean } | null>(null)

  async function sendSlip(file: File) {
    setError(null)
    setUploading(true)
    try {
      // Base64 in JSON rather than multipart. Both are accepted — checked
      // against the live API with a real key — and JSON keeps the route on the
      // same parse path as every other endpoint here.
      const base64 = await readAsBase64(file)
      const res = await fetch(`/api/donations/${created.donationId}/slip`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ imageBase64: base64 }),
      })
      const body = await res.json().catch(() => null)

      if (!res.ok) {
        setError(body?.error ?? `ตรวจสลิปไม่สำเร็จ (${res.status})`)
        return
      }
      setDone({ alerted: Boolean(body?.alerted) })
    } catch {
      setError('เชื่อมต่อไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่')
    } finally {
      setUploading(false)
    }
  }

  if (done) {
    return (
      <div className="animate-fade-up text-center">
        <p className="font-display text-h3 font-bold">ขอบคุณสำหรับการโดเนท!</p>
        <p className="mt-2 text-body text-muted">
          ตรวจสอบสลิปกับธนาคารเรียบร้อย — ส่ง{' '}
          <span className="font-numeric text-money">฿{formatBaht(created.amount)}</span> ให้{' '}
          {displayName} แล้ว
        </p>
        <p className="mt-2 text-meta text-faint">
          {done.alerted
            ? 'ข้อความของคุณกำลังขึ้นบนหน้าจอสตรีมเมอร์'
            : 'ยอดนี้ต่ำกว่าที่สตรีมเมอร์ตั้งให้ขึ้นแจ้งเตือน จึงไม่แสดงบนหน้าจอ'}
        </p>
        <button type="button" onClick={onRestart} className={`${buttonClass('quiet', 'md')} mt-5`}>
          โดเนทอีกครั้ง
        </button>
      </div>
    )
  }

  return (
    <div className="animate-fade-up">
      <p className="font-display text-h3 font-bold">โอนเงินแล้วแนบสลิป</p>

      <dl className="mt-4 space-y-2 rounded-panel border border-line bg-inset p-4">
        <Row label="ธนาคาร" value={bankName(created.bankAccount.bankCode)} />
        <Row label="ชื่อบัญชี" value={created.bankAccount.name} />
        <Row label="เลขบัญชี" value={`xxx-x-x${created.bankAccount.last4}-x`} numeric />
        <Row label="ยอดที่ต้องโอน" value={`฿${formatBaht(created.amount)}`} numeric />
      </dl>

      <p className="mt-3 text-meta text-faint">
        ยอดต้อง<span className="text-muted">ตรงทุกสตางค์</span> และต้องแนบสลิป
        <span className="text-muted">ภายใน 15 นาที</span>หลังโอน มิฉะนั้นระบบจะไม่รับ
      </p>

      <label className={`${buttonClass('primary', 'md', 'w-full')} mt-5 cursor-pointer`}>
        {uploading ? 'กำลังตรวจสลิป…' : 'เลือกรูปสลิป'}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          disabled={uploading}
          onChange={(e) => {
            const file = e.target.files?.[0]
            // Cleared straight away so picking the SAME file again still fires
            // a change event — otherwise a rejected slip cannot be retried
            // without choosing something else first.
            e.target.value = ''
            if (file) void sendSlip(file)
          }}
        />
      </label>

      {error && (
        <div className="mt-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      <button type="button" onClick={onRestart} className={`${buttonClass('quiet', 'md')} mt-4`}>
        ยกเลิก
      </button>
    </div>
  )
}

function Row({ label, value, numeric }: { label: string; value: string; numeric?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-label text-faint">{label}</dt>
      <dd className={`text-body text-ink ${numeric ? 'font-numeric tabular-nums' : ''}`}>{value}</dd>
    </div>
  )
}

/** The `data:` prefix is ours, not the API's — SlipOK wants the payload alone. */
function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('could not read file'))
    reader.onload = () => {
      const result = String(reader.result)
      const comma = result.indexOf(',')
      resolve(comma === -1 ? result : result.slice(comma + 1))
    }
    reader.readAsDataURL(file)
  })
}
