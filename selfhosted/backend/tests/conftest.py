import os
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from app.db import Base, get_db
from app.main import app
from app import main
from app.models import Team, User, Policy, Rule
from app.auth import hasher
from app.sla import DEFAULT_POLICY

PASSWORD = "test-password-long-enough"
HASH = hasher.hash(PASSWORD)


@pytest.fixture
def env(tmp_path, monkeypatch):
    url = os.getenv("TEST_DATABASE_URL", "sqlite://")
    if not url.startswith("sqlite") and not url.rsplit("/", 1)[-1].endswith("_test"):
        raise RuntimeError("Tests require an isolated *_test database")
    engine = create_engine(
        url,
        pool_pre_ping=True,
        **({"connect_args": {"check_same_thread": False}, "poolclass": StaticPool} if url.startswith("sqlite") else {}),
    )
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine, expire_on_commit=False)

    def db_override():
        with factory() as db:
            yield db

    app.dependency_overrides[get_db] = db_override
    monkeypatch.setattr(main.settings, "line_secret", "test-line-secret")
    monkeypatch.setattr(main.settings, "line_destination", "U-test-bot")
    monkeypatch.setattr(main.settings, "line_mode", "dry_run")
    monkeypatch.setattr(main.settings, "line_token", "")
    monkeypatch.setattr(main.settings, "uploads", tmp_path / "uploads")
    with factory.begin() as db:
        a, b = Team(name="Service"), Team(name="IT")
        db.add_all([a, b])
        db.flush()
        users = []
        for email, role, team in [
            ("admin", "admin", a),
            ("dispatch", "dispatcher", a),
            ("agent", "agent", a),
            ("other", "agent", b),
        ]:
            u = User(
                email=email + "@example.org", name=email, role=role, team_id=team.id, password_hash=HASH, capacity=5
            )
            db.add(u)
            users.append(u)
        config = {**DEFAULT_POLICY, "business_hours": False}
        p = Policy(name="Pilot", config=config)
        db.add(p)
        db.flush()
        db.add(Rule(name="IT issue", keywords=["ระบบ"], team_id=b.id, policy_id=p.id, priority=2, rank=1))
        db.flush()
        values = {"team": a.id, "other_team": b.id, "policy": p.id, **{u.name: u.id for u in users}}
    client = TestClient(app)

    def auth(role="admin"):
        response = client.post("/api/auth/login", json={"email": role + "@example.org", "password": PASSWORD})
        assert response.status_code == 200, response.text
        return {"Authorization": "Bearer " + response.json()["token"]}

    yield {"db": factory, "client": client, "auth": auth, "ids": values, "settings": main.settings}
    client.close()
    app.dependency_overrides.clear()
    Base.metadata.drop_all(engine)
    engine.dispose()
