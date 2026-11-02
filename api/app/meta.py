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

    def sam_track_video(self, file_id: str, concept: str) -> str:
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
        return "".join(parts)

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
