import base64
import hashlib
import hmac
import json
import time
from pathlib import Path
from fastapi import FastAPI, Depends, HTTPException, Request, Header, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy import select, func, text, exists
from sqlalchemy.exc import IntegrityError
from .db import get_db, settings
from .models import (
    Team,
    User,
    AuthSession,
    LoginGuard,
    Policy,
    Rule,
    WebhookEvent,
    Message,
    Ticket,
    TicketMessage,
    Task,
    Note,
    Attachment,
    Outbox,
    Audit,
    Alert,
    Command,
    Heartbeat,
    uid,
)
from .schemas import (
    Login,
    TicketCreate,
    Assignment,
    Change,
    TextInput,
    TaskCreate,
    Transfer,
    UserCreate,
    RuleCreate,
    PolicyCreate,
    Versioned,
    UserUpdate,
    RuleState,
)
from .auth import current_user, manager, admin, digest, password_ok, issue_session, hasher, visible_ticket_query, bearer
from .domain import (
    get_ticket,
    check_version,
    can_manage,
    create_ticket,
    dispatch_ticket,
    mapping_suggestion,
    transition,
    enqueue,
    audit,
    ACTIVE,
)
from .sla import validate_policy

app = FastAPI(title="MASCI Service Desk — Self-hosted", version="0.1.0")


def record(row, exclude=()):
    return {col.name: getattr(row, col.name) for col in row.__table__.columns if col.name not in exclude}


def user_record(user):
    return record(user, ("password_hash",))


@app.middleware("http")
async def security_headers(request: Request, call_next):
    # Bearer sessions avoid cookie-based CSRF; reject unexpected browser origins.
    if request.method not in {"GET", "HEAD", "OPTIONS"} and request.url.path != "/webhooks/line":
        origin = request.headers.get("origin")
        if origin and origin != settings.public_origin:
            from fastapi.responses import JSONResponse

            return JSONResponse({"detail": "Origin not allowed"}, status_code=403)
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/health/live")
def live():
    return {"status": "ok"}


@app.get("/health/ready")
def ready(db=Depends(get_db)):
    db.execute(text("SELECT 1"))
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    config.set_main_option("script_location", str(Path(__file__).resolve().parents[1] / "migrations"))
    expected = ScriptDirectory.from_config(config).get_current_head()
    if db.scalar(text("SELECT version_num FROM alembic_version")) != expected:
        raise HTTPException(503, "Database migration required")
    return {"status": "ready", "line_mode": settings.line_mode}


@app.post("/api/auth/login")
def login(body: Login, db=Depends(get_db)):
    email = body.email.strip().lower()
    key = digest(email)
    # Upsert guard to serialize account attempts across workers.
    dialect = db.bind.dialect.name
    if dialect == "postgresql":
        from sqlalchemy.dialects.postgresql import insert
    else:
        from sqlalchemy.dialects.sqlite import insert
    db.execute(insert(LoginGuard).values(key=key, failures=0, blocked_until=0).on_conflict_do_nothing())
    guard = db.scalar(select(LoginGuard).where(LoginGuard.key == key).with_for_update())
    if guard.blocked_until > time.time():
        db.commit()
        raise HTTPException(429, "ลองใหม่ภายหลัง")
    user = db.scalar(select(User).where(User.email == email))
    if not password_ok(user.password_hash if user else None, body.password) or not user or not user.active:
        guard.failures += 1
        if guard.failures >= 5:
            guard.blocked_until = time.time() + 300
            guard.failures = 0
        db.commit()
        raise HTTPException(401, "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง")
    guard.failures, guard.blocked_until = 0, 0
    token = issue_session(db, user)
    audit(db, user.id, "auth.login")
    db.commit()
    return {"token": token, "user": user_record(user)}


@app.post("/api/auth/logout")
def logout(credentials=Depends(bearer), user=Depends(current_user), db=Depends(get_db)):
    session = db.get(AuthSession, digest(credentials.credentials))
    if session:
        db.delete(session)
    db.commit()
    return {"ok": True}


@app.get("/api/me")
def me(user=Depends(current_user)):
    return user_record(user)


@app.post("/webhooks/line")
async def webhook(request: Request, db=Depends(get_db)):
    if not settings.line_secret:
        raise HTTPException(503, "LINE channel secret is not configured")
    # Bound streamed body before JSON parse (do not trust Content-Length).
    raw = bytearray()
    async for chunk in request.stream():
        raw.extend(chunk)
        if len(raw) > 1024 * 1024:
            raise HTTPException(413, "Webhook too large")
    expected = base64.b64encode(hmac.new(settings.line_secret.encode(), raw, hashlib.sha256).digest()).decode()
    if not hmac.compare_digest(expected, request.headers.get("x-line-signature", "")):
        raise HTTPException(403, "Invalid LINE signature")
    try:
        payload = json.loads(raw)
        if not isinstance(payload, dict) or not isinstance(payload.get("events"), list):
            raise ValueError()
        if settings.line_destination and payload.get("destination") != settings.line_destination:
            raise HTTPException(403, "Unexpected LINE destination")
        events = payload["events"]
        if any(not isinstance(e, dict) or not isinstance(e.get("webhookEventId"), str) for e in events):
            raise ValueError()
    except (ValueError, TypeError):
        raise HTTPException(400, "Malformed LINE webhook")
    if db.bind.dialect.name == "postgresql":
        from sqlalchemy.dialects.postgresql import insert
    else:
        from sqlalchemy.dialects.sqlite import insert
    for event in events:
        db.execute(
            insert(WebhookEvent)
            .values(id=event["webhookEventId"], payload=event, state="pending", attempts=0, received_at=time.time())
            .on_conflict_do_nothing(index_elements=["id"])
        )
    db.commit()
    return {"ok": True}


@app.get("/api/catalog")
def catalog(user=Depends(current_user), db=Depends(get_db)):
    return {
        "teams": [record(x) for x in db.scalars(select(Team).order_by(Team.name))],
        "users": [user_record(x) for x in db.scalars(select(User).where(User.active.is_(True)))],
        "policies": [record(x) for x in db.scalars(select(Policy))],
        "rules": [record(x) for x in db.scalars(select(Rule).order_by(Rule.rank))],
        "line_mode": settings.line_mode,
    }


@app.get("/api/inbox")
def inbox(offset: int = 0, user=Depends(manager), db=Depends(get_db)):
    rows = db.scalars(
        select(Message)
        .where(
            Message.direction == "inbound",
            Message.withdrawn.is_(False),
            ~exists().where(TicketMessage.message_id == Message.id),
        )
        .order_by(Message.created_at)
        .offset(max(0, offset))
        .limit(100)
    ).all()
    result = []
    for row in rows:
        rule = mapping_suggestion(db, row.text)
        result.append({**record(row, ("media_key",)), "suggestion": record(rule) if rule else None})
    return result


@app.get("/api/messages")
def messages(customer_id: str, user=Depends(manager), db=Depends(get_db)):
    return [
        record(x, ("media_key",))
        for x in db.scalars(
            select(Message).where(Message.customer_id == customer_id).order_by(Message.occurred_at).limit(200)
        )
    ]


@app.post("/api/tickets")
def new_ticket(
    body: TicketCreate,
    idempotency_key: str = Header(min_length=8, max_length=100),
    user=Depends(manager),
    db=Depends(get_db),
):
    key, fingerprint = user.id + ":" + idempotency_key, digest(body.model_dump_json())
    # Reserve command key first. A concurrent duplicate waits for original commit.
    try:
        with db.begin_nested():
            command = Command(key=key, fingerprint=fingerprint, resource_id="pending")
            db.add(command)
            db.flush()
    except IntegrityError:
        command = db.get(Command, key)
        if not command or command.fingerprint != fingerprint:
            raise HTTPException(409, "Idempotency key already used for another command")
        return record(get_ticket(db, command.resource_id, user))
    ticket = create_ticket(db, user.id, **body.model_dump())
    command.resource_id = ticket.id
    db.commit()
    return record(ticket)


@app.get("/api/tickets")
def ticket_list(status: str | None = None, offset: int = 0, user=Depends(current_user), db=Depends(get_db)):
    query = visible_ticket_query(user)
    if status:
        query = query.where(Ticket.status == status)
    return [
        record(x)
        for x in db.scalars(
            query.order_by(Ticket.priority, Ticket.resolution_due, Ticket.created_at).offset(max(0, offset)).limit(100)
        )
    ]


@app.get("/api/tickets/{ticket_id}")
def detail(ticket_id: str, user=Depends(current_user), db=Depends(get_db)):
    ticket = get_ticket(db, ticket_id, user, lock=False)
    return {
        **record(ticket),
        "messages": [
            record(x, ("media_key",))
            for x in db.scalars(
                select(Message)
                .join(TicketMessage, TicketMessage.message_id == Message.id)
                .where(TicketMessage.ticket_id == ticket.id)
                .order_by(Message.occurred_at)
            )
        ],
        "tasks": [record(x) for x in db.scalars(select(Task).where(Task.ticket_id == ticket.id))],
        "notes": [
            record(x) for x in db.scalars(select(Note).where(Note.ticket_id == ticket.id).order_by(Note.created_at))
        ],
        "attachments": [
            record(x, ("storage_key",)) for x in db.scalars(select(Attachment).where(Attachment.ticket_id == ticket.id))
        ],
        "audit": [
            record(x) for x in db.scalars(select(Audit).where(Audit.ticket_id == ticket.id).order_by(Audit.created_at))
        ],
        "outbox": [
            record(x)
            for x in db.scalars(select(Outbox).where(Outbox.ticket_id == ticket.id).order_by(Outbox.created_at))
        ],
    }


@app.post("/api/tickets/{ticket_id}/messages/{message_id}")
def link_message(ticket_id: str, message_id: str, body: Versioned, user=Depends(manager), db=Depends(get_db)):
    ticket = get_ticket(db, ticket_id, user)
    check_version(ticket, body.version)
    message = db.get(Message, message_id)
    if not message or message.customer_id != ticket.customer_id or message.withdrawn or message.direction != "inbound":
        raise HTTPException(422, "ข้อความต้องเป็นของลูกค้าเคสนี้และยังไม่ถอน")
    if not db.get(TicketMessage, (ticket.id, message.id)):
        db.add(TicketMessage(ticket_id=ticket.id, message_id=message.id))
        ticket.version += 1
        audit(db, user.id, "message.linked", ticket.id, message_id=message.id)
    db.commit()
    return {"ok": True}


@app.post("/api/tickets/{ticket_id}/assign")
def assign(ticket_id: str, body: Assignment, user=Depends(manager), db=Depends(get_db)):
    ticket = get_ticket(db, ticket_id, user)
    check_version(ticket, body.version)
    owner = dispatch_ticket(db, ticket, user.id, body.owner_id)
    db.commit()
    return {"owner_id": owner}


@app.post("/api/tickets/{ticket_id}/transfer")
def transfer(ticket_id: str, body: Transfer, user=Depends(manager), db=Depends(get_db)):
    ticket = get_ticket(db, ticket_id, user)
    check_version(ticket, body.version)
    if ticket.status not in ACTIVE or not db.get(Team, body.team_id):
        raise HTTPException(409, "โอนทีมไม่ได้")
    previous = ticket.team_id
    ticket.team_id, ticket.owner_id, ticket.status = body.team_id, None, "queued"
    ticket.version += 1
    audit(db, user.id, "ticket.transferred", ticket.id, previous=previous, team_id=body.team_id, reason=body.reason)
    db.commit()
    return {"ok": True}


@app.post("/api/tickets/{ticket_id}/transition")
def change(ticket_id: str, body: Change, user=Depends(current_user), db=Depends(get_db)):
    ticket = get_ticket(db, ticket_id, user)
    check_version(ticket, body.version)
    transition(db, ticket, user, body.action, body.reason.strip())
    db.commit()
    return record(ticket)


@app.post("/api/tickets/{ticket_id}/notes")
def note(ticket_id: str, body: TextInput, user=Depends(current_user), db=Depends(get_db)):
    ticket = get_ticket(db, ticket_id, user)
    db.add(Note(ticket_id=ticket.id, author_id=user.id, text=body.text))
    audit(db, user.id, "note.created", ticket.id)
    db.commit()
    return {"ok": True}


@app.post("/api/tickets/{ticket_id}/reply")
def reply(
    ticket_id: str,
    body: TextInput,
    idempotency_key: str = Header(min_length=8, max_length=100),
    user=Depends(current_user),
    db=Depends(get_db),
):
    ticket = get_ticket(db, ticket_id, user)
    can_manage(ticket, user)
    if ticket.status not in (*ACTIVE, "resolved"):
        raise HTTPException(409, "ไม่สามารถตอบในสถานะนี้")
    key = "reply:" + user.id + ":" + idempotency_key
    existing = db.scalar(select(Outbox).where(Outbox.request_key == key))
    content = [{"type": "text", "text": f"{ticket.number}: {body.text}"}]
    if len(content[0]["text"]) > 5000:
        raise HTTPException(422, "ข้อความรวมเลข Ticket ต้องไม่เกิน 5000 ตัวอักษร")
    if existing:
        if existing.ticket_id != ticket.id or existing.messages != content:
            raise HTTPException(409, "Idempotency key conflicts")
        return record(existing)
    row = enqueue(db, ticket, content, "reply", key)
    message = Message(customer_id=ticket.customer_id, direction="outbound", text=body.text)
    db.add(message)
    db.flush()
    db.add(TicketMessage(ticket_id=ticket.id, message_id=message.id))
    audit(db, user.id, "reply.queued", ticket.id, outbox_id=row.id)
    db.commit()
    return record(row)


@app.post("/api/tickets/{ticket_id}/tasks")
def add_task(ticket_id: str, body: TaskCreate, user=Depends(current_user), db=Depends(get_db)):
    ticket = get_ticket(db, ticket_id, user)
    can_manage(ticket, user)
    check_version(ticket, body.version)
    if ticket.status not in ACTIVE:
        raise HTTPException(409, "Ticket ไม่อยู่ในสถานะทำงาน")
    assignee = db.scalar(select(User).where(User.id == body.assignee_id).with_for_update())
    if not assignee or not assignee.active or not assignee.available or assignee.role != "agent":
        raise HTTPException(422, "ผู้รับงานไม่พร้อม")
    if not time.time() < body.due_at <= ticket.resolution_due:
        raise HTTPException(422, "กำหนดส่งต้องอยู่ในอนาคตและไม่เกิน SLA รวม")
    valid = set(db.scalars(select(Task.id).where(Task.ticket_id == ticket.id)).all())
    if not set(body.dependencies).issubset(valid):
        raise HTTPException(422, "Dependency ต้องเป็นงานเดิมใน Ticket เดียวกัน")
    load = db.scalar(
        select(func.count())
        .select_from(Task)
        .join(Ticket, Task.ticket_id == Ticket.id)
        .where(Task.assignee_id == assignee.id, Task.status != "done", Ticket.status.in_(ACTIVE))
    )
    load += db.scalar(
        select(func.count()).select_from(Ticket).where(Ticket.owner_id == assignee.id, Ticket.status.in_(ACTIVE))
    )
    if load >= assignee.capacity:
        raise HTTPException(409, "ผู้รับงานเต็มกำลัง")
    task = Task(ticket_id=ticket.id, **body.model_dump(exclude={"version"}))
    db.add(task)
    ticket.version += 1
    audit(db, user.id, "task.created", ticket.id, title=body.title, assignee_id=assignee.id)
    db.commit()
    return record(task)


@app.post("/api/tasks/{task_id}/complete")
def complete_task(task_id: str, body: Versioned, user=Depends(current_user), db=Depends(get_db)):
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(404, "ไม่พบงาน")
    ticket = get_ticket(db, task.ticket_id, user)
    check_version(ticket, body.version)
    if user.id != task.assignee_id and user.role not in {"admin", "dispatcher"}:
        raise HTTPException(403, "ไม่มีสิทธิ์ทำงานนี้")
    if ticket.status not in ACTIVE:
        raise HTTPException(409, "Ticket ไม่อยู่ในสถานะทำงาน")
    if task.dependencies and db.scalar(
        select(Task.id).where(Task.id.in_(task.dependencies), Task.status != "done").limit(1)
    ):
        raise HTTPException(409, "งานก่อนหน้ายังไม่เสร็จ")
    task.status, task.completed_at = "done", time.time()
    ticket.version += 1
    audit(db, user.id, "task.completed", ticket.id, task_id=task.id)
    db.commit()
    return {"ok": True}


@app.post("/api/tickets/{ticket_id}/attachments")
async def upload(ticket_id: str, file: UploadFile = File(), user=Depends(current_user), db=Depends(get_db)):
    ticket = get_ticket(db, ticket_id, user)
    settings.uploads.mkdir(parents=True, exist_ok=True)
    key, size = uid(), 0
    path = settings.uploads / key
    try:
        with path.open("xb") as target:
            while chunk := await file.read(65536):
                size += len(chunk)
                if size > 10 * 1024 * 1024:
                    raise HTTPException(413, "ไฟล์เกิน 10 MB")
                target.write(chunk)
        attachment = Attachment(
            ticket_id=ticket.id, filename=Path(file.filename or "attachment").name[:200], size=size, storage_key=key
        )
        db.add(attachment)
        audit(db, user.id, "attachment.created", ticket.id)
        db.commit()
        return record(attachment, ("storage_key",))
    except BaseException:
        path.unlink(missing_ok=True)
        raise
    finally:
        await file.close()


@app.get("/api/attachments/{attachment_id}")
def download(attachment_id: str, user=Depends(current_user), db=Depends(get_db)):
    item = db.get(Attachment, attachment_id)
    if not item:
        raise HTTPException(404, "ไม่พบไฟล์")
    get_ticket(db, item.ticket_id, user, lock=False)
    path = settings.uploads / item.storage_key
    if not path.is_file():
        raise HTTPException(404, "ไม่พบไฟล์ใน Storage")
    return FileResponse(path, media_type="application/octet-stream", filename=item.filename)


@app.get("/api/operations")
def operations(user=Depends(manager), db=Depends(get_db)):
    return {
        "events": [
            record(x, ("payload",))
            for x in db.scalars(
                select(WebhookEvent)
                .where(WebhookEvent.state.in_(["pending", "failed"]))
                .order_by(WebhookEvent.received_at)
                .limit(100)
            )
        ],
        "outbox": [
            record(x)
            for x in db.scalars(
                select(Outbox).where(Outbox.state != "accepted").order_by(Outbox.created_at.desc()).limit(100)
            )
        ],
        "alerts": [record(x) for x in db.scalars(select(Alert).order_by(Alert.created_at.desc()).limit(100))],
        "line_mode": settings.line_mode,
        "heartbeats": [record(x) for x in db.scalars(select(Heartbeat))],
        "media": [
            record(x, ("media_key", "text"))
            for x in db.scalars(select(Message).where(Message.media_state == "failed").limit(100))
        ],
    }


@app.post("/api/operations/events/{event_id}/retry")
def retry_event(event_id: str, user=Depends(manager), db=Depends(get_db)):
    row = db.scalar(select(WebhookEvent).where(WebhookEvent.id == event_id).with_for_update())
    if not row or row.state != "failed":
        raise HTTPException(409, "เฉพาะ Event ที่ล้มเหลว")
    row.state, row.attempts, row.error = "pending", 0, None
    audit(db, user.id, "event.retry", event_id=event_id)
    db.commit()
    return {"ok": True}


@app.get("/api/dashboard")
def dashboard(user=Depends(current_user), db=Depends(get_db)):
    tickets = db.scalars(visible_ticket_query(user)).all()
    now = time.time()
    return {
        "total": len(tickets),
        "active": sum(t.status in ACTIVE for t in tickets),
        "unassigned": sum(t.status in ACTIVE and not t.owner_id for t in tickets),
        "resolution_breached": sum(t.status in ACTIVE and now > t.resolution_due for t in tickets),
        "response_breached": sum(
            t.status in (*ACTIVE, "resolved") and not t.responded_at and now > t.response_due for t in tickets
        ),
        "resolved": sum(t.status == "resolved" for t in tickets),
        "closed": sum(t.status == "closed" for t in tickets),
    }


@app.post("/api/admin/teams")
def add_team(body: TextInput, user=Depends(admin), db=Depends(get_db)):
    name = body.text.strip()
    if not name or len(name) > 100 or db.scalar(select(Team.id).where(Team.name == name)):
        raise HTTPException(422, "ชื่อทีมไม่ถูกต้องหรือซ้ำ")
    row = Team(name=name)
    db.add(row)
    audit(db, user.id, "team.created", name=name)
    db.commit()
    return record(row)


@app.post("/api/admin/users")
def add_user(body: UserCreate, user=Depends(admin), db=Depends(get_db)):
    email = body.email.strip().lower()
    if "@" not in email or db.scalar(select(User.id).where(User.email == email)):
        raise HTTPException(422, "Email ไม่ถูกต้องหรือมีแล้ว")
    if body.team_id and not db.get(Team, body.team_id) or body.role == "agent" and not body.team_id:
        raise HTTPException(422, "Agent ต้องมีทีมที่ถูกต้อง")
    row = User(**body.model_dump(exclude={"password", "email"}), email=email, password_hash=hasher.hash(body.password))
    db.add(row)
    audit(db, user.id, "user.created", email=email)
    db.commit()
    return user_record(row)


@app.post("/api/admin/rules")
def add_rule(body: RuleCreate, user=Depends(admin), db=Depends(get_db)):
    if (
        not db.get(Team, body.team_id)
        or not db.get(Policy, body.policy_id)
        or any(not k.strip() for k in body.keywords)
    ):
        raise HTTPException(422, "ตรวจทีม Policy และ Keywords")
    row = Rule(**body.model_dump())
    db.add(row)
    audit(db, user.id, "rule.created", name=body.name)
    db.commit()
    return record(row)


@app.post("/api/admin/policies")
def add_policy(body: PolicyCreate, user=Depends(admin), db=Depends(get_db)):
    try:
        validate_policy(body.config)
    except (ValueError, KeyError, TypeError):
        raise HTTPException(422, "SLA policy ไม่ถูกต้อง")
    if db.scalar(select(Policy.id).where(Policy.name == body.name)):
        raise HTTPException(422, "ชื่อ Policy มีแล้ว ให้สร้างชื่อเวอร์ชันใหม่")
    row = Policy(name=body.name, config=body.config)
    db.add(row)
    audit(db, user.id, "policy.created", name=body.name)
    db.commit()
    return record(row)


@app.get("/api/messages/{message_id}/content")
def message_content(message_id: str, user=Depends(current_user), db=Depends(get_db)):
    item = db.get(Message, message_id)
    if not item or item.withdrawn or item.media_state != "ready" or not item.media_key:
        raise HTTPException(404, "ไฟล์ยังไม่พร้อมหรือถูกถอน")
    if user.role == "agent":
        allowed = db.scalar(
            visible_ticket_query(user)
            .join(TicketMessage, TicketMessage.ticket_id == Ticket.id)
            .where(TicketMessage.message_id == item.id)
            .limit(1)
        )
        if not allowed:
            raise HTTPException(404, "ไม่พบไฟล์")
    path = settings.uploads / item.media_key
    if not path.is_file():
        raise HTTPException(404, "ไม่พบไฟล์")
    return FileResponse(
        path, media_type="application/octet-stream", filename=f"line-{item.kind}-{item.line_message_id}.bin"
    )


@app.post("/api/operations/media/{message_id}/retry")
def retry_media(message_id: str, user=Depends(manager), db=Depends(get_db)):
    item = db.scalar(select(Message).where(Message.id == message_id).with_for_update())
    if not item or item.withdrawn or item.media_state != "failed":
        raise HTTPException(409, "ไม่สามารถลองใหม่")
    item.media_state, item.media_attempts, item.media_next_attempt = "pending", 0, time.time()
    audit(db, user.id, "media.retry", message_id=message_id)
    db.commit()
    return {"ok": True}


@app.patch("/api/admin/users/{user_id}")
def update_user(user_id: str, body: UserUpdate, user=Depends(admin), db=Depends(get_db)):
    row = db.scalar(select(User).where(User.id == user_id).with_for_update())
    if not row:
        raise HTTPException(404, "ไม่พบผู้ใช้")
    if row.id == user.id and body.active is False:
        raise HTTPException(409, "ห้ามปิดบัญชีตนเอง")
    values = body.model_dump(exclude_none=True)
    password = values.pop("password", None)
    for key, value in values.items():
        setattr(row, key, value)
    if password:
        row.password_hash = hasher.hash(password)
    if password or body.active is False:
        for session in db.scalars(select(AuthSession).where(AuthSession.user_id == row.id)):
            db.delete(session)
    audit(db, user.id, "user.updated", target_user=row.id, fields=list(values), password_reset=bool(password))
    db.commit()
    return user_record(row)


@app.patch("/api/admin/rules/{rule_id}")
def rule_state(rule_id: str, body: RuleState, user=Depends(admin), db=Depends(get_db)):
    row = db.scalar(select(Rule).where(Rule.id == rule_id).with_for_update())
    if not row:
        raise HTTPException(404, "ไม่พบกฎ")
    row.active = body.active
    row.version += 1
    audit(db, user.id, "rule.state_changed", rule_id=row.id, active=row.active)
    db.commit()
    return record(row)
