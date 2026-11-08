from datetime import datetime, timedelta, time as dtime
from zoneinfo import ZoneInfo

DEFAULT_POLICY = {
    "timezone": "Asia/Bangkok",
    "business_hours": True,
    "start": "08:30",
    "end": "17:00",
    "weekdays": [0, 1, 2, 3, 4],
    "holidays": [],
    "priorities": {
        "1": {"response": 30, "resolution": 240},
        "2": {"response": 60, "resolution": 480},
        "3": {"response": 240, "resolution": 1440},
        "4": {"response": 480, "resolution": 2400},
    },
}


def validate_policy(config):
    ZoneInfo(config["timezone"])
    start, end = dtime.fromisoformat(config["start"]), dtime.fromisoformat(config["end"])
    if start >= end or not config["weekdays"] or any(x not in range(7) for x in config["weekdays"]):
        raise ValueError("Invalid business calendar")
    for day in config["holidays"]:
        datetime.strptime(day, "%Y-%m-%d")
    for p in range(1, 5):
        target = config["priorities"][str(p)]
        if not 0 < target["response"] <= target["resolution"] <= 525600:
            raise ValueError("Invalid SLA minutes")
    return config


def due_at(timestamp, minutes, config):
    if not config["business_hours"]:
        return timestamp + minutes * 60
    zone = ZoneInfo(config["timezone"])
    now = datetime.fromtimestamp(timestamp, zone)
    start, end = dtime.fromisoformat(config["start"]), dtime.fromisoformat(config["end"])
    remaining = float(minutes) * 60
    for _ in range(3660):
        day = now.date()
        if now.weekday() in config["weekdays"] and day.isoformat() not in config["holidays"]:
            left, right = datetime.combine(day, start, zone), datetime.combine(day, end, zone)
            now = max(now, left)
            available = max(0, right.timestamp() - now.timestamp())
            if remaining <= available:
                return now.timestamp() + remaining
            remaining -= available
        now = datetime.combine(day + timedelta(days=1), dtime.min, zone)
    raise ValueError("Calendar cannot accommodate deadline")
