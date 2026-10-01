# ตรวจรับก่อนเปิดงานจริง

## ชุดทดสอบใน source

`pnpm check`: TypeScript, SLA/unit/integration tests ที่ใช้ SQLite transaction จริง และ build. ครอบคลุม concurrent intake/replies, stale version/token, atomic alert failure/recovery, idempotent requests, workflow, phase-based SLA, retry-window safety, partial channel progress, file retrieval/unsend, RBAC/settings, retention และ L Harness bridge.

`pnpm test:edge` หลัง build: Workerd พร้อม D1/R2 ในเครื่องจริง รับ webhook, ingest, token claim, concurrent reply APIs, multipart upload/download และ operations. ไม่เรียก LINE/Resend จริง.

`pnpm build:preview && pnpm test:preview`: standalone bundle แสดงคิว/รายละเอียด, writes ถูกปิด, dashboard/operations/settings และ startup fallback ผ่าน DOM assertions. ยังต้อง visual/interaction QA บน Chrome/Edge/mobile จริง.

## Staging ด้วย credentials ของเจ้าของระบบ

| กรณี | สิ่งที่ต้องเห็น |
| --- | --- |
| Access sign-in / expiry | ผู้ใช้อยู่ staff จึงเข้าได้; ไม่มี Access JWT หรือ inactive staff ถูกปฏิเสธ; agent ไม่เข้าหน้า Operations/Settings management |
| LINE text / image / file | สร้าง Ticket พร้อมข้อความ, blob ที่ไม่เกิน 10 MB ดาวน์โหลดผ่าน API ที่ตรวจสิทธิ์ได้ |
| Duplicate / concurrent events | หนึ่ง active Ticket ต่อ user และเก็บครบทุก distinct message; redelivery ไม่เพิ่มข้อความ/notification ซ้ำ |
| Claim / assign / transfer | ใช้ version ปัจจุบัน, เก็บ audit; อีกทีม/เจ้าหน้าที่ที่ไม่มีสิทธิ์ดำเนินการไม่ได้ |
| Concurrent reply / timeout | request ID เดิม retry ไม่ส่งซ้ำ; stale version ไม่สร้าง message/outbox; สถานะ LINE accepted แยกจาก delivered/read |
| SLA | ตอบแล้วก่อน resolution due ไม่ escalate; breach แยก phase, holiday/weekend ถูกต้อง, reopen เริ่มรอบใหม่; waiting_customer ยังนับ SLA |
| Provider / queue failure | Durable job อยู่ D1, lease ที่หมดอายุกู้คืนได้, terminal failed/uncertain เห็นใน Operations; retry ใช้ key เดิมและ audit |
| Unsends | ไม่แสดงข้อความที่ยกเลิก, ดึง blob ไม่ได้ทันที และ purge R2 ในงานถัดไป; ทดสอบ unsend มาก่อน message ด้วย |
| Notes / resolve / close | note ไม่ส่ง LINE, ปิดงานไม่ได้ถ้ามี reply ที่ยังไม่จัดการ, ทุกการเปลี่ยนสถานะมีประวัติ |
| Email / notification | ผู้รับมีช่องทางจริง, LINE accepted แต่ email ล้มเหลว retry ไม่ส่ง LINE ใหม่ |
| Retention (ถ้าเปิด) | ปิด default; งาน active ไม่ถูกลบ; งาน terminal เกินอายุถูก redact + purge evidence และเปิดงานเดิมใหม่ไม่ได้ |
| Backup / restore | กู้ D1 และ evidence จากกระบวนการที่กำหนดได้; ตรวจ job states/keys หลัง restore ก่อนเปิดส่งต่อ |

ผู้ดูแลควรบันทึก environment, เวลาทดสอบ, Ticket/event/request IDs, ผลที่คาดและผลจริง โดยไม่เก็บ secret. เมื่อผ่านทุกกรณีที่ใช้จริงจึงเปิดบัญชี production.
