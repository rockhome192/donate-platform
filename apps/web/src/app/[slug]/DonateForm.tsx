'use client'

import { useEffect, useState } from 'react'
import { createDonationSchema, formatBaht, toBaht, toSatang } from '@dp/shared'

/**
 * Two screens in one component: the form, then the QR it turns into.
 *
 * The same Zod schema runs here and in the route handler — layer 1 of
 * DESIGN.md 7.1.1. Client-side it exists to give instant feedback, NOT to
 * protect anything: the server re-parses every field regardless, and the
 * per-streamer limits are only ever enforced there.
 */

type Props = {
  slug: string
  displayName: string
  /** satang */
  minAmount: number
  /** satang */
  maxAmount: number
}

type Created = {
  donationId: string
  qrImageUrl: string
  amount: number
  expiresAt: string
}

type PollStatus = 'PENDING' | 'PAID' | 'FAILED' | 'EXPIRED' | 'REFUNDED'

const PRESET_BAHT = [20, 50, 100, 300, 500]

export function DonateForm(props: Props) {
  const [created, setCreated] = useState<Created | null>(null)

  if (created) {
    return (
      <QrPanel
        created={created}
        displayName={props.displayName}
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
  onCreated,
}: Props & { onCreated: (c: Created) => void }) {
  const [amountText, setAmountText] = useState(String(toBaht(minAmount)))
  const [donorName, setDonorName] = useState('')
  const [message, setMessage] = useState('')
  const [honeypot, setHoneypot] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

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
    <form onSubmit={submit} className="mt-8 animate-fade-up space-y-5" noValidate>
      <fieldset className="rounded-2xl border border-line bg-panel p-5">
        <legend className="px-1 font-mono text-[11px] tracking-[0.14em] text-faint">จำนวนเงิน</legend>

        {presets.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-2">
            {presets.map((satang) => {
              const active = toSatangSafe(amountText) === satang
              return (
                <button
                  key={satang}
                  type="button"
                  onClick={() => setAmountText(String(toBaht(satang)))}
                  aria-pressed={active}
                  className={`rounded-lg border px-3.5 py-2 font-numeric text-sm font-semibold transition-colors ${
                    active
                      ? 'border-accent bg-accent text-white'
                      : 'border-line2 bg-panel2 text-muted hover:border-accent hover:text-ink'
                  }`}
                >
                  ฿{toBaht(satang).toLocaleString('th-TH')}
                </button>
              )
            })}
          </div>
        )}

        <label htmlFor="amount" className="sr-only">
          จำนวนเงิน (บาท)
        </label>
        <div className="flex items-center gap-3 rounded-xl border border-line2 bg-bg px-4 py-3 focus-within:border-accent">
          <span className="font-numeric text-xl text-money">฿</span>
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
            className="w-full bg-transparent font-numeric text-2xl font-bold text-ink outline-none"
          />
        </div>
      </fieldset>

      <div className="space-y-4 rounded-2xl border border-line bg-panel p-5">
        <div>
          <label htmlFor="donorName" className="mb-1.5 block text-sm text-muted">
            ชื่อของคุณ
          </label>
          <input
            id="donorName"
            name="donorName"
            maxLength={40}
            placeholder="ผู้ชมนิรนาม"
            value={donorName}
            onChange={(e) => setDonorName(e.target.value)}
            className="w-full rounded-xl border border-line2 bg-bg px-4 py-3 text-ink placeholder:text-faint focus:border-accent focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="message" className="mb-1.5 block text-sm text-muted">
            ข้อความ <span className="text-faint">(ไม่บังคับ)</span>
          </label>
          <textarea
            id="message"
            name="message"
            rows={3}
            maxLength={200}
            placeholder="ฝากข้อความถึงสตรีมเมอร์"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className="w-full resize-none rounded-xl border border-line2 bg-bg px-4 py-3 text-ink placeholder:text-faint focus:border-accent focus:outline-none"
          />
          <p className="mt-1 text-right font-mono text-[11px] text-faint">{message.length}/200</p>
        </div>

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
      </div>

      {error && (
        <p role="alert" className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-xl bg-accent px-6 py-4 font-display text-base font-bold text-white transition-colors hover:bg-accent2 disabled:opacity-60"
      >
        {submitting ? 'กำลังสร้าง QR…' : 'ส่งโดเนท'}
      </button>
    </form>
  )
}

function QrPanel({
  created,
  displayName,
  onRestart,
}: {
  created: Created
  displayName: string
  onRestart: () => void
}) {
  const [status, setStatus] = useState<PollStatus>('PENDING')
  const [secondsLeft, setSecondsLeft] = useState(() => secondsUntil(created.expiresAt))

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

  if (status === 'PAID') {
    return (
      <section className="mt-8 animate-fade-up rounded-2xl border border-money/50 bg-money/10 p-8 text-center">
        <p className="font-display text-xl font-bold text-money">ขอบคุณสำหรับกำลังใจ</p>
        <p className="mt-2 text-sm text-muted">
          ส่ง <span className="font-numeric font-semibold text-money">฿{formatBaht(created.amount)}</span>{' '}
          ให้ {displayName} เรียบร้อยแล้ว (จำลอง)
        </p>
        <button
          type="button"
          onClick={onRestart}
          className="mt-6 rounded-xl border border-line2 bg-panel px-5 py-3 text-sm font-semibold text-ink hover:border-accent"
        >
          ส่งอีกครั้ง
        </button>
      </section>
    )
  }

  if (status === 'EXPIRED' || status === 'FAILED' || secondsLeft <= 0) {
    return (
      <section className="mt-8 animate-fade-up rounded-2xl border border-line2 bg-panel p-8 text-center">
        <p className="font-display text-lg font-bold text-ink">
          {status === 'FAILED' ? 'การชำระเงินไม่สำเร็จ' : 'QR หมดอายุแล้ว'}
        </p>
        <p className="mt-2 text-sm text-muted">ไม่มีการตัดเงินเกิดขึ้น สร้างรายการใหม่ได้เลย</p>
        <button
          type="button"
          onClick={onRestart}
          className="mt-6 rounded-xl bg-accent px-5 py-3 text-sm font-bold text-white hover:bg-accent2"
        >
          เริ่มใหม่
        </button>
      </section>
    )
  }

  return (
    <section className="mt-8 animate-fade-up rounded-2xl border border-line bg-panel p-6 text-center">
      <p className="font-mono text-[11px] tracking-[0.14em] text-faint">SCAN TO PAY · DEMO</p>

      <div className="mx-auto mt-4 w-fit rounded-2xl bg-white p-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- data: URI from the mock provider; next/image cannot optimise it */}
        <img src={created.qrImageUrl} alt="QR สำหรับชำระเงิน (จำลอง)" width={240} height={240} />
      </div>

      <p className="mt-4 font-numeric text-3xl font-bold text-money">
        ฿{formatBaht(created.amount)}
      </p>

      <p className="mt-3 text-sm text-muted">
        QR นี้ <strong className="text-ink">สแกนไม่ได้จริง</strong> — โปรเจกต์นี้ไม่รับเงินจริง
      </p>

      <div className="mt-5 flex items-center justify-center gap-2 text-sm text-faint">
        <span className="inline-block size-1.5 animate-livedot rounded-full bg-accent" />
        รอการชำระเงิน · เหลือ{' '}
        <span className="font-numeric font-semibold text-ink">{formatCountdown(secondsLeft)}</span>
      </div>

      <button
        type="button"
        onClick={onRestart}
        className="mt-6 text-sm text-faint underline underline-offset-4 hover:text-accent"
      >
        ยกเลิก
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
