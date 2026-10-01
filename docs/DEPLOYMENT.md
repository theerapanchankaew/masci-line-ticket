# Deploy Cloudflare

## 1. สร้างทรัพยากร Ticket

จาก **โฟลเดอร์หลัก masci-line-ticket** หลัง `pnpm install --frozen-lockfile`:

```sh
pnpm --filter @masci/worker exec wrangler login
pnpm --filter @masci/worker exec wrangler d1 create masci-ticket
pnpm --filter @masci/worker exec wrangler r2 bucket create masci-ticket-evidence
pnpm --filter @masci/worker exec wrangler queues create masci-ticket-jobs
pnpm --filter @masci/worker exec wrangler queues create masci-ticket-jobs-dlq
```

ใส่ database id ที่ Cloudflare คืนมาใน `apps/worker/wrangler.jsonc` ใต้ `env.production`. ปรับ bucket/queue names หากชื่อชนในบัญชี. อย่าใช้ D1 ของ L Harness เป็น D1 ของ Ticket. สำหรับ staging ให้สร้างชุดแยกและใช้ configuration แยก; ห้าม seed `scripts/demo.sql` ลง production.

## 2. Variables / Secrets

ปรับ production vars: `ALLOWED_ORIGIN`, `PORTAL_URL`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `LINE_ACCOUNT_KEY` (bot destination user ID), `L_HARNESS_URL` (root URL), `L_HARNESS_ACCOUNT_ID` (account/channel id ถ้า L Harness มีหลาย LINE accounts). `RETENTION_DAYS=0` ไม่ลบ content อัตโนมัติ; กำหนดค่าตามนโยบายที่อนุมัติเมื่อพร้อม.

สำหรับแต่ละ secret ใช้:

```sh
pnpm --filter @masci/worker exec wrangler secret put INTEGRATION_SECRET --env production
pnpm --filter @masci/worker exec wrangler secret put L_HARNESS_API_KEY --env production
pnpm --filter @masci/worker exec wrangler secret put EMAIL_API_KEY --env production
pnpm --filter @masci/worker exec wrangler secret put EMAIL_FROM --env production
```

EMAIL credentials เป็น Resend provider และต้องยืนยัน sending domain; หากใช้ LINE notification อย่างเดียว ไม่จำเป็นต้องเปิด email. Integration secret ต้องสุ่มอย่างน้อย 32 ตัวอักษร. ห้ามใส่ secret ใน source/vars ที่ commit.

## 3. Identity / Routing

Deploy portal ไป Cloudflare Pages. ใช้ root directory ของ repo, build `pnpm install --frozen-lockfile && pnpm --filter @masci/portal build`, output `apps/portal/dist`. แนะนำ custom hostname `tickets.example.org` และ route `tickets.example.org/api/*` ไป Ticket Worker (กำหนด Worker route ใน Cloudflare dashboard); ส่วนหน้าเว็บไป Pages. ให้ `/integrations/line/events` เข้าผ่าน Worker workers.dev หรือ dedicated API hostname ที่ L Harness เรียกได้.

สร้าง Cloudflare Access application ป้องกัน portal/API และจำกัดบุคลากร; API Worker ตรวจ JWT issuer/audience และ active staff เพิ่มอีกชั้น. ใช้ application AUD ของ route/API จริงใน `ACCESS_AUD`. Integration webhook ใช้ shared secret และไม่ต้องผ่าน interactive Access login: หาก Access ครอบคลุม API hostname ให้แยก path/application/bypass เฉพาะ integration endpoint ที่ยังตรวจ secret ใน Worker; ห้าม bypass `/api/*`.

หากใช้ portal/API ต่าง origin ตั้ง `VITE_API_BASE_URL` เป็น HTTPS API root ก่อน build และ `ALLOWED_ORIGIN` เป็น portal origin ที่ตรงเป๊ะ. ตั้ง Access ของ API ให้รับ session ได้และตรวจ authenticated preflight/credentials จริง; CORS header อย่างเดียวไม่สร้าง Access session. Same-origin ลดความซับซ้อนนี้.

## 4. Migrations / Bootstrap admin

```sh
pnpm preflight
pnpm --filter @masci/worker exec wrangler d1 migrations apply DB --remote --env production
pnpm --filter @masci/worker deploy
```

Migration ใช้ 0001, 0002 และ 0003. Backup D1 ก่อนอัปเกรด; ถ้าใช้ v0.1 เดิม apply เฉพาะ migration ใหม่ผ่าน Wrangler โดยไม่แก้ 0001. สร้าง admin แรกด้วย D1 console (แก้ค่าจริงทุกช่อง):

```sql
INSERT INTO staff(id,email,name,role,team_id,line_user_id,active)
VALUES('initial-admin','YOUR_ACCESS_EMAIL','YOUR_NAME','admin','service',NULL,1);
```

ล็อกอินแล้วเพิ่มทีม/เจ้าหน้าที่ผ่าน Settings. Email ต้องตรง Access identity. กำหนด notification LINE user id หรือเปิด email ของผู้รับ; ถ้าไม่มีช่องทาง งานแจ้งเตือนจะแสดง failed ใน Operations.

## 5. L Harness / Acceptance / Monitoring

ใช้ deployment/setup ของ `upstream/l-harness/README.en.md` และ [LINE_SETUP](LINE_SETUP.md) แยก workspace. Apply bridge migrations 073 + 074 กับ **D1 ของ L Harness** ก่อน deploy patched L Harness.

ตรวจตาม [ACCEPTANCE](ACCEPTANCE.md). Cron Ticket ทุกนาทีทำ reconciliation จาก D1; Queue consumer batch size 1/concurrency 4. ตั้ง Cloudflare alerts สำหรับ worker errors, DLQ queue depth, job backlog, D1/R2 usage และ L Harness bridge failures. Operations แสดง durable D1 jobs; ไม่ได้อ่าน provider DLQ dashboard โดยตรง. ถ้าต้อง replay DLQ ให้ replay ผ่าน Cloudflare console แล้วตรวจ D1 job state; ตัว jobs idempotent.

อย่า rollback binary ไป v0.1 หลัง 0002/0003 โดยไม่ประเมิน compatibility. รักษา backup ก่อน deploy และทดสอบ restore ใน staging. เลือก R2 object retention/backups ให้สอดคล้องกับ policy; เปิดการลบอัตโนมัติเฉพาะเมื่อทบทวนระยะเวลาแล้ว.
