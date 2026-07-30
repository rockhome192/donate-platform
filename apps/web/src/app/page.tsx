import Link from 'next/link'

/**
 * Landing. No numbers on this page are invented — DESIGN.md section 0 rules out
 * "5,000,000 THB raised" style filler, so what is here is what the thing does.
 */
export default function HomePage() {
  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-14">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <span className="font-display text-xl font-bold tracking-tight">DONATR</span>
        <div className="flex items-center gap-2">
          <Link
            href="/demo"
            className="rounded-xl border border-line2 px-4 py-2.5 text-sm font-medium text-ink hover:border-accent"
          >
            ดูหน้าโดเนท
          </Link>
          <Link
            href="/login"
            className="rounded-xl bg-accent px-4 py-2.5 text-sm font-bold text-white hover:bg-accent2"
          >
            เข้าสู่ระบบ
          </Link>
        </div>
      </header>

      <section className="grid animate-fade-up items-center gap-12 py-16 md:grid-cols-2">
        <div>
          <p className="inline-flex items-center gap-2 rounded-lg border border-line2 px-3 py-1.5 font-mono text-[11px] font-bold tracking-[0.14em] text-accent">
            <span className="inline-block size-1.5 animate-livedot rounded-full bg-accent" />
            REAL-TIME DONATION ALERTS
          </p>

          <h1 className="mt-6 font-display text-5xl leading-tight font-bold">
            เปลี่ยนกำลังใจ
            <br />
            ให้เป็น<span className="text-accent">โมเมนต์สด</span>
          </h1>

          <p className="mt-5 max-w-md leading-relaxed text-muted">
            สร้างหน้าโดเนทของคุณเอง แชร์ให้ผู้ชม แล้วดู alert เด้งขึ้นจอสตรีมทันทีที่มีคนส่งกำลังใจ
          </p>

          <div className="mt-7 flex flex-wrap gap-3">
            <Link
              href="/demo"
              className="rounded-xl bg-accent px-7 py-3.5 font-semibold text-white hover:bg-accent2"
            >
              ลองส่งโดเนท
            </Link>
            <Link
              href="/login"
              className="rounded-xl border border-line2 bg-panel px-6 py-3.5 font-semibold text-ink hover:border-accent"
            >
              เข้าสู่ระบบสตรีมเมอร์
            </Link>
          </div>

          <p className="mt-7 font-mono text-[11px] tracking-[0.1em] text-faint">
            OBS <span className="opacity-40">/</span> STREAMLABS <span className="opacity-40">/</span>{' '}
            PROMPTPAY
          </p>
        </div>

        <div className="rounded-2xl border border-line2 bg-overlay p-6">
          <div className="flex items-center justify-between font-mono text-[11px] tracking-[0.1em] text-faint">
            <span className="flex items-center gap-2">
              <span className="inline-block size-2 animate-livedot rounded-full bg-accent" />
              OBS · PREVIEW
            </span>
            <span className="rounded-md bg-accent px-2 py-0.5 font-bold text-white">LIVE</span>
          </div>

          <div className="mt-5 flex items-center gap-4 rounded-2xl bg-gradient-to-br from-money2 to-money px-5 py-4 text-money-ink">
            <span className="grid size-12 place-items-center rounded-xl bg-black/10 text-xl">🎉</span>
            <div className="min-w-0">
              <p className="font-semibold">
                มายด์ โดเนท <span className="font-numeric font-bold">฿150</span>
              </p>
              <p className="mt-0.5 truncate text-sm opacity-80">สู้ ๆ นะคะ ชอบสตรีมมาก 💜</p>
            </div>
          </div>

          <p className="mt-4 text-center text-xs text-faint">
            ตัวอย่างหน้าตา alert — ข้อมูลสมมติทั้งหมด
          </p>
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-panel p-6">
        <h2 className="font-display font-semibold">สถานะการพัฒนา</h2>
        <ul className="mt-3 space-y-1.5 text-sm text-muted">
          <li>
            <span className="font-mono text-money">M0</span> — monorepo, Prisma schema, NextAuth, seed
          </li>
          <li>
            <span className="font-mono text-money">M1</span> — หน้าโดเนท + MockProvider + dashboard
          </li>
          <li>
            <span className="font-mono text-faint">M3</span> — Omise test mode + webhook + idempotency
          </li>
          <li>
            <span className="font-mono text-faint">M2</span> — WebSocket server + OBS overlay
          </li>
        </ul>
      </section>
    </main>
  )
}
