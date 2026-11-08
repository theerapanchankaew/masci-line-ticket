# LINE OA setup

1. Use a test OA first. Enable Messaging API and obtain Channel Secret, Channel Access Token and bot user ID (destination). Provider/account configuration must be controlled by MASCI.
2. Store credentials using scripts/set-secret.py, never in source or chat. Set LINE_DESTINATION in .env. Use Messaging API Get bot info to check bot user ID.
3. Create a stable HTTPS hostname. For a Cloudflare-managed tunnel, route its hostname to http://gateway:8080 on this Compose network. The host must permit outbound tunnel traffic. Add its tunnel token to secrets/tunnel_token.
4. Set PUBLIC_ORIGIN=https://your-real-hostname. API origin checks compare this exact origin. Do not put a browser sign-in wall in front of /webhooks/line; LINE cannot complete it. Backend verifies LINE signatures independently.
5. Start stack and tunnel profile. Register https://your-real-hostname/webhooks/line in LINE Developers, Verify, enable Use webhook and Webhook redelivery.
6. Check OA Manager greetings/auto replies with the actual account to avoid duplicate responses. Do not assume staff replies made in OA Manager appear in this application's history: operate through the staff portal for traceable case communication.
7. Keep LINE_MODE=dry_run initially: send test text/image, verify Inbox, map to a Ticket and test assignments/tasks/SLA. Check Operations worker/scheduler heartbeats and media jobs. Retry media after correcting credentials if needed.
8. Switch LINE_MODE=live and APP_ENV=production only on the test OA first. Recreate API/worker/scheduler. Send one substantive reply, resolve, confirm from the same LINE account, test reopen and duplicate postbacks.
9. Check push eligibility, account message quota and monthly consumption in LINE. API acceptance is not read/delivery confirmation. Stable retry keys deduplicate accepted provider requests but do not guarantee customer delivery.
10. Complete staging acceptance before switching MASCI's customer-facing OA. Incoming group/room events are ignored by v0.1, deliberately.

## Callback authenticity
Signature is calculated over raw body before JSON parse; wrong signature or destination is rejected. Empty events Verify requests return 200 when correctly signed. Messages are persisted in inbox before 200, then processed asynchronously. Customer confirmation checks actual webhook source user ID, current ticket status and per-resolution token. Old buttons or another user's button clicks do not close a case.

## URLs
- Webhook: /webhooks/line
- Portal: /
- API: /api/*
- Readiness: /health/ready
- API documentation: available on backend directly at /docs for development; not routed publicly by gateway

## Official references
https://developers.line.biz/en/docs/messaging-api/building-bot/
https://developers.line.biz/en/docs/messaging-api/receiving-messages/
https://developers.line.biz/en/docs/messaging-api/verify-webhook-signature/
https://developers.line.biz/en/docs/messaging-api/retrying-api-request/
