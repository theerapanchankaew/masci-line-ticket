#!/usr/bin/env python3
"""Initialize local secret files once. Never print secrets."""

import os
import secrets
from pathlib import Path

root = Path(__file__).resolve().parents[1]
folder = root / "secrets"
folder.mkdir(mode=0o700, exist_ok=True)
os.chmod(folder, 0o700)
password_file = folder / "database_password"
if not password_file.exists():
    password_file.write_text(secrets.token_hex(32))
password = password_file.read_text().strip()
values = {
    "database_url": f"postgresql+psycopg://desk:{password}@db:5432/desk",
    "line_secret": "",
    "line_token": "",
    "tunnel_token": "",
}
for name, value in values.items():
    path = folder / name
    if not path.exists():
        path.write_text(value)
# Non-root app containers read these read-only mounts; directory is 0700 on host.
for path in folder.iterdir():
    if path.is_file():
        os.chmod(path, 0o444)
if not (root / ".env").exists():
    (root / ".env").write_text((root / ".env.example").read_text())
    os.chmod(root / ".env", 0o600)
print(
    "Initialized .env and secret files. Existing files preserved. Never commit secrets/."
)
