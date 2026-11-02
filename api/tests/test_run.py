import pytest


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setenv("GALILEO_DATA_DIR", str(tmp_path))
    from app import config
    config.get_settings.cache_clear()
    from app.db import connect, init_db
    init_db()
    with connect() as c:
        c.execute("INSERT INTO users (id, email) VALUES ('u', 'u')")
        c.execute(
            "INSERT INTO sessions (id, user_id, experiment, lang, state, px_per_m, object_prompt, run_state) "
            "VALUES ('s', 'u', 'mrua_ramp', 'en', 'record', 100, 'toy car', 'idle')"
        )
    yield
    config.get_settings.cache_clear()


def _feed(t, det, ppm=100.0):
    from app import run
    from app.db import connect
    with connect() as c:
        sess = c.execute("SELECT * FROM sessions WHERE id = 's'").fetchone()
        return run.handle_frame(c, sess, t, det, ppm)


def test_measures_uniform_acceleration_live(db):
    from app import run
    from app.db import connect
    with connect() as c:
        run.start(c, "s")
    a, ppm, rest = 0.4, 100.0, (300.0, 200.0)
    last = None
    t = 0.0
    while t <= 1.0 + 1e-9:
        last = _feed(round(t, 2), rest, ppm)
        t += 0.1
    t = 1.1
    while t <= 3.0 + 1e-9:
        tau = t - 1.0
        s_px = 0.5 * a * tau * tau * ppm
        last = _feed(round(t, 2), (rest[0] + s_px, rest[1]), ppm)
        t += 0.1
    assert last["state"] == "measuring"
    for i in range(4):
        last = _feed(round(3.1 + i * 0.1, 2), None, ppm)
    assert last["state"] == "results"
    assert last["result"]["key_name"] == "a"
    assert last["result"]["key_value"] == pytest.approx(a, rel=0.03)
    assert last["event"] == "left_frame"


def test_waiting_ignores_misses_and_never_starts_without_motion(db):
    from app import run
    from app.db import connect
    with connect() as c:
        run.start(c, "s")
    for i in range(10):
        r = _feed(i * 0.2, None)
    assert r["state"] == "waiting"
    for i in range(10):
        r = _feed(2 + i * 0.2, (300.0, 200.0))
    assert r["state"] == "waiting"


def test_timeout_finishes_run(db):
    from app import run
    from app.db import connect
    with connect() as c:
        run.start(c, "s")
    _feed(0.0, (300.0, 200.0))
    last = None
    for i in range(1, 120):
        t = i * 0.1
        s_px = 0.5 * 0.5 * (t - 0.0) ** 2 * 100 + 0.1
        last = _feed(round(t, 2), (300.0 + s_px, 200.0))
        if last["state"] == "results":
            break
    assert last["state"] == "results"
    assert last["event"] == "timeout"


def test_stop_with_too_few_points(db):
    from app import run
    from app.db import connect
    with connect() as c:
        run.start(c, "s")
    _feed(0.0, (300.0, 200.0))
    _feed(0.1, (330.0, 200.0))
    with connect() as c:
        sess = c.execute("SELECT * FROM sessions WHERE id = 's'").fetchone()
        r = run.stop(c, sess, 100.0)
    assert r["state"] == "idle"


def test_run_frame_endpoint_with_fake_sam(db, monkeypatch):
    import time

    import jwt
    from fastapi.testclient import TestClient

    from app import config, routes
    from app.db import connect
    from app.main import app

    monkeypatch.setenv("APP_JWT_SECRET", "k" * 40)
    config.get_settings.cache_clear()
    with connect() as c:
        c.execute("UPDATE users SET consent_version = ? WHERE id = 'u'", ("2026-11-02",))

    class FakeSam:
        def sam_image_boxes(self, b64, concept):
            assert concept == "toy car"
            return [(100.0, 100.0, 120.0, 120.0, 320.0, 240.0)]

    monkeypatch.setattr(routes, "_meta", lambda: FakeSam())
    now = int(time.time())
    tok = jwt.encode({"sub": "u", "aud": "galileo-vps", "iss": "galileo-web", "iat": now, "exp": now + 300},
                     "k" * 40, algorithm="HS256")
    h = {"Authorization": f"Bearer {tok}"}
    with TestClient(app, base_url="http://vps-oracle-01.tailfb0395.ts.net") as client:
        assert client.post("/run/start", json={"session_id": "s"}, headers=h).status_code == 200
        r = client.post("/run/frame", json={"session_id": "s", "t": 0.0, "height": 480, "frame": "AAAA"}, headers=h)
        assert r.status_code == 200
        body = r.json()
        assert body["state"] == "waiting" and body["detected"] is True
        # centro de la caja: (110/320*640, 110/240*480) = (220, 220)
        with connect() as c:
            row = c.execute("SELECT cx, cy FROM points WHERE session_id = 's'").fetchone()
        assert row["cx"] == pytest.approx(220.0) and row["cy"] == pytest.approx(220.0)
        assert client.post("/run/stop", json={"session_id": "s"}, headers=h).json()["state"] == "idle"
