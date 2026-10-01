import type { Env } from '../index.js';

/** Drain durable minimal webhook envelopes to the MASCI Ticket ingress. */
export async function processMasciTicketBridge(env: Env['Bindings']): Promise<void> {
  const endpoint = env.MASCI_TICKET_URL;
  const secret = env.MASCI_TICKET_SECRET;
  if (!endpoint || !secret) return;
  let target: URL;
  try {
    target = new URL(endpoint);
    if (target.pathname === '/') target.pathname = '/integrations/line/events';
    if (target.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(target.hostname)) {
      throw new Error('HTTPS required');
    }
  } catch {
    console.error('[masci-ticket] invalid bridge endpoint configuration');
    return;
  }
  const now = new Date().toISOString();
  const rows = await env.DB.prepare(
    `SELECT id,payload,attempts FROM masci_ticket_bridge_outbox
     WHERE (status='pending' AND next_attempt_at<=?) OR (status='sending' AND lease_until<=?)
     ORDER BY created_at LIMIT 25`,
  ).bind(now, now).all<{ id: string; payload: string; attempts: number }>();
  for (const row of rows.results) {
    const leaseToken = crypto.randomUUID();
    const lease = new Date(Date.now() + 60_000).toISOString();
    const claim = await env.DB.prepare(
      `UPDATE masci_ticket_bridge_outbox SET status='sending',attempts=attempts+1,lease_until=?,lease_token=?
       WHERE id=? AND ((status='pending' AND next_attempt_at<=?) OR (status='sending' AND lease_until<=?))`,
    ).bind(lease,leaseToken,row.id,now,now).run();
    if (!claim.meta.changes) continue;
    try {
      const response = await fetch(target.toString(), { method: 'POST', headers: {
        'content-type': 'application/json', 'x-masci-integration-secret': secret,
      }, body: row.payload, signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error(`Ticket ingress returned ${response.status}`);
      await env.DB.prepare(
        `UPDATE masci_ticket_bridge_outbox SET status='sent',sent_at=?,lease_until=NULL,last_error=NULL WHERE id=? AND status='sending' AND lease_token=?`,
      ).bind(new Date().toISOString(),row.id,leaseToken).run();
    } catch (error) {
      const attempts = row.attempts + 1;
      const state = attempts >= 12 ? 'failed' : 'pending';
      const next = new Date(Date.now() + Math.min(60,2 ** Math.min(attempts,6))*60_000).toISOString();
      await env.DB.prepare(
        `UPDATE masci_ticket_bridge_outbox SET status=?,next_attempt_at=?,lease_until=NULL,last_error=? WHERE id=? AND status='sending' AND lease_token=?`,
      ).bind(state,next,error instanceof Error && /^Ticket ingress returned \d+$/.test(error.message) ? error.message : 'Bridge delivery failed',row.id,leaseToken).run();
      console.error('[masci-ticket] bridge delivery failed',row.id);
    }
  }
}
