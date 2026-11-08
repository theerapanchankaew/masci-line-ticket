"""Real PostgreSQL concurrency tests; skipped by SQLite-only local runs."""

from concurrent.futures import ThreadPoolExecutor
import pytest
from sqlalchemy import select, func
from app.models import Ticket, Message, User
from app.domain import dispatch_ticket
from app.jobs import process_inbox_once
from test_service import event, open_ticket


def require_postgres(env):
    with env["db"]() as db:
        if db.bind.dialect.name != "postgresql":
            pytest.skip("PostgreSQL row-lock acceptance requires TEST_DATABASE_URL")


def test_competing_dispatch_never_exceeds_capacity(env):
    require_postgres(env)
    with env["db"].begin() as db:
        db.get(User, env["ids"]["agent"]).capacity = 1
    ids = [open_ticket(env) for _ in range(2)]

    def assign(tid):
        with env["db"].begin() as db:
            ticket = db.scalar(select(Ticket).where(Ticket.id == tid).with_for_update())
            return dispatch_ticket(db, ticket, "concurrency-test", automatic=True)

    with ThreadPoolExecutor(max_workers=2) as pool:
        result = list(pool.map(assign, ids))
    assert sum(value is not None for value in result) == 1


def test_competing_inbox_workers_process_once(env):
    require_postgres(env)
    event(env)
    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(lambda _: process_inbox_once(env["db"]), range(2)))
    with env["db"]() as db:
        assert db.scalar(select(func.count()).select_from(Message)) == 1


def test_competing_ticket_commands_share_one_result(env):
    require_postgres(env)
    event(env)
    process_inbox_once(env["db"])
    headers = {**env["auth"](), "Idempotency-Key": "concurrent-command-1"}
    message = env["client"].get("/api/inbox", headers=headers).json()[0]
    body = {
        "message_ids": [message["id"]],
        "title": "concurrent",
        "team_id": env["ids"]["team"],
        "policy_id": env["ids"]["policy"],
        "priority": 3,
        "reason": "concurrency acceptance",
    }

    def create(_):
        return env["client"].post("/api/tickets", headers=headers, json=body)

    with ThreadPoolExecutor(max_workers=2) as pool:
        result = list(pool.map(create, range(2)))
    assert [r.status_code for r in result] == [200, 200]
    assert result[0].json()["id"] == result[1].json()["id"]
