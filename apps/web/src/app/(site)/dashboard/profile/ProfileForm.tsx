'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { SATANG_PER_BAHT, THAI_BANKS, formatBaht, profileSchema } from '@dp/shared'
import { ErrorNote, Panel, PanelHeader, TechLabel, buttonClass } from '@/components/ui'

/**
 * The streamer's public identity, with the design's live preview beside it.
 *
 * The preview is not a mockup — it is the same composition the real donate page
 * renders (banner, avatar breaking the edge, name, /slug, bio, bounds), driven
 * by the form's own state. That is the point of it: the fields here are the only
 * ones on the site whose effect is invisible from the screen you edit them on.
 *
 * SLUG CHANGES BREAK LINKS, and the form says so before the save rather than
 * after. There is no redirect from an old slug — the row simply answers a new
 * URL and the old one 404s — so a streamer with the link in a video description
 * needs to know that in advance.
 */

export type ProfileInitial = {
  slug: string
  displayName: string
  bio: string | null
  avatarUrl: string | null
  /** satang */
  minAmount: number
  /** satang */
  maxAmount: number
  bankCode: string | null
  bankAccountLast4: string | null
  bankAccountName: string | null
  promptPayId: string | null
}

type Props = {
  initial: ProfileInitial
  /** Whether the deployment has object storage configured. Read on the server. */
  uploadsEnabled: boolean
}

const BIO_MAX = 300

const FIELD =
  'w-full rounded-control border border-line-strong bg-inset px-4 py-3 text-body text-ink placeholder:text-faint'
const LABEL = 'mb-1.5 block text-label font-semibold text-muted'

export function ProfileForm({ initial, uploadsEnabled }: Props) {
  const router = useRouter()
  const fileInput = useRef<HTMLInputElement>(null)

  const [displayName, setDisplayName] = useState(initial.displayName)
  const [slug, setSlug] = useState(initial.slug)
  const [bio, setBio] = useState(initial.bio ?? '')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(initial.avatarUrl)
  const [minBaht, setMinBaht] = useState(String(initial.minAmount / SATANG_PER_BAHT))
  const [maxBaht, setMaxBaht] = useState(String(initial.maxAmount / SATANG_PER_BAHT))
  const [bankCode, setBankCode] = useState(initial.bankCode ?? '')
  const [bankLast4, setBankLast4] = useState(initial.bankAccountLast4 ?? '')
  const [bankName, setBankName] = useState(initial.bankAccountName ?? '')
  const [ppId, setPpId] = useState(initial.promptPayId ?? '')

  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const minAmount = Math.round(Number(minBaht) * SATANG_PER_BAHT)
  const maxAmount = Math.round(Number(maxBaht) * SATANG_PER_BAHT)

  const dirty =
    displayName !== initial.displayName ||
    slug !== initial.slug ||
    bio !== (initial.bio ?? '') ||
    avatarUrl !== initial.avatarUrl ||
    minAmount !== initial.minAmount ||
    maxAmount !== initial.maxAmount ||
    bankCode !== (initial.bankCode ?? '') ||
    bankLast4 !== (initial.bankAccountLast4 ?? '') ||
    bankName !== (initial.bankAccountName ?? '') ||
    ppId !== (initial.promptPayId ?? '')

  async function pickAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    // Reset immediately, so choosing the SAME file again still fires a change
    // event — otherwise a failed upload cannot be retried without picking
    // something else first.
    e.target.value = ''
    if (!file) return

    setError(null)
    setNotice(null)
    setUploading(true)
    try {
      const ticket = await fetch('/api/me/avatar/upload-url', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contentType: file.type, size: file.size }),
      })
      const ticketBody = await ticket.json().catch(() => null)
      if (!ticket.ok) {
        setError(ticketBody?.error ?? `ขอลิงก์อัปโหลดไม่สำเร็จ (${ticket.status})`)
        return
      }

      // Straight to storage, not through this app: a Vercel function has a body
      // limit and a 60s ceiling, and proxying the bytes would spend both on
      // something the browser can do itself.
      //
      // The headers come from the TICKET, never from the file. The server
      // normalises the content type before signing it (`image/jpeg; charset=…`
      // and any uppercase from a non-Chromium File.type both collapse), so
      // sending `file.type` here would send a string that differs from the one
      // inside the signature and R2 answers 403 SignatureDoesNotMatch.
      const put = await fetch(ticketBody.uploadUrl, {
        method: 'PUT',
        headers: ticketBody.headers,
        body: file,
      })
      if (!put.ok) {
        setError(`อัปโหลดไม่สำเร็จ (${put.status})`)
        return
      }

      setAvatarUrl(ticketBody.publicUrl)
      setNotice('อัปโหลดรูปแล้ว — กด "บันทึก" เพื่อใช้รูปนี้')
    } catch {
      setError('อัปโหลดไม่สำเร็จ — เชื่อมต่อไม่ได้')
    } finally {
      setUploading(false)
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setNotice(null)

    const nextBio = bio.trim() === '' ? null : bio

    /**
     * Only what actually changed.
     *
     * Sending the whole object every time looks harmless and is not: the route
     * refuses an avatarUrl that is not on this deployment's storage host, so a
     * streamer who has an avatar from a previous R2_PUBLIC_BASE_URL — or whose
     * deployment has since dropped R2 entirely, which is a supported state —
     * would have every save rejected over a field they never touched, with the
     * only remedy being to delete their picture. The route is `.partial()` for
     * exactly this.
     */
    const patch = {
      ...(displayName !== initial.displayName && { displayName }),
      ...(slug !== initial.slug && { slug }),
      ...(nextBio !== initial.bio && { bio: nextBio }),
      ...(avatarUrl !== initial.avatarUrl && { avatarUrl }),
      ...(minAmount !== initial.minAmount && { minAmount }),
      ...(maxAmount !== initial.maxAmount && { maxAmount }),
      // Empty means "no account", which is a real state the column has to be
      // able to return to — hence null rather than dropping the key.
      ...(bankCode !== (initial.bankCode ?? '') && { bankCode: bankCode || null }),
      ...(bankLast4 !== (initial.bankAccountLast4 ?? '') && {
        bankAccountLast4: bankLast4 || null,
      }),
      ...(bankName !== (initial.bankAccountName ?? '') && {
        bankAccountName: bankName || null,
      }),
      ...(ppId !== (initial.promptPayId ?? '') && { promptPayId: ppId || null }),
    }

    const parsed = profileSchema.partial().safeParse(patch)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง')
      return
    }
    if (minAmount > maxAmount) {
      setError('ยอดขั้นต่ำต้องไม่มากกว่ายอดสูงสุด')
      return
    }
    // Mirrors the route's rule so the answer arrives without a round trip. The
    // route still enforces it — this is convenience, not the check.
    const bankFilled = [bankCode, bankLast4, bankName, ppId].filter((v) => v !== '').length
    if (bankFilled !== 0 && bankFilled !== 4) {
      setError('กรอกข้อมูลรับโอนให้ครบทุกช่อง หรือเว้นว่างทั้งหมด')
      return
    }

    setSaving(true)
    try {
      const res = await fetch('/api/me/profile', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(parsed.data),
      })
      const body = await res.json().catch(() => null)

      if (!res.ok) {
        setError(body?.error ?? `บันทึกไม่สำเร็จ (${res.status})`)
        return
      }

      setNotice(
        parsed.data.slug
          ? `บันทึกแล้ว — ลิงก์ใหม่คือ /${parsed.data.slug} ลิงก์เดิมใช้ไม่ได้อีกต่อไป`
          : 'บันทึกแล้ว',
      )
      // The nav and the donate link in the shell are server-rendered from this
      // row, so they stay on the old name until the tree re-renders.
      router.refresh()
    } catch {
      setError('เชื่อมต่อไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={save} className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]" noValidate>
      <Panel>
        <PanelHeader label="identity" />
        <div className="space-y-4 p-4 sm:p-5">
          <div>
            <span className={LABEL}>รูปโปรไฟล์</span>
            <div className="flex items-center gap-4">
              <Avatar url={avatarUrl} displayName={displayName} className="size-16 text-h2" />
              <div className="min-w-0 space-y-1.5">
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={pickAvatar}
                  className="hidden"
                />
                <button
                  type="button"
                  disabled={!uploadsEnabled || uploading}
                  onClick={() => fileInput.current?.click()}
                  className={buttonClass('secondary', 'sm')}
                >
                  {uploading ? 'กำลังอัปโหลด…' : '📁 อัปโหลดรูป'}
                </button>
                {avatarUrl && (
                  <button
                    type="button"
                    onClick={() => setAvatarUrl(null)}
                    className="block text-meta text-danger underline underline-offset-4"
                  >
                    ลบรูป — กลับไปใช้ตัวอักษรแรกของชื่อ
                  </button>
                )}
                <p className="text-meta text-faint">
                  {uploadsEnabled
                    ? 'PNG / JPEG / WebP ไม่เกิน 2 MB'
                    : 'เดพลอยนี้ยังไม่ได้ตั้งค่าที่เก็บไฟล์ จึงอัปโหลดรูปไม่ได้'}
                </p>
              </div>
            </div>
          </div>

          <div>
            <label htmlFor="displayName" className={LABEL}>
              ชื่อที่แสดง
            </label>
            <input
              id="displayName"
              maxLength={40}
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className={FIELD}
            />
          </div>

          <div>
            <label htmlFor="slug" className={LABEL}>
              ลิงก์หน้าโดเนท
            </label>
            <div className="flex items-center overflow-hidden rounded-control border border-line-strong bg-inset">
              <span className="shrink-0 pl-4 font-mono text-label text-faint">/</span>
              <input
                id="slug"
                required
                maxLength={30}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase())}
                className="w-full bg-transparent py-3 pr-4 pl-1 font-mono text-body text-ink outline-none"
              />
            </div>
            {slug !== initial.slug && (
              <p className="mt-1.5 text-meta text-danger">
                เปลี่ยนลิงก์แล้ว ลิงก์เดิม /{initial.slug} จะใช้ไม่ได้อีก — ระบบไม่ redirect ให้
              </p>
            )}
          </div>

          <div>
            <label htmlFor="bio" className={`${LABEL} flex items-baseline justify-between gap-2`}>
              <span>แนะนำตัว</span>
              <span className="font-numeric text-meta tabular-nums text-faint">
                {bio.length}/{BIO_MAX}
              </span>
            </label>
            <textarea
              id="bio"
              rows={3}
              maxLength={BIO_MAX}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="ผู้ชมจะเห็นข้อความนี้บนหน้าโดเนทของคุณ"
              className={`${FIELD} resize-none`}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="minAmount" className={LABEL}>
                โดเนทขั้นต่ำ (฿)
              </label>
              <input
                id="minAmount"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="1"
                required
                value={minBaht}
                onChange={(e) => setMinBaht(e.target.value)}
                className={`${FIELD} font-numeric tabular-nums`}
              />
            </div>
            <div>
              <label htmlFor="maxAmount" className={LABEL}>
                สูงสุดต่อครั้ง (฿)
              </label>
              <input
                id="maxAmount"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="1"
                required
                value={maxBaht}
                onChange={(e) => setMaxBaht(e.target.value)}
                className={`${FIELD} font-numeric tabular-nums`}
              />
            </div>
          </div>

          <div className="border-t border-line pt-4">
            <span className={LABEL}>รับโอนพร้อมสลิป</span>
            <p className="mb-3 text-meta text-faint">
              เว้นว่างทั้งหมด = ปิดรับ หน้าโดเนทจะเหลือแค่ QR จำลอง
              <br />
              <span className="text-muted">พร้อมเพย์</span> คือปลายทางที่ QR
              บนหน้าโดเนทจะพาไป ส่วน <span className="text-muted">ธนาคาร + 4 ตัวท้าย</span>{' '}
              คือสิ่งที่ระบบเอาไปเทียบกับสลิป — ต้องเป็นบัญชีเดียวกัน
            </p>
            <div className="mb-3">
              <label htmlFor="promptPayId" className={LABEL}>
                เบอร์พร้อมเพย์
              </label>
              <input
                id="promptPayId"
                inputMode="numeric"
                maxLength={10}
                placeholder="0812345678"
                value={ppId}
                onChange={(e) => setPpId(e.target.value.replace(/\D/g, '').slice(0, 10))}
                className={`${FIELD} font-numeric tabular-nums`}
              />
              {/*
                Said plainly, at the field, before it is typed. A PromptPay QR
                has to carry this number in the clear or a bank cannot read it,
                and one unauthenticated request to /api/donations returns that
                QR — so this is public the moment it is saved.
              */}
              <p className="mt-1.5 text-meta text-faint">
                เบอร์นี้จะ<span className="text-muted">อ่านได้จาก QR บนหน้าโดเนท</span>{' '}
                ใครสแกนก็เห็น — เป็นข้อจำกัดของพร้อมเพย์เอง ไม่ใช่ของเว็บนี้
                <br />
                รองรับเฉพาะเบอร์มือถือ ไม่รับเลขบัตรประชาชน
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label htmlFor="bankCode" className={LABEL}>
                  ธนาคาร
                </label>
                <select
                  id="bankCode"
                  value={bankCode}
                  onChange={(e) => setBankCode(e.target.value)}
                  className={FIELD}
                >
                  <option value="">— ไม่ระบุ —</option>
                  {THAI_BANKS.map((b) => (
                    <option key={b.code} value={b.code}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="bankAccountLast4" className={LABEL}>
                  เลขบัญชี 4 ตัวท้าย
                </label>
                <input
                  id="bankAccountLast4"
                  inputMode="numeric"
                  maxLength={4}
                  placeholder="7788"
                  value={bankLast4}
                  onChange={(e) => setBankLast4(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  className={`${FIELD} font-numeric tabular-nums`}
                />
              </div>
              <div>
                <label htmlFor="bankAccountName" className={LABEL}>
                  ชื่อบัญชี
                </label>
                <input
                  id="bankAccountName"
                  maxLength={120}
                  placeholder="ชื่อที่ปรากฏในแอปธนาคาร"
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                  className={FIELD}
                />
              </div>
            </div>
          </div>

          {error && <ErrorNote>{error}</ErrorNote>}
          {notice && (
            <p role="status" className="text-label text-money">
              {notice}
            </p>
          )}

          <button
            type="submit"
            disabled={saving || !dirty}
            className={buttonClass('primary', 'md', 'w-full')}
          >
            {saving ? 'กำลังบันทึก…' : dirty ? 'บันทึก' : 'บันทึกแล้ว'}
          </button>
        </div>
      </Panel>

      {/* ------------------------------------------------------------ preview */}
      <div>
        <TechLabel>preview — หน้าโดเนทของคุณ</TechLabel>
        <div className="mt-2 overflow-hidden rounded-panel border border-line bg-surface">
          <div className="h-18 bg-[linear-gradient(120deg,var(--color-accent),#a01d38_70%,#4a1220)]" />
          <div className="relative px-4 pb-4">
            <div className="flex items-end gap-3">
              <Avatar
                url={avatarUrl}
                displayName={displayName}
                className="-mt-7 size-15 border-3 border-surface text-h3"
              />
              <div className="min-w-0 pb-0.5">
                <p className="truncate font-display text-h3 font-bold">{displayName || '—'}</p>
                <p className="truncate font-mono text-meta text-faint">/{slug}</p>
              </div>
            </div>
            {bio.trim() && <p className="mt-3 text-meta leading-relaxed text-muted">{bio}</p>}
            <p className="mt-3 label-tech text-faint">
              min ฿{formatBaht(Number.isFinite(minAmount) ? minAmount : 0)} · max ฿
              {formatBaht(Number.isFinite(maxAmount) ? maxAmount : 0)}
            </p>
          </div>
        </div>

        {/* Points at the SAVED slug, not the field: until the save lands, the
            typed one is a 404. */}
        <a
          href={`/${initial.slug}`}
          target="_blank"
          rel="noreferrer"
          className={buttonClass('secondary', 'md', 'mt-3 w-full')}
        >
          เปิดหน้าโดเนทจริง →
        </a>
      </div>
    </form>
  )
}

function Avatar({
  url,
  displayName,
  className = '',
}: {
  url: string | null
  displayName: string
  className?: string
}) {
  return (
    <span
      className={`grid shrink-0 place-items-center overflow-hidden rounded-panel bg-surface-2 font-display font-bold text-muted ${className}`}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- arbitrary storage URL; next/image would need a remote allowlist per host
        <img src={url} alt="" className="size-full object-cover" />
      ) : (
        (displayName.slice(0, 1) || '?')
      )}
    </span>
  )
}
