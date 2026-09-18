from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

from bfclips.schemas import SourceInfo


class FFmpegError(RuntimeError):
    pass


def which_ffmpeg() -> str:
    path = shutil.which("ffmpeg")
    if not path:
        raise FFmpegError("ffmpeg is not on PATH")
    return path


def which_ffprobe() -> str:
    path = shutil.which("ffprobe")
    if not path:
        raise FFmpegError("ffprobe is not on PATH")
    return path


def run(cmd: list[str], cwd: Path | None = None) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        cmd,
        cwd=cwd,
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        raise FFmpegError(
            f"Command failed ({result.returncode}): {' '.join(cmd)}\n{result.stderr[-4000:]}"
        )
    return result


def probe(path: Path) -> SourceInfo:
    cmd = [
        which_ffprobe(),
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        str(path),
    ]
    result = run(cmd)
    data = json.loads(result.stdout)
    video = next((s for s in data.get("streams", []) if s.get("codec_type") == "video"), None)
    audio = next((s for s in data.get("streams", []) if s.get("codec_type") == "audio"), None)
    if not video:
        raise FFmpegError(f"No video stream in {path}")
    fps_raw = video.get("avg_frame_rate") or video.get("r_frame_rate") or "30/1"
    if "/" in fps_raw:
        num, den = fps_raw.split("/", 1)
        fps = float(num) / float(den) if float(den) else 30.0
    else:
        fps = float(fps_raw)
    duration = float(data.get("format", {}).get("duration") or video.get("duration") or 0)
    return SourceInfo(
        path=str(path),
        duration=duration,
        width=int(video["width"]),
        height=int(video["height"]),
        fps=fps,
        audio=audio is not None,
    )


def extract_audio(video: Path, wav_path: Path, sample_rate: int = 16000) -> Path:
    wav_path.parent.mkdir(parents=True, exist_ok=True)
    run(
        [
            which_ffmpeg(),
            "-y",
            "-i",
            str(video),
            "-ac",
            "1",
            "-ar",
            str(sample_rate),
            "-vn",
            str(wav_path),
        ]
    )
    return wav_path


def extract_frame(video: Path, time_s: float, output: Path) -> Path:
    output.parent.mkdir(parents=True, exist_ok=True)
    run(
        [
            which_ffmpeg(),
            "-y",
            "-ss",
            f"{time_s:.3f}",
            "-i",
            str(video),
            "-frames:v",
            "1",
            str(output),
        ]
    )
    return output


def find_font() -> str | None:
    candidates = [
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
        Path("/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"),
        Path("C:/Windows/Fonts/arialbd.ttf"),
        Path("C:/Windows/Fonts/segoeuib.ttf"),
        Path("/usr/share/fonts/TTF/DejaVuSans-Bold.ttf"),
    ]
    for path in candidates:
        if path.exists():
            return str(path).replace("\\", "/")
    return None
