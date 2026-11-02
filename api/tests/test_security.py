import os
import time

import jwt
import pytest
from fastapi.testclient import TestClient

SECRET = "x" * 48


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("GALILEO_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("APP_JWT_SECRET", SECRET)
    monkeypatch.setenv("MODEL_API_KEY", "")
    monkeypatch.setenv("BLOB_READ_WRITE_TOKEN", "test-token")
    from app import config
    config.get_settings.cache_clear()
    from app import security
    monkeypatch.setattr(security, "_window", security.SlidingWindow())
    from app.main import app
    with TestClient(app, base_url="http://vps-oracle-01.tailfb0395.ts.net") as c:
        yield c
    config.get_settings.cache_clear()


def token(**overrides) -> str:
    now = int(time.time())
    claims = {"sub": "ana@example.com", "aud": "galileo-vps", "iss": "galileo-web", "iat": now, "exp": now + 300}
    claims.update(overrides)
    return jwt.encode({k: v for k, v in claims.items() if v is not None}, SECRET, algorithm="HS256")


def auth(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}"}


CONSENT = {"version": "2026-11-03", "age_confirmed": True, "data_processing": True,
           "meta_processing": True, "international_transfer": True}


def accept(client, tok: str) -> None:
    assert client.post("/consent", json=CONSENT, headers=auth(tok)).status_code == 200


def test_valid_token_accepted(client):
    r = client.get("/me", headers=auth(token()))
    assert r.status_code == 200 and r.json()["consented"] is False


def test_data_endpoints_require_consent(client):
    assert client.get("/history", headers=auth(token())).status_code == 403
    accept(client, token())
    assert client.get("/history", headers=auth(token())).status_code == 200


def test_consent_requires_every_box(client):
    bad = dict(CONSENT, meta_processing=False)
    assert client.post("/consent", json=bad, headers=auth(token())).status_code == 422


def test_wrong_issuer_rejected(client):
    assert client.get("/me", headers=auth(token(iss="attacker"))).status_code == 401


def test_wrong_audience_rejected(client):
    assert client.get("/me", headers=auth(token(aud="other"))).status_code == 401


def test_long_lived_token_rejected(client):
    now = int(time.time())
    assert client.get("/me", headers=auth(token(iat=now, exp=now + 3600))).status_code == 401


def test_expired_token_rejected(client):
    now = int(time.time())
    assert client.get("/me", headers=auth(token(iat=now - 900, exp=now - 600))).status_code == 401


def test_missing_token_rejected(client):
    assert client.get("/history").status_code == 401


def test_docs_disabled(client):
    assert client.get("/docs").status_code == 404
    assert client.get("/openapi.json").status_code == 404


def test_unknown_host_rejected(client):
    assert client.get("/health", headers={"Host": "evil.example.com"}).status_code == 400


def test_security_headers_present(client):
    r = client.get("/health")
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["x-frame-options"] == "DENY"
    assert "server" not in r.headers


def test_oversized_body_rejected(client):
    r = client.post("/sessions", content=b"{}", headers={"Content-Length": str(100 * 1024 * 1024), "Content-Type": "application/json"})
    assert r.status_code == 413


def test_cors_only_allows_app_origin(client):
    ok = client.options("/sessions", headers={"Origin": "https://galileo-live.vercel.app", "Access-Control-Request-Method": "POST"})
    bad = client.options("/sessions", headers={"Origin": "https://evil.example.com", "Access-Control-Request-Method": "POST"})
    assert ok.headers.get("access-control-allow-origin") == "https://galileo-live.vercel.app"
    assert "access-control-allow-origin" not in bad.headers


def test_per_ip_rate_limit_on_sessions(client):
    accept(client, token())
    statuses = [client.post("/sessions", json={"lang": "en"}, headers=auth(token())).status_code for _ in range(21)]
    assert statuses[:19] == [200] * 19  # the consent call above used one of the 20 slots
    assert statuses[19] == 429


def test_daily_quota_blocks_measure(client, monkeypatch):
    from app import security
    monkeypatch.setitem(security.DAILY_QUOTA, "report", 0)
    from app.db import connect
    accept(client, token())
    with connect() as conn:
        conn.execute("INSERT INTO sessions (id, user_id, experiment, lang, state, px_per_m) VALUES ('s1', 'ana@example.com', 'mrua_ramp', 'en', 'results', 100)")
        conn.execute("INSERT INTO results (session_id, key_name, key_value, ref_value, error_pct, r2) VALUES ('s1', 'a', 0.4, NULL, NULL, 0.99)")
    r = client.post("/report", json={"session_id": "s1"}, headers=auth(token()))
    assert r.status_code == 429
