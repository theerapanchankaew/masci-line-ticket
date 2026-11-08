import time
import uuid
from sqlalchemy import String, Text, Integer, Float, Boolean, JSON, ForeignKey, UniqueConstraint, Index
from sqlalchemy.orm import Mapped, mapped_column
from .db import Base


def uid():
    return str(uuid.uuid4())


class Team(Base):
    __tablename__ = "teams"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(String(100), unique=True)


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    email: Mapped[str] = mapped_column(String(200), unique=True)
    name: Mapped[str] = mapped_column(String(100))
    password_hash: Mapped[str] = mapped_column(Text)
    role: Mapped[str] = mapped_column(String(20))
    team_id: Mapped[str | None] = mapped_column(ForeignKey("teams.id"))
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    available: Mapped[bool] = mapped_column(Boolean, default=True)
    capacity: Mapped[int] = mapped_column(Integer, default=5)


class AuthSession(Base):
    __tablename__ = "auth_sessions"
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    expires_at: Mapped[float] = mapped_column(Float)


class LoginGuard(Base):
    __tablename__ = "login_guards"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    failures: Mapped[int] = mapped_column(Integer, default=0)
    blocked_until: Mapped[float] = mapped_column(Float, default=0)


class Policy(Base):
    __tablename__ = "sla_policies"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    config: Mapped[dict] = mapped_column(JSON)


class Rule(Base):
    __tablename__ = "mapping_rules"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(String(100))
    keywords: Mapped[list] = mapped_column(JSON)
    team_id: Mapped[str] = mapped_column(ForeignKey("teams.id"))
    policy_id: Mapped[str] = mapped_column(ForeignKey("sla_policies.id"))
    priority: Mapped[int] = mapped_column(Integer, default=3)
    rank: Mapped[int] = mapped_column(Integer, default=100)
    version: Mapped[int] = mapped_column(Integer, default=1)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class WebhookEvent(Base):
    __tablename__ = "webhook_events"
    id: Mapped[str] = mapped_column(String(150), primary_key=True)
    payload: Mapped[dict] = mapped_column(JSON)
    state: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str | None] = mapped_column(String(100))
    received_at: Mapped[float] = mapped_column(Float, default=time.time)


class Message(Base):
    __tablename__ = "messages"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    line_message_id: Mapped[str | None] = mapped_column(String(100), unique=True)
    event_id: Mapped[str | None] = mapped_column(String(150), unique=True)
    customer_id: Mapped[str] = mapped_column(String(100), index=True)
    media_key: Mapped[str | None] = mapped_column(String(36))
    media_state: Mapped[str | None] = mapped_column(String(30))
    media_attempts: Mapped[int] = mapped_column(Integer, default=0)
    media_next_attempt: Mapped[float] = mapped_column(Float, default=0)
    media_error: Mapped[str | None] = mapped_column(String(100))
    direction: Mapped[str] = mapped_column(String(20), default="inbound")
    kind: Mapped[str] = mapped_column(String(30), default="text")
    text: Mapped[str] = mapped_column(Text, default="")
    withdrawn: Mapped[bool] = mapped_column(Boolean, default=False)
    occurred_at: Mapped[float] = mapped_column(Float, default=time.time)
    created_at: Mapped[float] = mapped_column(Float, default=time.time)


class Tombstone(Base):
    __tablename__ = "message_tombstones"
    message_id: Mapped[str] = mapped_column(String(100), primary_key=True)
    customer_id: Mapped[str] = mapped_column(String(100))


class Ticket(Base):
    __tablename__ = "tickets"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    number: Mapped[str] = mapped_column(String(30), unique=True)
    customer_id: Mapped[str] = mapped_column(String(100), index=True)
    title: Mapped[str] = mapped_column(String(300))
    status: Mapped[str] = mapped_column(String(30), default="queued", index=True)
    priority: Mapped[int] = mapped_column(Integer)
    team_id: Mapped[str] = mapped_column(ForeignKey("teams.id"))
    owner_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    sla_snapshot: Mapped[dict] = mapped_column(JSON)
    mapping_snapshot: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[float] = mapped_column(Float, default=time.time)
    response_due: Mapped[float] = mapped_column(Float)
    resolution_due: Mapped[float] = mapped_column(Float)
    responded_at: Mapped[float | None] = mapped_column(Float)
    resolved_at: Mapped[float | None] = mapped_column(Float)
    closed_at: Mapped[float | None] = mapped_column(Float)
    resolution: Mapped[str | None] = mapped_column(Text)
    close_reason: Mapped[str | None] = mapped_column(String(100))
    round: Mapped[int] = mapped_column(Integer, default=1)
    version: Mapped[int] = mapped_column(Integer, default=1)
    confirmation_token: Mapped[str | None] = mapped_column(String(36))


class TicketMessage(Base):
    __tablename__ = "ticket_messages"
    ticket_id: Mapped[str] = mapped_column(ForeignKey("tickets.id"), primary_key=True)
    message_id: Mapped[str] = mapped_column(ForeignKey("messages.id"), primary_key=True)


class Task(Base):
    __tablename__ = "tasks"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    ticket_id: Mapped[str] = mapped_column(ForeignKey("tickets.id"), index=True)
    title: Mapped[str] = mapped_column(String(300))
    assignee_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    dependencies: Mapped[list] = mapped_column(JSON, default=list)
    required: Mapped[bool] = mapped_column(Boolean, default=True)
    status: Mapped[str] = mapped_column(String(20), default="pending")
    due_at: Mapped[float] = mapped_column(Float)
    completed_at: Mapped[float | None] = mapped_column(Float)


class Note(Base):
    __tablename__ = "notes"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    ticket_id: Mapped[str] = mapped_column(ForeignKey("tickets.id"), index=True)
    author_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    text: Mapped[str] = mapped_column(Text)
    created_at: Mapped[float] = mapped_column(Float, default=time.time)


class Attachment(Base):
    __tablename__ = "attachments"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    ticket_id: Mapped[str] = mapped_column(ForeignKey("tickets.id"), index=True)
    filename: Mapped[str] = mapped_column(String(200))
    size: Mapped[int] = mapped_column(Integer)
    storage_key: Mapped[str] = mapped_column(String(36), unique=True)


class Outbox(Base):
    __tablename__ = "outbox"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    ticket_id: Mapped[str | None] = mapped_column(ForeignKey("tickets.id"), index=True)
    customer_id: Mapped[str] = mapped_column(String(100))
    messages: Mapped[list] = mapped_column(JSON)
    kind: Mapped[str] = mapped_column(String(30))
    request_key: Mapped[str] = mapped_column(String(150), unique=True)
    state: Mapped[str] = mapped_column(String(30), default="pending", index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    next_attempt: Mapped[float] = mapped_column(Float, default=time.time)
    created_at: Mapped[float] = mapped_column(Float, default=time.time)
    accepted_at: Mapped[float | None] = mapped_column(Float)
    provider_request_id: Mapped[str | None] = mapped_column(String(100))
    error: Mapped[str | None] = mapped_column(String(100))


class Audit(Base):
    __tablename__ = "audit_events"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    ticket_id: Mapped[str | None] = mapped_column(String(36), index=True)
    actor_id: Mapped[str] = mapped_column(String(100))
    action: Mapped[str] = mapped_column(String(100))
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[float] = mapped_column(Float, default=time.time)


class Alert(Base):
    __tablename__ = "sla_alerts"
    __table_args__ = (UniqueConstraint("ticket_id", "round", "phase", "level"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    ticket_id: Mapped[str] = mapped_column(ForeignKey("tickets.id"))
    round: Mapped[int] = mapped_column(Integer)
    phase: Mapped[str] = mapped_column(String(30))
    level: Mapped[str] = mapped_column(String(30))
    created_at: Mapped[float] = mapped_column(Float, default=time.time)


Index("ix_ticket_queue", Ticket.status, Ticket.priority, Ticket.resolution_due)


class Command(Base):
    __tablename__ = "commands"
    key: Mapped[str] = mapped_column(String(200), primary_key=True)
    fingerprint: Mapped[str] = mapped_column(String(64))
    resource_id: Mapped[str] = mapped_column(String(36))


class Heartbeat(Base):
    __tablename__ = "heartbeats"
    name: Mapped[str] = mapped_column(String(50), primary_key=True)
    last_seen: Mapped[float] = mapped_column(Float)
