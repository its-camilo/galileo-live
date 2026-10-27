import base64
import json
import re
import shutil
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from . import catalog, measure, media, reports
from .auth import require_user
from .config import get_settings
from .db import connect
from .meta import MetaClient, MetaNotConfigured, parse_frames, track_centroids

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


@router.post("/sessions")
def create_session(body: SessionIn, user: dict = Depends(require_user)):
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


@router.post("/stt")
async def stt(
    audio: UploadFile = File(...),
    lang_hint: str = Form("en"),
    user: dict = Depends(require_user),
):
    result = _meta().transcribe(await audio.read(), audio.filename or "audio.webm", lang_hint)
    return {"text": result.get("text", ""), "lang": result.get("language", lang_hint)}


class LiveIn(BaseModel):
    session_id: str
    frame: str  # base64 JPEG, ~640 px wide


@router.post("/live")
def live(body: LiveIn, user: dict = Depends(require_user)):
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
    session_id: str
    p1: tuple[float, float]
    p2: tuple[float, float]
    distance_m: float = Field(gt=0)


@router.post("/calibrate")
def calibrate(body: CalibrateIn, user: dict = Depends(require_user)):
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


@router.post("/measure")
async def measure_clip(
    session_id: str = Form(...),
    video: UploadFile = File(...),
    theta_deg: float | None = Form(None),
    user: dict = Depends(require_user),
):
    settings = get_settings()
    with connect() as conn:
        sess = _session(conn, session_id, user["sub"])
    if not sess["experiment"] or sess["px_per_m"] is None:
        raise HTTPException(409, "choose an experiment and calibrate first")
    exp = catalog.EXPERIMENTS[sess["experiment"]]

    workdir = settings.uploads_dir / session_id
    workdir.mkdir(parents=True, exist_ok=True)
    raw = workdir / f"raw-{uuid.uuid4().hex}"
    clip = workdir / f"clip-{uuid.uuid4().hex}.mp4"
    try:
        raw.write_bytes(await video.read())
        media.normalize_video(raw, clip)
        info = media.probe(clip)
        client = _meta()
        file_id = client.upload_file(clip)
        frames = parse_frames(client.sam_track_video(file_id, exp.object_prompt))
    finally:
        shutil.rmtree(workdir, ignore_errors=True)

    track = track_centroids(frames, out_w=media.NORMALIZED_WIDTH, out_h=info.height * media.NORMALIZED_WIDTH / info.width)
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


class AgentIn(BaseModel):
    session_id: str
    text: str


@router.post("/agent")
def agent(body: AgentIn, user: dict = Depends(require_user)):
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
                messages.append({"role": "tool", "tool_call_id": call["id"], "content": json.dumps({"id": exp.id, "title": exp.title[sess["lang"]]})})
        state = conn.execute("SELECT state FROM sessions WHERE id = ?", (sess["id"],)).fetchone()["state"]
    return {"say": say, "state": state, "actions": actions}


class ReportIn(BaseModel):
    session_id: str


@router.post("/report")
def report(body: ReportIn, user: dict = Depends(require_user)):
    settings = get_settings()
    with connect() as conn:
        sess = _session(conn, body.session_id, user["sub"])
        res = conn.execute("SELECT * FROM results WHERE session_id = ?", (sess["id"],)).fetchone()
    if res is None:
        raise HTTPException(409, "no results for this session")
    if not settings.blob_token:
        raise HTTPException(503, "BLOB_READ_WRITE_TOKEN not configured")
    exp = catalog.EXPERIMENTS[sess["experiment"]]
    lang = sess["lang"]
    error_text = f"{res['error_pct']:.2f} %" if res["error_pct"] is not None else "—"
    ref_text = f"{res['ref_value']:.2f}" if res["ref_value"] is not None else "—"
    figures = [
        {"path": str(p), "caption": p.stem} for p in sorted((settings.plots_dir / sess["id"]).glob("*.png"))
    ]
    context = {
        "session_id": sess["id"],
        "lang_babel": "spanish" if lang == "es" else "english",
        "title": exp.title[lang],
        "author": user.get("name") or user["sub"],
        "date": sess["created_at"][:10],
        "labels": {
            "objective": "Objetivo" if lang == "es" else "Objective",
            "hypothesis": "Hipótesis" if lang == "es" else "Hypothesis",
            "materials": "Materiales" if lang == "es" else "Materials",
            "procedure": "Procedimiento" if lang == "es" else "Procedure",
            "data": "Datos" if lang == "es" else "Data",
            "quantity": "Magnitud" if lang == "es" else "Quantity",
            "value": "Valor" if lang == "es" else "Value",
            "reference": "Referencia" if lang == "es" else "Reference",
            "error": "Error" if lang == "es" else "Error",
            "analysis": "Análisis" if lang == "es" else "Analysis",
            "figures": "Figuras" if lang == "es" else "Figures",
            "conclusion": "Conclusión" if lang == "es" else "Conclusion",
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
    pdf = reports.build_pdf(context, settings.reports_dir)
    raise HTTPException(501, f"PDF compiled at {pdf}; Vercel Blob upload not implemented yet")


@router.get("/history")
def history(user: dict = Depends(require_user)):
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT r.id, s.experiment, s.created_at AS date, r.blob_url AS pdf_url,
                   (SELECT key_value FROM results WHERE session_id = s.id LIMIT 1) AS key_value
            FROM reports r JOIN sessions s ON s.id = r.session_id
            WHERE s.user_id = ?
            ORDER BY r.created_at DESC
            """,
            (user["sub"],),
        ).fetchall()
    return [dict(row) for row in rows]
