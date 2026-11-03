import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timezone

from fastapi import HTTPException, Request

from .db import connect

MAX_BODY_BYTES = 60 * 1024 * 1024
GLOBAL_LIMIT = (120, 60)

# (requests, window in seconds) per client IP
IP_RULES = {
    "sessions": (20, 60),
    "stt": (30, 60),
    "live": (60, 60),
    "agent": (30, 60),
    "calibrate": (30, 60),
    "measure": (5, 600),
    "report": (5, 3600),
    "history": (30, 60),
    "frame": (900, 60),
}

# Maximum calls per user per UTC day (protects the Meta budget)
DAILY_QUOTA = {
    "stt": 300,
    "live": 1500,
    "agent": 300,
    "measure": 30,
    "report": 20,
    "frame": 3000,
}


class SlidingWindow:
    def __init__(self):
        self._hits: dict[str, deque] = defaultdict(deque)
        self._lock = threading.Lock()

    def hit(self, key: str, limit: int, window: float) -> bool:
        now = time.monotonic()
        with self._lock:
            q = self._hits[key]
            while q and now - q[0] > window:
                q.popleft()
            if len(q) >= limit:
                return False
            q.append(now)
            return True


_window = SlidingWindow()
heavy_slot = threading.BoundedSemaphore(1)


def free_memory() -> None:
    """Devuelve al sistema la memoria que Python liberó (el plan free de Render tiene 512 MB)."""
    import ctypes
    import gc

    gc.collect()
    try:
        ctypes.CDLL("libc.so.6").malloc_trim(0)
    except OSError:
        pass


def client_ip(request: Request) -> str:
    peer = request.client.host if request.client else "unknown"
    if peer in ("127.0.0.1", "::1"):
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[-1].strip()
    return peer


def check_global(request: Request) -> bool:
    return _window.hit(f"global:{client_ip(request)}", *GLOBAL_LIMIT)


def rate_limit(bucket: str):
    limit, window = IP_RULES[bucket]

    def dependency(request: Request) -> None:
        if not _window.hit(f"{bucket}:{client_ip(request)}", limit, window):
            raise HTTPException(429, "rate limit exceeded", headers={"Retry-After": str(window)})

    return dependency


def spend(user_id: str, bucket: str) -> None:
    day = datetime.now(timezone.utc).date().isoformat()
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO usage (user_id, day, bucket, count) VALUES (?, ?, ?, 1)
            ON CONFLICT (user_id, day, bucket) DO UPDATE SET count = usage.count + 1
            """,
            (user_id, day, bucket),
        )
        count = conn.execute(
            "SELECT count FROM usage WHERE user_id = ? AND day = ? AND bucket = ?",
            (user_id, day, bucket),
        ).fetchone()["count"]
    if count > DAILY_QUOTA[bucket]:
        raise HTTPException(429, "daily quota reached for this feature")


def acquire_heavy() -> None:
    if not heavy_slot.acquire(timeout=60):  # espera a que termine la otra tarea pesada
        raise HTTPException(503, "server busy, try again in a moment", headers={"Retry-After": "15"})


def release_heavy() -> None:
    heavy_slot.release()
