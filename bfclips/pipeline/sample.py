from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np

from bfclips.pipeline.audio import mix_beeps, write_wav
from bfclips.services.ffmpeg import run, which_ffmpeg


DEFAULT_KILLS = [3.0, 6.4, 7.1]


def generate_sample(
    dest: Path,
    duration: float = 12.0,
    fps: float = 24.0,
    size: tuple[int, int] = (1280, 720),
    kills: list[float] | None = None,
    death_at: float | None = 10.2,
    explosion_at: float | None = 7.25,
) -> Path:
    """Create a synthetic Battlefield-like clip with HUD flashes at known times."""
    kills = kills or list(DEFAULT_KILLS)
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp_video = dest.with_suffix(".raw.mp4")
    writer = cv2.VideoWriter(
        str(tmp_video),
        cv2.VideoWriter_fourcc(*"mp4v"),
        fps,
        size,
    )
    if not writer.isOpened():
        raise RuntimeError("Could not open VideoWriter for sample clip")

    width, height = size
    frames = int(duration * fps)
    for i in range(frames):
        t = i / fps
        frame = _battlefield_frame(width, height, t)
        for kill in kills:
            if 0 <= t - kill <= 0.42:
                strength = 1.0 - (t - kill) / 0.42
                _paint_kill(frame, strength, headshot=(kill == kills[0]))
        if explosion_at is not None and 0 <= t - explosion_at <= 0.28:
            flash = int(180 * (1.0 - (t - explosion_at) / 0.28))
            frame = cv2.add(frame, np.full_like(frame, flash))
        if death_at is not None and 0 <= t - death_at <= 1.4:
            _paint_death(frame, 1.0 - (t - death_at) / 1.4)
        writer.write(frame)
    writer.release()

    rate = 16000
    noise = (np.random.randn(int(duration * rate)) * 0.04).astype(np.float32)
    audio = mix_beeps(noise, rate, kills + ([explosion_at] if explosion_at else []), freq=920)
    wav = dest.with_suffix(".wav")
    write_wav(wav, audio, rate)
    dest.unlink(missing_ok=True)
    run(
        [
            which_ffmpeg(),
            "-y",
            "-i",
            str(tmp_video),
            "-i",
            str(wav),
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-crf",
            "28",
            "-c:a",
            "aac",
            "-shortest",
            str(dest),
        ]
    )
    tmp_video.unlink(missing_ok=True)
    wav.unlink(missing_ok=True)
    return dest


def _battlefield_frame(width: int, height: int, t: float) -> np.ndarray:
    yy, xx = np.mgrid[0:height, 0:width]
    base = np.zeros((height, width, 3), dtype=np.uint8)
    base[:, :, 0] = (28 + 18 * np.sin(xx / 90 + t)).astype(np.uint8)
    base[:, :, 1] = (42 + 20 * np.sin(yy / 70 + t * 0.7)).astype(np.uint8)
    base[:, :, 2] = (36 + 14 * np.cos(xx / 140 - t)).astype(np.uint8)
    # Fake terrain band
    horizon = int(height * (0.42 + 0.02 * np.sin(t)))
    base[horizon:, :, 1] = np.clip(base[horizon:, :, 1] + 30, 0, 255)
    # Crosshair
    cx, cy = width // 2, height // 2
    cv2.drawMarker(base, (cx, cy), (210, 210, 210), cv2.MARKER_CROSS, 18, 1)
    # Minimap block
    cv2.rectangle(base, (20, height - 150), (170, height - 20), (20, 40, 20), -1)
    cv2.rectangle(base, (20, height - 150), (170, height - 20), (80, 120, 80), 1)
    # Health pip
    cv2.rectangle(base, (24, height - 48), (160, height - 28), (40, 180, 70), -1)
    return base


def _paint_kill(frame: np.ndarray, strength: float, headshot: bool) -> None:
    h, w = frame.shape[:2]
    alpha = np.clip(strength, 0, 1)
    # Left kill feed row (BF6-style)
    x0, y0, x1, y1 = 18, int(h * 0.16), int(w * 0.28), int(h * 0.16) + 28
    color = (40, 40, 230) if not headshot else (20, 80, 255)
    cv2.rectangle(frame, (x0, y0), (x1, y1), color, -1)
    cv2.putText(
        frame,
        "YOU  killed  ENEMY",
        (x0 + 8, y0 + 20),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.45,
        (240, 240, 240),
        1,
        cv2.LINE_AA,
    )
    # Hit marker
    marker = (20, 20, 255) if headshot else (230, 230, 230)
    cx, cy = w // 2, h // 2
    span = int(16 + 10 * alpha)
    cv2.line(frame, (cx - span, cy - span), (cx - 4, cy - 4), marker, 2)
    cv2.line(frame, (cx + span, cy - span), (cx + 4, cy - 4), marker, 2)
    cv2.line(frame, (cx - span, cy + span), (cx - 4, cy + 4), marker, 2)
    cv2.line(frame, (cx + span, cy + span), (cx + 4, cy + 4), marker, 2)
    # Score pop
    cv2.putText(
        frame,
        "+100" if not headshot else "HEADSHOT +150",
        (int(w * 0.40), int(h * 0.60)),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.7,
        (0, 215, 255),
        2,
        cv2.LINE_AA,
    )


def _paint_death(frame: np.ndarray, strength: float) -> None:
    h, w = frame.shape[:2]
    dark = (frame.astype(np.float32) * (0.35 + 0.3 * (1 - strength))).astype(np.uint8)
    frame[:] = dark
    cv2.rectangle(frame, (int(w * 0.28), int(h * 0.36)), (int(w * 0.72), int(h * 0.50)), (0, 0, 90), -1)
    cv2.putText(
        frame,
        "YOU ARE DEAD",
        (int(w * 0.34), int(h * 0.46)),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.9,
        (40, 40, 255),
        2,
        cv2.LINE_AA,
    )
