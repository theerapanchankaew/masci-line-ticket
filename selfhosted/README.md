# MASCI Service Desk — Mini PC / Self-hosted v0.1

รับข้อความ LINE OA → Inbox → เจ้าหน้าที่ตรวจ Mapping → เปิด/เชื่อม Ticket → จัดคิวและมอบหมาย → งานร่วมหลายคน → SLA → ส่งผลกลับ LINE → ลูกค้ายืนยันปิดหรือเปิดกลับ

รุ่นนำร่องที่มีโค้ดทำงานและ automated tests ไม่ใช่การรับรอง production readiness ของระบบ/เครือข่าย MASCI ต้องผ่าน staging และ LINE test account ก่อนเปิดลูกค้าจริง ไม่มี credentials หรือข้อมูลลูกค้าจริงใน repository

## ส่วนประกอบ

- React + TypeScript: Login, Dashboard, Inbox/Mapping, Ticket queue/detail, งานย่อย, บันทึกภายใน, ไฟล์แนบ, Operations และ Settings
- FastAPI + PostgreSQL: API, RBAC, transactions, optimistic versions, idempotency, immutable SLA snapshots และ audit
- Worker: รับ Webhook จาก durable inbox, ดึงไฟล์ LINE, Outbox/retry พร้อม stable provider retry key
- Scheduler: จัดคิว Ticket ที่สร้างแล้วตาม Priority/SLA/เวลารับเรื่อง และตรวจ SLA alerts
- Docker Compose: Database, migrations, API, worker, scheduler, web, gateway และ optional Cloudflare Tunnel

## เริ่มบน Ubuntu / Mini PC

ต้องมี Git, Docker Engine + Compose plugin, Python 3 และ Make โดยติดตั้งตามคู่มือของผู้ผลิตก่อน ขั้นตอนต่อไปนี้รันใน `selfhosted/`

```bash
python3 scripts/init.py
make up
```

เปิด http://localhost:8080 หากเข้าจากเครื่องอื่น ใช้ SSH tunnel ไปยัง port 8080 แล้วเปิด localhost ในเครื่องผู้ใช้ หรือกำหนดโดเมน HTTPS ตามคู่มือ ห้ามเปิด API/DB port สู่ภายนอก

สร้าง Admin โดยใส่รหัสผ่านอย่างน้อย 12 ตัวเมื่อโปรแกรมถาม:

```bash
docker compose run --rm api python -m app.cli bootstrap --email admin@your-domain.example
```

ไม่มี default password และ bootstrap จะปฏิเสธหากมี Admin แล้ว เข้าระบบ → Settings → เพิ่มทีม/Agent → ปรับ Mapping และสร้าง SLA Policy ที่ตกลงแล้ว ตัวเลขเริ่มต้นเป็นตัวอย่างนำร่อง ไม่ใช่คำมั่น MASCI

สร้างข้อความจำลองเพื่อทดลอง:

```bash
docker compose run --rm api python -m app.cli demo-message
```

ไป Inbox → เปิด Ticket → รอ Scheduler มอบหมายให้ Agent ที่พร้อมและมีกำลังรับงาน → เริ่มงาน → เพิ่ม/ทำงานย่อย → ส่งผลแก้ไข ดูสถานะ `simulated` ใน Operations โหมดเริ่มต้นไม่ส่ง LINE จริง

## เชื่อม LINE OA จริง

อ่าน [LINE_SETUP.md](docs/LINE_SETUP.md) ก่อนเปลี่ยนเป็น live ต้องใช้ LINE OA ทดสอบและโดเมน HTTPS ที่คุณควบคุม พร้อม Channel Secret, Channel Access Token และ Bot User ID ของ OA ไม่ส่งค่า secret ผ่านแชทหรือ commit เข้า Git

```bash
python3 scripts/set-secret.py line_secret
python3 scripts/set-secret.py line_token
python3 scripts/set-secret.py tunnel_token
```

แก้ `.env` ให้ `PUBLIC_ORIGIN` เป็นโดเมนจริงและตั้ง `LINE_DESTINATION` ให้ถูกต้อง ตั้ง Tunnel public hostname ไป `http://gateway:8080` จากนั้น:

```bash
docker compose --profile tunnel up -d --build --wait
```

Webhook URL คือ `https://YOUR_DOMAIN/webhooks/line` เริ่ม Verify และทดสอบรับข้อความใน dry_run ก่อน แล้วจึงเปลี่ยน `LINE_MODE=live`, `APP_ENV=production` และ recreate บริการ ข้อความ simulated เดิมจะไม่ถูกส่งย้อนหลัง

## โครงสร้าง

| Path | หน้าที่ |
|---|---|
| `backend/app/main.py` | HTTP routes, authorization และ request validation |
| `backend/app/domain.py` | Ticket lifecycle, Mapping, Dispatch, SLA alerts |
| `backend/app/jobs.py` | Inbox, Outbox และ media jobs |
| `backend/app/sla.py` | Bangkok business calendar และกำหนดเวลา |
| `backend/app/models.py` | Database model |
| `backend/migrations` | Versioned schema |
| `backend/tests` | API/security/workflow/reliability tests |
| `web/src` | เว็บหลังบ้านภาษาไทย |
| `infra` | Gateway และ security headers |
| `scripts` | Initialize, secrets, deploy, backup, restore และ smoke |
| `docs` | Architecture, LINE setup, operations และ acceptance |

## ตรวจโค้ดในเครื่องพัฒนา

```bash
cd backend
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.lock
ruff check .
pytest -q
alembic upgrade head
uvicorn app.main:app --reload
```

Default local development ใช้ SQLite เพื่อทดสอบได้โดยไม่ต้องมี Docker; การใช้งานจริงและทดสอบ concurrency ใช้ PostgreSQL

อีก terminal:

```bash
cd web
npm ci
npm test
npm run build
npm run dev
```

Vite ใช้ port 5173; ตั้ง `PUBLIC_ORIGIN=http://localhost:5173` ตอนรัน Backend หากใช้ browser ผ่าน Vite ไม่ใช้ gateway สำหรับ bootstrap แบบ local ใช้ `python -m app.cli bootstrap --email ...` หลัง migration

PostgreSQL tests ใช้ `TEST_DATABASE_URL=postgresql+psycopg://.../desk_test` เท่านั้น ชุดทดสอบล้างตารางในฐานข้อมูลนี้ ห้ามชี้ฐานข้อมูลจริง

## Deploy และดูแล

```bash
make deploy
make status
make logs
make smoke
make backup
```

Backup มีช่วงหยุดรับงานสั้น ๆ เพื่อให้ DB และไฟล์ตรงกัน คัดลอกสำรองแบบเข้ารหัสออกนอก Mini PC และทดสอบ Restore ตาม [OPERATIONS.md](docs/OPERATIONS.md) ห้ามใช้ `docker compose down -v` กับข้อมูลที่ต้องเก็บ

## ขอบเขตรุ่นนี้

- รองรับ LINE แบบ 1:1 และ OA เดียวต่อ installation
- Mapping เป็นข้อเสนอให้เจ้าหน้าที่ตรวจ; Scheduler จัดคิวอัตโนมัติหลังเปิด Ticket แล้ว
- งานย่อยทำคู่ขนาน/รอตาม dependency ได้ ผู้รับผิดชอบรับ Task โดยตรง ยังไม่มี accept/reject stage
- SLA รองรับปฏิทิน เวลาทำการ วันหยุด P1–P4 และ snapshot; waiting ยังนับเวลา; transfer/reopen ไม่ reset deadline
- Alerts อยู่ในหน้า Operations; ยังไม่มี supervisor push/email หรือ SLA pause
- LINE รับ API request สำเร็จ ≠ ลูกค้าอ่านข้อความ; First response ไม่นับ auto-ack หรือ dry_run
- แยกหลาย Ticket จากบทสนทนาได้ แต่ยังไม่มี Case entity ครอบหลาย Ticket
- ยังไม่รวม LIFF portal, CRM/SSO, AI, task templates, skills/shift routing, data-retention automation และ high availability
- ไม่มีการย้ายข้อมูลจากระบบ Cloudflare เดิมโดยอัตโนมัติ

อ่าน [ARCHITECTURE.md](docs/ARCHITECTURE.md) และ [ACCEPTANCE.md](docs/ACCEPTANCE.md) เพื่อประเมินความพร้อมก่อนใช้ข้อมูลจริง
