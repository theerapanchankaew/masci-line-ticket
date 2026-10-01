import {now,id,teamRecipients} from '../infrastructure/db';
import {addMinutes,validatePolicy} from '../domain/sla';
import {ingestPending} from '../application/ingest';
import {processContent} from './content';
import {processRetention} from './retention';
import type {Bindings} from '../types';
class DeliveryError extends Error{constructor(public status:number){super(`Delivery provider returned ${status}`)}}
export function harnessHeaders(env:Bindings){if(!env.L_HARNESS_API_KEY)throw new Error('L Harness credentials not configured');const headers:Record<string,string>={authorization:`Bearer ${env.L_HARNESS_API_KEY}`};if(env.L_HARNESS_ACCOUNT_ID)headers['x-line-account-id']=env.L_HARNESS_ACCOUNT_ID;return headers;}
export async function sendLine(env:Bindings,payload:any,retry:string){
 const headers={...harnessHeaders(env),'content-type':'application/json','x-line-retry-key':retry,...(payload.manual?{'x-line-harness-source':'manual'}:{})};
 const r=await fetch(`${env.L_HARNESS_URL.replace(/\/$/,'')}/line-api/v2/bot/message/push`,{method:'POST',headers,body:JSON.stringify({to:payload.to,messages:[{type:'text',text:payload.text}]}),signal:AbortSignal.timeout(15000)});
 if(!r.ok&&!(r.status===409&&r.headers.has('x-line-accepted-request-id')))throw new DeliveryError(r.status);
}
async function sendEmail(env:Bindings,to:string,text:string,key:string){
 const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{authorization:`Bearer ${env.EMAIL_API_KEY}`,'content-type':'application/json','idempotency-key':key},body:JSON.stringify({from:env.EMAIL_FROM,to:[to],subject:'MASCI Ticket — แจ้งเตือนงาน',text}),signal:AbortSignal.timeout(15000)});if(!r.ok)throw new DeliveryError(r.status);
}
export async function processOutbox(env:Bindings,only?:string,limit=20){
 const at=now(),rows=await env.DB.prepare(`SELECT * FROM notification_outbox WHERE ((state='pending' AND next_attempt_at<=?) OR (state='sending' AND lease_until<=?)) ${only?'AND id=?':''} ORDER BY next_attempt_at LIMIT ?`).bind(at,at,...(only?[only]:[]),limit).all<any>();
 for(const row of rows.results){
  const lease=id(),claim=await env.DB.prepare("UPDATE notification_outbox SET state='sending',lease_token=?,lease_until=?,attempts=attempts+1,line_retry_key=COALESCE(line_retry_key,?),first_attempt_at=COALESCE(first_attempt_at,?) WHERE id=? AND ((state='pending' AND next_attempt_at<=?) OR (state='sending' AND lease_until<=?))").bind(lease,now()+60000,id(),now(),row.id,now(),now()).run();if(!claim.meta.changes)continue;
  const r=await env.DB.prepare('SELECT * FROM notification_outbox WHERE id=? AND lease_token=?').bind(row.id,lease).first<any>();if(!r)continue;
  try{
   if(now()-r.first_attempt_at>=23*3600000){await env.DB.prepare("UPDATE notification_outbox SET state='uncertain',error='Retry safety window expired; verify provider acceptance before reconciliation',lease_until=NULL WHERE id=? AND lease_token=?").bind(r.id,lease).run();continue;}
   const p=JSON.parse(r.payload);
   if(r.kind==='reply'){
    if(!r.line_sent_at){await sendLine(env,p,r.line_retry_key);await env.DB.prepare('UPDATE notification_outbox SET line_sent_at=? WHERE id=? AND lease_token=?').bind(now(),r.id,lease).run();}
   }else{
    const currentTicket=await env.DB.prepare('SELECT status,retention_state FROM tickets WHERE id=?').bind(r.ticket_id).first<any>();if(!currentTicket||!['new','assigned','in_progress','waiting_customer'].includes(currentTicket.status)||currentTicket.retention_state!=='pending'){await env.DB.prepare("UPDATE notification_outbox SET state='cancelled',lease_until=NULL WHERE id=? AND lease_token=?").bind(r.id,lease).run();continue;}
    const recipient=await env.DB.prepare('SELECT * FROM staff WHERE id=? AND active=1').bind(r.recipient_id).first<any>();if(!recipient)throw new Error('Active recipient not found');
    if(!Object.hasOwn(p,'lineTo')){p.lineTo=recipient.line_user_id;p.emailTo=recipient.email;await env.DB.prepare('UPDATE notification_outbox SET payload=? WHERE id=? AND lease_token=?').bind(JSON.stringify(p),r.id,lease).run();}
    let channels=0;
    if(p.lineTo){channels++;if(!r.line_sent_at){await sendLine(env,{to:p.lineTo,text:`${p.text}\n${env.PORTAL_URL}/?ticket=${p.ticketId}`},r.line_retry_key);await env.DB.prepare('UPDATE notification_outbox SET line_sent_at=? WHERE id=? AND lease_token=?').bind(now(),r.id,lease).run();}}
    if(p.emailTo&&env.EMAIL_API_KEY&&env.EMAIL_FROM){channels++;if(!r.email_sent_at){await sendEmail(env,p.emailTo,`${p.text}\n${env.PORTAL_URL}/?ticket=${p.ticketId}`,r.retry_key);await env.DB.prepare('UPDATE notification_outbox SET email_sent_at=? WHERE id=? AND lease_token=?').bind(now(),r.id,lease).run();}}
    if(!channels)throw new Error('No usable notification channel configured');
   }
   const sentAt=now(),stmts=[env.DB.prepare("UPDATE notification_outbox SET state='sent',sent_at=?,lease_until=NULL,error=NULL WHERE id=? AND lease_token=? AND state='sending'").bind(sentAt,r.id,lease)];
   if(r.kind==='reply'&&p.msgId){
    const sentGuard="EXISTS(SELECT 1 FROM notification_outbox WHERE id=? AND lease_token=? AND state='sent')";
    stmts.push(env.DB.prepare(`UPDATE ticket_messages SET state='accepted' WHERE id=? AND ${sentGuard}`).bind(p.msgId,r.id,lease));
    stmts.push(env.DB.prepare(`UPDATE tickets SET sla_breached=CASE WHEN first_response_at IS NULL AND response_due<? THEN 1 ELSE sla_breached END,escalation_level=CASE WHEN first_response_at IS NULL THEN 0 ELSE escalation_level END,next_escalation_at=CASE WHEN first_response_at IS NULL THEN resolution_due ELSE next_escalation_at END,escalation_phase='resolution',first_response_at=COALESCE(first_response_at,?),updated_at=?,version=version+1 WHERE id=? AND sla_cycle=? AND ${sentGuard}`).bind(sentAt,sentAt,sentAt,r.ticket_id,p.cycle??1,r.id,lease));
    stmts.push(env.DB.prepare(`INSERT INTO ticket_events(id,ticket_id,action,actor_id,note,created_at) SELECT ?,?,'reply_accepted','system','LINE accepted the request; delivery/read is not guaranteed',? WHERE ${sentGuard}`).bind(id(),r.ticket_id,sentAt,r.id,lease));
   }
   await env.DB.batch(stmts);
  }catch(e){
   const terminal=r.attempts>=8||e instanceof DeliveryError&&[400,401,403,404,410,413].includes(e.status);
   const err=e instanceof DeliveryError?e.message:e instanceof Error&&e.name==='TimeoutError'?'Delivery timeout; retrying with same key':'Delivery failed; inspect credentials, recipient or network';
   await env.DB.prepare("UPDATE notification_outbox SET state=?,lease_until=NULL,next_attempt_at=?,error=? WHERE id=? AND lease_token=? AND state='sending'").bind(terminal?'failed':'pending',now()+Math.min(60,2**r.attempts)*60000,err,r.id,lease).run();
   if(r.kind==='reply'){const p=JSON.parse(r.payload);await env.DB.prepare("UPDATE ticket_messages SET state=? WHERE id=? AND EXISTS(SELECT 1 FROM notification_outbox WHERE id=? AND lease_token=?)").bind(terminal?'send_failed':'queued',p.msgId,r.id,lease).run();}
  }
 }
}
export async function checkSla(env:Bindings){
 const at=now(),overdue="((first_response_at IS NULL AND response_due<?) OR (resolved_at IS NULL AND resolution_due<?))";
 await env.DB.prepare(`UPDATE tickets SET sla_breached=1,version=version+1 WHERE status IN('new','assigned','in_progress','waiting_customer') AND sla_breached=0 AND ${overdue}`).bind(at,at).run();
 const rows=await env.DB.prepare(`SELECT * FROM tickets WHERE status IN('new','assigned','in_progress','waiting_customer') AND next_escalation_at<=? AND ${overdue} ORDER BY next_escalation_at LIMIT 50`).bind(at,at,at).all<any>();
 for(const t of rows.results){
  const p=validatePolicy(JSON.parse(t.policy_json)),phase=t.first_response_at===null?'response':'resolution',previous=t.escalation_phase===phase?t.escalation_level:0,level=Math.min(previous+1,p.maxLevel),op=id();
  const stmts=[env.DB.prepare(`UPDATE tickets SET escalation_phase=?,escalation_level=?,next_escalation_at=?,sla_breached=1,version=version+1,last_operation_id=? WHERE id=? AND version=? AND status IN('new','assigned','in_progress','waiting_customer') AND ${overdue}`).bind(phase,level,addMinutes(at,p.escalationMinutes,p),op,t.id,t.version,at,at)];
  if(previous<p.maxLevel){
   stmts.push(env.DB.prepare("INSERT INTO ticket_events SELECT ?,id,'escalated','system',?,? FROM tickets WHERE id=? AND last_operation_id=?").bind(id(),`${phase} SLA exceeded; level ${level}`,at,t.id,op));
   for(const who of await teamRecipients(env.DB,t.team_id,level))stmts.push(env.DB.prepare("INSERT OR IGNORE INTO notification_outbox(id,ticket_id,kind,recipient_id,payload,next_attempt_at,retry_key,line_retry_key,dedupe_key,created_at) SELECT ?,id,'alert',?,?,?,?,?,?,? FROM tickets WHERE id=? AND last_operation_id=?").bind(id(),who.id,JSON.stringify({text:`Ticket ${t.number} เกิน ${phase} SLA — ระดับ ${level}`,ticketId:t.id,lineTo:who.line_user_id,emailTo:who.email}),at,id(),id(),`sla:${t.id}:${t.sla_cycle}:${phase}:${level}:${who.id}`,at,t.id,op));
  }
  await env.DB.batch(stmts);
 }
}
export async function runJobs(env:Bindings){await ingestPending(env,50);await checkSla(env);await processOutbox(env);await processContent(env);await processRetention(env);await env.DB.prepare('DELETE FROM action_tokens WHERE expires_at<?').bind(now()-86400000).run();}
export async function processQueue(env:Bindings,msg:any){if(msg.body?.kind==='line-event'){await ingestPending(env,50);await processOutbox(env,undefined,5);await processContent(env);}else if(msg.body?.kind==='outbox')await processOutbox(env,String(msg.body.id));else throw new Error('Unsupported job type');}
