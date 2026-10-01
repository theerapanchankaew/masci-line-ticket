import {Hono} from 'hono';
import type {AppEnv} from '../types';
import {now} from '../infrastructure/db';
import {ingestPending} from '../application/ingest';
const app=new Hono<AppEnv>();
async function sameSecret(a:string,b:string){const enc=new TextEncoder();const [x,y]=await Promise.all([crypto.subtle.digest('SHA-256',enc.encode(a)),crypto.subtle.digest('SHA-256',enc.encode(b))]);let diff=0;const u=new Uint8Array(x),v=new Uint8Array(y);for(let i=0;i<u.length;i++)diff|=u[i]^v[i];return diff===0;}
app.post('/integrations/line/events',async c=>{
 const expected=c.env.INTEGRATION_SECRET??'';if(expected.length<32||!await sameSecret(c.req.header('x-masci-integration-secret')??'',expected))return c.json({error:'Unauthorized'},401);
 const body=await c.req.json<any>().catch(()=>null);if(!body||!Array.isArray(body.events)||body.events.length>100)return c.json({error:'Invalid event batch'},400);
 if(body.destination!==c.env.LINE_ACCOUNT_KEY)return c.json({error:'LINE account destination mismatch'},409);
 const at=now(),stmts=[];
 for(const ev of body.events){
  if(!ev||!['message','unsend'].includes(ev.type))continue;
  if(ev.type==='message'&&(!ev.source?.userId||typeof ev.message?.id!=='string')||ev.type==='unsend'&&typeof ev.unsend?.messageId!=='string')return c.json({error:'Invalid supported event'},400);
  const eid=String(ev.webhookEventId??ev.message?.id??`unsend:${ev.unsend.messageId}`),messageId=String(ev.message?.id??ev.unsend?.messageId);
  if(eid.length>200||messageId.length>128||String(ev.source?.userId??'').length>128)return c.json({error:'Event identifier too long'},400);
  const occurred=Number.isFinite(ev.timestamp)?Math.min(ev.timestamp,at):at;
  const data=ev.type==='unsend'?{type:'unsend',unsend:{messageId:ev.unsend.messageId}}:{type:'message',timestamp:occurred,source:{userId:ev.source.userId},message:{id:ev.message.id,type:ev.message.type,text:ev.message.type==='text'?String(ev.message.text??'').slice(0,4000):undefined}};
  stmts.push(c.env.DB.prepare('INSERT OR IGNORE INTO integration_inbox(id,account_key,payload,occurred_at,received_at) VALUES(?,?,?,?,?)').bind(`${body.destination}:${eid}`,body.destination,JSON.stringify(data),occurred,at));
 }
 if(stmts.length)await c.env.DB.batch(stmts);
 try{if(stmts.length)await c.env.JOBS?.send({kind:'line-event'});}catch{}
 return c.json({accepted:stmts.length},202);
});
app.post('/internal/jobs/run',async c=>{if(c.env.ENVIRONMENT==='production')return c.json({error:'Not available'},404);if(!c.env.JOB_SECRET||c.req.header('x-job-secret')!==c.env.JOB_SECRET)return c.json({error:'Unauthorized'},401);await ingestPending(c.env,100);return c.json({ok:true});});
export default app;
