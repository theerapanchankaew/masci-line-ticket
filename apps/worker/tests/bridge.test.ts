import {it,expect,vi,afterEach} from 'vitest';
import {readFileSync} from 'node:fs';
import {SQLiteD1} from './sqlite-d1';
import {processMasciTicketBridge} from '../../../upstream/l-harness/apps/worker/src/services/masci-ticket-bridge';
afterEach(()=>vi.restoreAllMocks());
it('L Harness bridge normalizes root URL and durably retries then acknowledges ingress',async()=>{
 const db=new SQLiteD1();for(const file of ['073_masci_ticket_bridge_outbox.sql','074_masci_bridge_leases.sql'])db.sqlite.exec(readFileSync(new URL(`../../../integration/l-harness/patches/${file}`,import.meta.url),'utf8'));
 await db.prepare("INSERT INTO masci_ticket_bridge_outbox(id,payload,next_attempt_at,created_at) VALUES('bridge','{}',?,?)").bind(new Date(0).toISOString(),new Date().toISOString()).run();
 const env={DB:db,MASCI_TICKET_URL:'https://ticket.example.org',MASCI_TICKET_SECRET:'secret'} as any;
 const f=vi.spyOn(globalThis,'fetch').mockResolvedValueOnce(new Response('',{status:503})).mockResolvedValueOnce(new Response('',{status:202}));
 await processMasciTicketBridge(env);expect(db.rows('SELECT * FROM masci_ticket_bridge_outbox')[0].status).toBe('pending');db.sqlite.exec("UPDATE masci_ticket_bridge_outbox SET next_attempt_at='1970-01-01T00:00:00.000Z'");await processMasciTicketBridge(env);
 expect(f.mock.calls[0][0]).toBe('https://ticket.example.org/integrations/line/events');expect(db.rows('SELECT * FROM masci_ticket_bridge_outbox')[0].status).toBe('sent');
});
