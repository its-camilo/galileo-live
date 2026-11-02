import json
import subprocess
from dataclasses import dataclass
from pathlib import Path

NORMALIZED_WIDTH = 640


@dataclass(frozen=True)
class VideoInfo:
    width: int
    height: int
    fps: float
    duration: float


def normalize_video(src: Path, dst: Path) -> None:
    subprocess.run(
        [
            "ffmpeg", "-y", "-i", str(src),
            "-an",
            "-vf", f"scale={NORMALIZED_WIDTH}:-2",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
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
