# donate-platform

[![CI](https://github.com/rockhome192/donate-platform/actions/workflows/ci.yml/badge.svg)](https://github.com/rockhome192/donate-platform/actions/workflows/ci.yml)

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
| **M2a** — WebSocket server: ticket 60 วิ, replay guard, heartbeat, `/internal/*` | ✅ เสร็จ |
| **M2b** — OBS overlay client: reconnect backoff, alert queue, `/missed` + ack | ✅ เสร็จ |
| **M4** — ตั้งค่า alert, rotate token, test alert | ✅ เสร็จ |
| **นอกแผน** — สมัครสมาชิก, หน้าโปรไฟล์, หน้าแอดมิน, redesign v2 ทุกจอ | ✅ เสร็จ |
| M5 — CI + deploy | 🟡 CI แล้ว, ยังไม่ deploy |

**ใช้งานได้จริงตอนนี้ — ครบสายตั้งแต่จ่ายจนเด้งขึ้นจอ:** `/{slug}` กรอกจำนวนเงินแล้วได้ QR (จำลอง)
พร้อมนับถอยหลังและ poll สถานะ → ปุ่ม **"จำลองการจ่ายเงิน (simulated webhook)"** เดินผ่าน pipeline
จริงจนโดเนทเป็น `PAID` → publish เข้า `apps/realtime` → **alert เด้งบน OBS overlay จริง**
(ตรวจ end-to-end ด้วยสองเซอร์วิสรันพร้อมกันแล้ว)
นอกจากนั้น: สมัครสมาชิกเอง, dashboard + ประวัติ + ยอดรวมรายวัน, ตั้งค่า alert (template/
ระยะเวลา/ยอดขั้นต่ำ) ที่ push ลง overlay ที่เปิดค้างอยู่ทันที, rotate overlay token,
ปุ่มยิง alert ทดสอบ, แก้โปรไฟล์, และหน้าแอดมินสำหรับระงับ/ปลดระงับบัญชี

**ยังไม่ได้ — ที่รู้ตัวและตั้งใจปล่อยไว้:**
- **ยังไม่ deploy** จึงยังไม่มี public HTTPS URL → การตรวจลายเซ็น webhook ของ Omise
  **เขียนตามสเปกแล้วแต่ยังไม่เคยเจอ event จริง** (Omise ไม่ยิงเข้า localhost และไม่รับ
  self-signed cert) ส่วนที่ตรวจกับ Omise test mode จริงแล้วคือขา source → charge → อ่าน QR →
  retrieve กลับมาเป็น `successful`
- **ไม่มี ESLint config ในรีโปเลย** — คอมเมนต์ `eslint-disable-next-line` ที่มีอยู่จึงไม่มีผลอะไร
- ลบรูปอวาตาร์เก่าทิ้งไม่ได้ (เปลี่ยนรูปแล้วไฟล์เดิมค้างใน bucket) และเปลี่ยน slug แล้ว
  ลิงก์เดิมตาย ไม่มี redirect

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

บัญชีหลัง seed:

| บัญชี | รหัสผ่าน | ได้อะไร |
|---|---|---|
| `demo@donate-platform.local` | `demo1234` | สตรีมเมอร์ — dashboard, ตั้งค่า alert, overlay, โปรไฟล์ |
| `admin@donate-platform.local` | `admin1234` | แอดมิน — `/dashboard/admin` **ไม่มีแถว Streamer** จึงเข้าจอสตรีมเมอร์ไม่ได้ |

### คำสั่งอื่น

```bash
pnpm test        # ทุก workspace — unit ล้วน ไม่ต้องมี DB
pnpm typecheck
pnpm build
pnpm db:studio

# Integration — ต้องมี DIRECT_URL ใน apps/web/.env (ไม่มีก็ skip ตัวเอง)
# รันในทรานแซกชันที่ roll back ทุกครั้ง ไม่เขียนอะไรลง DB จริง
pnpm --filter @dp/web test:int
```

---

## หมายเหตุที่ต้องรู้

**Partial index ต้องมาจาก migration เท่านั้น** — index ที่รองรับ query `/missed`
(`WHERE status = 'PAID' AND alertedAt IS NULL`) ประกาศใน Prisma schema ไม่ได้
มันอยู่ใน `prisma/migrations/20260727000001_missed_alerts_index/` **`prisma db push`
จะไม่สร้างมันให้** ใช้ `prisma migrate` เสมอ

**เงินเป็น `Int` หน่วยสตางค์เสมอ** ไม่มี float ที่ไหนทั้งสิ้น และ `toSatang()`
จะ throw ถ้าได้จำนวนที่ละเอียดกว่าหนึ่งสตางค์ แทนที่จะปัดทิ้งเงียบ ๆ

**รูปอวาตาร์: ไฟล์ไม่ผ่านเซิร์ฟเวอร์เลย** เว็บออกแค่ "ตั๋ว" คือ presigned PUT อายุ 5 นาที
ที่เซ็น key + content-type + **จำนวนไบต์เป๊ะ ๆ** ไว้ด้วย SigV4 (`lib/storage.ts` เซ็นเอง ไม่ใช้
AWS SDK) แล้วเบราว์เซอร์ยิงไฟล์เข้า R2 ตรง ๆ **ตัวที่บังคับลิมิต 2 MB ได้จริงคือการเซ็น
`content-length`** — ลำพัง presigned URL ห้ามไคลเอนต์ส่ง 400 MB ไม่ได้ ขนาดที่ไคลเอนต์แจ้ง
ตอนขอตั๋วเป็นแค่คำกล่าวอ้าง

ตรวจกับ bucket จริงแล้ว (2026-08-17) **ด้วยสคริปต์ที่ยิง API ตรง ๆ ไม่ใช่การกดผ่านหน้าเว็บ**:
ขอตั๋ว → PUT ขึ้น R2 → อ่านกลับมาไบต์ตรงกัน → บันทึกลงแถวโปรไฟล์ → ขึ้นบนหน้าโดเนทสาธารณะ
และเคสที่ต้องพังก็พังจริง — **ยิงบอดี้ยาวกว่าที่เซ็นไว้ด้วยตั๋วใบเดิม R2 ตอบ 403**, `avatarUrl`
นอก host ของเราถูกปฏิเสธ 400 (ไม่งั้นสตรีมเมอร์ชี้รูปไปที่ไหนก็ได้ แล้ว IP ของคนที่เข้ามาดูรั่ว
ไปหาบุคคลที่สาม) และรูปของสตรีมเมอร์คนอื่นบนบัคเก็ตเดียวกันก็ถูกปฏิเสธ 400 เช่นกัน
ส่วน CORS ตรวจด้วย preflight จริง (OPTIONS + `Origin` + `Access-Control-Request-Method`)
ได้ 204 — จำเป็นต้องตรวจแยก เพราะ PUT จากฝั่งเซิร์ฟเวอร์ผ่านได้แม้ไม่มีกฎ CORS เลย
**ที่ยังไม่เคยทำ: ให้เบราว์เซอร์จริงขับฟอร์ม** ตัว `ProfileForm` ส่ง header จาก *ตั๋ว* ไม่ใช่จาก
ไฟล์ ซึ่งเป็นสัญญาเดียวกับที่รอบนี้ตรวจไปแล้ว แต่ไม่มีใครกดปุ่มจริงสักครั้ง

**`avatarUrl` ต้องเป็นรูปที่คนคนนั้นอัปโหลดเอง ไม่ใช่แค่ "อยู่บนบัคเก็ตเรา"** — URL ของอวาตาร์
เป็น public และโผล่อยู่ใน page source ของหน้าโดเนททุกหน้า ถ้าเช็คแค่ว่าขึ้นต้นด้วยโดเมนบัคเก็ต
สตรีมเมอร์คนไหนก็ก็อป URL ของคนอื่นมาแปะเป็นรูปตัวเองได้ แล้วสวมหน้าคนนั้นบนหน้าที่มีไว้
ขอเงินจากคนที่จำหน้าเขาได้ `ownsAvatarUrl()` จึงบังคับให้ key อยู่ใต้ `avatars/{id ของตัวเอง}/`
และ **parse URL ก่อนเทียบ ไม่ใช่เทียบสตริงดิบ** เพราะเบราว์เซอร์ย่อ `..` ให้เอง —
`/avatars/{ตัวเอง}/../{คนอื่น}/x.png` ผ่าน `startsWith` ได้สบาย ๆ แล้วไปโหลดไฟล์ของคนอื่น

**เป็นออปชัน** — ต้องมีตัวแปร `R2_*` ครบทั้งห้าตัว ขาดตัวเดียวคือปิดทั้งฟีเจอร์โดยตั้งใจ:
เดพลอยที่ไม่มี bucket ต้องรันได้ตามปกติ แค่ปุ่มอัปโหลดถูกปิดและ endpoint ตอบ 503 (ไม่ใช่ 500
เพราะไม่มีอะไรพัง) บัคเก็ตต้องเปิด public read **และ** ตั้ง CORS ให้ allow `PUT` +
header `content-type` จาก origin ของเว็บ ไม่งั้นเบราว์เซอร์บล็อกตั้งแต่ preflight
ตอนขึ้น production ต้องกลับไปเพิ่มโดเมนจริงใน `AllowedOrigins` อีกรอบ

(ข้อจำกัด instance เดียวของ realtime อยู่ในหัวข้อ Realtime pipeline ด้านล่าง)

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

**ledger ของ MockProvider อยู่ใน DB ไม่ใช่ใน memory** — ตอนแรกเก็บใน `Map` ของ process
ซึ่งพังบน serverless: `/api/demo/complete-donation` กับ `/api/webhooks/omise` เป็นคนละ request
Vercel จึงอาจให้คนละ instance มารับ แล้ว retrieve หา charge ไม่เจอ — ปุ่มเดโม่จะพังเป็นครั้ง ๆ
ซึ่งเป็นอาการที่แย่ที่สุดสำหรับหน้าที่ HR กดดู ตอนนี้ย้ายมาเป็นตาราง `MockCharge` แล้ว และ
`markPaid` เป็น `updateMany({ where: { providerRef, status: 'PENDING' } })` คำสั่งเดียว
จึงกันกดซ้ำแบบ atomic ไปในตัว **ตรวจแล้วด้วยการรีสตาร์ต web server คั่นกลาง** ระหว่างสร้าง
โดเนทกับจ่ายเงิน ไม่ใช่แค่ผ่าน unit test

---

## Realtime pipeline (M2a + M2b)

```
OBS เปิด  /overlay/{overlayToken}          ← token อายุยาว อยู่ใน URL ที่ streamer ก็อปไปวาง
  └─ หน้าเว็บขอ GET /api/overlay/{token}/ticket
        └─ JWT HS256 อายุ 60 วิ ใช้ได้ครั้งเดียว   ← rate limit ทำงาน "ก่อน" แตะ DB
  └─ WS  ws://realtime/?ticket=...
        ├─ verify offline   ปัก iss/aud/alg + clockTolerance   ← realtime ไม่แตะ Prisma เลย
        ├─ jti replay guard  ตั๋วใบเดิมยิงซ้ำ → ปิด 4001
        ├─ Origin allowlist + heartbeat 30 วิ
        └─ เกิน 5 socket ต่อสตรีมเมอร์ → ปิด "ตัวที่มาใหม่" 4003 ตัวที่ออนแอร์อยู่ไม่โดนแตะ
```

**auth เป็นสองชั้นเพราะ WebSocket ส่ง header ไม่ได้** — เบราว์เซอร์ไม่ยอมให้ใส่ header ใน
`new WebSocket()` token จึงต้องไปอยู่ใน URL ซึ่งหลุดลง log ของ proxy ได้ ตั๋ว 60 วิ
ใช้ครั้งเดียวจึงเป็นตัวที่วิ่งใน URL แทน ส่วน token อายุยาวอยู่ในฝั่งเว็บที่คุยกันด้วย header ปกติ
ผลพลอยได้: `apps/realtime` **ไม่ต้องรู้จัก DB เลย** ตรวจลายเซ็นด้วย secret ที่แชร์กันพอ

**close code ที่ retry ไม่ได้มีแค่ 4002 กับ 4003** และตารางนี้เก็บ "ฝั่งที่ห้าม retry"
ไม่ใช่ฝั่งที่ retry ได้ — เพราะโค้ดที่ไม่รู้จัก (เน็ตหลุด = 1006, proxy ตัดสาย) ต้องกลับมาต่อใหม่
ถ้าไปไล่ลิสต์ฝั่ง retry จะลิสต์ไม่มีวันจบ **4003 เคยเป็น retryable แล้วเกิด livelock**:
overlay 6 ตัวผลัดกันเตะกันออกไม่รู้จบ ทางแก้คือเปลี่ยนเป็น "ปฏิเสธตัวที่มาใหม่" แทน
"เตะตัวที่เก่าที่สุดทิ้ง"

**alert ที่หลุดตอน overlay ปิดอยู่ไม่หาย** — publish ที่ล้มเหลว **ห้าม** rollback สถานะ `PAID`
(เงินเข้าแล้วจริง) โดเนทจึงค้างเป็น `alertedAt IS NULL` แล้ว overlay ดึงกลับด้วย `/missed`
ตอนต่อสายได้ + ack กลับมา คิวนี้มี partial index รองรับโดยเฉพาะ

**ข้อจำกัดที่รู้ตัว: รันได้ instance เดียว** room registry กับ replay guard อยู่ใน memory
ถ้า scale เป็นสอง instance overlay ที่ต่อ A จะไม่ได้ alert ที่ publish เข้า B — ทางแก้คือ
Redis pub/sub และต้องย้าย **ทั้งสองอย่างพร้อมกัน** (DESIGN.md 8.6)

---

## Deploy

`apps/web` → **Vercel** (Root Directory = `apps/web`), `apps/realtime` → **Railway**
(Root Directory ว่าง เพราะ workspace + lockfile อยู่ที่ root, ตั้งค่าไว้แล้วใน `railway.toml`)
ขั้นตอนทีละข้อ ตารางตัวแปรครบทุกตัว และของที่พังเงียบถ้าลืม อยู่ใน [`DEPLOY.md`](./DEPLOY.md)

สองอย่างที่ต้องรู้ก่อนกดอะไร:
- **ต้อง deploy Railway ก่อน** `NEXT_PUBLIC_REALTIME_WS_URL` ถูก inline ตอน build
  แก้ตัวแปรทีหลังโดยไม่ build ใหม่จึงไม่มีผล และต้องเป็น `wss://` เพราะเบราว์เซอร์
  ไม่ยอมให้หน้า https เปิด `ws://`
- **Vercel ต้องเปิด Corepack** (`ENABLE_EXPERIMENTAL_COREPACK=1`) — Vercel รองรับ pnpm ถึง 10
  แต่รีโปนี้ปักไว้ที่ 11.17.0 และ `pnpm-workspace.yaml` ใช้คีย์ `allowBuilds` ของ pnpm 11
  (pnpm 10 อ่านชื่อ `onlyBuiltDependencies`) ถ้าไม่ตรงกัน postinstall ของ Prisma ถูกบล็อก

**`@dp/shared` ต้องถูกบันเดิลเข้าไปใน `apps/realtime`** (`tsup.config.ts` → `noExternal`)
มันเป็น TypeScript ดิบ (`main` ชี้ที่ `src/index.ts` — ฝั่งเว็บใช้ `transpilePackages` จัดการ)
tsup ตั้ง dependency ทุกตัวเป็น external ตามค่า default บันเดิลจึง `import '@dp/shared'` ทิ้งไว้
แล้ว `node dist/server.js` ตายตั้งแต่บูตด้วย ERR_MODULE_NOT_FOUND — Node โหลดไฟล์ `.ts`
ที่ import แบบไม่มีนามสกุลไม่ได้ และไม่ยอม strip types ใน `node_modules` เลย
dev ไม่เคยเจอเพราะรันด้วย `tsx` ส่วน `start` มีแต่ Railway ที่ใช้

## CI

`.github/workflows/ci.yml` รัน **typecheck → test → build** ทั้งสาม workspace ทุก push เข้า
`main` และทุก PR ไม่ต้องใช้ secret ใด ๆ

สามขั้นที่ต้องมีก่อนหน้านั้น ไม่งั้นพังบน checkout สะอาด:
- **`prisma generate` ซ้ำอีกรอบหลัง install** — postinstall ของ `@prisma/client` รัน *ทีหลัง*
  ของ `@dp/web` แล้วสร้าง client ที่ไม่มี schema ทับ ทำให้ enum ที่ import อยู่หายทั้งหมด
- **`next typegen`** — `typedRoutes: true` ทำให้ href ที่พิมพ์ไว้ typecheck ไม่ผ่านจนกว่าจะมี
  route manifest ซึ่ง checkout ใหม่ยังไม่มี `.next/`
- **env ปลอมตอน build** — `next build` ไม่เคยต่อ DB (ทุก route ที่แตะ DB เป็น dynamic)
  แต่ `lib/env.ts` โยน error ถ้าตัวแปรหาย ค่าพวกนี้จึงแค่ต้อง *มี* ไม่ต้องใช้ได้จริง

**integration test ไม่ได้อยู่ใน CI** — มันต้องใช้ `DIRECT_URL` จริง และถ้าไม่มีมันจะข้ามตัวเอง
เงียบ ๆ ซึ่งแย่กว่าไม่มีเลย (CI เขียวทั้งที่ไม่ได้ทดสอบอะไร) รันเองด้วย
`pnpm --filter @dp/web test:int` — ทุกเทสรันในทรานแซกชันที่ roll back เสมอ ไม่เขียนลง DB จริง
