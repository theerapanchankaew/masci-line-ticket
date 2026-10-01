import {addMinutes,validatePolicy} from '../domain/sla';
import type {Bindings} from '../types';
import {id,now,policy} from '../infrastructure/db';
export async function ingestPending(env:Bindings,limit=25){
 const rows=await env.DB.prepare("SELECT * FROM integration_inbox WHERE state='pending' AND next_attempt_at<=? ORDER BY occurred_at,id LIMIT ?").bind(now(),limit).all<any>();
 for(const row of rows.results){try{await processOne(env,row,JSON.parse(row.payload));}catch{await env.DB.prepare("UPDATE integration_inbox SET attempts=attempts+1,state=CASE WHEN attempts>=7 THEN 'failed' ELSE 'pending' END,next_attempt_at=?,error='Event processing failed; inspect configuration or schema' WHERE id=? AND state='pending'").bind(now()+Math.min(60,2**row.attempts)*60_000,row.id).run();}}
 return rows.results.length;
}
async function processOne(env:Bindings,row:any,ev:any){
 const at=now(),account=row.account_key,src=ev.source?.userId;
 const done=env.DB.prepare("UPDATE integration_inbox SET processed_at=?,state='processed',payload='{}',error=NULL WHERE id=?").bind(at,row.id);
 if(ev.type==='unsend'&&ev.unsend?.messageId){await env.DB.batch([
  env.DB.prepare('INSERT OR IGNORE INTO line_unsends VALUES(?,?,?)').bind(account,ev.unsend.messageId,at),
  env.DB.prepare("UPDATE ticket_messages SET content='[ข้อความถูกยกเลิก]',state='unsent' WHERE source_id=? AND direction='incoming' AND ticket_id IN(SELECT id FROM tickets WHERE account_key=?)").bind(ev.unsend.messageId,account),
  env.DB.prepare("UPDATE tickets SET subject='[ข้อความ LINE ถูกยกเลิก]',version=version+1,updated_at=? WHERE account_key=? AND ?=(SELECT source_id FROM ticket_messages WHERE ticket_id=tickets.id AND direction='incoming' ORDER BY created_at,id LIMIT 1)").bind(at,account,ev.unsend.messageId),
  env.DB.prepare("UPDATE notification_outbox SET payload=json_set(payload,'$.text','ข้อความ LINE ถูกยกเลิก'),state=CASE WHEN json_extract(payload,'$.sourceId')=? AND state IN('pending','sending') THEN 'cancelled' ELSE state END WHERE kind='alert' AND ticket_id IN(SELECT id FROM tickets WHERE account_key=?) AND (json_extract(payload,'$.sourceId')=? OR ticket_id IN(SELECT ticket_id FROM ticket_messages WHERE source_id=? AND direction='incoming'))").bind(ev.unsend.messageId,account,ev.unsend.messageId,ev.unsend.messageId),
  env.DB.prepare("UPDATE content_jobs SET state='cancelled' WHERE message_id=? AND ticket_id IN(SELECT id FROM tickets WHERE account_key=?)").bind(ev.unsend.messageId,account),done]);return;}
 if(ev.type!=='message'||!src||!ev.message?.id)throw new Error('Invalid stored event');
 const sourceId=String(ev.message.id),kind=String(ev.message.type??'unknown');
 const existing=await env.DB.prepare("SELECT team_id,policy_json FROM tickets WHERE account_key=? AND customer_id=? AND status IN('new','assigned','in_progress','waiting_customer')").bind(account,src).first<any>();
 const team=existing?.team_id??'service',p=validatePolicy(existing?JSON.parse(existing.policy_json):await policy(env.DB,team));
 const occurred=Number.isFinite(row.occurred_at)?row.occurred_at:at,content=kind==='text'?String(ev.message.text??'').slice(0,4000):`[${kind}]`;
 const tid=id(),mid=id(),op=id(),responseDue=addMinutes(occurred,p.responseMinutes,p);
 const active="SELECT id FROM tickets WHERE account_key=? AND customer_id=? AND status IN('new','assigned','in_progress','waiting_customer')";
 const stmts=[
  env.DB.prepare(`INSERT INTO tickets(id,number,account_key,customer_id,subject,status,team_id,created_at,updated_at,response_due,resolution_due,next_escalation_at,policy_json,last_operation_id)
   SELECT ?, 'MASCI-'||strftime('%Y%m%d','now','+7 hours')||'-'||printf('%06d',COALESCE((SELECT MAX(CAST(substr(number,-6) AS INTEGER)) FROM tickets WHERE number LIKE 'MASCI-'||strftime('%Y%m%d','now','+7 hours')||'-%'),0)+1),?,?,?,'new',?,?,?,?,?,?,?,?
   WHERE NOT EXISTS(SELECT 1 FROM ticket_messages WHERE source_id=?) AND NOT EXISTS(${active})`)
   .bind(tid,account,src,content.replace(/\s+/g,' ').slice(0,120),team,occurred,occurred,responseDue,addMinutes(occurred,p.resolutionMinutes,p),responseDue,JSON.stringify(p),op,sourceId,account,src),
  env.DB.prepare(`UPDATE tickets SET status=CASE WHEN status='waiting_customer' THEN 'in_progress' ELSE status END,updated_at=MAX(updated_at,?),version=version+1,last_operation_id=? WHERE id=(${active}) AND NOT EXISTS(SELECT 1 FROM ticket_messages WHERE source_id=?)`).bind(occurred,op,account,src,sourceId),
  env.DB.prepare(`INSERT INTO ticket_messages(id,ticket_id,source_id,direction,kind,content,state,created_at) SELECT ?,id,?,'incoming',?,CASE WHEN EXISTS(SELECT 1 FROM line_unsends WHERE account_key=? AND message_id=?) THEN '[ข้อความถูกยกเลิก]' ELSE ? END,CASE WHEN EXISTS(SELECT 1 FROM line_unsends WHERE account_key=? AND message_id=?) THEN 'unsent' ELSE 'received' END,? FROM tickets WHERE id=(${active}) AND last_operation_id=? AND NOT EXISTS(SELECT 1 FROM ticket_messages WHERE source_id=?)`).bind(mid,sourceId,kind,account,sourceId,content,account,sourceId,occurred,account,src,op,sourceId),
  env.DB.prepare("UPDATE tickets SET subject=(SELECT substr(content,1,120) FROM ticket_messages WHERE id=?) WHERE id=? AND EXISTS(SELECT 1 FROM ticket_messages WHERE id=?)").bind(mid,tid,mid),
  env.DB.prepare("INSERT INTO ticket_events(id,ticket_id,action,actor_id,note,created_at) SELECT ?,ticket_id,'message_received','system','Incoming LINE message',? FROM ticket_messages WHERE id=?").bind(id(),occurred,mid),
  env.DB.prepare('INSERT OR IGNORE INTO customer_links VALUES(?,?,?,?)').bind(account,src,src,at),
  env.DB.prepare(`INSERT OR IGNORE INTO notification_outbox(id,ticket_id,kind,recipient_id,payload,next_attempt_at,retry_key,line_retry_key,dedupe_key,created_at) SELECT ?,t.id,'alert',s.id,json_object('text','มีข้อความใหม่ใน Ticket '||t.number||': '||t.subject,'ticketId',t.id,'lineTo',s.line_user_id,'emailTo',s.email,'sourceId',m.source_id),?,?,?,?,? FROM ticket_messages m JOIN tickets t ON t.id=m.ticket_id JOIN staff s ON s.id=COALESCE(t.assignee_id,(SELECT id FROM staff WHERE active=1 AND team_id=t.team_id ORDER BY CASE role WHEN 'agent' THEN 0 WHEN 'supervisor' THEN 1 ELSE 2 END,id LIMIT 1)) WHERE m.id=? AND s.active=1`).bind(id(),at,id(),id(),`in:${row.id}`,at,mid),
 ];
 if(['image','file','audio','video'].includes(kind))stmts.push(env.DB.prepare("INSERT OR IGNORE INTO content_jobs(id,ticket_id,message_id,kind,next_attempt_at,created_at) SELECT ?,ticket_id,source_id,kind,?,? FROM ticket_messages WHERE id=? AND state!='unsent'").bind(id(),at,at,mid));
 stmts.push(env.DB.prepare("UPDATE integration_inbox SET processed_at=?,state='processed',payload='{}',error=NULL WHERE id=? AND EXISTS(SELECT 1 FROM ticket_messages WHERE source_id=?)").bind(at,row.id,sourceId));
 const result=await env.DB.batch(stmts);if(!result[result.length-1].meta.changes)throw new Error('Event was not persisted');
}
