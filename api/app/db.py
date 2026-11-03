from contextlib import contextmanager

import psycopg
from psycopg.rows import dict_row

from .config import get_settings

NOW_TEXT = "to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')"

SCHEMA = f"""
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    name TEXT,
    created_at TEXT NOT NULL DEFAULT ({NOW_TEXT}),
    consent_version TEXT,
    consent_at TEXT,
    consent_scope TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    experiment TEXT,
    lang TEXT NOT NULL DEFAULT 'en',
    state TEXT NOT NULL DEFAULT 'choose',
    px_per_m DOUBLE PRECISION,
    created_at TEXT NOT NULL DEFAULT ({NOW_TEXT}),
    object_prompt TEXT,
    theta_deg DOUBLE PRECISION,
    description TEXT,
    run_state TEXT NOT NULL DEFAULT 'idle',
    run_t0 DOUBLE PRECISION,
    anchor_x DOUBLE PRECISION,
    anchor_y DOUBLE PRECISION,
    miss INTEGER NOT NULL DEFAULT 0,
    chat TEXT
);
CREATE TABLE IF NOT EXISTS results (
    session_id TEXT NOT NULL REFERENCES sessions(id),
    key_name TEXT NOT NULL,
    key_value DOUBLE PRECISION,
    ref_value DOUBLE PRECISION,
    error_pct DOUBLE PRECISION,
    r2 DOUBLE PRECISION,
    series TEXT
);
CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    blob_url TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT ({NOW_TEXT})
);
CREATE TABLE IF NOT EXISTS points (
    session_id TEXT NOT NULL REFERENCES sessions(id),
    t DOUBLE PRECISION NOT NULL,
    cx DOUBLE PRECISION NOT NULL,
    cy DOUBLE PRECISION NOT NULL
);
CREATE INDEX IF NOT EXISTS points_session ON points (session_id, t);
CREATE TABLE IF NOT EXISTS usage (
    user_id TEXT NOT NULL,
    day TEXT NOT NULL,
    bucket TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, day, bucket)
);
"""


class Connection:
    """Envoltura fina sobre psycopg: usa `?` como marcador, igual que antes."""

    def __init__(self, raw: psycopg.Connection):
        self._raw = raw

    def execute(self, sql: str, params: tuple | list = ()):
        return self._raw.execute(sql.replace("?", "%s"), params)


@contextmanager
def connect():
    settings = get_settings()
    if not settings.database_url:
        raise RuntimeError("DATABASE_URL not configured")
    raw = psycopg.connect(settings.database_url, row_factory=dict_row)
    conn = Connection(raw)
    try:
        yield conn
        raw.commit()
    except Exception:
        raw.rollback()
        raise
    finally:
        raw.close()


def init_db() -> None:
    with connect() as conn:
        for statement in SCHEMA.split(";"):
            if statement.strip():
                conn.execute(statement)
        conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS consent_version TEXT")
        conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS consent_at TEXT")
        conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS consent_scope TEXT")


def reset_db_for_tests() -> None:
    with connect() as conn:
        conn.execute("DROP TABLE IF EXISTS points, results, reports, sessions, usage, users CASCADE")
    init_db()
