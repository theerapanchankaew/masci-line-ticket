import argparse
import getpass
import logging
import signal
import time
from sqlalchemy import select
from .db import Session, settings
from .models import User, Team, Policy, Rule, Message, Ticket, Heartbeat
from .auth import hasher
from .sla import DEFAULT_POLICY
from .domain import scan_sla, dispatch_ticket
from .jobs import process_inbox_once, send_outbox_once, fetch_media_once

running = True


def stop(*_):
    global running
    running = False


def bootstrap(email, name):
    import os

    password = os.getenv("BOOTSTRAP_PASSWORD") or getpass.getpass("Initial password (12+ characters): ")
    if len(password) < 12:
        raise SystemExit("Password must be at least 12 characters")
    with Session.begin() as db:
        if db.scalar(select(User.id).where(User.role == "admin")):
            raise SystemExit("Administrator already exists; bootstrap refuses to overwrite")
        team = Team(name="MASCI Service Desk")
        db.add(team)
        db.flush()
        policy = Policy(name="MASCI Pilot v1", config=DEFAULT_POLICY)
        db.add(policy)
        db.flush()
        db.add(
            User(
                email=email.strip().lower(),
                name=name,
                role="admin",
                team_id=team.id,
                password_hash=hasher.hash(password),
            )
        )
        db.add(
            Rule(name="งานบริการทั่วไป", keywords=["สอบถาม", "บริการ"], team_id=team.id, policy_id=policy.id, priority=3)
        )
    print("Administrator created. Add agents and configure pilot SLA before live operation.")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["bootstrap", "worker", "scheduler", "demo-message"])
    parser.add_argument("--email", default="")
    parser.add_argument("--name", default="MASCI Administrator")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    if args.command == "bootstrap":
        if "@" not in args.email:
            raise SystemExit("--email required")
        bootstrap(args.email, args.name)
        return
    if args.command == "demo-message":
        if settings.environment != "development" or settings.line_mode != "dry_run":
            raise SystemExit("Demo messages require development + dry_run")
        with Session.begin() as db:
            db.add(Message(customer_id="DEMO-NOT-A-LINE-USER", text="สอบถามบริการ: ขอแก้ข้อมูลเอกสารและติดตามการดำเนินงาน"))
        print("Demo message added to Inbox")
        return
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    while running:
        try:
            if args.command == "worker":
                busy = process_inbox_once()
                busy = send_outbox_once() or busy
                busy = fetch_media_once() or busy
                if not busy:
                    time.sleep(1)
            else:
                with Session.begin() as db:
                    scan_sla(db)
                    # Ordered and serialized by singleton scheduler advisory lock.
                    from sqlalchemy import text

                    leader = db.bind.dialect.name != "postgresql" or db.scalar(
                        text("SELECT pg_try_advisory_xact_lock(78194313)")
                    )
                    if leader:
                        tickets = db.scalars(
                            select(Ticket)
                            .where(Ticket.status == "queued", Ticket.owner_id.is_(None))
                            .order_by(Ticket.priority, Ticket.resolution_due, Ticket.created_at)
                            .limit(50)
                            .with_for_update(skip_locked=True)
                        ).all()
                        for ticket in tickets:
                            dispatch_ticket(db, ticket, "scheduler", automatic=True)
                # Short sleep permits graceful stop without long blocking.
                for _ in range(15):
                    if not running:
                        break
                    time.sleep(1)
            with Session.begin() as db:
                beat = db.get(Heartbeat, args.command)
                if beat:
                    beat.last_seen = time.time()
                else:
                    db.add(Heartbeat(name=args.command, last_seen=time.time()))
        except Exception as exc:
            logging.error("Job loop failed: %s", type(exc).__name__)
            time.sleep(2)


if __name__ == "__main__":
    main()
