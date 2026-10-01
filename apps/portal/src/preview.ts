import type { Staff, Ticket, TicketDetail } from '@masci/contracts';

declare global { interface Window { __MASCI_PREVIEW__?: boolean } }
export const isPreview = window.__MASCI_PREVIEW__ === true;
const at = Date.now();
const policy = JSON.stringify({responseMinutes:30,resolutionMinutes:240,escalationMinutes:60,maxLevel:2,businessHours:false,startHour:9,endHour:17,holidays:[]});
const staff: Staff[] = [
  {id:'demo-admin',email:'demo-admin@masci.local',name:'ผู้ดูแลระบบ (ตัวอย่าง)',role:'admin',team_id:'service',line_user_id:null,active:1},
  {id:'demo-agent',email:'demo-agent@masci.local',name:'เจ้าหน้าที่บริการ (ตัวอย่าง)',role:'agent',team_id:'service',line_user_id:null,active:1},
];
const rows: Ticket[] = [
  {id:'demo-001',number:'MASCI-DEMO-001',subject:'สอบถามสถานะการรับรองผลิตภัณฑ์',status:'new',category:'การรับรอง',assignee_id:null,sla_breached:1,response_due:at-1800000,first_response_at:null,escalation_level:1},
  {id:'demo-002',number:'MASCI-DEMO-002',subject:'ขอข้อมูลเอกสารประกอบการสมัคร',status:'in_progress',category:'ข้อมูลทั่วไป',assignee_id:'demo-agent',sla_breached:0,response_due:at+1800000,first_response_at:at-600000,escalation_level:0},
  {id:'demo-003',number:'MASCI-DEMO-003',subject:'ติดตามใบแจ้งหนี้ค่าบริการ',status:'waiting_customer',category:'การเงิน',assignee_id:'demo-agent',sla_breached:0,response_due:at+1800000,first_response_at:at-600000,escalation_level:0},
].map((t,i) => ({ ...t,account_key:'demo',customer_id:`U-demo-customer-${i+1}`,team_id:'service',created_at:at-3600000,updated_at:at-600000,resolution_due:at+14400000,resolved_at:null,closed_at:null,version:1,next_escalation_at:at+3600000,policy_json:policy,last_operation_id:null })) as Ticket[];

export async function previewApi<T>(path: string, options?: RequestInit): Promise<T> {
  if (options?.method && options.method !== 'GET') throw new Error('ไฟล์ Preview ใช้ดูข้อมูลตัวอย่างเท่านั้น กรุณารัน Worker และ Portal เพื่อดำเนินการจริง');
  const url = new URL(path,'https://preview.local');
  let data: unknown;
  if (url.pathname === '/api/me') data=staff[0];
  else if (url.pathname === '/api/staff') data=staff;
  else if (url.pathname === '/api/dashboard') data={total:3,waiting:1,breached:1,mine:0,resolved:0,avgResponse:18,avgResolution:null,slaCompliance:null,workload:[{name:'ยังไม่มอบหมาย',count:1},{name:'เจ้าหน้าที่บริการ (ตัวอย่าง)',count:2}],trend:[{day:new Date(at).toISOString().slice(0,10),count:3}]};
  else if (url.pathname === '/api/teams'||url.pathname === '/api/settings/sla') data=[{id:'service',name:'Customer Service',policy_json:policy}];
  else if(url.pathname==='/api/operations') data={outbox:[{id:'sample-failed',ticket_id:'demo-002',number:'MASCI-DEMO-002',kind:'reply',state:'failed',attempts:8,error:'ตัวอย่าง: provider connection failed',next_attempt_at:at,first_attempt_at:at-3600000}],inbox:[],content:[],configuration:{database:false,evidence:false,queue:false,harness:false,integration:false,lineAccount:false,email:false,access:false,localDemo:false},audit:[{id:'sample-audit',action:'preview_only',actor_id:'demo-admin',note:'ข้อมูลจำลองสำหรับดูหน้าติดตามระบบ',created_at:at}]};
  else if (url.pathname === '/api/tickets') {
    const status=url.searchParams.get('status')??'all',q=(url.searchParams.get('q')??'').toLowerCase();
    const filtered=rows.filter(t=>(status==='all'||status===t.status)&&(url.searchParams.get('mine')!=='true'||t.assignee_id==='demo-admin')&&`${t.number} ${t.subject}`.toLowerCase().includes(q));data={items:filtered,total:filtered.length,page:1,pageSize:25};
  } else if (url.pathname.startsWith('/api/tickets/')) {
    const t=rows.find(t=>t.id===url.pathname.split('/')[3]);
    if(!t)throw new Error('ไม่พบ Ticket ตัวอย่าง');
    data={ticket:t,messages:[{id:`msg-${t.id}`,ticket_id:t.id,source_id:null,direction:'incoming',kind:'text',content:`สวัสดีครับ ต้องการ${t.subject}ครับ`,state:'received',created_at:t.created_at,actor_id:null},...(t.first_response_at?[{id:`reply-${t.id}`,ticket_id:t.id,source_id:null,direction:'outgoing' as const,kind:'text',content:'รับเรื่องแล้วครับ เจ้าหน้าที่กำลังตรวจสอบข้อมูลให้',state:'sent',created_at:t.first_response_at,actor_id:'demo-agent'}]:[])],events:[{id:`event-${t.id}`,ticket_id:t.id,action:'created',actor_id:'system',note:'ข้อมูลตัวอย่างสำหรับดูหน้าจอ ไม่มีการส่งข้อความ LINE',created_at:t.created_at}],attachments:[]} satisfies TicketDetail;
  } else throw new Error('Preview ไม่รองรับคำขอนี้');
  return data as T;
}
