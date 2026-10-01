import type {SlaPolicy} from '@masci/contracts';
const MINUTE=60000, DAY=86400000, OFFSET=7*3600000;
export function validatePolicy(p:SlaPolicy):SlaPolicy {
 if(!p || ![p.responseMinutes,p.resolutionMinutes,p.escalationMinutes].every(n=>Number.isInteger(n)&&n>0&&n<=43200) || !Number.isInteger(p.maxLevel)||p.maxLevel<1||p.maxLevel>5||typeof p.businessHours!=='boolean'||!Number.isInteger(p.startHour)||!Number.isInteger(p.endHour)||p.startHour<0||p.endHour>24||p.startHour>=p.endHour||!Array.isArray(p.holidays)||p.holidays.length>366||!p.holidays.every(x=>/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x)) throw new Error('Invalid SLA policy');
 return p;
}
// Thailand only: Asia/Bangkok is UTC+07:00, no daylight saving.
export function addMinutes(start:number,minutes:number,policy:SlaPolicy):number {
 if(!policy.businessHours) return start+minutes*MINUTE;
 let cursor=start,remaining=minutes*MINUTE;
 for(let guard=0;guard<10000;guard++) {
  const local=new Date(cursor+OFFSET),dayStart=Math.floor((cursor+OFFSET)/DAY)*DAY-OFFSET;
  const date=local.toISOString().slice(0,10),weekday=local.getUTCDay();
  if(weekday===0||weekday===6||policy.holidays.includes(date)){cursor=dayStart+DAY;continue;}
  const open=dayStart+policy.startHour*3600000,close=dayStart+policy.endHour*3600000;
  cursor=Math.max(cursor,open);
  if(cursor>=close){cursor=dayStart+DAY;continue;}
  const usable=close-cursor;
  if(remaining<=usable)return cursor+remaining;
  remaining-=usable;cursor=dayStart+DAY;
 }
 throw new Error('Calendar has no available working time');
}
export function nextEscalation(now:number,previousDue:number,p:SlaPolicy):number {return addMinutes(Math.max(now,previousDue),p.escalationMinutes,p);}
