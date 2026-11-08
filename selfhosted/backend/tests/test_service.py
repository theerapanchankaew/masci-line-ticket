import base64
import hashlib
import hmac
import json
import time
from datetime import datetime
from types import SimpleNamespace
from zoneinfo import ZoneInfo
import httpx
import pytest
from sqlalchemy import select, func
from app.models import Message, Ticket, Task, WebhookEvent, Outbox, Alert
from app.domain import create_ticket, dispatch_ticket, scan_sla
from app.jobs import process_inbox_once, send_outbox_once, fetch_media_once
from app.sla import DEFAULT_POLICY, due_at


def event(env, event_id="event-1", text="ระบบมีปัญหา", customer="U-customer", **extras):
    body = {
        "destination": "U-test-bot",
        "events": [
            {
                "webhookEventId": event_id,
                "type": "message",
                "timestamp": time.time() * 1000,
                "source": {"type": "user", "userId": customer},
                "message": {"id": "msg-" + event_id, "type": "text", "text": text},
                **extras,
            }
        ],
    }
    return post_signed(env, body)


def post_signed(env, body):
    raw = json.dumps(body, ensure_ascii=False).encode()
    sig = base64.b64encode(hmac.new(b"test-line-secret", raw, hashlib.sha256).digest()).decode()
    return env["client"].post(
        "/webhooks/line", content=raw, headers={"x-line-signature": sig, "Content-Type": "application/json"}
    )


def open_ticket(env, customer="U-customer", team=None, owner=None):
    with env["db"].begin() as db:
        m = Message(customer_id=customer, text="สอบถามบริการ")
        db.add(m)
        db.flush()
        t = create_ticket(
            db, env["ids"]["admin"], [m.id], "Test case", team or env["ids"]["team"], env["ids"]["policy"], 3
        )
        if owner:
            dispatch_ticket(db, t, env["ids"]["admin"], owner)
        return t.id


def test_webhook_signature_and_duplicate(env):
    c = env["client"]
    assert c.post("/webhooks/line", content=b"{}").status_code == 403
    assert event(env).status_code == 200
    assert event(env).status_code == 200
    assert process_inbox_once(env["db"])
    assert not process_inbox_once(env["db"])
    with env["db"]() as db:
        assert db.scalar(select(func.count()).select_from(Message)) == 1
        assert db.get(WebhookEvent, "event-1").payload == {"type": "message"}


def test_webhook_verification_empty_and_destination(env):
    assert post_signed(env, {"destination": "U-test-bot", "events": []}).status_code == 200
    assert post_signed(env, {"destination": "wrong", "events": []}).status_code == 403
    assert post_signed(env, {"destination": "U-test-bot", "events": [{}]}).status_code == 400


def test_auth_required_and_logout_revokes(env):
    c = env["client"]
    assert c.get("/api/tickets").status_code == 401
    headers = env["auth"]()
    assert c.post("/api/auth/logout", headers=headers).status_code == 200
    assert c.get("/api/tickets", headers=headers).status_code == 401


def test_login_rate_limit(env):
    c = env["client"]
    for _ in range(5):
        assert c.post("/api/auth/login", json={"email": "admin@example.org", "password": "wrong"}).status_code == 401
    assert c.post("/api/auth/login", json={"email": "admin@example.org", "password": "wrong"}).status_code == 429


def test_mapping_suggestion_and_idempotent_creation(env):
    event(env)
    process_inbox_once(env["db"])
    c, h = env["client"], env["auth"]()
    m = c.get("/api/inbox", headers=h).json()[0]
    assert m["suggestion"]["priority"] == 2
    body = {
        "message_ids": [m["id"]],
        "title": "ระบบมีปัญหา",
        "team_id": env["ids"]["team"],
        "policy_id": env["ids"]["policy"],
        "priority": 2,
        "reason": "reviewed",
    }
    h = {**h, "Idempotency-Key": "test-command-001"}
    first = c.post("/api/tickets", headers=h, json=body)
    assert first.status_code == 200, first.text
    second = c.post("/api/tickets", headers=h, json=body)
    assert first.json()["id"] == second.json()["id"]
    assert c.post("/api/tickets", headers=h, json={**body, "title": "different"}).status_code == 409
    assert c.get("/api/inbox", headers=h).json() == []


def test_cross_customer_create_rejected(env):
    with env["db"].begin() as db:
        a, b = Message(customer_id="A", text="a"), Message(customer_id="B", text="b")
        db.add_all([a, b])
        db.flush()
        with pytest.raises(Exception) as exc:
            create_ticket(db, "admin", [a.id, b.id], "mixed", env["ids"]["team"], env["ids"]["policy"], 3)
        assert exc.value.status_code == 422


def test_team_access_and_cross_team_task_visibility(env):
    tid = open_ticket(env, owner=env["ids"]["agent"])
    c = env["client"]
    other = env["auth"]("other")
    assert c.get("/api/tickets/" + tid, headers=other).status_code == 404
    with env["db"].begin() as db:
        db.add(
            Task(
                ticket_id=tid,
                title="IT subtask",
                assignee_id=env["ids"]["other"],
                dependencies=[],
                due_at=time.time() + 1000,
            )
        )
    assert c.get("/api/tickets/" + tid, headers=other).status_code == 200
    assert (
        c.post("/api/tickets/" + tid + "/transition", headers=other, json={"version": 2, "action": "start"}).status_code
        == 403
    )


def test_capacity_and_transfer_keeps_sla(env):
    from app.models import User

    with env["db"].begin() as db:
        db.get(User, env["ids"]["agent"]).capacity = 1
    first = open_ticket(env, owner=env["ids"]["agent"])
    second = open_ticket(env)
    with env["db"].begin() as db:
        t = db.get(Ticket, second)
        assert dispatch_ticket(db, t, "scheduler", automatic=True) is None
        original = db.get(Ticket, first).resolution_due
    c, h = env["client"], env["auth"]()
    t = c.get("/api/tickets/" + first, headers=h).json()
    res = c.post(
        "/api/tickets/" + first + "/transfer",
        headers=h,
        json={"version": t["version"], "team_id": env["ids"]["other_team"], "reason": "IT required"},
    )
    assert res.status_code == 200, res.text
    t = c.get("/api/tickets/" + first, headers=h).json()
    assert t["resolution_due"] == original and t["owner_id"] is None


def test_stale_transition_rejected(env):
    tid = open_ticket(env, owner=env["ids"]["agent"])
    c, h = env["client"], env["auth"]("agent")
    assert (
        c.post("/api/tickets/" + tid + "/transition", headers=h, json={"version": 1, "action": "start"}).status_code
        == 409
    )
    assert (
        c.post("/api/tickets/" + tid + "/transition", headers=h, json={"version": 2, "action": "start"}).status_code
        == 200
    )


def test_tasks_block_resolution_and_dependencies(env):
    tid = open_ticket(env, owner=env["ids"]["agent"])
    c, h = env["client"], env["auth"]()

    def ticket():
        return c.get("/api/tickets/" + tid, headers=h).json()

    def add(title, deps):
        return c.post(
            "/api/tickets/" + tid + "/tasks",
            headers=h,
            json={
                "version": ticket()["version"],
                "title": title,
                "assignee_id": env["ids"]["agent"],
                "dependencies": deps,
                "due_at": time.time() + 2000,
            },
        ).json()

    a = add("Verify", [])
    b = add("Fix", [a["id"]])
    assert (
        c.post("/api/tasks/" + b["id"] + "/complete", headers=h, json={"version": ticket()["version"]}).status_code
        == 409
    )
    assert (
        c.post(
            "/api/tickets/" + tid + "/transition", headers=h, json={"version": ticket()["version"], "action": "start"}
        ).status_code
        == 200
    )
    assert (
        c.post(
            "/api/tickets/" + tid + "/transition",
            headers=h,
            json={"version": ticket()["version"], "action": "resolve", "reason": "fixed"},
        ).status_code
        == 409
    )
    for task in [a, b]:
        assert (
            c.post(
                "/api/tasks/" + task["id"] + "/complete", headers=h, json={"version": ticket()["version"]}
            ).status_code
            == 200
        )
    assert (
        c.post(
            "/api/tickets/" + tid + "/transition",
            headers=h,
            json={"version": ticket()["version"], "action": "resolve", "reason": "fixed"},
        ).status_code
        == 200
    )


def test_response_only_counts_provider_accepted_substantive_reply(env):
    tid = open_ticket(env, owner=env["ids"]["agent"])
    c, h = env["client"], env["auth"]("agent")
    assert (
        c.post(
            "/api/tickets/" + tid + "/reply",
            headers={**h, "Idempotency-Key": "reply-test-123"},
            json={"text": "checking"},
        ).status_code
        == 200
    )
    cfg = SimpleNamespace(line_mode="live", line_token="test-token")
    client = httpx.Client(
        transport=httpx.MockTransport(lambda req: httpx.Response(200, headers={"x-line-request-id": "request-1"}))
    )
    assert send_outbox_once(env["db"], cfg, client)  # acknowledgement
    with env["db"]() as db:
        assert db.get(Ticket, tid).responded_at is None
    assert send_outbox_once(env["db"], cfg, client)
    with env["db"]() as db:
        assert db.get(Ticket, tid).responded_at is not None


def test_dry_run_not_response_and_not_replayed(env):
    tid = open_ticket(env)
    assert send_outbox_once(env["db"], env["settings"])
    cfg = SimpleNamespace(line_mode="live", line_token="token")
    client = httpx.Client(transport=httpx.MockTransport(lambda req: pytest.fail("dry-run must not replay")))
    assert not send_outbox_once(env["db"], cfg, client)
    with env["db"]() as db:
        assert db.get(Ticket, tid).responded_at is None
        assert db.scalar(select(Outbox)).state == "simulated"


def test_retry_uses_same_provider_key_and_409_requires_reference(env):
    open_ticket(env)
    keys = []

    def handler(req):
        keys.append(req.headers["x-line-retry-key"])
        return httpx.Response(
            500 if len(keys) == 1 else 409,
            headers={} if len(keys) == 1 else {"x-line-accepted-request-id": "accepted-before"},
        )

    client = httpx.Client(transport=httpx.MockTransport(handler))
    cfg = SimpleNamespace(line_mode="live", line_token="x")
    send_outbox_once(env["db"], cfg, client)
    with env["db"].begin() as db:
        row = db.scalar(select(Outbox))
        assert row.state == "pending"
        row.next_attempt = 0
    send_outbox_once(env["db"], cfg, client)
    assert len(keys) == 2 and keys[0] == keys[1]
    with env["db"]() as db:
        assert db.scalar(select(Outbox)).state == "accepted"


def test_unrecognized_provider_409_is_failed(env):
    open_ticket(env)
    cfg = SimpleNamespace(line_mode="live", line_token="x")
    send_outbox_once(env["db"], cfg, httpx.Client(transport=httpx.MockTransport(lambda req: httpx.Response(409))))
    with env["db"]() as db:
        assert db.scalar(select(Outbox)).state == "failed"


def test_customer_confirmation_and_spoof_rejected(env):
    tid = open_ticket(env, owner=env["ids"]["agent"])
    c, h = env["client"], env["auth"]()
    for action in ["start", "resolve"]:
        t = c.get("/api/tickets/" + tid, headers=h).json()
        assert (
            c.post(
                "/api/tickets/" + tid + "/transition",
                headers=h,
                json={"version": t["version"], "action": action, "reason": "fixed"},
            ).status_code
            == 200
        )
    with env["db"]() as db:
        token = db.get(Ticket, tid).confirmation_token
    data = f"case={tid}&token={token}&action=confirm"
    event(env, "spoof", customer="someone-else", type="postback", postback={"data": data})
    process_inbox_once(env["db"])
    with env["db"]() as db:
        assert db.get(Ticket, tid).status == "resolved"
    event(env, "good", type="postback", postback={"data": data})
    process_inbox_once(env["db"])
    with env["db"]() as db:
        assert db.get(Ticket, tid).close_reason == "customer_confirmed"


def test_unsend_even_before_original_event(env):
    event(env, "unsend", type="unsend", unsend={"messageId": "msg-original"})
    process_inbox_once(env["db"])
    event(env, "original", text="private")
    process_inbox_once(env["db"])
    with env["db"]() as db:
        m = db.scalar(select(Message))
        assert m.withdrawn and m.text == ""


def test_internal_note_never_queued_to_line(env):
    tid = open_ticket(env)
    c, h = env["client"], env["auth"]()
    assert c.post("/api/tickets/" + tid + "/notes", headers=h, json={"text": "INTERNAL-ONLY"}).status_code == 200
    with env["db"]() as db:
        assert "INTERNAL-ONLY" not in json.dumps([o.messages for o in db.scalars(select(Outbox))])


def test_attachment_access_control(env):
    tid = open_ticket(env)
    c, h = env["client"], env["auth"]()
    res = c.post(
        "/api/tickets/" + tid + "/attachments", headers=h, files={"file": ("../proof.txt", b"proof", "text/plain")}
    )
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["filename"] == "proof.txt" and "storage_key" not in data
    assert c.get("/api/attachments/" + data["id"], headers=env["auth"]("other")).status_code == 404
    assert c.get("/api/attachments/" + data["id"], headers=h).content == b"proof"


def test_sla_weekend_holiday_calendar():
    cfg = {**DEFAULT_POLICY, "holidays": ["2026-11-09"]}
    zone = ZoneInfo("Asia/Bangkok")
    start = datetime(2026, 11, 6, 16, 30, tzinfo=zone).timestamp()
    assert datetime.fromtimestamp(due_at(start, 60, cfg), zone) == datetime(2026, 11, 10, 9, 0, tzinfo=zone)


def test_sla_alerts_are_idempotent(env):
    tid = open_ticket(env)
    with env["db"].begin() as db:
        t = db.get(Ticket, tid)
        t.response_due = time.time() - 1
        t.resolution_due = time.time() - 1
        assert scan_sla(db) == 2
    with env["db"].begin() as db:
        assert scan_sla(db) == 0
        assert db.scalar(select(func.count()).select_from(Alert)) == 2


def test_origin_rejected(env):
    h = {**env["auth"](), "Origin": "https://attacker.example"}
    assert env["client"].post("/api/admin/teams", headers=h, json={"text": "Bad"}).status_code == 403


def test_agent_cannot_admin_or_read_unassigned_inbox(env):
    h = env["auth"]("agent")
    c = env["client"]
    assert c.get("/api/inbox", headers=h).status_code == 403
    assert c.post("/api/admin/teams", headers=h, json={"text": "Bad"}).status_code == 403


def test_media_download_and_unsend(env):
    event(env, "photo", message={"id": "photo-1", "type": "image"})
    process_inbox_once(env["db"])
    cfg = SimpleNamespace(line_token="x", uploads=env["settings"].uploads)
    client = httpx.Client(transport=httpx.MockTransport(lambda req: httpx.Response(200, content=b"photo-bytes")))
    assert fetch_media_once(env["db"], cfg, client)
    with env["db"]() as db:
        m = db.scalar(select(Message))
        mid = m.id
        path = cfg.uploads / m.media_key
        assert path.read_bytes() == b"photo-bytes"
    assert env["client"].get("/api/messages/" + mid + "/content", headers=env["auth"]()).content == b"photo-bytes"
    event(env, "unsend-photo", type="unsend", unsend={"messageId": "photo-1"})
    process_inbox_once(env["db"])
    assert not path.exists()
    assert env["client"].get("/api/messages/" + mid + "/content", headers=env["auth"]()).status_code == 404


def test_policy_snapshot_does_not_change(env):
    from app.models import Policy

    tid = open_ticket(env)
    with env["db"].begin() as db:
        p = db.get(Policy, env["ids"]["policy"])
        p.config = {**p.config, "start": "10:00"}
        assert db.get(Ticket, tid).sla_snapshot["start"] == "08:30"


def test_triage_time_included_in_sla(env):
    with env["db"].begin() as db:
        m = Message(customer_id="U", text="test", created_at=time.time() - 7200)
        db.add(m)
        db.flush()
        t = create_ticket(db, "admin", [m.id], "late triage", env["ids"]["team"], env["ids"]["policy"], 2)
        assert abs(t.response_due - (m.created_at + 3600)) < 1
