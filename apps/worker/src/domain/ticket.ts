import type {Staff,Ticket,Status} from '@masci/contracts';
export const ACTIVE:Status[]=['new','assigned','in_progress','waiting_customer'];
export function canSee(a:Staff,t:Ticket):boolean {return a.role==='admin'||a.team_id===t.team_id;}
export function canManage(a:Staff,t:Ticket):boolean {return a.role==='admin'||(a.role==='supervisor'&&a.team_id===t.team_id)||a.id===t.assignee_id;}
export function canClaim(a:Staff,t:Ticket):boolean {return canSee(a,t)&&['new','assigned'].includes(t.status)&&(!t.assignee_id||t.assignee_id===a.id);}
export function canResolve(a:Staff,t:Ticket):boolean {return canManage(a,t)&&['in_progress','waiting_customer'].includes(t.status);}
export function isTerminal(t:Ticket):boolean {return !ACTIVE.includes(t.status);}
