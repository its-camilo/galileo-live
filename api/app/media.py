import json
import subprocess
from dataclasses import dataclass
from pathlib import Path

NORMALIZED_WIDTH = 960
# Cuadros por segundo del clip que recibe SAM. Se fuerza tasa constante para que
# índice de frame / fps sea el tiempo real (los celulares graban con tasa variable).
MAX_FPS = 30
MIN_FPS = 30


@dataclass(frozen=True)
class VideoInfo:
    width: int
    height: int
    fps: float
    duration: float


def target_fps(src: Path) -> int:
    """30 fps fijos: menos memoria en Render free y menos cuadros que SAM debe procesar."""
    try:
        fps = probe(src).fps
    except Exception:
        return MIN_FPS
    return MAX_FPS


def normalize_video(src: Path, dst: Path, fps: int | None = None) -> None:
    fps = fps or target_fps(src)
    subprocess.run(
        [
            # Render free tiene 512 MB: x264 abre muchos hilos (según los núcleos del host) y cada
            # uno guarda cuadros; con 2 hilos y lookahead corto la memoria queda acotada.
            "ffmpeg", "-y", "-threads", "2", "-i", str(src),
            "-an",
            "-vf", f"fps={fps},scale={NORMALIZED_WIDTH}:-2:flags=lanczos",
            "-fps_mode", "cfr",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
            "-threads", "2", "-x264-params", "rc-lookahead=10:sync-lookahead=0",
            "-filter_threads", "1",
            "-pix_fmt", "yuv420p",
            "-movflags", "+faststart",
            str(dst),
        ],
        check=True,
        capture_output=True,
        timeout=300,
    )


def probe(path: Path) -> VideoInfo:
    out = subprocess.run(
        [
            "ffprobe", "-v", "error", "-select_streams", "v:0",
            "-show_entries", "stream=width,height,avg_frame_rate:format=duration",
            "-of", "json", str(path),
        ],
        check=True,
        capture_output=True,
        text=True,
        timeout=60,
    )
    data = json.loads(out.stdout)
    stream = data["streams"][0]
    num, den = stream["avg_frame_rate"].split("/")
    fps = float(num) / float(den) if float(den) else 0.0
    if fps <= 0:
        raise ValueError("could not determine video fps")
    duration = float(data.get("format", {}).get("duration", 0.0))
    return VideoInfo(
        width=int(stream["width"]),
        height=int(stream["height"]),
        fps=fps,
        duration=duration,
    )
