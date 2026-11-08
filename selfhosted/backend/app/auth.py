import hashlib
import secrets
import time
from argon2 import PasswordHasher
from argon2.exceptions import VerificationError, InvalidHashError
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from .db import get_db
from .models import AuthSession, User

hasher = PasswordHasher()
bearer = HTTPBearer(auto_error=False)
DUMMY_HASH = hasher.hash("dummy-password-never-used")


def digest(token):
    return hashlib.sha256(token.encode()).hexdigest()


def password_ok(encoded, password):
    try:
        return hasher.verify(encoded or DUMMY_HASH, password)
    except (VerificationError, InvalidHashError):
        return False


def issue_session(db, user):
    token = secrets.token_urlsafe(40)
    db.add(AuthSession(token_hash=digest(token), user_id=user.id, expires_at=time.time() + 8 * 3600))
    return token


def current_user(credentials: HTTPAuthorizationCredentials | None = Depends(bearer), db=Depends(get_db)):
    if not credentials:
        raise HTTPException(401, "กรุณาเข้าสู่ระบบ")
    session = db.get(AuthSession, digest(credentials.credentials))
    user = db.get(User, session.user_id) if session and session.expires_at > time.time() else None
    if not user or not user.active:
        raise HTTPException(401, "Session หมดอายุ")
    return user


def manager(user=Depends(current_user)):
    if user.role not in {"admin", "dispatcher"}:
        raise HTTPException(403, "ต้องมีสิทธิ์จัดการคิว")
    return user


def admin(user=Depends(current_user)):
    if user.role != "admin":
        raise HTTPException(403, "ต้องมีสิทธิ์ผู้ดูแลระบบ")
    return user


def visible_ticket_query(user):
    from .models import Ticket, Task

    query = select(Ticket)
    if user.role == "agent":
        query = query.where(
            (Ticket.team_id == user.team_id)
            | (Ticket.owner_id == user.id)
            | Ticket.id.in_(select(Task.ticket_id).where(Task.assignee_id == user.id))
        )
    return query
