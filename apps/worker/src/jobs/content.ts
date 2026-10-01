import type {Bindings} from '../types';
import {harnessHeaders} from './process';
import {id,now} from '../infrastructure/db';
export async function processContent(env:Bindings){
 const rows=await env.DB.prepare("SELECT * FROM content_jobs WHERE (state='pending' AND next_attempt_at<=?) OR (state='fetching' AND lease_until<=?) ORDER BY next_attempt_at LIMIT 5").bind(now(),now()).all<any>();
 for(const r of rows.results){const lease=id();const claim=await env.DB.prepare("UPDATE content_jobs SET state='fetching',attempts=attempts+1,lease_until=?,lease_token=? WHERE id=? AND ((state='pending' AND next_attempt_at<=?) OR (state='fetching' AND lease_until<=?))").bind(now()+60000,lease,r.id,now(),now()).run();if(!claim.meta.changes)continue;
  const key=`tickets/${r.ticket_id}/line-${r.id}-${lease}`;
  try{
   const response=await fetch(`${env.L_HARNESS_URL.replace(/\/$/,'')}/line-api-data/v2/bot/message/${encodeURIComponent(r.message_id)}/content`,{headers:harnessHeaders(env),signal:AbortSignal.timeout(15000)});
   if(!response.ok)throw new Error(`Content provider ${response.status}`);
   const mime=response.headers.get('content-type')?.split(';')[0]??'application/octet-stream';
   if(!response.body)throw new Error('Empty content');
   const reader=response.body.getReader();let size=0;const chunks:Uint8Array[]=[];
   while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>10*1024*1024){await reader.cancel();throw new Error('Content exceeds 10 MB');}chunks.push(part.value);}
   const bytes=new Uint8Array(size);let offset=0;for(const ch of chunks){bytes.set(ch,offset);offset+=ch.length;}
   const ext:Record<string,string>={'image/jpeg':'jpg','image/png':'png','application/pdf':'pdf','audio/mp4':'m4a','video/mp4':'mp4','text/plain':'txt'};
   await env.EVIDENCE.put(key,bytes,{httpMetadata:{contentType:mime}});
   const results=await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO attachments SELECT id,ticket_id,?,?,?,?,'system',? FROM content_jobs WHERE id=? AND lease_token=? AND state='fetching' AND NOT EXISTS(SELECT 1 FROM line_unsends WHERE message_id=content_jobs.message_id)").bind(key,`LINE-${r.message_id}.${ext[mime]??'bin'}`,size,mime,now(),r.id,lease),
    env.DB.prepare("UPDATE content_jobs SET state=CASE WHEN EXISTS(SELECT 1 FROM attachments WHERE id=?) THEN 'done' ELSE 'cancelled' END,lease_until=NULL,error=NULL WHERE id=? AND lease_token=? AND state='fetching'").bind(r.id,r.id,lease)]);
   if(!results[0].meta.changes)await env.EVIDENCE.delete(key);
  }catch(e){await env.EVIDENCE.delete(key);const error=e instanceof Error&&(/Content provider \d+/.test(e.message)||e.message==='Content exceeds 10 MB')?e.message:'Content fetch failed';await env.DB.prepare("UPDATE content_jobs SET state=?,next_attempt_at=?,lease_until=NULL,error=? WHERE id=? AND lease_token=? AND state='fetching'").bind(r.attempts>=7?'failed':'pending',now()+Math.min(60,2**r.attempts)*60000,error,r.id,lease).run();}
 }
 // Unsent evidence is inaccessible immediately; purge the R2 object and metadata asynchronously.
 const removed=await env.DB.prepare("SELECT a.id,a.object_key FROM attachments a JOIN content_jobs j ON j.id=a.id WHERE j.state='cancelled' LIMIT 10").all<any>();for(const a of removed.results){await env.EVIDENCE.delete(a.object_key);await env.DB.prepare('DELETE FROM attachments WHERE id=?').bind(a.id).run();}
}
