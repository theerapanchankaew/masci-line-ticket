import logging
import time
from urllib.parse import parse_qs
import httpx
from sqlalchemy import select
from .db import Session, settings
from .models import WebhookEvent, Message, Tombstone, Ticket, Outbox, uid
from .domain import enqueue, audit

log = logging.getLogger(__name__)


def process_event(db, row):
    event = row.payload
    customer = event.get("source", {}).get("userId")
    # v0.1 deliberately accepts one-to-one user conversations only.
    if not customer or event.get("source", {}).get("type") != "user":
        row.state, row.payload = "ignored", {"type": event.get("type")}
        return
    if event.get("type") == "message":
        incoming = event["message"]
        mid = incoming.get("id")
        if not mid:
            row.state, row.payload = "ignored", {"type": "message_without_id"}
            return
        withdrawn = db.get(Tombstone, mid) is not None
        kind = incoming.get("type", "unknown")
        body = incoming.get("text", "") if kind == "text" else f"[{kind}: LINE message {mid}]"
        db.add(
            Message(
                line_message_id=mid,
                event_id=row.id,
                customer_id=customer,
                kind=kind,
                text="" if withdrawn else body,
                withdrawn=withdrawn,
                media_state="pending" if kind in {"image", "video", "audio", "file"} and not withdrawn else None,
                occurred_at=event.get("timestamp", row.received_at * 1000) / 1000,
                created_at=row.received_at,
            )
        )
    elif event.get("type") == "unsend":
        mid = event.get("unsend", {}).get("messageId")
        if mid:
            if not db.get(Tombstone, mid):
                db.add(Tombstone(message_id=mid, customer_id=customer))
            message = db.scalar(select(Message).where(Message.line_message_id == mid, Message.customer_id == customer))
            if message:
                message.text, message.withdrawn = "", True
                if message.media_key:
                    (settings.uploads / message.media_key).unlink(missing_ok=True)
                message.media_key, message.media_state = None, "withdrawn"
    elif event.get("type") == "postback":
        data = parse_qs(event.get("postback", {}).get("data", ""))
        case, token, action = (data.get(k, [""])[0] for k in ("case", "token", "action"))
        ticket = db.scalar(select(Ticket).where(Ticket.id == case).with_for_update()) if case else None
        if (
            ticket
            and ticket.customer_id == customer
            and ticket.status == "resolved"
            and token
            and token == ticket.confirmation_token
        ):
            if action == "confirm":
                ticket.status, ticket.closed_at, ticket.close_reason = "closed", time.time(), "customer_confirmed"
            elif action == "reopen":
                ticket.status, ticket.resolved_at = "working" if ticket.owner_id else "queued", None
                ticket.round += 1
            else:
                row.state, row.payload = "ignored", {"type": "unknown_postback"}
                return
            ticket.confirmation_token = None
            ticket.version += 1
            audit(db, "line_customer", "customer." + action, ticket.id)
            enqueue(
                db,
                ticket,
                [
                    {
                        "type": "text",
                        "text": f"{ticket.number}: "
                        + ("ปิดเคสแล้ว ขอบคุณครับ" if action == "confirm" else "รับแจ้งว่ายังมีปัญหา เจ้าหน้าที่จะดำเนินการต่อ"),
                    }
                ],
                "confirmation",
                "postback:" + row.id,
            )
    row.state, row.error = "done", None
    # Keep business message once; discard webhook copy (including replyToken).
    row.payload = {"type": event.get("type")}


def process_inbox_once(factory=Session):
    with factory.begin() as db:
        row = db.scalar(
            select(WebhookEvent)
            .where(WebhookEvent.state == "pending")
            .order_by(WebhookEvent.received_at, WebhookEvent.id)
            .with_for_update(skip_locked=True)
            .limit(1)
        )
        if not row:
            return False
        try:
            with db.begin_nested():
                process_event(db, row)
                db.flush()
        except Exception as exc:
            row.attempts += 1
            row.error = type(exc).__name__
            if row.attempts >= 5:
                row.state = "failed"
            log.warning("inbox failure id=%s error=%s", row.id, type(exc).__name__)
        return True


def send_outbox_once(factory=Session, cfg=settings, client=None):
    # Row lock held during bounded HTTP call. PostgreSQL lock is released after
    # crash; provider retry key prevents duplicate accepted requests on recovery.
    with factory.begin() as db:
        row = db.scalar(
            select(Outbox)
            .where(Outbox.state == "pending", Outbox.next_attempt <= time.time())
            .order_by(Outbox.created_at, Outbox.id)
            .with_for_update(skip_locked=True)
            .limit(1)
        )
        if not row:
            return False
        if row.kind == "resolution" and row.ticket_id:
            ticket = db.get(Ticket, row.ticket_id)
            if not ticket or ticket.status != "resolved" or row.request_key != f"resolve:{ticket.id}:{ticket.round}":
                row.state, row.error = "superseded", "RESOLUTION_NO_LONGER_CURRENT"
                return True
        row.attempts += 1
        if cfg.line_mode == "dry_run":
            row.state = "simulated"
            return True
        try:
            if client:
                response = client.post(
                    "https://api.line.me/v2/bot/message/push",
                    headers={"Authorization": "Bearer " + cfg.line_token, "X-Line-Retry-Key": row.id},
                    json={"to": row.customer_id, "messages": row.messages},
                    timeout=10,
                )
            else:
                with httpx.Client() as sender:
                    response = sender.post(
                        "https://api.line.me/v2/bot/message/push",
                        headers={"Authorization": "Bearer " + cfg.line_token, "X-Line-Retry-Key": row.id},
                        json={"to": row.customer_id, "messages": row.messages},
                        timeout=10,
                    )
            accepted = 200 <= response.status_code < 300 or (
                response.status_code == 409 and bool(response.headers.get("x-line-accepted-request-id"))
            )
            if accepted:
                row.state, row.accepted_at = "accepted", time.time()
                row.provider_request_id = response.headers.get("x-line-accepted-request-id") or response.headers.get(
                    "x-line-request-id"
                )
                # Acknowledgements never satisfy first substantive response.
                if row.ticket_id and row.kind in {"reply", "resolution"}:
                    ticket = db.scalar(select(Ticket).where(Ticket.id == row.ticket_id).with_for_update())
                    if ticket and ticket.responded_at is None:
                        ticket.responded_at = row.accepted_at
                audit(db, "worker", "line.accepted", row.ticket_id, outbox_id=row.id)
            elif response.status_code == 429 or response.status_code >= 500:
                row.error = "HTTP_" + str(response.status_code)
            else:
                row.state, row.error = "failed", "HTTP_" + str(response.status_code)
        except httpx.HTTPError as exc:
            row.error = type(exc).__name__
        if row.state == "pending":
            row.next_attempt = time.time() + min(3600, 2**row.attempts * 10)
            # Retry keys have a bounded validity window: stop automatic retry
            # well before that window, leaving ambiguous requests for review.
            if row.attempts >= 8 or time.time() - row.created_at >= 20 * 3600:
                row.state = "failed"
        return True


def fetch_media_once(factory=Session, cfg=settings, client=None):
    with factory.begin() as db:
        row = db.scalar(
            select(Message)
            .where(
                Message.media_state == "pending",
                Message.withdrawn.is_(False),
                Message.media_next_attempt <= time.time(),
            )
            .order_by(Message.created_at)
            .with_for_update(skip_locked=True)
            .limit(1)
        )
        if not row:
            return False
        if not cfg.line_token:
            row.media_state, row.media_error = "failed", "LINE_TOKEN_NOT_CONFIGURED"
            return True
        cfg.uploads.mkdir(parents=True, exist_ok=True)
        key = uid()
        path = cfg.uploads / key
        row.media_attempts += 1
        try:

            def fetch(sender):
                size = 0
                with sender.stream(
                    "GET",
                    f"https://api-data.line.me/v2/bot/message/{row.line_message_id}/content",
                    headers={"Authorization": "Bearer " + cfg.line_token},
                    timeout=15,
                ) as response:
                    response.raise_for_status()
                    with path.open("xb") as target:
                        for chunk in response.iter_bytes(65536):
                            size += len(chunk)
                            if size > 10 * 1024 * 1024:
                                raise ValueError("MEDIA_EXCEEDS_10MB")
                            target.write(chunk)

            if client:
                fetch(client)
            else:
                with httpx.Client() as sender:
                    fetch(sender)
            row.media_key, row.media_state, row.media_error = key, "ready", None
        except (httpx.HTTPError, ValueError, OSError) as exc:
            path.unlink(missing_ok=True)
            row.media_error = type(exc).__name__
            row.media_next_attempt = time.time() + min(3600, 30 * 2**row.media_attempts)
            if row.media_attempts >= 5 or isinstance(exc, ValueError):
                row.media_state = "failed"
        return True
