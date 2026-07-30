/**
 * Non-negotiable. This project talks about money, QR codes and payouts, and a
 * visitor must never be able to mistake it for something that takes real
 * payments. See DESIGN.md section 0.
 */
export function DemoBanner() {
  return (
    <div
      role="note"
      className="sticky top-0 z-50 flex flex-wrap items-center justify-center gap-2 border-b border-line bg-black px-4 py-2 text-center"
    >
      <span className="inline-block size-1.5 animate-livedot rounded-full bg-money" />
      <span className="font-mono text-[11px] font-bold tracking-[0.12em] text-money">DEMO MODE</span>
      <span className="text-xs text-faint">
        — ระบบสาธิต <strong className="font-semibold text-muted">ไม่รับเงินจริง</strong>{' '}
        QR และการชำระเงินทั้งหมดเป็นการจำลอง
      </span>
    </div>
  )
}
