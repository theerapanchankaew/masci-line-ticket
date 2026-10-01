import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {JSDOM,VirtualConsole} from 'jsdom';
const root=resolve(import.meta.dirname,'..'),html=readFileSync(resolve(root,'preview.html'),'utf8'),errors=[];
const vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
const dom=new JSDOM(html,{url:'file:///preview.html',runScripts:'outside-only',virtualConsole:vc}),{window}=dom;
try{
 window.__MASCI_PREVIEW__=true;
 const code=html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];assert.ok(code);window.eval(code);
 const settle=()=>new Promise(r=>setTimeout(r,100));await settle();
 assert.equal(window.document.querySelectorAll('.ticket-row').length,3);
 window.document.querySelector('.ticket-row').click();await settle();
 assert.match(window.document.querySelector('.detail-head h2').textContent,/สอบถามสถานะ/);
 assert.equal(window.document.querySelector('.workflow button').disabled,true);
 for(const [name,selector] of [['ภาพรวม SLA','.report-metrics'],['ติดตามระบบ','.job'],['ตั้งค่า','.policy-form']]){
  const button=[...window.document.querySelectorAll('button.nav')].find(b=>b.textContent.includes(name));assert.ok(button,`Missing navigation ${name}`);button.click();await settle();assert.ok(window.document.querySelector(selector),`${name} failed to render`);
 }
 assert.equal(errors.length,0,errors.join('\n'));
 const source=readFileSync(resolve(root,'apps/portal/index.html'),'utf8');assert.ok(source.includes('preview.html')&&source.includes('localhost:5173'));
 console.log('PASS: standalone preview — ticket list/detail, disabled writes, dashboard, operations, settings, startup fallback; DOM verification (not browser visual QA)');
}finally{window.close();}
