import Link from 'next/link'
import { env } from '@/lib/env'
import { OverlayStage } from '@/components/OverlayStage'
import { Panel, PanelHeader, TechLabel, buttonClass } from '@/components/ui'

/**
 * Landing, as a console.
 *
 * The old version led with a marketing headline and gave the bottom half of the
 * fold to a milestone checklist — a dev to-do list shown to viewers. What the
 * product actually is, an alert arriving on a stream, sat in a small card in
 * the corner. That is inverted here: the alert leads, and the milestone list is
 * replaced by real configuration read off this deployment.
 *
 * Nothing on this page is invented. The alert is labelled as a sample, and the
 * status strip reports env values rather than fictional telemetry — there is no
 * WebSocket to measure yet (M2a), and printing "12ms" before one exists is
 * exactly the kind of filler DESIGN.md section 0 rules out.
 */

export const dynamic = 'force-dynamic'

/**
 * The v2 mockup opens this list with "สร้างบัญชีฟรี — สมัครแล้วได้ลิงก์ทันที".
 * There is no signup yet, so that step is written for what a visitor can
 * actually do today. It gets its real wording the day registration ships, and
 * not a moment before: a landing page that promises a button the product does
 * not have is the same defect as an invented statistic.
 */
const STEPS = [
  {
    no: '01',
    title: 'เข้าสู่ระบบ',
    body: 'ตอนนี้เปิดให้ลองด้วยบัญชีเดโม่ กดปุ่มกรอกอัตโนมัติในหน้าล็อกอินได้เลย',
  },
  {
    no: '02',
    title: 'วาง overlay ใน OBS',
    body: 'คัดลอก URL จากหน้า Overlay ไปวางเป็น Browser Source เสร็จในนาทีเดียว',
  },
  {
    no: '03',
    title: 'แชร์ลิงก์ให้ผู้ชม',
    body: 'ผู้ชมเปิดหน้าโดเนทของคุณ ส่งกำลังใจ แล้ว alert เด้งขึ้นจอสตรีมทันที',
  },
] as const

/**
 * Rows are labelled with the env var they read, and the value is the literal
 * state of that var — nothing is summarised into a word like "connected".
 *
 * That precision is the whole point. A first draft rendered
 * "Realtime service: configured" because REALTIME_HTTP_URL happens to be set,
 * which reads as "real-time works" when the service does not exist yet (M2a).
 * Reporting the variable cannot mislead: it says exactly what it knows.
 */
function systemFacts() {
  return {
    provider: env.paymentProvider === 'omise' ? 'omise test' : 'mock',
    demo: env.isDemoMode,
    // Read raw, NOT through env.realtimeHttpUrl — that getter throws when the
    // var is unset, and "unset" is precisely the case being reported.
    realtimeUrlSet: Boolean(process.env.REALTIME_HTTP_URL),
  }
}

export default function HomePage() {
  const sys = systemFacts()

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-5 py-8 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <span className="font-display text-h3 font-bold tracking-tight">DONATR</span>
        <nav className="flex items-center gap-2">
          <Link href="/demo" className={buttonClass('secondary', 'sm')}>
            ดูหน้าโดเนท
          </Link>
          <Link href="/login" className={buttonClass('primary', 'sm')}>
            เข้าสู่ระบบ
          </Link>
        </nav>
      </header>

      <main className="animate-fade-up">
        {/* Headline first, stage second. The stage used to lead, which put a
            large empty checkerboard above the fold for the seconds before the
            sample alert plays — the strongest thing on the page arriving after
            a visitor had already decided nothing was happening. */}
        <section className="mt-10 grid gap-8 md:grid-cols-[1.1fr_0.9fr] md:items-center">
          <div>
            <h1 className="font-display text-display font-bold">
              เปลี่ยนกำลังใจ
              <br />
              ให้เป็น<span className="text-accent-text">โมเมนต์สด</span>
            </h1>
            <p className="mt-4 max-w-md text-body text-muted">
              สร้างหน้าโดเนทของคุณเอง แชร์ให้ผู้ชม แล้วดู alert เด้งขึ้นจอสตรีมทันทีที่มีคนส่งกำลังใจ
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/demo" className={buttonClass('primary', 'lg')}>
                ลองส่งโดเนท
              </Link>
              <Link href="/login" className={buttonClass('secondary', 'lg')}>
                เข้าสู่ระบบสตรีมเมอร์
              </Link>
            </div>
          </div>

          {/* Real deployment configuration, in place of the old milestone list. */}
          <Panel as="div">
            <PanelHeader label="Build config" />
            <dl className="divide-y divide-line">
              <SystemRow label="PAYMENT_PROVIDER" value={sys.provider} tone="ink" />
              <SystemRow
                label="REALTIME_HTTP_URL"
                value={sys.realtimeUrlSet ? 'set' : 'unset'}
                tone={sys.realtimeUrlSet ? 'ink' : 'faint'}
              />
              <SystemRow label="DEMO_MODE" value={String(sys.demo)} tone="money" />
            </dl>
            <p className="border-t border-line px-4 py-3 text-micro leading-relaxed text-faint">
              ค่าจริงของ deployment นี้ — ไม่ใช่ตัวเลขสาธิต และ &ldquo;set&rdquo;
              บอกแค่ว่าตัวแปรถูกตั้งไว้ ไม่ได้แปลว่าตอนนี้มี overlay ต่ออยู่จริง
            </p>
          </Panel>
        </section>

        <Panel className="mt-10 overflow-hidden">
          <OverlayStage />
        </Panel>

        <section className="mt-12">
          <TechLabel>// how it works</TechLabel>
          <h2 className="mt-1 font-display text-h2 font-bold">เริ่มรับโดเนทใน 3 ขั้นตอน</h2>
          <ol className="mt-5 grid gap-3 md:grid-cols-3">
            {STEPS.map((step) => (
              <li key={step.no}>
                <Panel as="div" className="h-full px-4 py-4">
                  <span className="label-tech text-accent-text">{step.no}</span>
                  <p className="mt-2 font-semibold text-ink">{step.title}</p>
                  <p className="mt-1 text-label text-muted">{step.body}</p>
                </Panel>
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-10 rounded-panel border border-line bg-surface px-5 py-8 text-center">
          <h2 className="font-display text-h2 font-bold">อยากเห็น alert เด้งจริงไหม</h2>
          <p className="mx-auto mt-2 max-w-lg text-label text-muted">
            หน้าโดเนทตัวอย่างเปิดให้ลองได้เลย ส่งโดเนทจำลองแล้วดูว่ามันวิ่งผ่าน webhook
            ไปโผล่บน overlay จริง ๆ
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <Link href="/demo" className={buttonClass('primary', 'md')}>
              ลองส่งโดเนท
            </Link>
            <Link href="/login" className={buttonClass('secondary', 'md')}>
              เข้าสู่ระบบสตรีมเมอร์
            </Link>
          </div>
        </section>
      </main>

      <footer className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-line pt-6 pb-2 text-meta text-faint">
        <span>
          DONATR — โปรเจกต์สาธิต ไม่รับเงินจริง
        </span>
        <span className="flex items-center gap-3">
          <TechLabel>OBS</TechLabel>
          <TechLabel>PromptPay</TechLabel>
          <TechLabel>Omise test</TechLabel>
        </span>
      </footer>
    </div>
  )
}

function SystemRow({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: 'ink' | 'money' | 'live' | 'faint'
}) {
  const colour = {
    ink: 'text-ink',
    money: 'text-money',
    live: 'text-live',
    faint: 'text-faint',
  }[tone]
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      {/* Mono because these are literal variable names, not prose — the one
          job the mono role is reserved for in this system. */}
      <dt className="font-mono text-meta text-muted">{label}</dt>
      <dd className={`font-mono text-meta ${colour}`}>{value}</dd>
    </div>
  )
}
