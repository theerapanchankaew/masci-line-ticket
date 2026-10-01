import type {Bindings} from '../types';
import {id,now} from '../infrastructure/db';
// Disabled unless the owner explicitly configures a retention period.
export async function processRetention(env:Bindings){
 const days=Number(env.RETENTION_DAYS??0);if(!Number.isInteger(days)||days<30||days>3650)return;
 const cutoff=now()-days*86400000;
 const rows=await env.DB.prepare("SELECT * FROM tickets WHERE status IN('closed','cancelled') AND closed_at<? AND retention_state IN('pending','processing') ORDER BY closed_at LIMIT 5").bind(cutoff).all<any>();
 for(const t of rows.results){
  if(t.retention_state==='pending'){
   const claim=await env.DB.prepare("UPDATE tickets SET retention_state='processing',version=version+1 WHERE id=? AND version=? AND status IN('closed','cancelled') AND retention_state='pending'").bind(t.id,t.version).run();if(!claim.meta.changes)continue;
  }
  const attachments=await env.DB.prepare('SELECT object_key FROM attachments WHERE ticket_id=?').bind(t.id).all<any>();
  for(const a of attachments.results)await env.EVIDENCE.delete(a.object_key);
  await env.DB.batch([
   env.DB.prepare('DELETE FROM attachments WHERE ticket_id=?').bind(t.id),
   env.DB.prepare("UPDATE ticket_messages SET content='[ข้อมูลหมดอายุการเก็บ]',source_id=NULL WHERE ticket_id=?").bind(t.id),
   env.DB.prepare("UPDATE ticket_events SET note='[รายละเอียดหมดอายุการเก็บ]' WHERE ticket_id=?").bind(t.id),
   env.DB.prepare("UPDATE operation_audit SET note='[รายละเอียดหมดอายุการเก็บ]' WHERE target_id IN(SELECT id FROM notification_outbox WHERE ticket_id=? UNION SELECT id FROM content_jobs WHERE ticket_id=?)").bind(t.id,t.id),
   env.DB.prepare("UPDATE notification_outbox SET payload='{}',error=NULL,state=CASE WHEN state IN('pending','failed','uncertain') THEN 'cancelled' ELSE state END WHERE ticket_id=?").bind(t.id),
   env.DB.prepare('DELETE FROM content_jobs WHERE ticket_id=?').bind(t.id),
   env.DB.prepare('DELETE FROM api_requests WHERE ticket_id=?').bind(t.id),
   env.DB.prepare("UPDATE tickets SET customer_id=?,subject='[ข้อมูลหมดอายุการเก็บ]',retention_state='processed',retention_processed_at=?,updated_at=?,version=version+1 WHERE id=? AND retention_state='processing'").bind(`deleted:${t.id}`,now(),now(),t.id),
   env.DB.prepare('DELETE FROM customer_links WHERE account_key=? AND customer_id=? AND NOT EXISTS(SELECT 1 FROM tickets WHERE account_key=? AND customer_id=?)').bind(t.account_key,t.customer_id,t.account_key,t.customer_id),
   env.DB.prepare("INSERT INTO ticket_events VALUES(?,?,'retention_completed','system','Content and evidence removed under configured retention policy',?)").bind(id(),t.id,now()),
  ]);
 }
 await env.DB.prepare("UPDATE integration_inbox SET payload='{}',state='cancelled',error=NULL WHERE state IN('failed','cancelled') AND received_at<?").bind(cutoff).run();
 await env.DB.prepare('DELETE FROM line_unsends WHERE created_at<?').bind(cutoff).run();
}
