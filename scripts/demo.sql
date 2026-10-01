INSERT OR IGNORE INTO staff(id,email,name,role,team_id,line_user_id,active) VALUES
 ('demo-admin','demo-admin@masci.local','ผู้ดูแลระบบ','admin','service',NULL,1),
 ('demo-supervisor','demo-supervisor@masci.local','หัวหน้าทีม','supervisor','service',NULL,1),
 ('demo-agent','demo-agent@masci.local','เจ้าหน้าที่บริการ','agent','service',NULL,1);

INSERT OR IGNORE INTO tickets(
 id,number,account_key,customer_id,subject,category,status,team_id,assignee_id,
 created_at,updated_at,response_due,resolution_due,first_response_at,resolved_at,closed_at,
 version,escalation_level,next_escalation_at,sla_breached,policy_json,last_operation_id
) VALUES
 ('demo-ticket-001','MASCI-DEMO-001','demo-account','U-demo-customer-001','สอบถามสถานะการรับรองผลิตภัณฑ์','การรับรอง','new','service',NULL,
  unixepoch('now')*1000-3600000,unixepoch('now')*1000-3600000,unixepoch('now')*1000-1800000,unixepoch('now')*1000+14400000,NULL,NULL,NULL,1,1,unixepoch('now')*1000+1800000,1,
  '{"responseMinutes":30,"resolutionMinutes":240,"escalationMinutes":60,"maxLevel":2,"businessHours":false,"startHour":9,"endHour":17,"holidays":[]}',NULL),
 ('demo-ticket-002','MASCI-DEMO-002','demo-account','U-demo-customer-002','ขอข้อมูลเอกสารประกอบการสมัคร','ข้อมูลทั่วไป','in_progress','service','demo-agent',
  unixepoch('now')*1000-1200000,unixepoch('now')*1000-600000,unixepoch('now')*1000+600000,unixepoch('now')*1000+13200000,unixepoch('now')*1000-600000,NULL,NULL,2,0,unixepoch('now')*1000+3600000,0,
  '{"responseMinutes":30,"resolutionMinutes":240,"escalationMinutes":60,"maxLevel":2,"businessHours":false,"startHour":9,"endHour":17,"holidays":[]}',NULL),
 ('demo-ticket-003','MASCI-DEMO-003','demo-account','U-demo-customer-003','ติดตามใบแจ้งหนี้ค่าบริการ','การเงิน','waiting_customer','service','demo-agent',
  unixepoch('now')*1000-5400000,unixepoch('now')*1000-4500000,unixepoch('now')*1000-3600000,unixepoch('now')*1000+9000000,unixepoch('now')*1000-4500000,NULL,NULL,3,0,unixepoch('now')*1000+86400000,0,
  '{"responseMinutes":30,"resolutionMinutes":240,"escalationMinutes":60,"maxLevel":2,"businessHours":false,"startHour":9,"endHour":17,"holidays":[]}',NULL);

INSERT OR IGNORE INTO customer_links(account_key,customer_id,line_user_id,created_at) VALUES
 ('demo-account','U-demo-customer-001','U-demo-customer-001',unixepoch('now')*1000),
 ('demo-account','U-demo-customer-002','U-demo-customer-002',unixepoch('now')*1000),
 ('demo-account','U-demo-customer-003','U-demo-customer-003',unixepoch('now')*1000);

INSERT OR IGNORE INTO ticket_messages(id,ticket_id,source_id,direction,kind,content,state,created_at,actor_id) VALUES
 ('demo-message-001','demo-ticket-001','demo-source-001','incoming','text','สวัสดีครับ อยากทราบว่าคำขอรับรองผลิตภัณฑ์ที่ยื่นไว้ถึงขั้นตอนไหนแล้วครับ','received',unixepoch('now')*1000-3600000,NULL),
 ('demo-message-002','demo-ticket-002','demo-source-002','incoming','text','ต้องใช้เอกสารอะไรบ้างสำหรับสมัครบริการครับ','received',unixepoch('now')*1000-1200000,NULL),
 ('demo-message-003','demo-ticket-002',NULL,'outgoing','text','ส่งรายการเอกสารเบื้องต้นให้แล้วครับ หากมีข้อสงสัยแจ้งได้เลย','sent',unixepoch('now')*1000-600000,'demo-agent'),
 ('demo-message-004','demo-ticket-003','demo-source-003','incoming','text','ได้รับรายละเอียดแล้วครับ กำลังตรวจสอบข้อมูลและจะตอบกลับอีกครั้ง','received',unixepoch('now')*1000-5400000,NULL);

INSERT OR IGNORE INTO ticket_events(id,ticket_id,action,actor_id,note,created_at) VALUES
 ('demo-event-001','demo-ticket-001','created','system','ตัวอย่างงานจาก LINE',unixepoch('now')*1000-3600000),
 ('demo-event-002','demo-ticket-002','created','system','ตัวอย่างงานจาก LINE',unixepoch('now')*1000-7200000),
 ('demo-event-003','demo-ticket-002','reply_queued','demo-agent','ส่งคำตอบตัวอย่างแล้ว',unixepoch('now')*1000-600000),
 ('demo-event-004','demo-ticket-003','created','system','ตัวอย่างงานจาก LINE',unixepoch('now')*1000-172800000);

UPDATE tickets SET sla_started_at=COALESCE(sla_started_at,created_at),escalation_phase=CASE WHEN first_response_at IS NULL THEN 'response' ELSE 'resolution' END WHERE id LIKE 'demo-ticket-%';
