import Link from 'next/link'
import { formatBaht } from '@dp/shared'
import { OverlayStage } from '@/components/OverlayStage'
import {
  AmbientBackdrop,
  Panel,
  TechLabel,
  Wordmark,
  buttonClass,
} from '@/components/ui'
import { db } from '@/lib/db'

/**
 * Landing, rebuilt to the v2 design file's own composition.
 *
 * Part one had inverted it — a left-aligned two-column hero with a BUILD CONFIG
 * panel beside it — on the argument that the stage should not lead. The design
 * puts a centred hero first and the stage under it, which solves the same
 * problem without giving half the fold to a table of environment variables, so
 * the design's version is what is here. The config panel is gone with it.
 *
 * Four things in the file did not survive, all for the reason that has held
 * since part one — this page may not claim something the product does not do:
 *
 * - **The GOAL TODAY progress bar (฿620 / ฿1,000).** There is no goal anywhere
 *   in the schema. A sample donation is sample DATA and says so; a goal bar
 *   advertises a FEATURE, and a visitor who signs up for it finds nothing.
 * - ~~**"เริ่มใช้งานฟรี" / "สร้างบัญชีฟรี →".**~~ Reinstated: registration
 *   exists now (`/register`), so the design's own copy is true and both buttons
 *   point at it. They said "ลองด้วยบัญชีเดโม่" for as long as there was nothing
 *   to sign up for.
 * - **STREAMLABS in the trust line.** The overlay is a browser source and has
 *   only ever been run in OBS. Omise test mode has been, so it takes the slot.
 * - **The invented ticker.** The design fills it with made-up donors, which is
 *   the FOLLOWERS problem again — it reads as volume. It runs on the real last
 *   donations on this deployment instead, and disappears when there are none.
 */

export const dynamic = 'force-dynamic'

const TICKER_LIMIT = 8
const TICKER_MIN = 4

const STEPS = [
  {
    no: '01',
    icon: '👤',
    title: 'สมัครและตั้งลิงก์',
    body: 'สมัครแล้วเลือกลิงก์หน้าโดเนทของตัวเอง หรือกดเข้าด้วยบัญชีเดโม่ถ้าแค่อยากลองดูก่อน',
  },
  {
    no: '02',
    icon: '🖥',
    title: 'วาง overlay ใน OBS',
    body: 'คัดลอก URL จากหน้า Overlay ไปวางเป็น Browser Source เสร็จในนาทีเดียว',
  },
  {
    no: '03',
    icon: '📣',
    title: 'แชร์ลิงก์ให้ผู้ชม',
    body: 'ผู้ชมเปิดหน้าโดเนทของคุณ ส่งกำลังใจ แล้ว alert เด้งขึ้นจอสตรีมทันที',
  },
] as const

export default async function HomePage() {
  /**
   * The ticker's contents. Public already — every one of these was read aloud
   * on a stream by the alert this page is advertising.
   */
  const recent = await db.donation.findMany({
    where: { status: 'PAID' },
    orderBy: { paidAt: 'desc' },
    take: TICKER_LIMIT,
    select: { id: true, donorName: true, amount: true, message: true },
  })

  return (
    <>
      <AmbientBackdrop />
      <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-5 py-8 sm:px-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <Wordmark />
          <nav className="flex items-center gap-2">
            <Link href="/demo" className={buttonClass('secondary', 'sm')}>
              ดูหน้าโดเนท
            </Link>
            <Link href="/login" className={buttonClass('primary', 'sm')}>
              เข้าสู่ระบบ
            </Link>
          </nav>
        </header>

        <main>
          <section className="animate-fade-up pt-14 pb-6 text-center">
            {/* accent-text, not the fill red: this is 11px type, and the fill
                reaches only 4.16:1 on the canvas. */}
            <span className="inline-flex items-center gap-2 rounded-chip border border-line-strong px-3 py-1.5 label-tech text-accent-text">
              <span aria-hidden className="size-1.5 rounded-full bg-accent-text animate-livedot" />
              real-time donation alerts
            </span>

            <h1 className="mx-auto mt-6 max-w-3xl font-display text-display font-bold tracking-tight sm:text-[clamp(2.75rem,6.2vw,4.5rem)]">
              โดเนทถึงจอสตรีม
              <br />
              <span className="text-accent-text">ภายในวินาทีเดียว</span>
            </h1>

            <p className="mx-auto mt-5 max-w-lg text-body text-muted">
              สร้างหน้าโดเนท แชร์ให้ผู้ชม แล้วดู alert เด้งบนจอ OBS ทันทีที่มีคนส่งกำลังใจ —
              ตั้งค่าเสร็จในไม่กี่นาที
            </p>

            <div className="mt-7 flex flex-wrap justify-center gap-3">
              <Link
                href="/register"
                className={buttonClass('primary', 'lg', 'shadow-[5px_5px_0_rgba(255,59,78,0.22)]')}
              >
                เริ่มใช้งานฟรี
              </Link>
              <Link href="/demo" className={buttonClass('secondary', 'lg')}>
                ลองส่งโดเนท →
              </Link>
            </div>

            {/* Kept beside the signup button rather than replaced by it: a
                recruiter opening this link wants to see the console in ten
                seconds, not fill in a form first. */}
            <p className="mt-3 text-meta text-faint">
              หรือ{' '}
              <Link href="/login" className="text-muted underline underline-offset-4 hover:text-ink">
                เข้าสู่ระบบด้วยบัญชีเดโม่
              </Link>
            </p>

            <p className="mt-6 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-meta text-faint">
              ใช้กับ
              <span className="flex items-center gap-2.5 text-muted">
                <TechLabel className="text-muted">OBS</TechLabel>
                <span aria-hidden className="text-line-strong">
                  /
                </span>
                <TechLabel className="text-muted">PromptPay</TechLabel>
                <span aria-hidden className="text-line-strong">
                  /
                </span>
                <TechLabel className="text-muted">Omise test</TechLabel>
              </span>
            </p>
          </section>

          <Panel className="mt-4 overflow-hidden">
            <OverlayStage />
          </Panel>

          {/*
            Below TICKER_MIN the row is narrower than the viewport, and a
            marquee that does not overflow is just a short list sliding off the
            left edge into blank space. Two real donations are not a ticker.
          */}
          {recent.length >= TICKER_MIN && (
            <section
              className="mt-8 overflow-hidden [mask-image:linear-gradient(90deg,transparent,black_6%,black_94%,transparent)]"
              aria-label="โดเนทล่าสุด"
            >
              {/* Rendered twice so the -50% translate loops seamlessly. The copy
                  is aria-hidden: a screen reader should hear this list once. */}
              <div className="flex w-max animate-marquee gap-3">
                {[false, true].map((isCopy) => (
                  <ul key={String(isCopy)} className="flex gap-3" aria-hidden={isCopy || undefined}>
                    {recent.map((d) => (
                      <li
                        key={d.id}
                        className="flex items-center gap-2.5 rounded-full border border-line bg-surface px-4 py-2 text-meta whitespace-nowrap text-muted"
                      >
                        <span className="font-semibold text-ink">{d.donorName}</span>
                        <span className="font-numeric font-semibold tabular-nums text-money">
                          ฿{formatBaht(d.amount).replace('.00', '')}
                        </span>
                        {d.message && <span className="text-faint">· {d.message}</span>}
                      </li>
                    ))}
                  </ul>
                ))}
              </div>
            </section>
          )}

          <section className="mt-14">
            <div className="mx-auto max-w-lg text-center">
              <TechLabel className="text-accent-text">// how it works</TechLabel>
              <h2 className="mt-3 font-display text-h1 font-bold tracking-tight">
                เริ่มรับโดเนทใน 3 ขั้นตอน
              </h2>
            </div>

            <ol className="mt-8 grid gap-4 md:grid-cols-3">
              {STEPS.map((step) => (
                <li key={step.no}>
                  <Panel as="div" className="relative h-full px-6 py-7">
                    <span className="absolute top-6 right-5 label-tech text-accent-text">
                      step {step.no}
                    </span>
                    {/* The design tints one of these three tiles amber. Amber is
                        money in this system and "วาง overlay ใน OBS" is not
                        money, so all three get the same neutral well. */}
                    <span
                      aria-hidden
                      className="grid size-13 place-items-center rounded-panel border border-line bg-surface-2 text-h2"
                    >
                      {step.icon}
                    </span>
                    <p className="mt-5 font-display text-h3 font-bold">{step.title}</p>
                    <p className="mt-2 text-label leading-relaxed text-muted">{step.body}</p>
                  </Panel>
                </li>
              ))}
            </ol>
          </section>

          {/* The closing band. White at 88% over this fill measures 3.92:1, so
              the body copy is full white — the design's own value fails on its
              own colour. */}
          <section className="dot-grid relative mt-12 overflow-hidden rounded-panel bg-accent px-6 py-12 text-center sm:px-10">
            <h2 className="font-display text-h1 font-bold tracking-tight text-white">
              พร้อมเริ่มรับโดเนทแล้วยัง?
            </h2>
            <p className="mt-3 text-body font-medium text-white">
              เปิดหน้าโดเนทของคุณได้ในไม่กี่นาที · ไม่มีค่าใช้จ่าย
            </p>
            <Link
              href="/register"
              className="mt-7 inline-flex items-center justify-center gap-2 rounded-control bg-canvas px-8 py-3.5 text-body font-semibold text-ink transition-colors hover:bg-surface"
            >
              สร้างบัญชีฟรี →
            </Link>
          </section>
        </main>

        <footer className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-6 pb-2 text-meta text-faint">
          <span>DONATR — โปรเจกต์สาธิต ไม่รับเงินจริง</span>
          <span className="flex items-center gap-3">
            <TechLabel>OBS</TechLabel>
            <TechLabel>PromptPay</TechLabel>
            <TechLabel>Omise test</TechLabel>
          </span>
        </footer>
      </div>
    </>
  )
}
