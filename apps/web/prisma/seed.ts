/**
 * Seed for local dev and the public demo account.
 *
 * Everything here is obviously fake and small on purpose. No inflated totals,
 * no invented "5,000,000 THB raised" — the project is a sandbox and says so.
 */
import { PrismaClient, DonationStatus, PaymentProvider } from '@prisma/client'
import bcrypt from 'bcryptjs'

const db = new PrismaClient()

const DEMO_EMAIL = 'demo@donate-platform.local'
const DEMO_PASSWORD = 'demo1234'

/**
 * The operator account for /dashboard/admin.
 *
 * It has NO Streamer row on purpose — that pairing is what api-session.ts
 * distinguishes, and having one real account without a streamer profile is the
 * only way the 403 branch of `requireStreamer` is ever exercised outside a test.
 */
const ADMIN_EMAIL = 'admin@donate-platform.local'
const ADMIN_PASSWORD = 'admin1234'

async function main() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10)

  const user = await db.user.upsert({
    where: { email: DEMO_EMAIL },
    update: { passwordHash },
    create: { email: DEMO_EMAIL, passwordHash, role: 'STREAMER' },
  })

  await db.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: { passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 10), role: 'ADMIN' },
    create: { email: ADMIN_EMAIL, passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 10), role: 'ADMIN' },
  })

  const streamer = await db.streamer.upsert({
    where: { userId: user.id },
    update: {},
    create: {
      userId: user.id,
      slug: 'demo',
      displayName: 'Demo Streamer',
      bio: 'บัญชีตัวอย่างสำหรับทดลองใช้งาน — ไม่ใช่สตรีมเมอร์จริง และไม่รับเงินจริง',
      minAmount: 2_000, // 20.00 THB
      maxAmount: 500_000, // 5,000.00 THB
    },
  })

  await db.alertSetting.upsert({
    where: { streamerId: streamer.id },
    update: {},
    create: {
      streamerId: streamer.id,
      template: '{name} โดเนท {amount} บาท',
      durationMs: 6_000,
      minAlertAmount: 2_000,
    },
  })

  // A few finished donations so the dashboard is not an empty state.
  // alertedAt is set: these have already been shown, so /missed stays empty.
  const existing = await db.donation.count({ where: { streamerId: streamer.id } })
  if (existing === 0) {
    const now = Date.now()
    await db.donation.createMany({
      data: [
        { amount: 5_000, donorName: 'ผู้ชมนิรนาม', message: 'สู้ ๆ นะครับ', minutesAgo: 45 },
        { amount: 2_000, donorName: 'สมชาย', message: 'ชอบคลิปเมื่อวาน', minutesAgo: 120 },
        { amount: 20_000, donorName: 'แฟนคลับ', message: '', minutesAgo: 300 },
      ].map(({ minutesAgo, ...d }) => ({
        ...d,
        streamerId: streamer.id,
        status: DonationStatus.PAID,
        provider: PaymentProvider.MOCK,
        providerRef: `seed_${minutesAgo}`,
        createdAt: new Date(now - minutesAgo * 60_000),
        paidAt: new Date(now - minutesAgo * 60_000 + 30_000),
        alertedAt: new Date(now - minutesAgo * 60_000 + 35_000),
        expiresAt: new Date(now - minutesAgo * 60_000 + 24 * 3_600_000),
      })),
    })
  }

  console.log('Seeded:')
  console.log(`  login    ${DEMO_EMAIL} / ${DEMO_PASSWORD}`)
  console.log(`  admin    ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`)
  console.log(`  donate   /${streamer.slug}`)
  console.log(`  overlay  /overlay/${streamer.overlayToken}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
