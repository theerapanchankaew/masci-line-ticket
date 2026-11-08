"""Container health probe for background loops."""

import sys
import time
from .db import Session
from .models import Heartbeat

with Session() as db:
    beat = db.get(Heartbeat, sys.argv[1])
    if not beat or time.time() - beat.last_seen > 120:
        raise SystemExit(1)
