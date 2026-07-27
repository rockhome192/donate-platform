export default function HomePage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-20">
      <p className="font-mono text-xs tracking-widest text-cyan-400">M0 · SCAFFOLD</p>
      <h1 className="mt-3 text-4xl font-bold">donate-platform</h1>
      <p className="mt-4 leading-relaxed text-neutral-300">
        ระบบรับโดเนทสำหรับสตรีมเมอร์ พร้อม alert เรียลไทม์บน OBS overlay
        สร้างเป็นโปรเจกต์สาธิต — การชำระเงินทั้งหมดเป็นการจำลอง ไม่มีเงินจริง
      </p>

      <div className="mt-10 rounded-lg border border-neutral-800 bg-neutral-900/50 p-5">
        <h2 className="text-sm font-semibold text-neutral-200">สถานะการพัฒนา</h2>
        <ul className="mt-3 space-y-1.5 text-sm text-neutral-400">
          <li>M0 — monorepo, Prisma schema, NextAuth, seed</li>
          <li>M1 — หน้าโดเนท + MockProvider + dashboard</li>
          <li>M3 — Omise test mode + webhook + idempotency</li>
          <li>M2 — WebSocket server + OBS overlay</li>
        </ul>
      </div>
    </main>
  )
}
