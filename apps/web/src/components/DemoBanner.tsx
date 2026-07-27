/**
 * Non-negotiable. This project talks about money, QR codes and payouts, and a
 * visitor must never be able to mistake it for something that takes real
 * payments. See DESIGN.md section 0.
 */
export function DemoBanner() {
  return (
    <div
      role="note"
      className="sticky top-0 z-50 bg-amber-400 px-4 py-2 text-center text-sm font-medium text-amber-950"
    >
      โปรเจกต์สาธิต (sandbox) — <strong>ไม่รับเงินจริง</strong> QR
      และการชำระเงินทั้งหมดเป็นการจำลอง
    </div>
  )
}
