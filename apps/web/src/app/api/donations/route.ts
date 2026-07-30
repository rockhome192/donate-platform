import { createDonationSchema } from '@dp/shared'
import { db } from '@/lib/db'
import { checkStreamerRules, donationExpiry } from '@/lib/donation-rules'
import { getPaymentProvider, ProviderUnavailableError } from '@/lib/payments'
import { clientIp, rateLimit } from '@/lib/rate-limit'

/**
 * POST /api/donations — DESIGN.md 9.1
 *
 * Creates the Donation row FIRST, then the charge. If the provider call fails
 * we are left with a PENDING row nobody paid, which the expiry sweeper cleans
 * up (DESIGN.md 6.3). The other order loses the opposite way: a charge the
 * viewer can pay with no row to attach the money to.
 */

export const runtime = 'nodejs'

const RATE_LIMIT = { requests: 10, windowSeconds: 60 }

/** Real people never fill this field; it is off-screen and has no label they can see. */
function isHoneypotFilled(body: unknown): boolean {
  return (
    typeof body === 'object' &&
    body !== null &&
    'website' in body &&
    Boolean((body as { website?: unknown }).website)
  )
}

export async function POST(req: Request) {
  const ip = clientIp(req.headers)
  const limit = await rateLimit(`donate:${ip}`, RATE_LIMIT.requests, RATE_LIMIT.windowSeconds)
  if (!limit.ok) {
    return Response.json(
      { error: 'ส่งคำขอถี่เกินไป กรุณารอสักครู่' },
      { status: 429, headers: { 'retry-after': String(limit.retryAfter) } },
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'รูปแบบข้อมูลไม่ถูกต้อง' }, { status: 400 })
  }

  // Honeypot, checked before Zod on purpose. The schema would reject it too,
  // but with a field name and a reason attached — which tells a bot exactly
  // which input to leave alone next time.
  if (isHoneypotFilled(body)) {
    return Response.json({ error: 'ข้อมูลไม่ถูกต้อง' }, { status: 400 })
  }

  // Layer 1: shape + absolute system bounds.
  const parsed = createDonationSchema.safeParse(body)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return Response.json(
      { error: 'ข้อมูลไม่ถูกต้อง', field: first?.path.join('.'), detail: first?.message },
      { status: 400 },
    )
  }
  const input = parsed.data

  const streamer = await db.streamer.findUnique({
    where: { slug: input.slug },
    select: {
      id: true,
      displayName: true,
      isActive: true,
      isSuspended: true,
      minAmount: true,
      maxAmount: true,
    },
  })
  if (!streamer) {
    return Response.json({ error: 'ไม่พบสตรีมเมอร์คนนี้' }, { status: 404 })
  }

  // Layer 2: per-streamer rules. Without this, minAmount/maxAmount are dead
  // columns and T7 is unguarded. DESIGN.md 7.1.1
  const failure = checkStreamerRules(input.amount, streamer)
  if (failure) {
    return Response.json({ error: failure.message, field: failure.field }, { status: failure.status })
  }

  const provider = getPaymentProvider()
  const expiresAt = donationExpiry()

  const donation = await db.donation.create({
    data: {
      streamerId: streamer.id,
      donorName: input.donorName,
      message: input.message,
      amount: input.amount,
      provider: provider.name === 'omise' ? 'OMISE' : 'MOCK',
      status: 'PENDING',
      expiresAt,
    },
    select: { id: true },
  })

  // The two awaits below are deliberately NOT in one try block.
  //
  // "no charge exists" and "a charge exists that we failed to write down" are
  // opposite situations and must not share a failure path. Marking the second
  // one FAILED would be a lie: with a real provider (M3) the viewer can still
  // pay that charge, and the webhook would then arrive carrying a providerRef
  // no row in our database has ever heard of.
  let charge
  try {
    charge = await provider.createCharge({
      donationId: donation.id,
      amount: input.amount,
      currency: 'THB',
      expiresAt,
    })
  } catch (e) {
    // Nothing was created on the provider side, so nobody can pay this. FAILED
    // is the honest terminal state. The row is kept, not deleted — it is the
    // only evidence that the provider is having a bad day.
    await db.donation
      .update({ where: { id: donation.id }, data: { status: 'FAILED' } })
      .catch((updateError) => {
        // Left PENDING; the expiry sweeper (DESIGN.md 6.3) will still terminate
        // it. Swallowing this silently would make a provider outage invisible.
        console.error('[donations] could not mark donation FAILED', donation.id, updateError)
      })

    if (e instanceof ProviderUnavailableError) {
      console.error('[donations] provider unavailable', e.cause ?? e)
      return Response.json(
        { error: 'ระบบชำระเงินไม่พร้อมใช้งานชั่วคราว กรุณาลองใหม่อีกครั้ง' },
        { status: 503 },
      )
    }
    throw e
  }

  try {
    // Store the provider's expiry, not ours — it owns that clock.
    await db.donation.update({
      where: { id: donation.id },
      data: { providerRef: charge.providerRef, expiresAt: charge.expiresAt },
    })
  } catch (e) {
    // A real charge is now live with no providerRef recorded. Loudly, because
    // this is the one case a human has to reconcile by hand: the id is the only
    // thread back to it.
    console.error(
      `[donations] ORPHANED CHARGE — donation=${donation.id} providerRef=${charge.providerRef} ` +
        `provider=${provider.name}: charge created but not persisted`,
      e,
    )

    // Left PENDING on purpose. FAILED would claim no money can arrive, and
    // that is exactly what we do not know.
    return Response.json(
      { error: 'ระบบชำระเงินไม่พร้อมใช้งานชั่วคราว กรุณาลองใหม่อีกครั้ง' },
      { status: 503 },
    )
  }

  return Response.json(
    {
      donationId: donation.id,
      qrImageUrl: charge.qrImageUrl,
      amount: input.amount,
      expiresAt: charge.expiresAt.toISOString(),
    },
    { status: 201 },
  )
}
