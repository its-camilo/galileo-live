import base64
import json
import re
from pathlib import Path

import httpx

from .config import Settings

DEFAULT_CHAT_MODEL = "muse-spark-1.3"
SAM_MODEL = "sam-3.1"
IMAGE_MODEL = "muse-image-1.0"

FRAME_RE = re.compile(r"<(\d+)f>")
NUM = r"(-?\d+(?:\.\d+)?)"
BOX_RE = re.compile(rf"<\|box;x1={NUM};y1={NUM};x2={NUM};y2={NUM};w={NUM};h={NUM}\|>")


REC_RE = re.compile(rf"(\d+)<\|box;x1={NUM};y1={NUM};x2={NUM};y2={NUM};w={NUM};h={NUM}(?:;c={NUM})?\|>")
LINE_FRAME_RE = re.compile(r"^\s*<(\d+)f>")


def parse_tracks(lines: list[str]) -> dict[int, list[tuple[int, float, float, float]]]:
    """Una línea por frame (un delta por frame). Devuelve {object_id: [(frame, cx/w, cy/h, área/w·h)]}.

    Se lee cada delta por separado para que el payload base85 de una máscara nunca se
    confunda con un marcador de frame.
    """
    tracks: dict[int, list[tuple[int, float, float, float]]] = {}
    for line in lines:
        fm = LINE_FRAME_RE.match(line)
        if not fm:
            continue
        frame = int(fm.group(1))
        for r in REC_RE.finditer(line, fm.end()):
            oid = int(r.group(1))
            x1, y1, x2, y2, w, h = (float(g) for g in r.groups()[1:7])
            if w <= 0 or h <= 0:
                continue
            tracks.setdefault(oid, []).append(
                (frame, (x1 + x2) / 2 / w, (y1 + y2) / 2 / h, (x2 - x1) * (y2 - y1) / (w * h))
            )
    for pts in tracks.values():
        pts.sort(key=lambda p: p[0])
    return tracks


def _span(values: list[float]) -> float:
    v = sorted(values)
    lo = v[int(0.1 * (len(v) - 1))]
    hi = v[int(round(0.9 * (len(v) - 1)))]
    return hi - lo


def pick_moving_track(
    tracks: dict[int, list[tuple[int, float, float, float]]],
    min_points: int = 4,
    min_move: float = 0.025,
) -> tuple[int | None, float]:
    """Elige, entre los objetos que coinciden con el nombre, el que más se desplaza.

    El desplazamiento es la diagonal del rango 10-90 % de su centroide (en fracción del
    cuadro), robusta a saltos sueltos. Objetos quietos (< min_move) se descartan.
    Devuelve (object_id o None, desplazamiento del mejor).
    """
    best, best_move = None, 0.0
    for oid, pts in tracks.items():
        if len(pts) < min_points:
            continue
        move = (_span([p[1] for p in pts]) ** 2 + _span([p[2] for p in pts]) ** 2) ** 0.5
        if move > best_move:
            best, best_move = oid, move
    if best_move < min_move:
        return None, best_move
    return best, best_move


class MetaNotConfigured(RuntimeError):
    pass


def parse_frames(text: str) -> dict[int, list[tuple[float, ...]]]:
    matches = list(FRAME_RE.finditer(text))
    frames: dict[int, list[tuple[float, ...]]] = {}
    for i, m in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        boxes = [tuple(float(g) for g in b.groups()) for b in BOX_RE.finditer(text, m.end(), end)]
        frames[int(m.group(1))] = boxes
    return frames


def track_centroids(
    frames: dict[int, list[tuple[float, ...]]], out_w: float, out_h: float
) -> list[tuple[int, float, float]]:
    track = []
    for idx in sorted(frames):
        boxes = frames[idx]
        if not boxes:
            continue
        x1, y1, x2, y2, w, h = max(boxes, key=lambda b: (b[2] - b[0]) * (b[3] - b[1]))
        track.append((idx, (x1 + x2) / 2 / w * out_w, (y1 + y2) / 2 / h * out_h))
    return track


class MetaClient:
    def __init__(self, settings: Settings):
        if not settings.meta_api_key:
            raise MetaNotConfigured("MODEL_API_KEY not configured")
        self._base = settings.meta_base_url.rstrip("/")
        self._model = settings.meta_chat_model or DEFAULT_CHAT_MODEL
        self._auth = {"Authorization": f"Bearer {settings.meta_api_key}"}

    def chat(
        self,
        messages: list[dict],
        tools: list[dict] | None = None,
        reasoning_effort: str = "low",
        model: str | None = None,
    ) -> dict:
        body: dict = {"model": model or self._model, "messages": messages, "reasoning_effort": reasoning_effort}
        if tools:
            body["tools"] = tools
        r = httpx.post(f"{self._base}/chat/completions", json=body, headers=self._auth, timeout=60)
        r.raise_for_status()
        return r.json()

    def english_object_name(self, name: str) -> str:
        """Convierte el nombre que escribe el usuario (cualquier idioma) en una frase corta en inglés para SAM."""
        out = self.chat(
            [
                {
                    "role": "developer",
                    "content": "Translate the user's object name into a short, concrete English noun phrase "
                    "(1 to 4 words, keep colors and materials) that an object detector can find. "
                    "Reply with the phrase only, lowercase, no punctuation.",
                },
                {"role": "user", "content": name},
            ],
            reasoning_effort="low",
        )
        text = out["choices"][0]["message"].get("content") or ""
        if isinstance(text, list):
            text = " ".join(p.get("text", "") for p in text if isinstance(p, dict))
        text = re.sub(r"[^A-Za-z \-]", "", text).strip().lower()
        return " ".join(text.split()[:4])

    def suggest_concepts(self, frame_jpeg: bytes, wanted: str) -> list[str]:
        """Muse Spark mira un cuadro del clip y propone nombres alternativos para SAM (de específico a genérico)."""
        b64 = base64.b64encode(frame_jpeg).decode()
        out = self.chat(
            [
                {
                    "role": "developer",
                    "content": "You help a segmentation model (SAM) find one object in a physics experiment video. "
                    "Look at the frame. The user calls the moving object: '" + wanted + "'. Reply ONLY with JSON "
                    '{"concepts": [...]} holding up to 3 short English noun phrases (1 to 3 words each), from most '
                    "specific to most generic, that name that object as it actually looks in this frame "
                    "(for example: 'blue toy car', 'toy car', 'car'). No other text.",
                },
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": f"Object: {wanted}"},
                        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
                    ],
                },
            ],
            reasoning_effort="low",
        )
        text = out["choices"][0]["message"].get("content") or ""
        if isinstance(text, list):
            text = " ".join(p.get("text", "") for p in text if isinstance(p, dict))
        m = re.search(r"\{.*\}", text, re.S)
        try:
            items = json.loads(m.group(0)).get("concepts", []) if m else []
        except (json.JSONDecodeError, AttributeError):
            items = []
        clean = []
        for c in items:
            c = re.sub(r"[^a-z \-]", "", str(c).lower()).strip()
            c = " ".join(c.split()[:3])
            if len(c) >= 2 and c not in clean:
                clean.append(c)
        return clean[:3]

    def upload_file(self, path: Path) -> str:
        with path.open("rb") as fh:
            r = httpx.post(
                f"{self._base}/files",
                data={"purpose": "user_data"},
                files={"file": (path.name, fh, "video/mp4")},
                headers=self._auth,
                timeout=300,
            )
        r.raise_for_status()
        return r.json()["id"]

    def transcribe(self, audio: bytes, filename: str, lang_hint: str) -> dict:
        r = httpx.post(
            f"{self._base}/asr/transcribe",
            data={"mode": "PUSH_TO_TALK", "language": lang_hint},
            files={"file": (filename, audio)},
            headers=self._auth,
            timeout=60,
        )
        r.raise_for_status()
        return r.json()

    def sam_track_video(self, file_id: str, concept: str) -> list[str]:
        body = {
            "model": SAM_MODEL,
            "stream": True,
            "input": [
                {
                    "type": "message",
                    "role": "user",
                    "content": [
                        {"type": "input_text", "text": concept},
                        {"type": "input_video", "file_id": file_id},
                    ],
                }
            ],
            "metadata": {"mask_encoding": "one_bit"},
        }
        parts: list[str] = []
        with httpx.stream(
            "POST",
            f"{self._base}/responses",
            json=body,
            headers={**self._auth, "Accept": "text/event-stream"},
            timeout=600,
        ) as r:
            r.raise_for_status()
            for line in r.iter_lines():
                if not line.startswith("data: "):
                    continue
                data = line[6:]
                if data == "[DONE]":
                    break
                event = json.loads(data)
                if event.get("type") == "response.output_text.delta":
                    parts.append(event.get("delta", ""))
                elif event.get("type") == "response.completed":
                    break
        return parts

    def delete_file(self, file_id: str) -> None:
        r = httpx.delete(f"{self._base}/files/{file_id}", headers=self._auth, timeout=60)
        r.raise_for_status()

    def sam_image_boxes(self, image_b64: str, concept: str) -> list[tuple[float, ...]]:
        body = {
            "model": SAM_MODEL,
            "stream": True,
            "input": [
                {
                    "type": "message",
                    "role": "user",
                    "content": [
                        {"type": "input_text", "text": concept},
                        {"type": "input_image", "image_url": f"data:image/jpeg;base64,{image_b64}"},
                    ],
                }
            ],
        }
        parts: list[str] = []
        with httpx.stream(
            "POST",
            f"{self._base}/responses",
            json=body,
            headers={**self._auth, "Accept": "text/event-stream"},
            timeout=30,
        ) as r:
            r.raise_for_status()
            for line in r.iter_lines():
                if not line.startswith("data: "):
                    continue
                data = line[6:]
                if data == "[DONE]":
                    break
                event = json.loads(data)
                if event.get("type") == "response.output_text.delta":
                    parts.append(event.get("delta", ""))
                elif event.get("type") == "response.completed":
                    break
        return [tuple(float(g) for g in b.groups()) for b in BOX_RE.finditer("".join(parts))]

    def generate_image_png(self, prompt: str, size: str = "1536x1024") -> bytes:
        r = httpx.post(
            f"{self._base}/images/generations",
            json={"model": IMAGE_MODEL, "prompt": prompt, "size": size, "output_format": "png", "n": 1},
            headers=self._auth,
            timeout=120,
        )
        r.raise_for_status()
        return base64.b64decode(r.json()["data"][0]["b64_json"])

    def generate_image(self, prompt: str) -> dict:
        r = httpx.post(
            f"{self._base}/images/generations",
            json={"model": IMAGE_MODEL, "prompt": prompt},
            headers=self._auth,
            timeout=120,
        )
        r.raise_for_status()
        return r.json()
