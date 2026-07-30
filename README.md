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
| M3 — Omise test mode + webhook + idempotency | ⬜ |
| M2a — WebSocket server | ⬜ (มีแค่ health check + room registry) |
| M2b — OBS overlay client | ⬜ |
| M4 — ตั้งค่า alert, demo mode | ⬜ |
| M5 — CI + deploy | ⬜ |

**ใช้งานได้จริงตอนนี้:** `/{slug}` กรอกจำนวนเงินแล้วได้ QR (จำลอง) + นับถอยหลัง +
poll สถานะ, dashboard แสดงประวัติกับยอดรวม, login ด้วยบัญชีเดโม่

**ยังไม่ได้:** โดเนทค้างที่ `PENDING` เพราะสิ่งที่เปลี่ยนเป็น `PAID` คือ webhook ซึ่งอยู่ใน **M3**
ยอดรวมใน dashboard จึงนับเฉพาะแถวที่ seed ไว้ — ตั้งใจให้เป็นแบบนี้ ไม่ใช่บั๊ก

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
#   apps/web/.env       DATABASE_URL, DIRECT_URL, NEXTAUTH_*, ...
#   apps/realtime/.env  PORT + REALTIME_*_SECRET (ต้องตรงกับฝั่ง web เป๊ะ)

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
