#!/usr/bin/env python3
import argparse
import getpass
import os
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("name", choices=["line_secret", "line_token", "tunnel_token"])
args = parser.parse_args()
folder = Path(__file__).resolve().parents[1] / "secrets"
if not folder.is_dir():
    raise SystemExit("Run init.py first")
path = folder / args.name
value = getpass.getpass(f"{args.name} (hidden): ").strip()
if not value:
    raise SystemExit("Empty value rejected; existing secret preserved")
os.chmod(path, 0o600)
try:
    path.write_text(value)
finally:
    os.chmod(path, 0o444)
print("Saved. Recreate affected containers to reload mounted credentials.")
