# Security / Operations policy

Production ใช้ Cloudflare Access JWT issuer/audience verification และ active staff identity. Local demo auth ต้อง ENVIRONMENT development + localhost + explicit flag; ห้ามใส่ demo staff ลง cloud. API mutation ตรวจ Origin เมื่อ browser ส่งมา และ version/permission; tokens ผูก actor/action/ticket/version, หมดอายุ และใช้ครั้งเดียว. Reply ต้อง UUID idempotency key; retry เนื้อหาเดิมด้วย key เดิม.

Integration มี shared secret สุ่มอย่างน้อย 32 ตัวอักษร ตรวจ digest แบบ constant-time และ account destination. Signed LINE webhook verification อยู่ L Harness. Body limits และ attachment size limits ถูกกำหนดใน Worker. Evidence บังคับ download ผ่าน authenticated API, Content-Disposition แบบ encoded, no-store/nosniff; binary LINE content ไม่ render inline.

Production logs ไม่บันทึกข้อความ/secret หรือ provider body. Development error messages ใช้สำหรับ local troubleshooting เท่านั้น. Operations จำกัด supervisor ต่อทีม และ admin ทั้งระบบ; job actions/staff/settings มี audit. `accepted` คือ provider รับคำขอ ไม่ใช่หลักฐานการอ่าน/การส่งถึง user.

## Retention

`RETENTION_DAYS=0` เป็นค่าเริ่มต้นและปิด auto cleanup. ถ้าเจ้าของข้อมูล/ระบบอนุมัติระยะเวลา 30–3650 วัน จึงตั้ง production var. Job จะ lock งาน closed/cancelled ที่อายุเกินช่วงกำหนด, purge R2 evidence, redact customer ID/subject/message/event-note/outbox payload และคงเวลา/สถานะสถิติ. งาน active ไม่ถูกทำลาย; Ticket ที่ redact แล้วเปิดใหม่ไม่ได้. กรณี delete R2 สำเร็จแต่ DB ล้มเหลว job จะ retry ได้. Failed/cancelled raw inbox ที่เกินอายุถูกล้าง payload. ห้ามเปิดค่าลบอัตโนมัติใน staging ที่ใช้หลักฐานจริงโดยไม่มี policy.

กำหนด backup retention, Restore procedure และสิทธิ์ Cloudflare account แยกด้วย; backups อาจยังเก็บข้อมูลที่ถูก redact ในฐาน live. R2 objects ที่ upload แล้ว DB metadata ไม่สำเร็จถูก cleanup ในคำขอปกติ; กรณี process crash ระหว่าง upload และ DB commit อาจมี orphan object ให้กำหนดการตรวจ orphan ตามอายุและ metadata ก่อนลบ. ระบบไม่ claim PDPA/compliance certification โดยอัตโนมัติ.

กรณี provider timeout เกิน safe retry window จะใช้สถานะ uncertain. ตรวจ logs/request reference ที่ provider ก่อนใช้ accepted reconciliation; การ cancel คือหยุด retry ไม่สามารถถอนข้อความที่ provider รับไปแล้ว. หลัง D1 restore ให้ตรวจ retry timestamps/windows ก่อนเปิด consumer/scheduler เพื่อป้องกันการส่งซ้ำย้อนหลัง.
