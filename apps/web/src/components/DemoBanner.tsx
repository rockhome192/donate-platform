import { env } from '@/lib/env'

/**
 * Non-negotiable. This project talks about money, QR codes and payouts, and a
 * visitor must never be able to mistake one path here for the other.
 *
 * It used to say one thing — "ไม่รับเงินจริง" — and that stopped being true the
 * day SLIP_DONATIONS_ENABLED was turned on: the slip path prints the STREAMER's
 * own PromptPay QR, so a viewer who takes it moves real baht into a real
 * account. What stayed true is the part that matters legally and morally: this
 * platform never holds the money and never pays anybody out.
 *
 * So the sentence follows the flag rather than being written once and hoped
 * over. A deployment with slips off really does take no money at all and
 * should say so; one with them on must not. Both wordings are lies on the
 * other deployment, which is the whole reason this reads env instead of
 * hardcoding either. See DESIGN.md section 0.
 *
 * Amber, because this banner is about money — the same role the amounts wear.
 * It is the one piece of chrome allowed to sit above everything else, and it
 * never scrolls away.
 */
export function DemoBanner() {
  return (
    <div
      role="note"
      className="sticky top-0 z-50 flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 border-b border-money/25 bg-money/10 px-4 py-2 text-center backdrop-blur"
    >
      <span aria-hidden className="inline-block size-1.5 shrink-0 rounded-full bg-money" />
      <span className="label-tech text-money">demo mode</span>
      <span className="text-meta text-muted">
        {env.slipDonationsEnabled ? (
          <>
            การชำระผ่าน gateway <strong className="font-semibold text-ink">เป็นการจำลอง</strong> ·
            โอนเอง + แนบสลิป เป็น<strong className="font-semibold text-ink">เงินจริง</strong>
            เข้าบัญชีสตรีมเมอร์โดยตรง — แพลตฟอร์มไม่ถือเงินและไม่จ่ายเงินออก
          </>
        ) : (
          <>
            ระบบสาธิต <strong className="font-semibold text-ink">ไม่รับเงินจริง</strong> —
            QR และการชำระเงินทั้งหมดเป็นการจำลอง
          </>
        )}
      </span>
    </div>
  )
}
