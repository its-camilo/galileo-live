import json
import re
import shutil
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field

from . import blob, catalog, measure, media, reports
from .auth import CONSENT_VERSION, require_consent, require_user
from .config import get_settings
from .db import connect
from .meta import MetaClient, MetaNotConfigured, parse_frames, track_centroids
from .security import acquire_heavy, rate_limit, release_heavy, spend

router = APIRouter()

LIVE_SYSTEM = (
    "You are a physics lab assistant watching a phone camera. Reply ONLY with JSON: "
    '{"say": short instruction, "show": one-line on-screen text, "done": true when the setup is ready}. '
    "Keep 'say' under 12 words, neutral tone. Use this language: {lang}. "
    "Corrections look like: move back, the ruler is not visible, phone is tilted."
)

AGENT_SYSTEM = (
    "You are Galileo, a neutral physics lab assistant. Short sentences. Reply in {lang}. "
    "Use select_experiment to pick the closest catalog experiment. Never invent measurements."
)

AGENT_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "select_experiment",
            "description": "Pick the closest catalog experiment for the user's description and materials.",
            "parameters": {
                "type": "object",
                "properties": {
                    "description": {"type": "string"},
                    "materials": {"type": "string"},
                },
                "required": ["description"],
            },
        },
    }
]


def _session(conn, session_id: str, user_id: str):
    row = conn.execute(
        "SELECT * FROM sessions WHERE id = ? AND user_id = ?", (session_id, user_id)
    ).fetchone()
    if row is None:
        raise HTTPException(404, "session not found")
    return row


def _meta() -> MetaClient:
    try:
        return MetaClient(get_settings())
    except MetaNotConfigured as exc:
        raise HTTPException(503, str(exc))


class SessionIn(BaseModel):
    experiment: str | None = None
    lang: str = Field("en", pattern="^(en|es)$")


@router.post("/sessions", dependencies=[Depends(rate_limit("sessions"))])
def create_session(body: SessionIn, user: dict = Depends(require_consent)):
    if body.experiment and body.experiment not in catalog.EXPERIMENTS:
        raise HTTPException(400, "unknown experiment")
    session_id = uuid.uuid4().hex
    state = "setup" if body.experiment else "choose"
    with connect() as conn:
        conn.execute(
            "INSERT INTO sessions (id, user_id, experiment, lang, state) VALUES (?, ?, ?, ?, ?)",
            (session_id, user["sub"], body.experiment, body.lang, state),
        )
    return {"id": session_id, "state": state}


@router.post("/stt", dependencies=[Depends(rate_limit("stt"))])
async def stt(
    audio: UploadFile = File(...),
    lang_hint: str = Form("en", pattern="^(en|es)$"),
    user: dict = Depends(require_consent),
):
    spend(user["sub"], "stt")
    data = await audio.read(10 * 1024 * 1024 + 1)
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(413, "audio too large")
    result = _meta().transcribe(data, audio.filename or "audio.webm", lang_hint)
    return {"text": result.get("text", ""), "lang": result.get("language", lang_hint)}


class LiveIn(BaseModel):
    session_id: str = Field(max_length=64)
    frame: str = Field(max_length=2_000_000)  # base64 JPEG, ~640 px wide


@router.post("/live", dependencies=[Depends(rate_limit("live"))])
def live(body: LiveIn, user: dict = Depends(require_consent)):
    spend(user["sub"], "live")
    with connect() as conn:
        sess = _session(conn, body.session_id, user["sub"])
    messages = [
        {"role": "developer", "content": LIVE_SYSTEM.format(lang=sess["lang"])},
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "Current frame."},
                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{body.frame}"}},
            ],
        },
    ]
    reply = _meta().chat(messages)
    content = reply["choices"][0]["message"].get("content") or ""
    match = re.search(r"\{.*\}", content, re.S)
    try:
        parsed = json.loads(match.group(0)) if match else {}
    except json.JSONDecodeError:
        parsed = {}
    return {
        "say": parsed.get("say", ""),
        "show": parsed.get("show", ""),
        "done": bool(parsed.get("done", False)),
    }


class CalibrateIn(BaseModel):
    session_id: str = Field(max_length=64)
    p1: tuple[float, float]
    p2: tuple[float, float]
    distance_m: float = Field(gt=0, le=100)


@router.post("/calibrate", dependencies=[Depends(rate_limit("calibrate"))])
def calibrate(body: CalibrateIn, user: dict = Depends(require_consent)):
    with connect() as conn:
        sess = _session(conn, body.session_id, user["sub"])
        try:
            px_per_m = measure.px_per_m_from_points(body.p1, body.p2, body.distance_m)
        except ValueError as exc:
            raise HTTPException(422, str(exc))
        conn.execute(
            "UPDATE sessions SET px_per_m = ?, state = 'record' WHERE id = ?",
            (px_per_m, sess["id"]),
        )
    return {"px_per_m": px_per_m}


@router.post("/measure", dependencies=[Depends(rate_limit("measure"))])
async def measure_clip(
    session_id: str = Form(..., max_length=64),
    video: UploadFile = File(...),
    theta_deg: float | None = Form(None, ge=0, le=90),
    user: dict = Depends(require_consent),
):
    settings = get_settings()
    with connect() as conn:
        sess = _session(conn, session_id, user["sub"])
    if not sess["experiment"] or sess["px_per_m"] is None:
        raise HTTPException(409, "choose an experiment and calibrate first")
    exp = catalog.EXPERIMENTS[sess["experiment"]]
    spend(user["sub"], "measure")

    acquire_heavy()
    workdir = settings.uploads_dir / session_id
    workdir.mkdir(parents=True, exist_ok=True)
    try:
        raw = workdir / f"raw-{uuid.uuid4().hex}"
        clip = workdir / f"clip-{uuid.uuid4().hex}.mp4"
        raw.write_bytes(await video.read(MAX_CLIP_BYTES + 1))
        if raw.stat().st_size > MAX_CLIP_BYTES:
            raise HTTPException(413, "clip too large")
        media.normalize_video(raw, clip)
        info = media.probe(clip)
        if info.duration > MAX_CLIP_SECONDS:
            raise HTTPException(422, "clip longer than 10 seconds")
        client = _meta()
        file_id = client.upload_file(clip)
        frames = parse_frames(client.sam_track_video(file_id, exp.object_prompt))
        track = track_centroids(
            frames,
            out_w=media.NORMALIZED_WIDTH,
            out_h=info.height * media.NORMALIZED_WIDTH / info.width,
        )
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
        release_heavy()

    if len(track) < 5:
        raise HTTPException(422, "not enough detections of the object in the clip")

    t = [idx / info.fps for idx, _, _ in track]
    displacement = measure.displacement_m([(cx, cy) for _, cx, cy in track], sess["px_per_m"])
    ref = catalog.ramp_reference(theta_deg) if exp.id == "mrua_ramp" and theta_deg else exp.default_ref
    result = measure.analyze_motion(t, displacement, exp.key_name, ref)

    with connect() as conn:
        conn.execute("DELETE FROM results WHERE session_id = ?", (session_id,))
        conn.execute(
            "INSERT INTO results (session_id, key_name, key_value, ref_value, error_pct, r2) VALUES (?, ?, ?, ?, ?, ?)",
            (session_id, result["key_name"], result["key_value"], result["ref_value"], result["error_pct"], result["r2"]),
        )
        conn.execute("UPDATE sessions SET state = 'results' WHERE id = ?", (session_id,))
    reports.plot_series(result["series"], settings.plots_dir / session_id, exp.key_name)
    return result


MAX_CLIP_BYTES = 50 * 1024 * 1024
MAX_CLIP_SECONDS = 10.5


class AgentIn(BaseModel):
    session_id: str = Field(max_length=64)
    text: str = Field(min_length=1, max_length=2000)


@router.post("/agent", dependencies=[Depends(rate_limit("agent"))])
def agent(body: AgentIn, user: dict = Depends(require_consent)):
    spend(user["sub"], "agent")
    with connect() as conn:
        sess = _session(conn, body.session_id, user["sub"])
        client = _meta()
        messages = [
            {"role": "developer", "content": AGENT_SYSTEM.format(lang=sess["lang"])},
            {"role": "user", "content": body.text},
        ]
        actions: list[dict] = []
        say = ""
        for _ in range(3):
            message = client.chat(messages, tools=AGENT_TOOLS)["choices"][0]["message"]
            tool_calls = message.get("tool_calls") or []
            if not tool_calls:
                say = message.get("content") or ""
                break
            messages.append(message)
            for call in tool_calls:
                args = json.loads(call["function"].get("arguments") or "{}")
                exp = catalog.select_experiment(args.get("description", ""))
                conn.execute(
                    "UPDATE sessions SET experiment = ?, state = 'setup' WHERE id = ?",
                    (exp.id, sess["id"]),
                )
                actions.append({"type": "experiment", "id": exp.id})
                messages.append({
                    "role": "tool",
                    "tool_call_id": call["id"],
                    "content": json.dumps({"id": exp.id, "title": exp.title[sess["lang"]]}),
                })
        state = conn.execute("SELECT state FROM sessions WHERE id = ?", (sess["id"],)).fetchone()["state"]
    return {"say": say, "state": state, "actions": actions}


class ReportIn(BaseModel):
    session_id: str = Field(max_length=64)


@router.post("/report", dependencies=[Depends(rate_limit("report"))])
def report(body: ReportIn, user: dict = Depends(require_consent)):
    settings = get_settings()
    with connect() as conn:
        sess = _session(conn, body.session_id, user["sub"])
        res = conn.execute("SELECT * FROM results WHERE session_id = ?", (sess["id"],)).fetchone()
    if res is None:
        raise HTTPException(409, "no results for this session")
    if not settings.blob_token:
        raise HTTPException(503, "report storage not configured")
    spend(user["sub"], "report")

    exp = catalog.EXPERIMENTS[sess["experiment"]]
    lang = sess["lang"]
    es = lang == "es"
    error_text = f"{res['error_pct']:.2f} %" if res["error_pct"] is not None else "—"
    ref_text = f"{res['ref_value']:.2f}" if res["ref_value"] is not None else "—"
    figures = [
        {"path": str(p), "caption": p.stem} for p in sorted((settings.plots_dir / sess["id"]).glob("*.png"))
    ]
    report_id = uuid.uuid4().hex
    context = {
        "session_id": sess["id"],
        "lang_babel": "spanish" if es else "english",
        "title": exp.title[lang],
        "author": user.get("name") or user["sub"],
        "date": sess["created_at"][:10],
        "labels": {
            "objective": "Objetivo" if es else "Objective",
            "hypothesis": "Hipótesis" if es else "Hypothesis",
            "materials": "Materiales" if es else "Materials",
            "procedure": "Procedimiento" if es else "Procedure",
            "data": "Datos" if es else "Data",
            "quantity": "Magnitud" if es else "Quantity",
            "value": "Valor" if es else "Value",
            "reference": "Referencia" if es else "Reference",
            "error": "Error",
            "analysis": "Análisis" if es else "Analysis",
            "figures": "Figuras" if es else "Figures",
            "conclusion": "Conclusión" if es else "Conclusion",
        },
        "objective": exp.title[lang],
        "hypothesis": "",
        "materials": [],
        "procedure": [],
        "key_label": res["key_name"],
        "key_value": res["key_value"],
        "ref_text": ref_text,
        "error_text": error_text,
        "r2": res["r2"],
        "analysis": "",
        "equation": r"x(t)=x_0+v_0t+\tfrac{1}{2}at^2",
        "figures": figures,
        "conclusion": "",
    }

    acquire_heavy()
    try:
        pdf = reports.build_pdf(context, settings.reports_dir)
        try:
            url = blob.upload_private_pdf(f"reports/{report_id}.pdf", pdf.read_bytes())
        finally:
            pdf.unlink(missing_ok=True)
    finally:
        release_heavy()

    with connect() as conn:
        conn.execute(
            "INSERT INTO reports (id, session_id, blob_url) VALUES (?, ?, ?)",
            (report_id, sess["id"], url),
        )
    return {"id": report_id, "pdf_url": f"/reports/{report_id}/pdf"}


@router.get("/reports/{report_id}/pdf", dependencies=[Depends(rate_limit("history"))])
def report_pdf(report_id: str, user: dict = Depends(require_consent)):
    if not re.fullmatch(r"[0-9a-f]{32}", report_id):
        raise HTTPException(404, "report not found")
    with connect() as conn:
        row = conn.execute(
            """
            SELECT r.blob_url FROM reports r JOIN sessions s ON s.id = r.session_id
            WHERE r.id = ? AND s.user_id = ?
            """,
            (report_id, user["sub"]),
        ).fetchone()
    if row is None:
        raise HTTPException(404, "report not found")
    body, content_type = blob.download_private(row["blob_url"])
    return Response(
        content=body,
        media_type=content_type,
        headers={"Content-Disposition": f'attachment; filename="galileo-{report_id}.pdf"'},
    )


@router.get("/history", dependencies=[Depends(rate_limit("history"))])
def history(user: dict = Depends(require_consent)):
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT r.id, s.experiment, s.created_at AS date,
                   '/reports/' || r.id || '/pdf' AS pdf_url,
                   (SELECT key_value FROM results WHERE session_id = s.id LIMIT 1) AS key_value
            FROM reports r JOIN sessions s ON s.id = r.session_id
            WHERE s.user_id = ?
            ORDER BY r.created_at DESC
            LIMIT 100
            """,
            (user["sub"],),
        ).fetchall()
    return [dict(row) for row in rows]


class ConsentIn(BaseModel):
    version: str
    age_confirmed: bool
    data_processing: bool
    meta_processing: bool
    international_transfer: bool


@router.get("/me")
def me(user: dict = Depends(require_user)):
    with connect() as conn:
        row = conn.execute(
            "SELECT email, name, consent_version, consent_at FROM users WHERE id = ?", (user["sub"],)
        ).fetchone()
    return {
        "email": row["email"],
        "name": row["name"],
        "consent_required_version": CONSENT_VERSION,
        "consented": row["consent_version"] == CONSENT_VERSION,
        "consent_at": row["consent_at"],
    }


@router.post("/consent", dependencies=[Depends(rate_limit("sessions"))])
def consent(body: ConsentIn, user: dict = Depends(require_user)):
    if body.version != CONSENT_VERSION:
        raise HTTPException(409, "consent version changed, reload the page")
    if not all([body.age_confirmed, body.data_processing, body.meta_processing, body.international_transfer]):
        raise HTTPException(422, "all consent checkboxes are required")
    scope = json.dumps({
        "age_confirmed": True,
        "data_processing": True,
        "meta_processing": True,
        "international_transfer": True,
    })
    with connect() as conn:
        conn.execute(
            "UPDATE users SET consent_version = ?, consent_at = datetime('now'), consent_scope = ? WHERE id = ?",
            (CONSENT_VERSION, scope, user["sub"]),
        )
    return {"consented": True, "consent_version": CONSENT_VERSION}


@router.get("/sessions/{session_id}", dependencies=[Depends(rate_limit("history"))])
def get_session(session_id: str, user: dict = Depends(require_consent)):
    with connect() as conn:
        sess = _session(conn, session_id, user["sub"])
        res = conn.execute("SELECT * FROM results WHERE session_id = ?", (sess["id"],)).fetchone()
    result = None
    if res is not None:
        result = {
            "key_name": res["key_name"],
            "key_value": res["key_value"],
            "ref_value": res["ref_value"],
            "error_pct": res["error_pct"],
            "r2": res["r2"],
        }
    return {
        "id": sess["id"],
        "state": sess["state"],
        "experiment": sess["experiment"],
        "lang": sess["lang"],
        "px_per_m": sess["px_per_m"],
        "result": result,
    }
