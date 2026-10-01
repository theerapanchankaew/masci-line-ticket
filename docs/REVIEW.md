# สถานะการแก้ไข v0.2

ข้อเร่งด่วนที่พบใน v0.1 ได้แก้แล้ว: atomic intake/notification acknowledgement, reply/assign writes ผูกกับ successful operation และ version, idempotent reply request, token-validity guard ใน mutation, response/resolution SLA แยก phase และ reliable outbox พร้อม lease fencing/partial-channel progress/retry-window safety.

เพิ่ม workflow, internal notes, team/staff/SLA settings, dashboard, pagination/mine/deep link, operations recovery + audit, LINE content retrieval/unsend handling, opt-in retention, local setup/dev launcher, preflight และ standalone preview. L Harness bridge รองรับ root endpoint และ lease ownership.

ไม่มีการยืนยันว่า credentials, routing, Access policy หรือ LINE OA ของผู้ใช้ถูกตั้งค่าแล้ว. ตรวจรับจริงตาม ACCEPTANCE.md. Tests ในเครื่องไม่แทน network/provider end-to-end และยังไม่ใช่ browser visual QA ทุกขนาด.
