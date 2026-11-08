import secrets
import time
from fastapi import HTTPException
from sqlalchemy import select, func
from .models import Ticket, TicketMessage, Task, User, Team, Policy, Rule, Message, Outbox, Audit, Alert, uid
from .auth import visible_ticket_query
from .sla import due_at

ACTIVE = ("queued", "assigned", "working", "waiting_customer")


def audit(db, actor, action, ticket=None, **details):
    db.add(Audit(actor_id=actor, action=action, ticket_id=ticket, details=details))


def get_ticket(db, ticket_id, user=None, lock=True):
    query = visible_ticket_query(user) if user else select(Ticket)
    query = query.where(Ticket.id == ticket_id)
    ticket = db.scalar(query.with_for_update() if lock else query)
    if not ticket:
        raise HTTPException(404, "ไม่พบ Ticket หรือไม่มีสิทธิ์เข้าถึง")
    return ticket


def check_version(ticket, version):
    if ticket.version != version:
        raise HTTPException(409, "ข้อมูลถูกแก้ไขแล้ว กรุณาโหลดใหม่")


def can_manage(ticket, user):
    if user.role not in {"admin", "dispatcher"} and ticket.owner_id != user.id:
        raise HTTPException(403, "เฉพาะเจ้าของ Ticket หรือผู้จัดการคิว")


def enqueue(db, ticket, messages, kind, key):
    existing = db.scalar(select(Outbox).where(Outbox.request_key == key))
    if existing:
        return existing
    row = Outbox(ticket_id=ticket.id, customer_id=ticket.customer_id, messages=messages, kind=kind, request_key=key)
    db.add(row)
    db.flush()
    return row


def mapping_suggestion(db, text):
    rules = db.scalars(select(Rule).where(Rule.active.is_(True)).order_by(Rule.rank, Rule.id)).all()
    return next((r for r in rules if any(k.casefold() in text.casefold() for k in r.keywords)), None)


def create_ticket(db, actor, message_ids, title, team_id, policy_id, priority, rule_id=None, reason="manual"):
    messages = db.scalars(select(Message).where(Message.id.in_(message_ids)).with_for_update()).all()
    if (
        not messages
        or len(messages) != len(set(message_ids))
        or any(m.withdrawn or m.direction != "inbound" for m in messages)
    ):
        raise HTTPException(422, "เลือกข้อความรับเข้าที่ยังไม่ถูกถอน")
    if len({m.customer_id for m in messages}) != 1:
        raise HTTPException(422, "ห้ามรวมข้อความคนละลูกค้า")
    policy, team = db.get(Policy, policy_id), db.get(Team, team_id)
    if not policy or not team:
        raise HTTPException(422, "ไม่พบทีม/นโยบาย SLA")
    snapshot = {**policy.config, "policy_id": policy.id, "version": policy.version}
    rule = db.get(Rule, rule_id) if rule_id else None
    if rule_id and not rule:
        raise HTTPException(422, "ไม่พบ Mapping rule")
    now = time.time()
    # Clocks start at original server receipt, including time spent in triage.
    start = min(m.created_at for m in messages)
    target = snapshot["priorities"][str(priority)]
    ticket = Ticket(
        number="MS-" + secrets.token_hex(5).upper(),
        customer_id=messages[0].customer_id,
        title=title,
        team_id=team_id,
        priority=priority,
        sla_snapshot=snapshot,
        mapping_snapshot={
            "rule_id": rule.id if rule else None,
            "rule_version": rule.version if rule else None,
            "reason": reason,
            "team_id": team_id,
            "priority": priority,
        },
        created_at=now,
        response_due=due_at(start, target["response"], snapshot),
        resolution_due=due_at(start, target["resolution"], snapshot),
    )
    db.add(ticket)
    db.flush()
    for m in messages:
        db.add(TicketMessage(ticket_id=ticket.id, message_id=m.id))
    audit(db, actor, "ticket.created", ticket.id, message_ids=message_ids, mapping=ticket.mapping_snapshot)
    enqueue(
        db,
        ticket,
        [{"type": "text", "text": f"MASCI รับเรื่อง {ticket.number} แล้ว เจ้าหน้าที่จะตรวจสอบและติดต่อกลับ"}],
        "acknowledgement",
        "ack:" + ticket.id,
    )
    return ticket


def dispatch_ticket(db, ticket, actor, owner_id=None, automatic=False):
    if ticket.status not in ACTIVE:
        raise HTTPException(409, "Ticket ไม่อยู่ในสถานะรับงาน")
    # Lock team before capacity calculation. All assignments use the same order.
    db.scalar(select(Team).where(Team.id == ticket.team_id).with_for_update())
    users = db.scalars(
        select(User)
        .where(User.team_id == ticket.team_id, User.role == "agent", User.active.is_(True), User.available.is_(True))
        .order_by(User.id)
        .with_for_update()
    ).all()
    candidates = []
    for user in users:
        tickets = db.scalar(
            select(func.count()).select_from(Ticket).where(Ticket.owner_id == user.id, Ticket.status.in_(ACTIVE))
        )
        tasks = db.scalar(
            select(func.count())
            .select_from(Task)
            .join(Ticket, Task.ticket_id == Ticket.id)
            .where(Task.assignee_id == user.id, Task.status != "done", Ticket.status.in_(ACTIVE))
        )
        load = tickets + tasks - (1 if ticket.owner_id == user.id else 0)
        if load < user.capacity and (owner_id is None or owner_id == user.id):
            candidates.append((load, user.id))
    if not candidates:
        if automatic:
            return None
        raise HTTPException(409, "ไม่มีเจ้าหน้าที่ว่างในทีม หรือเต็มกำลังรับงาน")
    previous = ticket.owner_id
    ticket.owner_id = min(candidates)[1]
    ticket.status = "assigned"
    ticket.version += 1
    audit(db, actor, "ticket.assigned", ticket.id, previous=previous, owner_id=ticket.owner_id)
    return ticket.owner_id


def resolution_messages(ticket):
    def data(action):
        return f"case={ticket.id}&token={ticket.confirmation_token}&action={action}"

    return [
        {"type": "text", "text": f"{ticket.number}: {ticket.resolution}"},
        {
            "type": "template",
            "altText": f"{ticket.number} กรุณายืนยันผล",
            "template": {
                "type": "confirm",
                "text": "ผลการดำเนินการแก้ปัญหาได้แล้วหรือไม่?",
                "actions": [
                    {"type": "postback", "label": "แก้ไขแล้ว", "data": data("confirm")},
                    {"type": "postback", "label": "ยังมีปัญหา", "data": data("reopen")},
                ],
            },
        },
    ]


def transition(db, ticket, user, action, reason):
    can_manage(ticket, user)
    now, old = time.time(), ticket.status
    if action == "start" and old == "assigned":
        ticket.status = "working"
    elif action == "wait" and old == "working" and reason:
        ticket.status = "waiting_customer"
    elif action == "resume" and old == "waiting_customer":
        ticket.status = "working"
    elif action == "resolve" and old in {"working", "waiting_customer"} and reason and len(reason) <= 4000:
        if db.scalar(
            select(Task.id).where(Task.ticket_id == ticket.id, Task.required.is_(True), Task.status != "done").limit(1)
        ):
            raise HTTPException(409, "งานย่อยบังคับยังไม่เสร็จ")
        ticket.status, ticket.resolution, ticket.resolved_at = "resolved", reason, now
        ticket.confirmation_token = uid()
        enqueue(db, ticket, resolution_messages(ticket), "resolution", f"resolve:{ticket.id}:{ticket.round}")
    elif action == "close" and old == "resolved" and reason:
        ticket.status, ticket.closed_at, ticket.close_reason = "closed", now, reason
        ticket.confirmation_token = None
    elif action == "reopen" and old in {"resolved", "closed"} and reason:
        ticket.status, ticket.resolved_at, ticket.closed_at = "working" if ticket.owner_id else "queued", None, None
        ticket.round += 1
        ticket.confirmation_token = None
        # Original SLA deadlines retained; no hidden reset after reopen.
    elif action == "cancel" and old in ACTIVE and reason and user.role in {"admin", "dispatcher"}:
        ticket.status, ticket.closed_at, ticket.close_reason = "cancelled", now, reason
        ticket.confirmation_token = None
    else:
        raise HTTPException(409, "เปลี่ยนสถานะไม่ได้ หรือขาดเหตุผล/สรุปผล")
    ticket.version += 1
    audit(db, user.id, "ticket." + action, ticket.id, previous=old, status=ticket.status, reason=reason)


def scan_sla(db, now=None):
    now = now or time.time()
    # Single scheduler leader per DB; transaction-scoped lock on PostgreSQL.
    if db.bind.dialect.name == "postgresql":
        from sqlalchemy import text

        if not db.scalar(text("SELECT pg_try_advisory_xact_lock(78194312)")):
            return 0
    count = 0
    for ticket in db.scalars(select(Ticket).where(Ticket.status.in_((*ACTIVE, "resolved")))).all():
        phases = [("response", ticket.response_due, ticket.responded_at)]
        if ticket.status != "resolved":
            phases.append(("resolution", ticket.resolution_due, ticket.resolved_at))
        for phase, deadline, completed in phases:
            if completed is not None:
                continue
            level = "breached" if now >= deadline else "at_risk" if now >= deadline - 1800 else None
            if level and not db.scalar(
                select(Alert.id).where(
                    Alert.ticket_id == ticket.id,
                    Alert.round == ticket.round,
                    Alert.phase == phase,
                    Alert.level == level,
                )
            ):
                db.add(Alert(ticket_id=ticket.id, round=ticket.round, phase=phase, level=level))
                audit(db, "scheduler", "sla." + level, ticket.id, phase=phase, due_at=deadline)
                count += 1
    return count
