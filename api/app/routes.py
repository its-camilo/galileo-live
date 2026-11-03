import json
import logging
import re
import threading
import unicodedata
import uuid
from pathlib import Path

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field

from . import blob, catalog, reports, run
from .auth import CONSENT_VERSION, require_consent, require_user
from .config import get_settings
from .db import NOW_TEXT, connect
import shutil

from . import media
from .meta import MetaClient, MetaNotConfigured, parse_frames, parse_tracks, pick_moving_track, track_centroids
from .security import acquire_heavy, rate_limit, release_heavy, spend

log = logging.getLogger("galileo.routes")

router = APIRouter()

FRAME_WIDTH = 640
_run_lock = threading.Lock()

LIVE_SYSTEM = (
    "You are a physics lab assistant watching a phone camera. Reply ONLY with JSON: "
    '{{"say": short instruction, "show": one-line on-screen text, "done": true when the setup is ready}}. '
    "Keep 'say' under 12 words, neutral tone. Use this language: {lang}. "
    "Corrections look like: move back, the ruler is not visible, phone is tilted."
)

AGENT_SYSTEM = (
    "You are Galileo, a neutral physics lab guide. Short sentences, one question at a time. Reply in {lang}. "
    "The app measures the position of ONE object over time with the camera and fits x(t) = x0 + v0 t + a t^2/2 "
    "to get the acceleration a (or g for free fall). It supports objects moving in a straight line with constant "
    "acceleration. If the user asks for something else (pendulum, circular motion, etc.), say so briefly and offer "
    "the closest catalog experiment. Find out what object to track and whether there is a ramp angle. "
    "When you have enough information, call configure_custom with object_prompt as a short English noun phrase "
    "(for example 'toy car' or 'ball') and a short description. For catalog experiments call select_experiment. "
    "Never invent measurements."
)

AGENT_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "select_experiment",
            "description": "Pick the closest catalog experiment (mrua_ramp or free_fall) for the user's description.",
            "parameters": {
                "type": "object",
                "properties": {"description": {"type": "string"}},
                "required": ["description"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "configure_custom",
            "description": "Configure a free experiment: the object to track and what the user wants to measure.",
            "parameters": {
                "type": "object",
                "properties": {
                    "object_prompt": {"type": "string", "description": "Short English noun phrase, e.g. 'toy car'."},
                    "description": {"type": "string"},
                    "theta_deg": {"type": "number", "description": "Ramp angle in degrees, if any."},
                },
                "required": ["object_prompt", "description"],
            },
        },
    },
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
    object_prompt = catalog.EXPERIMENTS[body.experiment].object_prompt if body.experiment else None
    with connect() as conn:
        conn.execute(
            "INSERT INTO sessions (id, user_id, experiment, lang, state, object_prompt) VALUES (?, ?, ?, ?, ?, ?)",
            (session_id, user["sub"], body.experiment, body.lang, state, object_prompt),
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
    frame: str = Field(max_length=2_000_000)


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
    try:
        reply = _meta().chat(messages)
        content = reply["choices"][0]["message"].get("content") or ""
    except httpx.HTTPStatusError as exc:
        log.warning("live guide: Meta API returned %s", exc.response.status_code)
        raise HTTPException(502, "guide unavailable")
    except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError) as exc:
        log.warning("live guide failed: %s", type(exc).__name__)
        raise HTTPException(502, "guide unavailable")
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
    from . import measure

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


class SessionRef(BaseModel):
    session_id: str = Field(max_length=64)


class FrameIn(BaseModel):
    session_id: str = Field(max_length=64)
    t: float = Field(ge=0, le=120)
    height: int = Field(ge=100, le=2000)
    frame: str = Field(max_length=400_000)


def _px_per_m(sess) -> float:
    if sess["px_per_m"] is None or sess["experiment"] is None:
        raise HTTPException(409, "choose an experiment and calibrate first")
    return sess["px_per_m"]


@router.post("/run/start", dependencies=[Depends(rate_limit("sessions"))])
def run_start(body: SessionRef, user: dict = Depends(require_consent)):
    with connect() as conn:
        sess = _session(conn, body.session_id, user["sub"])
        _px_per_m(sess)
        with _run_lock:
            run.start(conn, sess["id"])
    return {"state": "waiting"}


@router.post("/run/frame", dependencies=[Depends(rate_limit("frame"))])
def run_frame(body: FrameIn, user: dict = Depends(require_consent)):
    spend(user["sub"], "frame")
    with connect() as conn:
        sess = _session(conn, body.session_id, user["sub"])
    if sess["run_state"] not in ("waiting", "measuring"):
        raise HTTPException(409, "run is not active")
    boxes = _meta().sam_image_boxes(body.frame, run.object_prompt(sess))
    det = None
    if boxes:
        x1, y1, x2, y2, w, h = max(boxes, key=lambda b: (b[2] - b[0]) * (b[3] - b[1]))
        det = ((x1 + x2) / 2 / w * FRAME_WIDTH, (y1 + y2) / 2 / h * body.height)
    with _run_lock, connect() as conn:
        sess = _session(conn, body.session_id, user["sub"])
        return run.handle_frame(conn, sess, body.t, det, _px_per_m(sess))


@router.post("/run/stop", dependencies=[Depends(rate_limit("sessions"))])
def run_stop(body: SessionRef, user: dict = Depends(require_consent)):
    with _run_lock, connect() as conn:
        sess = _session(conn, body.session_id, user["sub"])
        return run.stop(conn, sess, _px_per_m(sess))


class AgentIn(BaseModel):
    session_id: str = Field(max_length=64)
    text: str = Field(min_length=1, max_length=2000)


@router.post("/agent", dependencies=[Depends(rate_limit("agent"))])
def agent(body: AgentIn, user: dict = Depends(require_consent)):
    spend(user["sub"], "agent")
    with connect() as conn:
        sess = _session(conn, body.session_id, user["sub"])
        client = _meta()
        history = json.loads(sess["chat"] or "[]")[-16:]
        messages = [{"role": "developer", "content": AGENT_SYSTEM.format(lang=sess["lang"])}]
        messages += history
        messages.append({"role": "user", "content": body.text})
        actions: list[dict] = []
        say = ""
        for _ in range(3):
            message = client.chat(messages, tools=AGENT_TOOLS)["choices"][0]["message"]
            calls = message.get("tool_calls") or []
            if not calls:
                say = message.get("content") or ""
                break
            messages.append(message)
            for call in calls:
                args = json.loads(call["function"].get("arguments") or "{}")
                name = call["function"].get("name")
                if name == "select_experiment":
                    exp = catalog.select_experiment(args.get("description", ""))
                    conn.execute(
                        "UPDATE sessions SET experiment = ?, object_prompt = ?, state = 'setup' WHERE id = ?",
                        (exp.id, exp.object_prompt, sess["id"]),
                    )
                    actions.append({"type": "experiment", "id": exp.id})
                    result = {"id": exp.id}
                elif name == "configure_custom":
                    theta = args.get("theta_deg")
                    conn.execute(
                        "UPDATE sessions SET experiment = 'custom', object_prompt = ?, description = ?, theta_deg = ?, state = 'setup' WHERE id = ?",
                        (
                            str(args.get("object_prompt", "object"))[:60],
                            str(args.get("description", ""))[:300],
                            float(theta) if theta is not None else None,
                            sess["id"],
                        ),
                    )
                    actions.append({"type": "custom"})
                    result = {"ok": True}
                else:
                    result = {"error": "unknown tool"}
                messages.append({"role": "tool", "tool_call_id": call["id"], "content": json.dumps(result)})
        history += [{"role": "user", "content": body.text}, {"role": "assistant", "content": say}]
        conn.execute("UPDATE sessions SET chat = ? WHERE id = ?", (json.dumps(history[-20:]), sess["id"]))
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

    lang = sess["lang"]
    es = lang == "es"
    if sess["experiment"] in catalog.EXPERIMENTS:
        title = catalog.EXPERIMENTS[sess["experiment"]].title[lang]
    else:
        title = (sess["description"] or ("Experimento libre" if es else "Free experiment"))[:80]
    error_text = f"{res['error_pct']:.2f} %" if res["error_pct"] is not None else "—"
    ref_text = f"{res['ref_value']:.2f}" if res["ref_value"] is not None else "—"

    report_id = uuid.uuid4().hex
    plot_dir = settings.plots_dir / report_id
    series = json.loads(res["series"] or "null")
    figures = []
    if series:
        from .reports import plot_series

        figures = [{"path": str(p), "caption": p.stem} for p in plot_series(series, plot_dir, res["key_name"])]

    analysis = (
        f"Se midió la posición del objeto con SAM 3.1 en cada frame y se ajustó x(t) con un polinomio de grado 2. "
        f"Resultado: {res['key_name']} = {res['key_value']:.3f} m/s², R² = {res['r2']:.4f}."
        if es
        else
        f"The object position was measured with SAM 3.1 in each frame and x(t) was fitted with a degree-2 polynomial. "
        f"Result: {res['key_name']} = {res['key_value']:.3f} m/s², R² = {res['r2']:.4f}."
    )
    conclusion = ""
    if res["error_pct"] is not None:
        conclusion = (
            f"El error frente a la referencia fue de {res['error_pct']:.2f} %."
            if es
            else f"The error against the reference was {res['error_pct']:.2f} %."
        )

    if _trains_on_report(user["sub"]):
        ai_text = _contributor_text(report_facts(sess, res), lang)
        if ai_text:
            analysis, conclusion = ai_text["analysis"], ai_text["conclusion"]

    diagram = _diagram(sess, plot_dir)
    if diagram:
        figures.insert(0, {"path": str(diagram), "caption": "Montaje del experimento" if es else "Experiment setup"})

    context = {
        "session_id": sess["id"],
        "lang_babel": "spanish" if es else "english",
        "title": title,
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
        "objective": sess["description"] or title,
        "hypothesis": "",
        "materials": [],
        "procedure": [],
        "key_label": res["key_name"],
        "key_value": res["key_value"],
        "ref_text": ref_text,
        "error_text": error_text,
        "r2": res["r2"],
        "analysis": analysis,
        "equation": r"x(t)=x_0+v_0t+\tfrac{1}{2}at^2",
        "figures": figures,
        "conclusion": conclusion,
    }

    pdf = reports.build_pdf(context, settings.reports_dir)
    try:
        url = blob.upload_private_pdf(f"reports/{report_id}.pdf", pdf.read_bytes())
    finally:
        pdf.unlink(missing_ok=True)
        for p in plot_dir.glob("*.png"):
            p.unlink(missing_ok=True)

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
    training_report: bool = False


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
        "training_report": body.training_report,
    })
    with connect() as conn:
        conn.execute(
            "UPDATE users SET consent_version = ?, consent_at = " + NOW_TEXT + ", consent_scope = ? WHERE id = ?",
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
        "object_prompt": sess["object_prompt"],
        "description": sess["description"],
        "lang": sess["lang"],
        "px_per_m": sess["px_per_m"],
        "run_state": sess["run_state"],
        "result": result,
    }


ALLOWED_REPORT_FACTS = ("kind", "key_name", "key_value", "ref_value", "error_pct", "r2", "theta_deg", "lang")


def report_facts(sess, res) -> dict:
    """Solo datos numéricos y del catálogo: sin nombre, correo, descripción ni objeto libre."""
    kind = sess["experiment"] if sess["experiment"] in catalog.EXPERIMENTS else "free"
    facts = {
        "kind": kind,
        "key_name": res["key_name"],
        "key_value": round(res["key_value"], 3),
        "ref_value": None if res["ref_value"] is None else round(res["ref_value"], 3),
        "error_pct": None if res["error_pct"] is None else round(res["error_pct"], 2),
        "r2": round(res["r2"], 4),
        "theta_deg": sess["theta_deg"] if kind == "mrua_ramp" else None,
        "lang": sess["lang"],
    }
    return {key: facts[key] for key in ALLOWED_REPORT_FACTS}


def _trains_on_report(user_sub: str) -> bool:
    with connect() as conn:
        row = conn.execute("SELECT consent_scope FROM users WHERE id = ?", (user_sub,)).fetchone()
    if row is None or not row["consent_scope"]:
        return False
    return bool(json.loads(row["consent_scope"]).get("training_report"))


def _contributor_text(facts: dict, lang: str) -> dict | None:
    settings = get_settings()
    messages = [
        {
            "role": "developer",
            "content": (
                "You write a short analysis and conclusion for a physics lab report. "
                "Use ONLY the numbers in the JSON. Never invent values, never mention people. "
                f"Write in {'Spanish' if lang == 'es' else 'English'}, two short paragraphs at most. "
                'Reply ONLY with JSON: {"analysis": "...", "conclusion": "..."}.'
            ),
        },
        {"role": "user", "content": json.dumps(facts)},
    ]
    try:
        reply = _meta().chat(messages, reasoning_effort="low", model=settings.meta_contributor_model)
        content = reply["choices"][0]["message"].get("content") or ""
        match = re.search(r"\{.*\}", content, re.S)
        parsed = json.loads(match.group(0)) if match else {}
    except (MetaNotConfigured, HTTPException, ValueError, KeyError, IndexError):
        return None
    analysis, conclusion = parsed.get("analysis"), parsed.get("conclusion")
    if not isinstance(analysis, str) or not isinstance(conclusion, str):
        return None
    if len(analysis) > 1200 or len(conclusion) > 800:
        return None
    return {"analysis": analysis, "conclusion": conclusion}


SETUP_SCENES = {
    "mrua_ramp": "a straight inclined ramp with a small toy cart at the top, a ruler lying along the ramp, and an angle symbol theta between the ramp and the table",
    "free_fall": "a ball held above the floor next to a vertical ruler, with its path marked by a dashed line",
}


def _diagram_prompt(sess) -> str:
    """Solo el tipo de experimento del catálogo: nunca la descripción ni el objeto escritos por el usuario."""
    scene = SETUP_SCENES.get(sess["experiment"], "a straight track with a small object on it and a ruler lying along the track")
    return (
        f"Clean technical line diagram of a physics lab setup: {scene}, and a smartphone on a tripod "
        "filming the setup from the side. White background, flat vector style, minimal, labels in English, "
        "no people, no text other than short labels."
    )


def _diagram(sess, out_dir: Path) -> Path | None:
    try:
        png = _meta().generate_image_png(_diagram_prompt(sess))
    except (MetaNotConfigured, HTTPException, httpx.HTTPError, KeyError, IndexError, ValueError):
        return None
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "diagram.png"
    path.write_bytes(png)
    return path


MAX_CLIP_BYTES = 50 * 1024 * 1024
MAX_CLIP_SECONDS = 10.5
MOVE_M_TRIM = 0.03


class ObjectIn(BaseModel):
    session_id: str = Field(max_length=64)
    object_prompt: str = Field(min_length=2, max_length=60)


OBJECT_NAME_RE = re.compile(r"^[^\W\d_][^\W\d_ \-]{1,59}$")


@router.post("/session/object", dependencies=[Depends(rate_limit("sessions"))])
def set_object(body: ObjectIn, user: dict = Depends(require_consent)):
    """Filtro 1: el nombre que el usuario le pone al objeto (en cualquier idioma) es lo que SAM busca."""
    name = " ".join(body.object_prompt.split())
    if not OBJECT_NAME_RE.match(name):
        raise HTTPException(422, "object name must be letters only")
    prompt = name.lower()
    if not name.isascii() or (prompt and any(w in prompt.split() for w in SPANISH_HINTS)):
        try:
            prompt = _meta().english_object_name(name) or prompt
        except (MetaNotConfigured, httpx.HTTPError, KeyError, IndexError, TypeError) as exc:
            log.warning("object name translation failed: %s", type(exc).__name__)
    if not re.match(r"^[a-z][a-z \-]{1,59}$", prompt):
        # Sin traducción disponible: quitar tildes (camión -> camion) antes de rechazar.
        prompt = unicodedata.normalize("NFKD", name.lower()).encode("ascii", "ignore").decode()
        prompt = re.sub(r"[^a-z \-]", "", prompt).strip()
    if not re.match(r"^[a-z][a-z \-]{1,59}$", prompt):
        raise HTTPException(422, "object name must be letters only")
    with connect() as conn:
        sess = _session(conn, body.session_id, user["sub"])
        conn.execute("UPDATE sessions SET object_prompt = ? WHERE id = ?", (prompt, sess["id"]))
    return {"object_prompt": prompt}


SPANISH_HINTS = {
    "carro", "carrito", "pelota", "bola", "balon", "canica", "juguete", "rojo", "roja", "azul", "verde",
    "amarillo", "amarilla", "negro", "negra", "blanco", "blanca", "de", "del", "la", "el", "pequeno",
    "caja", "botella", "moneda", "dado", "cubo", "tapa", "lata", "vaso", "llavero", "borrador", "lapiz",
}


@router.post("/measure", dependencies=[Depends(rate_limit("measure"))])
async def measure_clip(
    session_id: str = Form(..., max_length=64),
    video: UploadFile = File(...),
    theta_deg: float | None = Form(None, ge=0, le=90),
    user: dict = Depends(require_consent),
):
    """Graba-luego-analiza: el video se normaliza, SAM lo sigue, se borra en Meta y en el VPS."""
    settings = get_settings()
    with connect() as conn:
        sess = _session(conn, session_id, user["sub"])
    _px_per_m(sess)
    spend(user["sub"], "measure")

    acquire_heavy()
    workdir = settings.uploads_dir / session_id
    workdir.mkdir(parents=True, exist_ok=True)
    client = None
    file_id = None
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
        try:
            file_id = client.upload_file(clip)
            lines = client.sam_track_video(file_id, run.object_prompt(sess))
        except httpx.HTTPError as exc:
            log.exception("SAM video tracking failed")
            raise HTTPException(502, "segmentation unavailable") from exc
        # Filtro 2: de todos los objetos con ese nombre, solo el que se mueve.
        tracks = parse_tracks(lines)
        oid, moved = pick_moving_track(tracks)
        log.info("measure: %d objects matched, moving id=%s span=%.3f", len(tracks), oid, moved)
        if not tracks:
            raise HTTPException(422, "not enough detections of the object in the clip")
        if oid is None:
            raise HTTPException(422, "the object did not move enough in the clip")
        out_h = info.height * FRAME_WIDTH / info.width
        track = [(f, cx * FRAME_WIDTH, cy * out_h) for f, cx, cy, _ in tracks[oid]]
    finally:
        if client is not None and file_id is not None:
            try:
                client.delete_file(file_id)
            except Exception:
                pass
        shutil.rmtree(workdir, ignore_errors=True)
        release_heavy()

    if len(track) < 5:
        raise HTTPException(422, "not enough detections of the object in the clip")

    from . import measure

    t_all = [idx / info.fps for idx, _, _ in track]
    disp_all = measure.displacement_m([(cx, cy) for _, cx, cy in track], sess["px_per_m"])
    start = 0
    for i, s in enumerate(disp_all):
        if abs(s) >= MOVE_M_TRIM * 1.0:
            start = max(0, i - 1)
            break
    t = [x - t_all[start] for x in t_all[start:]]
    disp = disp_all[start:] - disp_all[start]
    if len(t) < 5:
        raise HTTPException(422, "the object did not move enough in the clip")

    key_name, ref = run.reference(sess, theta_deg)
    result = measure.analyze_motion(t, disp, key_name, ref)
    with connect() as conn:
        run.store_result(conn, session_id, result)
    return result
