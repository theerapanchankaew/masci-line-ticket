import type {Status,Ticket,TicketDetail,TicketEvent,TicketMessage} from '@masci/contracts';
import type {Staff} from '@masci/contracts';
import type {Bindings} from '../types';
export const now=()=>Date.now();
export const id=()=>crypto.randomUUID();
export async function ticket(db:D1Database,ticketId:string):Promise<Ticket|null>{return db.prepare('SELECT * FROM tickets WHERE id=?').bind(ticketId).first<Ticket>();}
export async function detail(db:D1Database,t:Ticket):Promise<TicketDetail>{
 const [m,e,a]=await Promise.all([
 db.prepare('SELECT * FROM ticket_messages WHERE ticket_id=? ORDER BY created_at,id').bind(t.id).all<TicketMessage>(),
 db.prepare('SELECT * FROM ticket_events WHERE ticket_id=? ORDER BY created_at,id').bind(t.id).all<TicketEvent>(),
 db.prepare('SELECT id,name,size FROM attachments WHERE ticket_id=? ORDER BY created_at').bind(t.id).all<{id:string;name:string;size:number}>()]);
 return {ticket:t,messages:m.results,events:e.results,attachments:a.results};
}
export async function policy(db:D1Database,teamId:string){const r=await db.prepare('SELECT policy_json FROM teams WHERE id=?').bind(teamId).first<{policy_json:string}>();if(!r)throw new Error('Team not found');return JSON.parse(r.policy_json);}
export async function teamRecipients(db:D1Database,teamId:string,minimumLevel:number):Promise<Staff[]>{
 const roles=minimumLevel<=1?['supervisor','admin']:['admin'];
 const rows=await db.prepare(`SELECT * FROM staff WHERE active=1 AND (team_id=? AND role='supervisor' OR role='admin') ORDER BY CASE role WHEN 'supervisor' THEN 0 ELSE 1 END`).bind(teamId).all<Staff>();
 const filtered=rows.results.filter(s=>roles.includes(s.role));return filtered.length?filtered:db.prepare("SELECT * FROM staff WHERE active=1 AND role='admin' ORDER BY id LIMIT 1").all<Staff>().then(x=>x.results);
}
export function pushOutbox(db:D1Database,ticketId:string,kind:'alert'|'reply',recipientId:string|null,payload:unknown,key:string,at:number){return db.prepare(`INSERT OR IGNORE INTO notification_outbox(id,ticket_id,kind,recipient_id,payload,state,attempts,next_attempt_at,retry_key,created_at) VALUES(?,?,?,?,?,'pending',0,?,?,?)`).bind(id(),ticketId,kind,recipientId,JSON.stringify(payload),at,key,at);}
export function eventRow(tid:string,action:string,actor:string,note:string,at:number){return {sql:`INSERT INTO ticket_events(id,ticket_id,action,actor_id,note,created_at) VALUES(?,?,?,?,?,?)`,values:[id(),tid,action,actor,note,at] as (string|number|null)[]};}
export function statusValue(x:string):x is Status{return ['new','assigned','in_progress','waiting_customer','resolved','closed','cancelled'].includes(x);}
export async function enqueueEvent(env:Bindings,account:string,ev:Record<string,any>,at:number){
 const eventId=typeof ev.webhookEventId==='string'?ev.webhookEventId:typeof ev.message?.id==='string'?ev.message.id:`${ev.type}:${ev.timestamp}:${ev.source?.userId??'unknown'}`;
 if(env.JOBS) await env.JOBS.send({kind:'line-event',id:eventId});
}
