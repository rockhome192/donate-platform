# Deploy

> ⚠️ ยังเป็นโปรเจกต์สาธิต — ขึ้น production แล้วก็ยัง **ไม่รับเงินจริง** ทุกหน้าที่เกี่ยวกับเงิน
> ต้องคงแบนเนอร์ "DEMO — ไม่รับเงินจริง" ไว้เหมือนเดิม

| ส่วน | ไปอยู่ที่ | ทำไม |
|---|---|---|
| `apps/web` | **Vercel** | Next.js 16 + API + Prisma |
| `apps/realtime` | **Railway** | ต้องค้าง WebSocket ทั้งสตรีม — Vercel Hobby ตัด function ที่ 60 วิ |
| Postgres | **Neon** (มีอยู่แล้ว) | migrate + seed ไปแล้ว ใช้ตัวเดิมได้เลย |
| รูปอวาตาร์ | **Cloudflare R2** (มีอยู่แล้ว) | ต้องกลับไปเพิ่มโดเมนจริงใน CORS — ข้อ 4 |

---

## ลำดับที่ห้ามสลับ

**Railway → Vercel → กลับมาเติมค่าที่ Railway**

เพราะ `NEXT_PUBLIC_REALTIME_WS_URL` ถูก **inline ตอน build** ไม่ใช่อ่านตอนรัน แก้ตัวแปรทีหลัง
โดยไม่ build ใหม่จึงไม่มีผลอะไรเลย ต้องรู้โดเมนของ Railway ก่อนจะ build เว็บครั้งแรก
ส่วน `ALLOWED_ORIGINS` / `WEB_APP_URL` ฝั่ง Railway ต้องรู้โดเมน Vercel จึงค่อยเติมทีหลังได้
(เปลี่ยนตัวแปรบน Railway = รีสตาร์ต ไม่ต้อง build ใหม่)

---

## 0. สร้างค่าลับก่อน 5 ตัว

ยังไม่ต้องเปิดเว็บไซต์ไหนทั้งนั้น ข้อนี้แค่ **สุ่มค่ามาจดไว้** เพราะสามตัวแรกต้องกรอก
**ค่าเดียวกันเป๊ะทั้ง Railway และ Vercel** ถ้าไปสุ่มตอนกรอกทีละฝั่งจะได้คนละค่า
แล้ว overlay ต่อไม่ติด / `/internal/publish` โดน 401 โดยไม่มี error บอกว่าเพราะอะไร

รันคำสั่งข้างล่างห้ารอบ (ได้คนละค่าทุกรอบ) แล้วเก็บไว้ในที่ที่ไม่ใช่ในรีโป

```powershell
$b = New-Object byte[] 32; [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)
```

| ตัวแปร | ใช้ทำอะไร | ต้องกรอกที่ไหน |
|---|---|---|
| `REALTIME_JWT_SECRET` | เซ็นตั๋ว 60 วิของ overlay | **ทั้งสองที่ ค่าเดียวกัน** |
| `REALTIME_INTERNAL_SECRET` | HMAC ของ `/internal/publish`, `/internal/disconnect` | **ทั้งสองที่ ค่าเดียวกัน** |
| `CRON_SECRET` | Bearer ของ `/api/cron/reconcile` | **ทั้งสองที่ ค่าเดียวกัน** |
| `MOCK_WEBHOOK_SECRET` | ลายเซ็นของ webhook จำลอง | Vercel อย่างเดียว |
| `NEXTAUTH_SECRET` | เซ็น session cookie | Vercel อย่างเดียว |

**ใช้ค่าใหม่ ไม่ใช่ค่าจาก `apps/web/.env`** — ค่าใน dev เคยผ่านตา log และสคริปต์ทดสอบมาแล้ว
โดยเฉพาะ `MOCK_WEBHOOK_SECRET`: ใครรู้ค่านี้ยิงโดเนทให้เป็น `PAID` ได้เองทั้งที่ไม่ได้จ่าย

---

## 1. Railway — `apps/realtime`

1. [railway.com](https://railway.com) → **New Project** → **Deploy from GitHub repo** → เลือก
   `rockhome192/donate-platform`
   (ถ้ารีโปยัง private ต้องกด authorize ให้ Railway เห็นก่อน)
2. **Root Directory ปล่อยว่างไว้** (= root ของรีโป) — `apps/realtime` ต้องใช้ `@dp/shared`
   ผ่าน pnpm workspace และ lockfile อยู่ที่ root ชี้ root directory ไปที่ `apps/realtime`
   แล้ว builder จะไม่เห็น `pnpm-workspace.yaml` เลย
3. build/start command **ไม่ต้องกรอก** — `railway.toml` ที่ root กำหนดไว้แล้ว
   (config in code ทับค่าจาก dashboard เสมอ) ในนั้นมี healthcheck `/healthz` และ watch paths
   ที่ทำให้ push ที่แตะแต่ `apps/web` ไม่รีสตาร์ตเซอร์วิสนี้
4. ใส่ Variables:

   | ตัวแปร | ค่า |
   |---|---|
   | `REALTIME_JWT_SECRET` | ค่าจากข้อ 0 |
   | `REALTIME_INTERNAL_SECRET` | ค่าจากข้อ 0 |
   | `CRON_SECRET` | ค่าจากข้อ 0 |
   | `RECONCILE_INTERVAL_MS` | `300000` (ไม่ใส่ก็ default เท่านี้) |

   **ยังไม่ต้องใส่ `ALLOWED_ORIGINS` กับ `WEB_APP_URL`** — รอโดเมน Vercel ในข้อ 3
   **และห้ามใส่ `PORT`** Railway ฉีดให้เอง ถ้าไปกำหนดทับ edge proxy กับ process
   จะคนละพอร์ตแล้วขึ้น "Application failed to respond"
5. **Settings → Networking → Generate Domain** จะได้ `xxx.up.railway.app` — จดไว้
6. ตรวจว่ารันจริง:

   ```powershell
   curl.exe https://<railway-domain>/healthz
   # {"ok":true,"connections":0,"pendingTickets":0,"uptimeSeconds":...}
   ```

   ใน deploy log ต้องเห็น `[realtime] listening on :<port>` และ
   `[reconciler-driver] WEB_APP_URL / CRON_SECRET unset — not scheduling`
   (บรรทัดหลังจะหายไปหลังข้อ 3)

---

## 2. Vercel — `apps/web`

1. [vercel.com/new](https://vercel.com/new) → Import `donate-platform`
2. **Root Directory = `apps/web`** (กด Edit ตรง Root Directory ตอน import)
   Framework Preset ต้องขึ้น **Next.js** เอง — `apps/web/vercel.json` (cron รายวัน) จะถูกอ่าน
   จากตรงนี้ด้วย
3. **เพิ่ม Environment Variable `ENABLE_EXPERIMENTAL_COREPACK` = `1`** — ข้อนี้สำคัญ:
   Vercel รองรับ pnpm ถึงเวอร์ชัน 10 แต่รีโปนี้ปักไว้ที่ `pnpm@11.17.0` และ
   `pnpm-workspace.yaml` ใช้คีย์ `allowBuilds` ซึ่งเป็นของ pnpm 11 (pnpm 10 ใช้ชื่อ
   `onlyBuiltDependencies`) ถ้าปล่อยให้ build ด้วย pnpm 10 คีย์นี้ไม่ถูกอ่าน →
   postinstall ของ Prisma ถูกบล็อก → query engine หาย เปิด Corepack แล้วมันจะใช้
   pnpm ตัวเดียวกับเครื่องเรา
4. ใส่ Environment Variables ให้ครบ (เลือก **Production** ไว้ก่อน ถ้าจะให้ preview
   ใช้ได้ด้วยค่อยติ๊ก Preview ทีหลัง):

   | ตัวแปร | ค่า |
   |---|---|
   | `DATABASE_URL` | Neon **pooled** (ก็อปจาก `apps/web/.env`) |
   | `DIRECT_URL` | Neon **direct** (ไม่มี `-pooler`) |
   | `NEXTAUTH_SECRET` | ค่าใหม่ (สุ่มแบบข้อ 0) |
   | `NEXTAUTH_URL` | `https://<vercel-domain>` |
   | `NEXT_PUBLIC_SITE_URL` | `https://<vercel-domain>` |
   | `DEMO_MODE` | `true` |
   | `MOCK_WEBHOOK_SECRET` | ค่าจากข้อ 0 |
   | `PAYMENT_PROVIDER` | `mock` ← อย่าเพิ่งเป็น `omise` เดี๋ยวปุ่มเดโม่พัง (ดูข้อ 6) |
   | `OMISE_PUBLIC_KEY` / `OMISE_SECRET_KEY` / `OMISE_WEBHOOK_SECRET` | **ข้ามไปก่อนได้** ทั้งสามตัว — `env.ts` อ่านมันแบบ lazy และไม่มีใครแตะเลยตอน `PAYMENT_PROVIDER=mock` (CI ก็ build ผ่านโดยไม่มีสามตัวนี้) ค่อยใส่ตอนข้อ 6 |
   | `CRON_SECRET` | ค่าจากข้อ 0 (ตรงกับ Railway) |
   | `REALTIME_JWT_SECRET` | ค่าจากข้อ 0 (ตรงกับ Railway) |
   | `REALTIME_INTERNAL_SECRET` | ค่าจากข้อ 0 (ตรงกับ Railway) |
   | `REALTIME_HTTP_URL` | `https://<railway-domain>` |
   | `NEXT_PUBLIC_REALTIME_WS_URL` | **`wss://`**`<railway-domain>` |
   | `UPSTASH_REDIS_REST_URL` / `_TOKEN` | ข้อ 5 (ไม่ใส่ = rate limit ปิดเงียบ) |
   | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE_URL` | ก็อปจาก `apps/web/.env` ทั้งห้าตัว ขาดตัวเดียว = ปิดฟีเจอร์อัปโหลดทั้งอัน |

   **`wss://` ไม่ใช่ `ws://`** — เบราว์เซอร์ปฏิเสธ ws:// จากหน้า https และค่านี้ inline
   ตอน build ถ้าใส่ผิดต้อง **redeploy** ไม่ใช่แค่แก้ตัวแปร

5. Deploy แล้วจดโดเมนที่ได้ (เปลี่ยนชื่อ subdomain ได้ที่ Settings → Domains
   เหมือนที่เคยทำกับ portfolio) — ถ้าเปลี่ยนชื่อทีหลังต้องกลับไปแก้ `NEXTAUTH_URL`,
   `NEXT_PUBLIC_SITE_URL`, `ALLOWED_ORIGINS`, `WEB_APP_URL` และ R2 CORS ตามด้วย

**เรื่อง migration:** build บน Vercel **ไม่ได้รัน** `prisma migrate deploy` (แค่ `prisma generate`)
ตอนนี้ไม่มีปัญหาเพราะ Neon ตัวเดียวกันนี้ migrate ครบแล้ว แต่ครั้งหน้าที่แก้ schema ต้องรัน
`pnpm --filter @dp/web exec prisma migrate deploy` จากเครื่องตัวเอง (ใช้ `DIRECT_URL`)
**ก่อน** push ไม่งั้นเว็บใหม่จะคุยกับตารางเก่า

---

## 3. กลับไปเติมที่ Railway

| ตัวแปร | ค่า |
|---|---|
| `ALLOWED_ORIGINS` | `https://<vercel-domain>` (ไม่มี `/` ปิดท้าย, หลายค่าคั่นด้วย `,`) |
| `WEB_APP_URL` | `https://<vercel-domain>` |

`ALLOWED_ORIGINS` ที่ไม่ได้ตั้ง = **รับทุก Origin** โดยเตือนไว้ใน log เท่านั้น — WebSocket
ไม่มี preflight เหมือน fetch ตัวนี้จึงเป็นด่านเดียวที่กันหน้าเว็บของคนอื่นเปิดสายเข้ามา
เซฟแล้วเซอร์วิสรีสตาร์ตเอง ใน log ต้องเห็น `[reconciler-driver] every 300s -> https://...`

---

## 4. R2 — เพิ่มโดเมนจริงใน CORS

Cloudflare dashboard → R2 → bucket `donate` → **Settings → CORS Policy**

```json
[
  {
    "AllowedOrigins": ["http://localhost:3000", "https://donate-platform-web.vercel.app"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["content-type"],
    "MaxAgeSeconds": 3600
  }
]
```

ข้ามข้อนี้แล้วอัปโหลดรูปจะตายที่ preflight **บน production เท่านั้น** ในเครื่องยังผ่านปกติ
(และการทดสอบด้วยสคริปต์ฝั่งเซิร์ฟเวอร์ก็ผ่านแม้ไม่มีกฎ CORS เลย — มันไม่ได้พิสูจน์อะไรกับเบราว์เซอร์)
ตรวจด้วย preflight จริง:

```powershell
curl.exe -i -X OPTIONS "https://<r2-public-base>/avatars/x.png" `
  -H "Origin: https://<vercel-domain>" `
  -H "Access-Control-Request-Method: PUT" `
  -H "Access-Control-Request-Headers: content-type"
# ต้องได้ 204 + access-control-allow-origin ที่เป็นโดเมนเรา
```

---

## 5. Upstash — เปิด rate limit ที่ตอนนี้ปิดอยู่

ตอนนี้ `UPSTASH_REDIS_REST_URL` / `_TOKEN` ว่าง และ `lib/rate-limit.ts` **fail open ตั้งใจ**
แปลว่า **ทั้ง 12 route ที่เรียก `rateLimit()` ไม่มีลิมิตเลย** — ใน dev ไม่เป็นไร แต่บนเว็บ public
`/api/register` เหลือแค่ honeypot กัน bot และ `/api/overlay/{token}/ticket` เสียด่านที่ตั้งใจ
วางไว้ **ก่อน** แตะ DB

1. [upstash.com](https://upstash.com) → Create Database (free tier 10k command/วัน ไม่ต้องผูกบัตร)
2. ก็อป **REST URL** + **REST TOKEN** (ไม่ใช่ Redis URL แบบ `redis://`)
3. ใส่ทั้งใน Vercel (Production) **และ** `apps/web/.env` ในเครื่อง
4. Redeploy แล้วดู log: ถ้ายังไม่ได้ตั้งจะมี warning ของ rate limiter ขึ้นทุกครั้งที่ถูกเรียก

---

## 6. Omise webhook — ปิดช่องว่างสุดท้ายของโปรเจกต์

ตอนนี้ `lib/payments/omise.ts` ตรวจลายเซ็นตามสเปกแล้วแต่ **ไม่เคยเจอ event จริงสักครั้ง**
เพราะ Omise ยิงเข้า localhost ไม่ได้ (ต้อง HTTPS + cert จริง) — มี public URL แล้วจึงทำได้

1. [dashboard.omise.co/test/webhooks](https://dashboard.omise.co/test/webhooks) → เพิ่ม endpoint
   `https://<vercel-domain>/api/webhooks/omise`
2. ก็อป signing secret (base64) → `OMISE_WEBHOOK_SECRET` บน Vercel
3. **ชั่วคราว** ตั้ง `PAYMENT_PROVIDER=omise` แล้ว redeploy — route นี้ตรวจลายเซ็นด้วย
   provider ที่เปิดอยู่ ถ้าเป็น `mock` webhook ของ Omise จริงจะโดนตอบ 401
4. เข้าหน้า `/{slug}` สร้างโดเนท → ได้ QR จริงจาก Omise test → ไปกด
   **Actions → Mark as Successful** ที่ dashboard (ไม่มี public API สำหรับขั้นนี้)
5. ดู log ฝั่ง Vercel: ต้องเห็น webhook เข้า **ไม่ใช่** `[webhook] rejected: bad signature`
   แล้วโดเนทเป็น `PAID` + alert เด้งบน overlay
6. **ตั้งกลับเป็น `PAYMENT_PROVIDER=mock`** เพื่อให้ปุ่ม "จำลองการจ่ายเงิน" ที่ HR จะกดใช้ได้
   (MockProvider คือตัวที่ทำให้เดโม่จบได้เองโดยไม่ต้องเข้า dashboard)

ผ่านข้อนี้แล้วประโยคที่พูดในสัมภาษณ์เปลี่ยนจาก "เขียน adapter ตามสเปก Omise"
เป็น "รับ webhook จริงจาก Omise แล้วตรวจลายเซ็นผ่าน" ได้

---

## 7. ตรวจหลัง deploy

ทั้งหมดนี้ทำจากเบราว์เซอร์จริง ไม่ใช่ดูแต่ screenshot — **และเปิด console ดูด้วย**
(เคยมี React warning ซ่อนอยู่ในหน้าที่ดู "เรียบร้อยทุกพิกเซล" มาแล้ว)

- [ ] `https://<railway-domain>/healthz` → `{"ok":true}`
- [ ] เปิดหน้าแรก → เข้าสู่ระบบ `demo@donate-platform.local` / `demo1234`
- [ ] `/dashboard/overlay` → ก็อป URL overlay เปิดอีกแท็บ → console ต้องไม่มี error
      และ `/healthz` ต้องขึ้น `connections: 1`
- [ ] กด **ยิง alert ทดสอบ** → เด้งบนแท็บ overlay ภายในไม่กี่วินาที
- [ ] `/{slug}` → สร้างโดเนท → กดปุ่มจำลองการจ่ายเงิน → alert เด้ง + ขึ้นใน dashboard
- [ ] `/dashboard/profile` → อัปโหลดรูปจริงจากฟอร์ม (ข้อนี้ยังไม่เคยมีใครกดจากเบราว์เซอร์จริง
      สักครั้ง — เป็นการตรวจครั้งแรก) → Network tab ต้องไม่มี 403 SignatureDoesNotMatch
- [ ] ปิดแท็บ overlay → ยิง alert → เปิด overlay ใหม่ → alert ที่หายต้องตามมาจาก `/missed`
- [ ] ลองเปิด overlay ค้างไว้ 2-3 นาที ดูว่าไม่หลุด (heartbeat 30 วิ)
- [ ] วัดเวลา server render ใหม่อีกรอบ — ตัวเลขที่วัดไว้ (`/` 58ms warm) วัดจากเครื่องนี้
      ต่อ Neon ตรง ๆ region ระหว่าง Vercel กับ Neon เป็นคนละเรื่อง

---

## ค่าใช้จ่าย

| บริการ | แผน | ราคา |
|---|---|---|
| Vercel | Hobby | ฟรี (ห้ามใช้เชิงพาณิชย์ — โปรเจกต์นี้ไม่ใช่อยู่แล้ว) |
| Railway | Hobby | **$5/เดือน** (รวมเครดิตใช้งาน $5) — service เล็กแบบนี้ใช้จริง ~$2 |
| Neon | Free | ฟรี |
| Upstash | Free | ฟรี 10k command/วัน |
| Cloudflare R2 | Free tier | ฟรีในโควตา |

Railway ไม่มี free tier ถาวร — ถ้าไม่อยากจ่าย ทางเลือกคือปิด realtime แล้วเว็บยังใช้ได้ทุกอย่าง
ยกเว้น alert สด (overlay จะ reconnect วนไปเรื่อย ๆ) ซึ่งเป็นจุดขายหลักของโปรเจกต์พอดี

---

## อาการที่น่าจะเจอ

| อาการ | สาเหตุที่เจอบ่อยสุด |
|---|---|
| overlay ต่อไม่ติด ไม่มี error ชัด | `NEXT_PUBLIC_REALTIME_WS_URL` เป็น `ws://` หรือแก้แล้วแต่ยังไม่ build ใหม่ |
| WS โดนปิดทันทีที่ต่อ | `ALLOWED_ORIGINS` ไม่ตรงโดเมน (มี `/` ท้าย หรือใส่ `http://`) |
| alert ไม่เด้งแต่โดเนทเป็น PAID | `REALTIME_INTERNAL_SECRET` สองฝั่งไม่ตรง → `/internal/publish` 401 |
| ล็อกอินแล้วเด้งกลับ | `NEXTAUTH_URL` ไม่ใช่โดเมนจริง |
| build ตายที่ Prisma | ลืม `ENABLE_EXPERIMENTAL_COREPACK=1` |
| Railway ขึ้น "Application failed to respond" | ไปตั้ง `PORT` เอง หรือ build command ไม่ได้อ่าน `railway.toml` |
| อัปโหลดรูปตายเฉพาะบน production | R2 CORS ยังไม่มีโดเมนจริง (ข้อ 4) |
| ปุ่มจำลองการจ่ายเงินหาย | `DEMO_MODE` ไม่ใช่สตริง `"true"` เป๊ะ ๆ → route 404 ตามที่ตั้งใจ |

---

## หลัง deploy: รีโปจะ public ไหม

badge CI ใน README กับลิงก์ repo ยัง 404 สำหรับคนที่ไม่มีสิทธิ์ ตราบใดที่รีโปยัง private
ถ้าจะเปิด public ให้ไล่ดู git history หา secret ก่อน (ค่าใน `apps/web/.env` ไม่เคยถูก commit —
`.gitignore` กัน `.env*` ไว้ และมีแต่ `.env.example` ที่เป็นค่าหลอก) และเมื่อเปิดแล้ว
ค่าลับชุด production ที่สร้างในข้อ 0 ก็ยิ่งต้องไม่ใช่ค่าเดียวกับใน dev
