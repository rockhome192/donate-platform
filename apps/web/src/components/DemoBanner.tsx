/**
 * Non-negotiable. This project talks about money, QR codes and payouts, and a
 * visitor must never be able to mistake it for something that takes real
 * payments. See DESIGN.md section 0.
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
        ระบบสาธิต <strong className="font-semibold text-ink">ไม่รับเงินจริง</strong> —
        QR และการชำระเงินทั้งหมดเป็นการจำลอง
      </span>
    </div>
  )
}
