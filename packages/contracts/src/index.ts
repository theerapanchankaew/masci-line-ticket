export type Role = 'admin' | 'supervisor' | 'agent';
export type Status = 'new' | 'assigned' | 'in_progress' | 'waiting_customer' | 'resolved' | 'closed' | 'cancelled';
export interface Staff { id: string; email: string; name: string; role: Role; team_id: string; line_user_id: string | null; active: number }
export interface Ticket {
 id: string; number: string; account_key: string; customer_id: string; subject: string;
 category: string; status: Status; team_id: string; assignee_id: string | null;
 created_at: number; updated_at: number; response_due: number; resolution_due: number;
 first_response_at: number | null; resolved_at: number | null; closed_at: number | null;
 retention_state?: string; retention_processed_at?: number; sla_cycle?: number; escalation_phase?: string; sla_started_at?: number; version: number; escalation_level: number; next_escalation_at: number;
 sla_breached: number; policy_json: string; last_operation_id: string | null;
}
export interface TicketMessage { id: string; ticket_id: string; source_id: string | null; direction: 'incoming'|'outgoing'|'internal'; kind: string; content: string; state: string; created_at: number; actor_id: string | null }
export interface TicketEvent { id: string; ticket_id: string; action: string; actor_id: string; note: string; created_at: number }
export interface TicketDetail { ticket: Ticket; messages: TicketMessage[]; events: TicketEvent[]; attachments: {id:string;name:string;size:number}[] }
export interface SlaPolicy { responseMinutes:number; resolutionMinutes:number; escalationMinutes:number; maxLevel:number; businessHours:boolean; startHour:number; endHour:number; holidays:string[] }
export const DEFAULT_POLICY: SlaPolicy = {responseMinutes:30,resolutionMinutes:240,escalationMinutes:60,maxLevel:2,businessHours:false,startHour:9,endHour:17,holidays:[]};
