import {Hono} from 'hono';
import type {Ticket,SlaPolicy} from '@masci/contracts';
import type {AppEnv} from '../types';
import {ApiError} from '../types';
import {ticket,detail,id,now,policy} from '../infrastructure/db';
import {canSee,canClaim,canResolve,canManage} from '../domain/ticket';
import {addMinutes,validatePolicy} from '../domain/sla';
const app=new Hono<AppEnv>();
const json=(c:any,data:any,status=200)=>c.json({data},status);
export function hash(s:string){return crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)).then(b=>Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join(''));}
async function visible(c:any,tid:string){const t=await ticket(c.env.DB,tid);if(!t)throw new ApiError(404,'Ticket not found');if(!canSee(c.get('actor'),t))throw new ApiError(403,'Team access denied');return t;}
function note(body:any){const s=String(body.note??'').trim();if(s.length<5||s.length>4000)throw new ApiError(400,'Add a note of 5–4000 characters');return s;}
function version(t:Ticket,body:any){if(body.version!==t.version)throw new ApiError(409,'Ticket changed; reload before retrying');}
function event(c:any,t:Ticket,op:string,action:string,n:string,at:number){return c.env.DB.prepare('INSERT INTO ticket_events(id,ticket_id,action,actor_id,note,created_at) SELECT ?,id,?,?,?,? FROM tickets WHERE id=? AND last_operation_id=?').bind(id(),action,c.get('actor').id,n,at,t.id,op);}
async function commit(c:any,t:Ticket,update:any,extra:any[]){const r=await c.env.DB.batch([update,...extra]);if(!r[0].meta.changes)throw new ApiError(409,'Ticket changed; reload and retry');return json(c,await detail(c.env.DB,(await ticket(c.env.DB,t.id))!));}
async function wake(c:any,oid?:string){try{await c.env.JOBS?.send(oid?{kind:'outbox',id:oid}:{kind:'line-event'});}catch{/* durable scheduler recovers */}}
const actions=['claim','resolve','close','wait','resume','reopen','cancel'];
function allowed(a:any,t:Ticket,action:string){return action==='claim'?canClaim(a,t):action==='resolve'?canResolve(a,t):action==='close'?a.role!=='agent'&&t.status==='resolved'&&canManage(a,t):action==='wait'?canManage(a,t)&&t.status==='in_progress':action==='resume'?canManage(a,t)&&t.status==='waiting_customer':action==='reopen'?canManage(a,t)&&['resolved','closed'].includes(t.status)&&(!t.retention_state||t.retention_state==='pending'):action==='cancel'?a.role!=='agent'&&canManage(a,t)&&!['closed','cancelled'].includes(t.status):false;}
app.get('/api/me',c=>json(c,c.get('actor')));
app.get('/api/teams',async c=>json(c,(await c.env.DB.prepare('SELECT * FROM teams ORDER BY name').all()).results));
app.get('/api/staff',async c=>{const a=c.get('actor');return json(c,(await c.env.DB.prepare(`SELECT id,email,name,role,team_id,line_user_id,active FROM staff ${a.role==='admin'?'':'WHERE team_id=?'} ORDER BY name`).bind(...(a.role==='admin'?[]:[a.team_id])).all()).results)});
app.get('/api/tickets',async c=>{
 const a=c.get('actor'),status=c.req.query('status'),q=c.req.query('q')?.slice(0,100),mine=c.req.query('mine')==='true';
 const page=Math.floor(Math.max(1,Math.min(100000,Number(c.req.query('page'))||1))),pageSize=25;let where='1=1',v:any[]=[];
 if(a.role!=='admin'){where+=' AND team_id=?';v.push(a.team_id)}
 if(c.req.query('active')==='true'){where+=" AND status IN('new','assigned','in_progress','waiting_customer')";}
 if(status&&status!=='all'){where+=' AND status=?';v.push(status)}if(mine){where+=' AND assignee_id=?';v.push(a.id)}
 if(q){where+=' AND (number LIKE ? OR subject LIKE ?)';v.push(`%${q}%`,`%${q}%`)}
 const count=await c.env.DB.prepare(`SELECT COUNT(*) total FROM tickets WHERE ${where}`).bind(...v).first<any>();
 const items=await c.env.DB.prepare(`SELECT * FROM tickets WHERE ${where} ORDER BY CASE WHEN status IN('closed','cancelled') THEN 1 ELSE 0 END,sla_breached DESC,updated_at DESC,id LIMIT ? OFFSET ?`).bind(...v,pageSize,(page-1)*pageSize).all();
 return json(c,{items:items.results,total:count.total,page,pageSize});
});
app.get('/api/tickets/:id',async c=>json(c,await detail(c.env.DB,await visible(c,c.req.param('id')))));
app.post('/api/tickets',async c=>{
 const a=c.get('actor');if(a.role==='agent')throw new ApiError(403,'Supervisor role required');
 const b=await c.req.json<any>(),subject=String(b.subject??'').trim(),customer=String(b.customerId??'').trim(),team=a.role==='admin'?String(b.teamId??a.team_id):a.team_id;
 if(subject.length<5||subject.length>120||!/^U[a-f0-9]{32}$/.test(customer))throw new ApiError(400,'Enter a subject and a verified LINE user ID (U + 32 hex characters)');
 const p=validatePolicy(await policy(c.env.DB,team)),at=now(),tid=id();
 try{await c.env.DB.batch([
  c.env.DB.prepare("INSERT INTO tickets(id,number,account_key,customer_id,subject,category,status,team_id,created_at,updated_at,response_due,resolution_due,next_escalation_at,policy_json) VALUES(?,?,?,?,?,?,'new',?,?,?,?,?,?,?)").bind(tid,`MASCI-M-${tid.slice(0,8).toUpperCase()}`,c.env.LINE_ACCOUNT_KEY,customer,subject,String(b.category??'general').slice(0,80),team,at,at,addMinutes(at,p.responseMinutes,p),addMinutes(at,p.resolutionMinutes,p),addMinutes(at,p.responseMinutes,p),JSON.stringify(p)),
  c.env.DB.prepare('INSERT OR IGNORE INTO customer_links VALUES(?,?,?,?)').bind(c.env.LINE_ACCOUNT_KEY,customer,customer,at),
  c.env.DB.prepare("INSERT INTO ticket_events VALUES(?,?,'created',?,'Manually created by supervisor',?)").bind(id(),tid,a.id,at)]);
 }catch{throw new ApiError(409,'Customer already has an open ticket, or team is invalid');}
 return json(c,await detail(c.env.DB,(await ticket(c.env.DB,tid))!),201);
});
app.post('/api/tickets/:id/action-tokens',async c=>{
 const t=await visible(c,c.req.param('id')),b=await c.req.json<any>(),a=c.get('actor');version(t,b);
 if(!actions.includes(b.action)||!allowed(a,t,b.action))throw new ApiError(403,'Action not allowed');
 const token=id()+id(),exp=now()+5*60_000;await c.env.DB.prepare('INSERT INTO action_tokens(hash,ticket_id,actor_id,action,version,expires_at) VALUES(?,?,?,?,?,?)').bind(await hash(token),t.id,a.id,b.action,t.version,exp).run();return json(c,{token,expiresAt:exp},201);
});
app.post('/api/tickets/:id/actions/:action',async c=>{
 const t=await visible(c,c.req.param('id')),a=c.get('actor'),action=c.req.param('action'),b=await c.req.json<any>();
 if(!allowed(a,t,action))throw new ApiError(403,'Action not allowed');
 if(typeof b.token!=='string'||b.token.length>128)throw new ApiError(400,'Action token required');
 const h=await hash(b.token),at=now(),op=id(),n=action==='claim'?'claim':note(b);
 const guard='id=? AND version=? AND EXISTS(SELECT 1 FROM action_tokens WHERE hash=? AND ticket_id=? AND actor_id=? AND action=? AND version=? AND used_at IS NULL AND expires_at>?)';
 const binds=[t.id,t.version,h,t.id,a.id,action,t.version,at];let sets='';let vals:any[]=[];
 if(action==='claim'){sets="assignee_id=?,status='in_progress'";vals=[a.id]}
 if(action==='resolve'){sets="status='resolved',resolved_at=?";vals=[at]}
 if(action==='close'){sets="status='closed',closed_at=?";vals=[at]}
 if(action==='wait')sets="status='waiting_customer'";
 if(action==='resume')sets="status='in_progress'";
 if(action==='cancel')sets="status='cancelled',closed_at=?",vals=[at];
 if(action==='reopen'){
  const p=validatePolicy(JSON.parse(t.policy_json));sets="status='in_progress',sla_started_at=?,first_response_at=NULL,resolved_at=NULL,closed_at=NULL,sla_cycle=sla_cycle+1,escalation_phase='response',escalation_level=0,sla_breached=0,response_due=?,resolution_due=?,next_escalation_at=?";
  vals=[at,addMinutes(at,p.responseMinutes,p),addMinutes(at,p.resolutionMinutes,p),addMinutes(at,p.responseMinutes,p)];
  const other=await c.env.DB.prepare("SELECT id FROM tickets WHERE account_key=? AND customer_id=? AND id!=? AND status IN('new','assigned','in_progress','waiting_customer')").bind(t.account_key,t.customer_id,t.id).first();if(other)throw new ApiError(409,'Customer has another active ticket');
 }
 const retentionGuard=action==='reopen'?" AND retention_state='pending'":'';
 const replyGuard=['resolve','close','cancel','reopen'].includes(action)?" AND NOT EXISTS(SELECT 1 FROM notification_outbox WHERE ticket_id=tickets.id AND kind='reply' AND state IN('pending','sending','failed','uncertain'))":'';
 const update=c.env.DB.prepare(`UPDATE tickets SET ${sets},updated_at=?,version=version+1,last_operation_id=? WHERE ${guard}${replyGuard}${retentionGuard}`).bind(...vals,at,op,...binds);
 const used=c.env.DB.prepare('UPDATE action_tokens SET used_at=? WHERE hash=? AND EXISTS(SELECT 1 FROM tickets WHERE id=? AND last_operation_id=?)').bind(at,h,t.id,op);
 try{return await commit(c,t,update,[used,event(c,t,op,action,n,at)]);}catch(e){if(e instanceof ApiError)throw e;throw new ApiError(409,'Ticket conflict or outstanding reply; inspect pending/failed delivery before closing');}
});
app.post('/api/tickets/:id/assign',async c=>{
 const t=await visible(c,c.req.param('id')),a=c.get('actor'),b=await c.req.json<any>();version(t,b);
 if(a.role==='agent'||!canManage(a,t))throw new ApiError(403,'Supervisor required');
 const s=await c.env.DB.prepare('SELECT * FROM staff WHERE id=? AND active=1 AND team_id=?').bind(b.assigneeId,t.team_id).first<any>();if(!s)throw new ApiError(400,'Choose active staff in this team');
 const at=now(),op=id(),oid=id(),n=note(b);
 const update=c.env.DB.prepare("UPDATE tickets SET assignee_id=?,status=CASE WHEN status='new' THEN 'assigned' ELSE status END,updated_at=?,version=version+1,last_operation_id=? WHERE id=? AND version=? AND status IN('new','assigned','in_progress','waiting_customer')").bind(s.id,at,op,t.id,t.version);
 const out=c.env.DB.prepare("INSERT INTO notification_outbox(id,ticket_id,kind,recipient_id,payload,next_attempt_at,retry_key,line_retry_key,dedupe_key,created_at) SELECT ?,id,'alert',?,?, ?,?,?,?,? FROM tickets WHERE id=? AND last_operation_id=?").bind(oid,s.id,JSON.stringify({text:`Ticket ${t.number} ถูกมอบหมายให้คุณ`,ticketId:t.id,lineTo:s.line_user_id,emailTo:s.email}),at,id(),id(),`assign:${op}`,at,t.id,op);
 const result=await commit(c,t,update,[event(c,t,op,'assigned',`${s.name}: ${n}`,at),out]);await wake(c,oid);return result;
});
app.post('/api/tickets/:id/transfer',async c=>{
 const t=await visible(c,c.req.param('id')),a=c.get('actor'),b=await c.req.json<any>();version(t,b);if(a.role!=='admin')throw new ApiError(403,'Administrator required for cross-team transfer');
 await policy(c.env.DB,String(b.teamId));const at=now(),op=id();return commit(c,t,c.env.DB.prepare("UPDATE tickets SET team_id=?,assignee_id=NULL,status='new',updated_at=?,version=version+1,last_operation_id=? WHERE id=? AND version=? AND status IN('new','assigned','in_progress','waiting_customer')").bind(b.teamId,at,op,t.id,t.version),[event(c,t,op,'transferred',note(b),at)]);
});
app.post('/api/tickets/:id/messages',async c=>{
 const t=await visible(c,c.req.param('id')),a=c.get('actor'),b=await c.req.json<any>(),text=String(b.text??'').trim(),clientKey=c.req.header('Idempotency-Key');
 if(!clientKey||! /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientKey))throw new ApiError(400,'UUID Idempotency-Key required');
 const key=`${a.id}:${clientKey}`,digest=await hash(`${t.id}:${text}`);
 const replay=async()=>{const old=await c.env.DB.prepare('SELECT * FROM api_requests WHERE request_key=?').bind(key).first<any>();if(!old)return null;if(old.request_hash!==digest)throw new ApiError(409,'Idempotency key was used for a different request');return json(c,{queued:true,messageId:old.message_id,outboxId:old.outbox_id},202);};
 const previous=await replay();if(previous)return previous;
 version(t,b);if(!canManage(a,t)||!['new','assigned','in_progress','waiting_customer'].includes(t.status))throw new ApiError(403,'Claim this ticket before replying');
 if(!text||text.length>4000)throw new ApiError(400,'Message must contain 1–4000 characters');
 const customer=await c.env.DB.prepare('SELECT line_user_id FROM customer_links WHERE account_key=? AND customer_id=?').bind(t.account_key,t.customer_id).first<any>();if(!customer)throw new ApiError(409,'LINE identity mapping is missing');
 const at=now(),mid=id(),oid=id(),op=id(),payload={to:customer.line_user_id,text,msgId:mid,ticketId:t.id,manual:true,cycle:(t as any).sla_cycle??1};
 const rows=await c.env.DB.batch([
  c.env.DB.prepare("UPDATE tickets SET status=CASE WHEN status IN('new','assigned') THEN 'in_progress' ELSE status END,assignee_id=COALESCE(assignee_id,?),updated_at=?,version=version+1,last_operation_id=? WHERE id=? AND version=? AND NOT EXISTS(SELECT 1 FROM api_requests WHERE request_key=?)").bind(a.id,at,op,t.id,t.version,key),
  c.env.DB.prepare("INSERT INTO ticket_messages(id,ticket_id,direction,kind,content,state,created_at,actor_id,reply_key) SELECT ?,id,'outgoing','text',?,'queued',?,?,? FROM tickets WHERE id=? AND last_operation_id=?").bind(mid,text,at,a.id,key,t.id,op),
  c.env.DB.prepare("INSERT INTO notification_outbox(id,ticket_id,kind,payload,next_attempt_at,retry_key,line_retry_key,dedupe_key,created_at) SELECT ?,id,'reply',?,?,?,?,?,? FROM tickets WHERE id=? AND last_operation_id=?").bind(oid,JSON.stringify(payload),at,id(),id(),key,at,t.id,op),
  c.env.DB.prepare('INSERT INTO api_requests SELECT ?,?,id,?,?,?,? FROM tickets WHERE id=? AND last_operation_id=?').bind(key,a.id,digest,mid,oid,at,t.id,op),event(c,t,op,'reply_queued','Reply queued for LINE acceptance',at)]);
 if(!rows[0].meta.changes){const old=await replay();if(old)return old;throw new ApiError(409,'Ticket changed; reload and retry');}
 await wake(c,oid);return json(c,{queued:true,messageId:mid,outboxId:oid},202);
});
app.post('/api/tickets/:id/notes',async c=>{
 const t=await visible(c,c.req.param('id')),a=c.get('actor'),b=await c.req.json<any>();version(t,b);if(!canManage(a,t))throw new ApiError(403,'Owner or supervisor required');if(t.retention_state!=='pending')throw new ApiError(410,'Ticket content has expired under retention policy');const n=note(b),at=now(),op=id();
 return commit(c,t,c.env.DB.prepare('UPDATE tickets SET updated_at=?,version=version+1,last_operation_id=? WHERE id=? AND version=?').bind(at,op,t.id,t.version),[c.env.DB.prepare("INSERT INTO ticket_messages(id,ticket_id,direction,kind,content,state,created_at,actor_id) SELECT ?,id,'internal','note',?,'recorded',?,? FROM tickets WHERE id=? AND last_operation_id=?").bind(id(),n,at,a.id,t.id,op),event(c,t,op,'internal_note','Internal note added (not sent to LINE)',at)]);
});
app.post('/api/tickets/:id/resolve-evidence',async c=>{
 const t=await visible(c,c.req.param('id')),a=c.get('actor'),b=await c.req.json<any>();version(t,b);if(a.role==='agent'||!canManage(a,t))throw new ApiError(403,'Supervisor required');const at=now(),op=id();
 return commit(c,t,c.env.DB.prepare("UPDATE tickets SET escalation_phase='resolution',escalation_level=CASE WHEN first_response_at IS NULL THEN 0 ELSE escalation_level END,next_escalation_at=CASE WHEN first_response_at IS NULL THEN resolution_due ELSE next_escalation_at END,first_response_at=COALESCE(first_response_at,?),updated_at=?,version=version+1,last_operation_id=? WHERE id=? AND version=? AND status IN('new','assigned','in_progress','waiting_customer')").bind(at,at,op,t.id,t.version),[event(c,t,op,'manual_reply_verified',note(b),at)]);
});
app.post('/api/tickets/:id/attachments',async c=>{
 const t=await visible(c,c.req.param('id'));if(!canManage(c.get('actor'),t))throw new ApiError(403,'Owner or supervisor required');if(t.retention_state!=='pending')throw new ApiError(410,'Ticket content has expired under retention policy');if(!c.req.header('content-type')?.startsWith('multipart/form-data'))throw new ApiError(400,'Multipart file upload required');const f=(await c.req.formData()).get('file');
 if(!(f instanceof File)||f.size<1||f.size>10*1024*1024||!['application/pdf','image/jpeg','image/png','text/plain'].includes(f.type))throw new ApiError(400,'PDF, JPG, PNG or TXT up to 10 MB required');
 const aid=id(),key=`tickets/${t.id}/${aid}`,at=now();await c.env.EVIDENCE.put(key,f.stream(),{httpMetadata:{contentType:f.type}});
 try{await c.env.DB.batch([c.env.DB.prepare('INSERT INTO attachments VALUES(?,?,?,?,?,?,?,?)').bind(aid,t.id,key,f.name.slice(0,180),f.size,f.type,c.get('actor').id,at),c.env.DB.prepare("INSERT INTO ticket_events VALUES(?,?,'attachment_added',?,?,?)").bind(id(),t.id,c.get('actor').id,f.name.slice(0,180),at)]);}catch(e){await c.env.EVIDENCE.delete(key);throw e;}
 return json(c,{id:aid,name:f.name,size:f.size},201);
});
app.get('/api/tickets/:id/attachments/:aid',async c=>{
 const t=await visible(c,c.req.param('id')),r=await c.env.DB.prepare('SELECT * FROM attachments WHERE id=? AND ticket_id=?').bind(c.req.param('aid'),t.id).first<any>();if(!r)throw new ApiError(404,'Attachment not found');
 const removed=await c.env.DB.prepare("SELECT 1 FROM content_jobs j JOIN ticket_messages m ON m.source_id=j.message_id WHERE j.id=? AND m.state='unsent'").bind(r.id).first();if(removed)throw new ApiError(410,'Message was unsent');
 const o=await c.env.EVIDENCE.get(r.object_key);if(!o)throw new ApiError(404,'Stored file unavailable');
 return new Response(o.body,{headers:{'content-type':r.mime,'content-disposition':`attachment; filename="evidence"; filename*=UTF-8''${encodeURIComponent(r.name)}`,'cache-control':'private, no-store','x-content-type-options':'nosniff'}});
});
app.get('/api/settings/sla',async c=>{const a=c.get('actor');if(a.role==='agent')throw new ApiError(403,'Supervisor required');return json(c,(await c.env.DB.prepare(`SELECT * FROM teams ${a.role==='admin'?'':'WHERE id=?'}`).bind(...(a.role==='admin'?[]:[a.team_id])).all()).results)});
app.put('/api/settings/sla/:team',async c=>{const a=c.get('actor'),team=c.req.param('team');if(a.role==='agent'||a.role!=='admin'&&a.team_id!==team)throw new ApiError(403,'Team supervisor required');let p:SlaPolicy;try{p=validatePolicy(await c.req.json<SlaPolicy>())}catch{throw new ApiError(400,'Invalid SLA policy')};const r=await c.env.DB.batch([c.env.DB.prepare('UPDATE teams SET policy_json=? WHERE id=?').bind(JSON.stringify(p),team),c.env.DB.prepare('INSERT INTO operation_audit VALUES(?,?,?,?,?,?)').bind(id(),a.id,'sla_policy_updated',team,JSON.stringify(p),now())]);if(!r[0].meta.changes)throw new ApiError(404,'Team not found');return json(c,{team,policy:p})});
export default app;
