# donate-platform

> ⚠️ **โปรเจกต์สาธิต (sandbox) — ไม่รับเงินจริง**
> การชำระเงินทั้งหมดเป็นการจำลอง ไม่มีเงินจริงเคลื่อนย้าย และไม่มีการจ่ายเงินออกจริง
> เหตุผล: การรับโดเนทแล้วจ่ายต่อให้บุคคลที่สามเข้าข่ายธุรกิจที่ ธปท. กำกับ และ payment
> gateway ในไทยเปิด live mode ให้เฉพาะนิติบุคคลที่ผ่าน KYC

ระบบรับโดเนทสำหรับสตรีมเมอร์ พร้อม alert เรียลไทม์บน OBS overlay

**ออกแบบเต็มอยู่ที่ [`DESIGN.md`](./DESIGN.md)** — รวมเหตุผลของทุกการตัดสินใจ, threat model 14 ข้อ,
และข้อจำกัดที่รู้ตัว

---

## สถานะ

| Milestone | สถานะ |
|---|---|
| **M0** — monorepo, Prisma schema, NextAuth, seed | ✅ เสร็จ |
| **M1** — หน้าโดเนท + MockProvider + dashboard + validation 2 ชั้น | ✅ เสร็จ |
| **M3** — Omise adapter + webhook + `after()` + idempotency + reconciler | ✅ เสร็จ |
| M2a — WebSocket server | ⬜ (มีแค่ health check + room registry + reconciler clock) |
| M2b — OBS overlay client | ⬜ |
| M4 — ตั้งค่า alert, rotate token, test alert | ⬜ |
| M5 — CI + deploy | ⬜ |

**ใช้งานได้จริงตอนนี้:** `/{slug}` กรอกจำนวนเงินแล้วได้ QR (จำลอง) + นับถอยหลัง +
poll สถานะ, ปุ่ม **"จำลองการจ่ายเงิน (simulated webhook)"** เดินผ่าน pipeline จริงจนโดเนทเป็น
`PAID`, dashboard แสดงประวัติกับยอดรวม, login ด้วยบัญชีเดโม่

**ยังไม่ได้:** alert ยังไม่เด้งขึ้นจอ — ตัว publish ยิงไปที่ `apps/realtime` ซึ่ง `/internal/publish`
ยังไม่มี (M2a) โดเนทที่จ่ายแล้วจึงค้างเป็น "ยังไม่เด้ง" (`alertedAt IS NULL`) รอ `/missed` มาเก็บ
— **ตั้งใจให้เป็นแบบนี้ ไม่ใช่บั๊ก** publish ล้มเหลวห้าม rollback `PAID` (DESIGN.md 8.3.1)

---

## โครงสร้าง

```
apps/
  web/        Next.js 16 — เว็บ + API + Prisma   (deploy: Vercel)
  realtime/   Node + ws   — WebSocket server      (deploy: Railway)
packages/
  shared/     type + Zod schema + money + backoff (ใช้ร่วมกันสองฝั่ง)
```

**ทำไมแยกเป็นสอง service:** Vercel Hobby จำกัด function ที่ 60 วินาที ซึ่งใช้ค้าง WebSocket
ตลอดการสตรีมไม่ได้ ส่วนที่ต้องค้างสายจึงต้องอยู่คนละที่

**ทำไมเขียน WebSocket เองแทนที่จะใช้ Pusher/Ably:** heartbeat, reconnect backoff และ
connection lifecycle คือส่วนที่โปรเจกต์นี้ตั้งใจจะแสดง — managed SDK ซ่อนมันไว้หมด

---

## เริ่มใช้งาน

ต้องมี **Node 22+** และ **pnpm 11+**

```bash
pnpm install

# ไม่มี .env ที่ root — Prisma กับ Next หา .env จากโฟลเดอร์ของ app
# ดู .env.example ว่าตัวไหนไปไฟล์ไหน
#   apps/web/.env       DATABASE_URL, DIRECT_URL, NEXTAUTH_*, CRON_SECRET, ...
#   apps/realtime/.env  PORT + REALTIME_*_SECRET (ต้องตรงกับฝั่ง web เป๊ะ)
#                       + WEB_APP_URL/CRON_SECRET ถ้าจะให้ยิง reconciler

pnpm db:migrate             # ใช้ DIRECT_URL (ไม่ใช่ pooler)
pnpm db:seed
pnpm dev                    # apps/web      → http://localhost:3000
pnpm dev:rt                 # apps/realtime → http://localhost:8080/healthz
```

**Neon ต้องใช้สอง connection string:** `DATABASE_URL` เป็น pooled endpoint สำหรับรันแอป
(serverless เปิด-ปิด connection ถี่มาก ต้องมี PgBouncer คั่น) ส่วน `DIRECT_URL` คือ host เดิม
**ที่ตัด `-pooler` ออก** สำหรับ migration เพราะ transaction pooler ถือ session-level lock
ที่ `prisma migrate` ต้องใช้ไม่ได้

บัญชีเดโม่หลัง seed: `demo@donate-platform.local` / `demo1234`

### คำสั่งอื่น

```bash
pnpm test        # ทุก workspace
pnpm typecheck
pnpm build
pnpm db:studio
```

---

## หมายเหตุที่ต้องรู้

**Partial index ต้องมาจาก migration เท่านั้น** — index ที่รองรับ query `/missed`
(`WHERE status = 'PAID' AND alertedAt IS NULL`) ประกาศใน Prisma schema ไม่ได้
มันอยู่ใน `prisma/migrations/20260727000001_missed_alerts_index/` **`prisma db push`
จะไม่สร้างมันให้** ใช้ `prisma migrate` เสมอ

**เงินเป็น `Int` หน่วยสตางค์เสมอ** ไม่มี float ที่ไหนทั้งสิ้น และ `toSatang()`
จะ throw ถ้าได้จำนวนที่ละเอียดกว่าหนึ่งสตางค์ แทนที่จะปัดทิ้งเงียบ ๆ

**ข้อจำกัดที่รู้ตัว — realtime รันได้ instance เดียว** room registry และ ticket
replay guard เก็บใน memory ของ process ถ้า scale เป็นสอง instance เมื่อไหร่
overlay ที่ต่อ instance A จะไม่ได้รับ alert ที่ publish เข้า instance B
ทางแก้คือ Redis pub/sub backplane และต้องย้าย **ทั้งสองอย่างพร้อมกัน**
รายละเอียดอยู่ใน `DESIGN.md` 8.6

---

## Payment pipeline (M3)

```
POST /api/webhooks/omise
  ├─ verify signature            HMAC-SHA256 ของ "<timestamp>.<raw body>" (Omise)
  │                              หรือ x-mock-signature (MockProvider ตอนเดโม่)
  ├─ INSERT WebhookEvent (PK = event id)  ← ยิงซ้ำ = ชน unique = จบทันที
  ├─ 200 { received: true }      ← ตอบก่อน ยังไม่ประมวลผล
  └─ after():  retrieve charge จาก provider  ← ห้ามเชื่อ payload
               UPDATE ... WHERE status='PENDING'  → PAID  (rowCount = คำตอบว่าใครเป็นคนทำ)
               publish alert (best-effort)
```

**ตอบ 200 เร็ว = สละ retry ของ provider** จึงต้องมี retry ของตัวเองมาแทน:
`/api/cron/reconcile` หยิบ `WebhookEvent` ที่ `processedAt IS NULL` และ `attempts < 5`
มารันซ้ำ แล้ว **ค่อย** sweep `PENDING → EXPIRED` (ห้ามสลับลำดับ — DESIGN.md 6.3)
event ที่ครบ 5 ครั้งจะหลุดออกจากคิวและขึ้นเป็น `stuck` ให้คนเข้าไปดู

**Vercel Cron ไม่พอบน Hobby (ตรวจแล้ว 2026-08-01)** — Hobby รัน cron ได้ **วันละครั้ง**
และ expression ที่ถี่กว่านั้น deploy ไม่ผ่านเลย ตัวที่ยิงทุก 5 นาทีจริง ๆ คือ `apps/realtime`
(process ค้างอยู่บน Railway อยู่แล้ว → `setInterval` ฟรี) ส่วน cron รายวันบน Vercel
เก็บไว้เป็น backstop เผื่อ realtime ล่ม ทั้งสองทางยิง endpoint เดียวกันด้วย `CRON_SECRET`

**ปุ่ม "จำลองการจ่ายเงิน"** โผล่เมื่อ `DEMO_MODE=true` เท่านั้น (ไม่งั้น route 404)
มันสร้าง event ปลอมที่เซ็นด้วย `MOCK_WEBHOOK_SECRET` แล้ว POST เข้า webhook ของตัวเอง
— **สิ่งเดียวที่ถูกจำลองคือ "ใครเป็นคนบอกว่าจ่ายแล้ว"** ที่เหลือของจริงหมด
เหตุผลที่ต้องจำลอง: **Omise ไม่มี public API สำหรับ "Mark as Successful"** มีแต่ปุ่มบน dashboard

**ข้อจำกัดของ MockProvider บน serverless** — ledger ของ charge จำลองอยู่ใน memory ของ process
ถ้า Vercel เอาคนละ instance มารับ `/api/demo/complete-donation` กับ `/api/webhooks/omise`
ตัว retrieve จะหา charge ไม่เจอ ตอน dev (process เดียว) ไม่มีปัญหา ถ้าจะให้เดโม่บน production
เชื่อถือได้ 100% ต้องย้าย ledger ลง DB — ยกไปตัดสินใจตอน M5
