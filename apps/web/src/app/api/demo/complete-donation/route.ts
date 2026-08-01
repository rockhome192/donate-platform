import { randomBytes } from 'node:crypto'
import { db } from '@/lib/db'
import { env } from '@/lib/env'
import { getPaymentProvider, MockProvider, signMockWebhook } from '@/lib/payments'
import { clientIp, rateLimit } from '@/lib/rate-limit'

/**
 * POST /api/demo/complete-donation — DESIGN.md 4.3
 *
 * The interview button. Omise has no public API for "mark this test charge
 * successful" (it is a button on their dashboard), so in a demo the sentence
 * "somebody paid" has to come from somewhere else — and this is that somewhere.
 *
 * What is simulated: exactly one thing, who says the money arrived.
 * What stays real: signature verification, the WebhookEvent unique insert, the
 * early 200, after(), retrieve-don't-trust, the PENDING-guarded update, the
 * publish. The synthetic event is posted over HTTP to our own webhook URL
 * rather than shortcutting into the processor, because the transport is part of
 * what this is meant to prove.
 *
 * Honesty rules from 4.3, not negotiable: the button says "simulated", the
 * signing secret is MOCK_WEBHOOK_SECRET (never Omise's), and this route 404s
 * unless DEMO_MODE=true.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const RATE_LIMIT = { requests: 20, windowSeconds: 60 }

export async function POST(req: Request) {
  if (!env.isDemoMode) {
    // 404, not 403: with DEMO_MODE off this endpoint does not exist, and
    // saying "forbidden" would advertise that it could.
    return new Response('not found', { status: 404 })
  }

  const ip = clientIp(req.headers)
  const limit = await rateLimit(`demo:${ip}`, RATE_LIMIT.requests, RATE_LIMIT.windowSeconds)
  if (!limit.ok) {
    return Response.json(
      { error: 'กดถี่เกินไป รอสักครู่' },
      { status: 429, headers: { 'retry-after': String(limit.retryAfter) } },
    )
  }

  let body: { donationId?: unknown }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'รูปแบบข้อมูลไม่ถูกต้อง' }, { status: 400 })
  }

  const donationId = typeof body.donationId === 'string' ? body.donationId : null
  if (!donationId) {
    return Response.json({ error: 'ต้องระบุ donationId' }, { status: 400 })
  }

  // Checked before anything is settled: failing after markPaid would leave a
  // paid mock charge with no event to match it.
  const origin = selfOrigin(req)
  if (!origin) {
    console.error('[demo] NEXT_PUBLIC_SITE_URL must be set for the demo endpoint in production')
    return Response.json({ error: 'โหมดสาธิตยังไม่ได้ตั้งค่า NEXT_PUBLIC_SITE_URL' }, { status: 500 })
  }

  const provider = getPaymentProvider()
  if (!(provider instanceof MockProvider)) {
    // With PAYMENT_PROVIDER=omise the charge lives at Omise, which has no API
    // to settle it. Pretending here would mean writing PAID without any
    // provider ever saying so — the one thing this whole pipeline exists to
    // prevent.
    return Response.json(
      { error: 'โหมดสาธิตใช้ได้เฉพาะกับ PAYMENT_PROVIDER=mock — charge ของ Omise ต้องกดจ่ายจาก dashboard' },
      { status: 409 },
    )
  }

  const donation = await db.donation.findUnique({
    where: { id: donationId },
    select: { id: true, status: true, provider: true, providerRef: true, amount: true },
  })

  if (!donation) {
    return Response.json({ error: 'ไม่พบรายการนี้' }, { status: 404 })
  }
  if (donation.provider !== 'MOCK' || !donation.providerRef) {
    return Response.json({ error: 'รายการนี้ไม่ได้สร้างด้วย provider จำลอง' }, { status: 409 })
  }
  if (donation.status !== 'PENDING') {
    return Response.json({ error: 'รายการนี้จบไปแล้ว' }, { status: 409 })
  }

  // The provider's own ledger, not ours. Returns false on a double click, which
  // is the point: the second press must not produce a second payment.
  if (!provider.markPaid(donation.providerRef)) {
    return Response.json(
      { error: 'charge นี้ถูกจ่ายหรือหมดอายุไปแล้ว (หรือเซิร์ฟเวอร์รีสตาร์ตหลังสร้าง QR)' },
      { status: 409 },
    )
  }

  // Shaped like an Omise event, because the receiver reads it as one.
  const event = {
    id: `evnt_mock_${randomBytes(12).toString('hex')}`,
    key: 'charge.complete',
    created_at: new Date().toISOString(),
    livemode: false,
    data: {
      object: 'charge',
      id: donation.providerRef,
      status: 'successful',
      amount: donation.amount,
      currency: 'THB',
    },
  }

  const rawBody = JSON.stringify(event)

  let webhookStatus: number
  try {
    const res = await fetch(`${origin}/api/webhooks/omise`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-mock-signature': signMockWebhook(rawBody, env.mockWebhookSecret),
      },
      body: rawBody,
      signal: AbortSignal.timeout(5_000),
      cache: 'no-store',
    })
    webhookStatus = res.status
  } catch (e) {
    // The mock charge is already settled, so the reconciler cannot help here —
    // it only re-runs events that were recorded. Say so plainly instead of
    // reporting a success the viewer will never see.
    console.error('[demo] could not deliver synthetic webhook', e)
    return Response.json(
      { error: 'ส่ง webhook จำลองไม่สำเร็จ ลองใหม่อีกครั้ง' },
      { status: 502 },
    )
  }

  if (webhookStatus !== 200) {
    console.error('[demo] webhook rejected the synthetic event', webhookStatus)
    return Response.json({ error: `webhook ตอบ ${webhookStatus}` }, { status: 502 })
  }

  // 202: the webhook has accepted the event, but the donation flips to PAID in
  // after(), a moment later. The QR screen is already polling and will see it.
  return Response.json({ ok: true, simulated: true, eventId: event.id }, { status: 202 })
}

/**
 * Where to post the synthetic event.
 *
 * Deliberately NOT built from the Host / X-Forwarded-Host header: those are
 * client-controlled, and this route would otherwise deliver a signed payload to
 * whatever host the caller named — an outbound-request primitive handed to a
 * stranger.
 *
 * `new URL(req.url).origin` is NOT a safe substitute: a Node server has no way
 * to know its own external origin except from that same Host header, so the
 * fallback would reintroduce exactly what the paragraph above rejects. In
 * production the origin must therefore be configured explicitly, and this
 * returns null rather than guessing. Dev keeps the fallback: there the host is
 * localhost and the alternative is an endpoint that cannot run at all.
 */
function selfOrigin(req: Request): string | null {
  const configured = process.env.NEXT_PUBLIC_SITE_URL
  if (configured) return configured.replace(/\/$/, '')
  if (process.env.NODE_ENV === 'production') return null
  return new URL(req.url).origin
}
