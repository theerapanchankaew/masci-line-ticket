# LINE / L Harness integration

1. ตั้ง LINE OA/channel และ L Harness ตาม upstream README; ใช้ L Harness เป็น webhook receiver ที่ตรวจ LINE signature จาก raw body. เปิด webhook redelivery ใน LINE Developers Console.
2. Source L Harness ที่ส่งมามี bridge ใน `apps/worker/src/routes/webhook.ts`, `src/services/masci-ticket-bridge.ts`, `src/scheduled.ts` และ optional Env bindings ใน `src/index.ts`; SDK มี UnsendEvent. Apply migrations `packages/db/migrations/073_masci_ticket_bridge_outbox.sql` และ `074_masci_bridge_leases.sql` กับ L Harness D1. สำเนา SQL อยู่ใน `integration/l-harness/patches`. ถ้า apply 073 แล้ว ให้ apply เฉพาะ 074 เพิ่ม.
3. ตั้ง `MASCI_TICKET_URL=https://YOUR_TICKET_API/integrations/line/events` ที่ L Harness. Bridge รองรับ root URL โดยเติม path แต่แนะนำระบุ endpoint เต็ม. URL ต้อง HTTPS (ยกเว้น localhost). ตั้ง `MASCI_TICKET_SECRET` ตรงกับ `INTEGRATION_SECRET` ฝั่ง Ticket; ทั้งสองเป็น secret.
4. ตั้ง Ticket `LINE_ACCOUNT_KEY` ตรง webhook destination bot user ID; Ticket `L_HARNESS_URL` เป็น root ของ L Harness. `L_HARNESS_API_KEY` ใช้ Harness API token ของ service account ที่มีสิทธิ์ส่ง; `L_HARNESS_ACCOUNT_ID` ใช้ account/channel id หากมีหลายบัญชี.
5. ทดสอบข้อความ user จริงที่เป็นเพื่อนของ OA, reply, notifications และ content retrieval. Ticket reply จากเจ้าหน้าที่ส่ง `X-Line-Harness-Source: manual`; notifications อัตโนมัติไม่ส่ง header นี้.

Bridge เขียน outbox ก่อน ACK LINE. ถ้า D1 เขียนไม่ได้จะตอบ 503 ให้ LINE redeliver. Bridge ส่งต่อพร้อม retry/lease fencing และ Ticket ingress ACK เฉพาะหลังเขียน durable inbox. Ticket ingest รวม message/event/alert/ACK ใน transaction เดียว; ข้อความหลายอันของคนเดียวกันจะอยู่ใน Ticket active เดียว.

ข้อความเก็บสูงสุด 4,000 ตัวอักษรตาม envelope ที่เลือกใน pilot; non-text มี job ดึง blob ผ่าน `/line-api-data/v2/bot/message/{messageId}/content` สูงสุด 10 MB. ไฟล์เกินเพดาน/หมดอายุ/ไม่มีสิทธิ์ขึ้น failed ใน Operations. ไม่อ้างว่าทุกเนื้อหาที่ LINE เคยส่งจะยังเรียกกลับได้ตลอดไป.

LINE push ใช้ UUID retry key เดิมทุก attempt. แม้ provider ตอบ success/accepted duplicate ก็ยืนยันเพียงการรับคำขอ ไม่ยืนยัน delivery/read. ระบบหยุด auto retry ที่ 23 ชั่วโมงหลัง first attempt และขึ้น uncertain ให้ผู้ดูแลตรวจหลักฐานก่อน reconcile; ไม่ออก key ใหม่เงียบ ๆ เพื่อ resend งานเดิม. เอกสาร LINE: https://developers.line.biz/en/docs/messaging-api/retrying-api-request/.

## Monitor bridge (ฐานข้อมูล L Harness)

```sql
SELECT id,status,attempts,last_error,created_at FROM masci_ticket_bridge_outbox
WHERE status IN('failed','pending','sending') ORDER BY created_at LIMIT 100;
```

หลังแก้ ingress/config แล้ว ผู้ดูแล retry เฉพาะ row ที่ตรวจแล้วด้วย D1 console:

```sql
UPDATE masci_ticket_bridge_outbox
SET status='pending',attempts=0,next_attempt_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),lease_until=NULL
WHERE id='REPLACE_VERIFIED_EVENT_ID' AND status='failed';
```

การ retry inbound event ไม่มีการส่งข้อความออกโดยตรง และ Ticket จะ dedupe event/message id. งาน bridge ถูกเก็บใน D1 ของ L Harness จึงไม่อยู่ใน Operations ของ Ticket; ต้องตั้ง alert/ตรวจทั้งสอง Workers.
