import json
import math

from . import catalog, measure

MOVE_M = 0.03
MAX_RUN_S = 10.0
MISS_S = 0.8
MIN_POINTS = 6


def _resp(state: str, detected: bool, x_m: float | None, event: str | None = None, result: dict | None = None) -> dict:
    return {
        "state": state,
        "detected": detected,
        "x_m": None if x_m is None else round(x_m, 4),
        "event": event,
        "result": result,
    }


def reference(sess, theta: float | None = None) -> tuple[str, float | None]:
    theta = theta if theta is not None else sess["theta_deg"]
    if sess["experiment"] in catalog.EXPERIMENTS:
        exp = catalog.EXPERIMENTS[sess["experiment"]]
        if exp.id == "mrua_ramp" and theta:
            return exp.key_name, catalog.ramp_reference(theta)
        return exp.key_name, exp.default_ref
    return "a", catalog.ramp_reference(theta) if theta else None


def store_result(conn, sid: str, result: dict) -> None:
    conn.execute("DELETE FROM results WHERE session_id = ?", (sid,))
    conn.execute(
        "INSERT INTO results (session_id, key_name, key_value, ref_value, error_pct, r2, series) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (sid, result["key_name"], result["key_value"], result["ref_value"], result["error_pct"], result["r2"], json.dumps(result["series"])),
    )
    conn.execute("UPDATE sessions SET state = 'results' WHERE id = ?", (sid,))


def object_prompt(sess) -> str:
    if sess["object_prompt"]:
        return sess["object_prompt"]
    if sess["experiment"] in catalog.EXPERIMENTS:
        return catalog.EXPERIMENTS[sess["experiment"]].object_prompt
    return "object"


def start(conn, session_id: str) -> None:
    conn.execute("DELETE FROM points WHERE session_id = ?", (session_id,))
    conn.execute(
        "UPDATE sessions SET run_state = 'waiting', run_t0 = NULL, anchor_x = NULL, anchor_y = NULL, miss = 0 WHERE id = ?",
        (session_id,),
    )


def stop(conn, sess, px_per_m: float) -> dict:
    if sess["run_state"] == "measuring":
        return finish(conn, sess, "stopped", px_per_m)
    conn.execute("UPDATE sessions SET run_state = 'idle' WHERE id = ?", (sess["id"],))
    return _resp("idle", False, None)


def handle_frame(conn, sess, t: float, det: tuple[float, float] | None, px_per_m: float) -> dict:
    sid = sess["id"]
    if det is not None:
        conn.execute("INSERT INTO points (session_id, t, cx, cy) VALUES (?, ?, ?, ?)", (sid, t, det[0], det[1]))

    if sess["run_state"] == "waiting":
        if det is None:
            return _resp("waiting", False, None)
        if sess["anchor_x"] is None:
            conn.execute(
                "UPDATE sessions SET anchor_x = ?, anchor_y = ?, run_t0 = ? WHERE id = ?",
                (det[0], det[1], t, sid),
            )
            return _resp("waiting", True, 0.0)
        dist_m = math.dist(det, (sess["anchor_x"], sess["anchor_y"])) / px_per_m
        if dist_m >= MOVE_M:
            conn.execute("UPDATE sessions SET run_state = 'measuring', miss = 0 WHERE id = ?", (sid,))
            return _resp("measuring", True, dist_m, event="moving")
        conn.execute("UPDATE sessions SET run_t0 = ? WHERE id = ?", (t, sid))
        return _resp("waiting", True, 0.0)

    if sess["run_state"] == "measuring":
        if det is None:
            last = conn.execute(
                "SELECT MAX(t) AS last FROM points WHERE session_id = ?", (sid,)
            ).fetchone()["last"]
            if last is None or t - last >= MISS_S:
                return finish(conn, sess, "left_frame", px_per_m)
            return _resp("measuring", False, None)
        conn.execute("UPDATE sessions SET miss = 0 WHERE id = ?", (sid,))
        dist_m = math.dist(det, (sess["anchor_x"], sess["anchor_y"])) / px_per_m
        if t - sess["run_t0"] >= MAX_RUN_S:
            return finish(conn, sess, "timeout", px_per_m)
        return _resp("measuring", True, dist_m)

    return _resp("idle", False, None)


def finish(conn, sess, event: str, px_per_m: float) -> dict:
    sid = sess["id"]
    conn.execute("UPDATE sessions SET run_state = 'idle' WHERE id = ?", (sid,))
    rows = conn.execute(
        "SELECT t, cx, cy FROM points WHERE session_id = ? AND t >= ? ORDER BY t",
        (sid, sess["run_t0"]),
    ).fetchall()
    if len(rows) < MIN_POINTS:
        return _resp("idle", False, None, event="too_few")
    anchor = (sess["anchor_x"], sess["anchor_y"])
    ts = [row["t"] - sess["run_t0"] for row in rows]
    xs = [math.dist((row["cx"], row["cy"]), anchor) / px_per_m for row in rows]
    key_name, ref = reference(sess)
    result = measure.analyze_motion(ts, xs, key_name, ref)
    store_result(conn, sid, result)
    return _resp("results", True, None, event=event, result=result)
