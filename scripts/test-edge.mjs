import {createRequire} from 'node:module';
import {realpathSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'),require=createRequire(import.meta.url);
const {Miniflare,convertV4MiniflareOptions}=require(require.resolve('miniflare',{paths:[realpathSync(resolve(root,'apps/worker/node_modules/wrangler'))]}));
const options={modules:true,scriptPath:resolve(root,'apps/worker/dist/index.js'),compatibilityDate:'2026-09-01',d1Databases:{DB:'smoke-db'},r2Buckets:['EVIDENCE'],bindings:{ENVIRONMENT:'development',DEV_AUTH_ENABLED:'true',ALLOWED_ORIGIN:'http://localhost:5173',PORTAL_URL:'http://localhost:5173',LINE_ACCOUNT_KEY:'test-account',INTEGRATION_SECRET:'s'.repeat(40),JOB_SECRET:'test-job',L_HARNESS_URL:'https://harness.invalid'}};
const mf=new Miniflare(convertV4MiniflareOptions?convertV4MiniflareOptions(options):options);
try{
 const db=await mf.getD1Database('DB');
 for(const file of ['apps/worker/migrations/0001_ticket.sql','apps/worker/migrations/0002_reliability.sql','apps/worker/migrations/0003_retention.sql','scripts/demo.sql']){const source=readFileSync(resolve(root,file),'utf8');for(const sql of source.split(';').map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run();}
 async function request(path,method='GET',body,headers={}){return mf.dispatchFetch('http://localhost:8787'+path,{method,headers:{host:'localhost:8787','x-dev-staff-id':'demo-admin','content-type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})});}
 assert.equal((await request('/api/me')).status,200);
 const event={destination:'test-account',events:[{type:'message',webhookEventId:'edge-event',timestamp:Date.now(),source:{userId:'U'+'a'.repeat(32)},message:{id:'edge-message',type:'text',text:'Edge runtime smoke test'}}]};
 assert.equal((await request('/integrations/line/events','POST',event,{'x-masci-integration-secret':'s'.repeat(40)})).status,202);
 assert.equal((await request('/internal/jobs/run','POST',{}, {'x-job-secret':'test-job'})).status,200);
 const listing=await (await request('/api/tickets?q=Edge')).json();assert.equal(listing.data.items.length,1);
 const t=listing.data.items[0];
 const token=await (await request(`/api/tickets/${t.id}/action-tokens`,'POST',{action:'claim',version:t.version})).json();assert.ok(token.data?.token);
 const claimed=await (await request(`/api/tickets/${t.id}/actions/claim`,'POST',{token:token.data.token})).json();assert.equal(claimed.data.ticket.status,'in_progress');
 const version=claimed.data.ticket.version;
 const replies=await Promise.all(['Answer one','Answer two'].map(text=>request(`/api/tickets/${t.id}/messages`,'POST',{text,version},{'Idempotency-Key':crypto.randomUUID()})));
 assert.deepEqual(replies.map(r=>r.status).sort(),[202,409]);
 const messages=await db.prepare("SELECT COUNT(*) n FROM ticket_messages WHERE ticket_id=? AND direction='outgoing'").bind(t.id).first();assert.equal(messages.n,1);
 const fd=new FormData();fd.append('file',new File([new Uint8Array([1,2,3])],'test.png',{type:'image/png'}));
 const encoded=new Request('http://localhost/upload',{method:'POST',body:fd});const upload=await mf.dispatchFetch(`http://localhost:8787/api/tickets/${t.id}/attachments`,{method:'POST',headers:{host:'localhost:8787','x-dev-staff-id':'demo-admin','content-type':encoded.headers.get('content-type')},body:await encoded.arrayBuffer()});assert.equal(upload.status,201);
 const aid=(await upload.json()).data.id;const download=await request(`/api/tickets/${t.id}/attachments/${aid}`);assert.equal(download.status,200);assert.equal((await download.arrayBuffer()).byteLength,3);
 assert.equal((await request('/api/operations')).status,200);
 console.log('PASS: Workerd + real local D1/R2 — webhook, atomic intake, token claim, concurrent replies, upload/download and operations');
}finally{await mf.dispose();}
