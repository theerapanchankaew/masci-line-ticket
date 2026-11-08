"""Run via docker compose exec -T api python - < this file in CI/staging.
Uses only disposable test data; never run against live OA mode.
"""

import base64
import hashlib
import hmac
import json
import os
import time
import urllib.request
from pathlib import Path


def request(path, body=None, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        "http://localhost:8000" + path, data=data, headers=headers
    )
    return json.load(urllib.request.urlopen(req, timeout=10))


assert os.getenv("LINE_MODE") == "dry_run"
credentials = {"email": "ci@example.org", "password": "ci-test-password-1234"}
session = request("/api/auth/login", credentials)
token = session["token"]
body = {
    "destination": "U-ci-bot",
    "events": [
        {
            "webhookEventId": "ci-event-1",
            "type": "message",
            "timestamp": time.time() * 1000,
            "source": {"type": "user", "userId": "U-ci-user"},
            "message": {
                "id": "ci-message-1",
                "type": "text",
                "text": "CI backup acceptance",
            },
        }
    ],
}
raw = json.dumps(body).encode()
key = Path(os.environ["LINE_CHANNEL_SECRET_FILE"]).read_text().strip().encode()
sig = base64.b64encode(hmac.new(key, raw, hashlib.sha256).digest()).decode()
req = urllib.request.Request(
    "http://localhost:8000/webhooks/line",
    data=raw,
    headers={"Content-Type": "application/json", "x-line-signature": sig},
)
assert json.load(urllib.request.urlopen(req))["ok"]
for _ in range(30):
    inbox = request("/api/inbox", token=token)
    if inbox:
        break
    time.sleep(1)
assert any(m["text"] == "CI backup acceptance" for m in inbox)
print(
    "Compose acceptance: auth -> signed webhook -> persistent inbox -> worker -> staff API passed"
)
