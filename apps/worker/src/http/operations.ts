import {Hono} from 'hono';
import type {AppEnv} from '../types';
import {ApiError} from '../types';
import {id,now} from '../infrastructure/db';
import {runJobs} from '../jobs/process';
const app=new Hono<AppEnv>();
const json=(c:any,data:any)=>c.json({data});
function manager(c:any){const a=c.get('actor');if(a.role==='agent')throw new ApiError(403,'Supervisor required');return a;}
function explanation(b:any){const n=String(b.note??'').trim();if(n.length<5||n.length>1000)throw new ApiError(400,'Enter a reason of 5–1000 characters');return n;}
app.get('/api/dashboard',async c=>{
 const a=c.get('actor'),scope=a.role==='admin'?'1=1':'team_id=?',args=a.role==='admin'?[]:[a.team_id],at=now();
 const summary=await c.env.DB.prepare(`SELECT COUNT(CASE WHEN status NOT IN('closed','cancelled') THEN 1 END) total,COUNT(CASE WHEN status IN('new','assigned') THEN 1 END) waiting,COUNT(CASE WHEN status NOT IN('closed','cancelled') AND sla_breached=1 THEN 1 END) breached,COUNT(CASE WHEN assignee_id=? AND status IN('new','assigned','in_progress','waiting_customer') THEN 1 END) mine,COUNT(CASE WHEN status IN('resolved','closed') THEN 1 END) resolved,AVG(CASE WHEN first_response_at IS NOT NULL THEN (first_response_at-COALESCE(sla_started_at,created_at))/60000.0 END) avgResponse,AVG(CASE WHEN resolved_at IS NOT NULL THEN (resolved_at-COALESCE(sla_started_at,created_at))/60000.0 END) avgResolution,COUNT(CASE WHEN status IN('resolved','closed') AND sla_breached=0 THEN 1 END) compliant FROM tickets WHERE ${scope}`).bind(a.id,...args).first<any>();
 const workload=await c.env.DB.prepare(`SELECT COALESCE(s.name,'ยังไม่มอบหมาย') name,COUNT(*) count FROM tickets t LEFT JOIN staff s ON s.id=t.assignee_id WHERE t.status IN('new','assigned','in_progress','waiting_customer') ${a.role==='admin'?'':'AND t.team_id=?'} GROUP BY t.assignee_id ORDER BY count DESC`).bind(...args).all();
 const trend=await c.env.DB.prepare(`SELECT strftime('%Y-%m-%d',created_at/1000,'unixepoch','+7 hours') day,COUNT(*) count FROM tickets WHERE ${scope} AND created_at>=? GROUP BY day ORDER BY day`).bind(...args,at-14*86400000).all();
 return json(c,{...summary,slaCompliance:summary.resolved?Math.round(summary.compliant*100/summary.resolved):null,workload:workload.results,trend:trend.results});
});
app.post('/api/operations/run',async c=>{manager(c);if(c.env.ENVIRONMENT!=='development')throw new ApiError(404,'Local development only');await runJobs(c.env);return json(c,{ok:true});});
app.get('/api/operations',async c=>{
 const a=manager(c),scope=a.role==='admin'?'':'AND t.team_id=?',args=a.role==='admin'?[]:[a.team_id];
 const [outbox,content,inbox,audit]=await Promise.all([
  c.env.DB.prepare(`SELECT o.id,o.ticket_id,t.number,o.kind,o.state,o.attempts,o.error,o.next_attempt_at,o.first_attempt_at,o.line_sent_at,o.email_sent_at,o.created_at FROM notification_outbox o JOIN tickets t ON t.id=o.ticket_id WHERE o.state NOT IN('sent','cancelled') ${scope} ORDER BY o.created_at DESC LIMIT 100`).bind(...args).all(),
  c.env.DB.prepare(`SELECT j.id,j.ticket_id,t.number,j.kind,j.state,j.attempts,j.error,j.next_attempt_at FROM content_jobs j JOIN tickets t ON t.id=j.ticket_id WHERE j.state NOT IN('done','cancelled') ${scope} ORDER BY j.created_at DESC LIMIT 100`).bind(...args).all(),
  a.role==='admin'?c.env.DB.prepare("SELECT id,state,attempts,error,received_at,next_attempt_at FROM integration_inbox WHERE state IN('pending','failed') ORDER BY received_at DESC LIMIT 100").all():Promise.resolve({results:[]}),
  a.role==='admin'?c.env.DB.prepare('SELECT * FROM operation_audit ORDER BY created_at DESC LIMIT 50').all():Promise.resolve({results:[]}),
 ]);
 return json(c,{outbox:outbox.results,content:content.results,inbox:inbox.results,audit:audit.results,configuration:{database:true,evidence:!!c.env.EVIDENCE,queue:!!c.env.JOBS,harness:!!c.env.L_HARNESS_API_KEY&&!c.env.L_HARNESS_URL.includes('REPLACE'),integration:(c.env.INTEGRATION_SECRET?.length??0)>=32,lineAccount:!c.env.LINE_ACCOUNT_KEY.includes('REPLACE'),email:!!c.env.EMAIL_API_KEY&&!!c.env.EMAIL_FROM,access:!!c.env.ACCESS_AUD&&!!c.env.ACCESS_TEAM_DOMAIN,retention:Number(c.env.RETENTION_DAYS??0)>=30,localDemo:c.env.ENVIRONMENT==='development'&&c.env.DEV_AUTH_ENABLED==='true'},notice:'Queue retries and terminal failures are tracked in D1. Configure Cloudflare queue DLQ alerts separately; cron reconciles durable jobs.'});
});
app.post('/api/operations/:kind/:id/:action',async c=>{
 const a=manager(c),kind=c.req.param('kind'),jid=c.req.param('id'),action=c.req.param('action'),b=await c.req.json<any>(),n=explanation(b);
 const table=kind==='outbox'?'notification_outbox':kind==='inbox'?'integration_inbox':kind==='content'?'content_jobs':null;if(!table)throw new ApiError(400,'Unknown job kind');
 if(kind==='inbox'&&a.role!=='admin')throw new ApiError(403,'Administrator required');
 const row=await c.env.DB.prepare(`SELECT j.*,t.team_id FROM ${table} j ${kind==='inbox'?'LEFT JOIN tickets t ON 1=0':'JOIN tickets t ON t.id=j.ticket_id'} WHERE j.id=?`).bind(jid).first<any>();if(!row)throw new ApiError(404,'Job not found');if(kind!=='inbox'&&a.role!=='admin'&&a.team_id!==row.team_id)throw new ApiError(403,'Other team job');
 if(!['failed','uncertain','pending'].includes(row.state))throw new ApiError(409,'Job is active or already completed');
 const at=now(),auditId=id();let update:any;const extra:any[]=[];
 if(action==='retry'){
  if(row.state==='uncertain'||kind==='outbox'&&row.first_attempt_at&&at-row.first_attempt_at>=23*3600000)throw new ApiError(409,'Retry window expired; verify provider acceptance and reconcile instead');
  update=c.env.DB.prepare(`UPDATE ${table} SET state='pending',attempts=0,next_attempt_at=?,error=NULL WHERE id=? AND state=? ${kind==='outbox'||kind==='content'?'AND (lease_until IS NULL OR lease_until<=?)':''}`).bind(at,jid,row.state,...(kind==='inbox'?[]:[at]));
 }else if(action==='cancel'){
  update=c.env.DB.prepare(`UPDATE ${table} SET state='cancelled' WHERE id=? AND state=?`).bind(jid,row.state);
  if(kind==='outbox'&&row.kind==='reply')extra.push(c.env.DB.prepare("UPDATE ticket_messages SET state='cancelled' WHERE id=? AND EXISTS(SELECT 1 FROM notification_outbox WHERE id=? AND state='cancelled') AND EXISTS(SELECT 1 FROM operation_audit WHERE id=?)").bind(JSON.parse(row.payload).msgId,jid,auditId));
 }else if(action==='accepted'&&kind==='outbox'&&row.kind==='reply'){
  const p=JSON.parse(row.payload);if(!b.providerReference||String(b.providerReference).length>200)throw new ApiError(400,'Provider acceptance reference required');
  update=c.env.DB.prepare("UPDATE notification_outbox SET state='sent',sent_at=?,error=NULL WHERE id=? AND state=?").bind(at,jid,row.state);
  extra.push(c.env.DB.prepare("UPDATE ticket_messages SET state='accepted_verified' WHERE id=? AND EXISTS(SELECT 1 FROM notification_outbox WHERE id=? AND state='sent') AND EXISTS(SELECT 1 FROM operation_audit WHERE id=?)").bind(p.msgId,jid,auditId));
  extra.push(c.env.DB.prepare("UPDATE tickets SET first_response_at=COALESCE(first_response_at,?),sla_breached=CASE WHEN first_response_at IS NULL AND response_due<? THEN 1 ELSE sla_breached END,escalation_level=CASE WHEN first_response_at IS NULL THEN 0 ELSE escalation_level END,next_escalation_at=CASE WHEN first_response_at IS NULL THEN resolution_due ELSE next_escalation_at END,escalation_phase='resolution',version=version+1,updated_at=? WHERE id=? AND sla_cycle=? AND EXISTS(SELECT 1 FROM operation_audit WHERE id=?)").bind(at,at,at,row.ticket_id,p.cycle??1,auditId));
 }else throw new ApiError(400,'Action not supported for this job');
 const audit=c.env.DB.prepare('INSERT INTO operation_audit SELECT ?,?,?,?,?,? WHERE changes()>0').bind(auditId,a.id,`${kind}_${action}`,jid,`${n}${b.providerReference?' | '+String(b.providerReference):''}`,at);
 if(row.ticket_id)extra.push(c.env.DB.prepare("INSERT INTO ticket_events SELECT ?,?,'delivery_operation',?,?,? WHERE EXISTS(SELECT 1 FROM operation_audit WHERE id=?)").bind(id(),row.ticket_id,a.id,`${kind} ${action}: ${n}`,at,auditId));
 const result=await c.env.DB.batch([update,audit,...extra]);
 if(!result[0].meta.changes)throw new ApiError(409,'Job changed; reload');
 try{await c.env.JOBS?.send(kind==='outbox'?{kind:'outbox',id:jid}:{kind:'line-event'});}catch{}
 return json(c,{ok:true});
});
app.post('/api/settings/teams',async c=>{
 if(c.get('actor').role!=='admin')throw new ApiError(403,'Administrator required');const b=await c.req.json<any>();
 if(!/^[a-z0-9_-]{2,40}$/.test(String(b.id))||String(b.name??'').trim().length<2)throw new ApiError(400,'Valid team id and name required');
 const defaultPolicy=await c.env.DB.prepare("SELECT policy_json FROM teams WHERE id='service'").first<any>();await c.env.DB.batch([c.env.DB.prepare('INSERT INTO teams VALUES(?,?,?)').bind(b.id,String(b.name).slice(0,120),defaultPolicy.policy_json),c.env.DB.prepare('INSERT INTO operation_audit VALUES(?,?,?,?,?,?)').bind(id(),c.get('actor').id,'team_created',b.id,String(b.name),now())]);return json(c,{ok:true});
});
app.put('/api/settings/staff/:id',async c=>{
 const a=c.get('actor');if(a.role!=='admin')throw new ApiError(403,'Administrator required');const b=await c.req.json<any>(),sid=c.req.param('id');
 if(!/^[a-z0-9_-]{2,64}$/.test(sid)||!/^\S+@\S+\.\S+$/.test(String(b.email))||String(b.name??'').trim().length<2||!['agent','supervisor','admin'].includes(b.role)||![0,1].includes(b.active)||b.line_user_id&&!/^U[a-f0-9]{32}$/.test(b.line_user_id))throw new ApiError(400,'Invalid staff account');
 if(sid===a.id&&(b.active!==1||b.role!=='admin'))throw new ApiError(400,'Cannot deactivate or demote your own admin account');
 const old=await c.env.DB.prepare('SELECT * FROM staff WHERE id=?').bind(sid).first<any>();
 if(old&&old.team_id!==b.team_id&&await c.env.DB.prepare("SELECT id FROM tickets WHERE assignee_id=? AND status IN('new','assigned','in_progress','waiting_customer') LIMIT 1").bind(sid).first())throw new ApiError(409,'Transfer or reassign active tickets before moving staff to another team');
 await c.env.DB.batch([c.env.DB.prepare('INSERT INTO staff(id,email,name,role,team_id,line_user_id,active) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET email=excluded.email,name=excluded.name,role=excluded.role,team_id=excluded.team_id,line_user_id=excluded.line_user_id,active=excluded.active').bind(sid,String(b.email).toLowerCase(),String(b.name).slice(0,120),b.role,b.team_id,b.line_user_id||null,b.active),c.env.DB.prepare('INSERT INTO operation_audit VALUES(?,?,?,?,?,?)').bind(id(),a.id,'staff_updated',sid,`${b.role}, active=${b.active}`,now())]);return json(c,{ok:true});
});
export default app;
