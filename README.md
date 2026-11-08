# MASCI LINE Ticket v0.2

> **Mini PC / Docker / PostgreSQL:** ดู [Self-hosted Service Desk](selfhosted/README.md) ซึ่งเป็น stack แยกสำหรับ LINE OA โดยตรง พร้อม Mapping, Dispatch, Tasks และ SLA. รุ่น Cloudflare ด้านล่างยังคงใช้งานตามเดิม.

รับข้อความจาก LINE OA เป็น Ticket พร้อมคิวงาน, เจ้าหน้าที่รับผิดชอบ, SLA, บันทึกภายใน, หลักฐาน และประวัติการดำเนินการ ส่งคำตอบผ่าน L Harness Proxy และใช้ Cloudflare D1/R2/Queues.

## เปิดดูหน้าจอทันที

เปิด `preview.html` ในโฟลเดอร์หลักด้วยเบราว์เซอร์ได้โดยตรง ไม่ต้องติดตั้งอะไร. ใช้ข้อมูลจำลอง อ่านอย่างเดียว; ดูคิวงาน, รายละเอียด, Dashboard, Operations และ Settings ได้. ไฟล์ `apps/portal/index.html` เป็น entry ของ React จึงต้องเปิดผ่าน Vite เมื่อใช้งานระบบจริง.

## เริ่มระบบในเครื่อง (Windows / macOS / Linux)

แนะนำ Node.js 24 LTS, pnpm 9.15.4+ (ขั้นต่ำ Node 22.16 สำหรับ tests).

```sh
pnpm install --frozen-lockfile
pnpm setup:local
pnpm dev
```

เปิด `http://localhost:5173`. คำสั่ง setup สร้าง `.dev.vars` เฉพาะเมื่อยังไม่มี, apply migrations ในเครื่อง และ seed ข้อมูล demo; ไม่แก้ฐานข้อมูล cloud. `pnpm dev` เปิดทั้ง Worker API ที่ 8787 และ Vite ที่ 5173. เลือก demo admin/supervisor/agent ด้านล่างหน้าเว็บ. Local demo authentication ถูกปฏิเสธใน production.

ข้อมูล demo ไม่มี LINE user จริงและไม่มี provider credentials. การตอบใน local demo จึงใช้ตรวจการเข้าคิว/สถานะผิดพลาด; ถ้าจะทดสอบส่งจริงให้ใช้บัญชี LINE ทดสอบและ Ticket ของ user จริง. Local Cron ไม่เดินเหมือน cloud; ใช้ปุ่ม **รัน scheduler (Local)** ใน Operations เพื่อทดสอบ SLA/งานค้าง.

## ฟังก์ชัน

- คิวงาน, งานของฉัน, ค้นหา, pagination และ deep link `?ticket=ID`.
- รับงาน, มอบหมาย, โอนทีมโดย admin, รอลูกค้า, ดำเนินการต่อ, แก้ไข, ปิด, ยกเลิก และเปิดงานใหม่.
- ข้อความตอบ LINE พร้อม request idempotency, บันทึกภายใน และยืนยันหลักฐานการตอบจากช่องทางภายนอก.
- Evidence upload/download ผ่าน R2; ดึงรูป/ไฟล์/เสียง/วิดีโอจาก LINE สูงสุด 10 MB ผ่าน content jobs.
- Response และ resolution SLA แยก phase, business calendar Asia/Bangkok และ policy snapshot ต่อ Ticket; รอลูกค้ายังนับเวลา, โอนทีมไม่เปลี่ยนกำหนดเดิม, reopen เริ่มรอบใหม่.
- Dashboard: compliance ของงานแก้ไขแล้ว, เวลาเฉลี่ยตอบ/แก้ไข, backlog/workload และ Ticket ใหม่ 14 วัน.
- Operations: งาน inbox/outbox/content ที่ค้างหรือล้มเหลว, retry, หยุด retry, ยืนยันการรับคำขอพร้อม provider reference และ audit.
- ตั้งค่า SLA, ทีม และเจ้าหน้าที่/บทบาท; email ผูกกับ Cloudflare Access identity.
- Retention เป็น opt-in: `RETENTION_DAYS=0` ปิดอัตโนมัติ; ค่าที่เลือก 30–3650 วันจะลบ content/evidence ของงานปิด/ยกเลิกที่เกินอายุ และคงข้อมูลสถิติ. ดู SECURITY ก่อนเปิด.

## โครงสร้าง

| Path | หน้าที่ |
| --- | --- |
| `apps/portal` | React + TypeScript + Vite ภาษาไทย |
| `apps/worker` | Hono API, Cloudflare Access, D1/R2/Queues, scheduled jobs |
| `packages/contracts` | สัญญาข้อมูลร่วม |
| `upstream/l-harness` | สำเนา upstream พร้อม patch bridge; workspace/deployment แยก |
| `integration/l-harness` | migration, monitoring SQL และขั้นตอนเชื่อม L Harness |
| `scripts` | setup/dev/preflight/preview/runtime tests |

## ตรวจโค้ด

```sh
pnpm check
pnpm test:edge
pnpm build:preview
pnpm test:preview
```

`check` ตรวจ TypeScript, SQLite-backed integration/unit tests และ production build. `test:edge` ใช้ Workerd + D1/R2 ในเครื่องจริง ต้อง build Worker ก่อน. `test:preview` ตรวจ DOM ของ bundle standalone; ไม่ใช่ visual QA ใน browser ทุกชนิด. CI รันชุดนี้โดยไม่ใช้ secret.

## Deploy

อ่าน [DEPLOYMENT](docs/DEPLOYMENT.md), [LINE_SETUP](docs/LINE_SETUP.md), [SECURITY](docs/SECURITY.md) และ [ACCEPTANCE](docs/ACCEPTANCE.md). ตั้งค่า placeholders/secrets/resources ของบัญชีคุณก่อน deploy. ใช้ `pnpm preflight` ตรวจ config ที่ commit. โค้ดไม่สามารถยืนยัน LINE/Access/email/live resources ของคุณจากเครื่องนี้ได้ จึงต้องผ่าน staging acceptance ก่อนเปิดงานจริง.

ตั้ง `VITE_API_BASE_URL` **ก่อน build** หากแยก origin. แนะนำ domain เดียว: `tickets.example.org/api/*` route ไป Ticket Worker และส่วนหน้าเว็บไป Pages; Access และ API audience จึงตรงกัน. อย่าให้ Pages preview domain เรียก API production โดยไม่ได้กำหนด Access/CORS.

## Upstream / License

ต่อยอดจาก `Shudesu/line-harness-oss` commit `53864603502ae4ccdf350f39a71264b4b41155f2`. เก็บ MIT License และ attribution ไว้ใน LICENSE/NOTICE. Root install/build ไม่ติดตั้ง workspace ของ upstream; ติดตั้งและ deploy L Harness แยกตาม README ของ upstream และคู่มือ integration. คุณนำโฟลเดอร์นี้ไป `git init` และ push repo ของตนเองได้ ไม่มี remote ของ upstream ผูกอยู่.
