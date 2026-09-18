from __future__ import annotations

import wave
from pathlib import Path

import numpy as np

from bfclips.schemas import Event
from bfclips.services.ffmpeg import extract_audio


def read_wav_mono(path: Path) -> tuple[np.ndarray, int]:
    with wave.open(str(path), "rb") as handle:
        channels = handle.getnchannels()
        width = handle.getsampwidth()
        rate = handle.getframerate()
        frames = handle.readframes(handle.getnframes())
    if width == 2:
        samples = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
    elif width == 4:
        samples = np.frombuffer(frames, dtype=np.int32).astype(np.float32) / 2147483648.0
    else:
        samples = np.frombuffer(frames, dtype=np.uint8).astype(np.float32)
        samples = (samples - 128.0) / 128.0
    if channels > 1:
        samples = samples.reshape(-1, channels).mean(axis=1)
    return samples, rate


def envelope(samples: np.ndarray, rate: int, hop_s: float = 0.05) -> tuple[np.ndarray, np.ndarray]:
    hop = max(1, int(rate * hop_s))
    if samples.size == 0:
        return np.zeros(0), np.zeros(0)
    n = samples.size // hop
    if n == 0:
        return np.array([0.0]), np.array([float(np.sqrt(np.mean(samples**2)))])
    clipped = samples[: n * hop].reshape(n, hop)
    rms = np.sqrt(np.mean(clipped**2, axis=1))
    times = (np.arange(n) + 0.5) * hop_s
    return times, rms


def detect_onsets(
    rms: np.ndarray,
    times: np.ndarray,
    z_thresh: float = 2.6,
    min_gap_s: float = 0.28,
) -> list[tuple[float, float]]:
    if rms.size < 8:
        return []
    median = float(np.median(rms))
    mad = float(np.median(np.abs(rms - median))) + 1e-8
    z = (rms - median) / (1.4826 * mad)
    peaks: list[tuple[float, float]] = []
    last_t = -min_gap_s
    for i, score in enumerate(z):
        if score >= z_thresh and times[i] - last_t >= min_gap_s:
            energy = float(rms[i])
            # Large booms vs gunfire: very high energy and wider than a click.
            peaks.append((float(times[i]), energy))
            last_t = float(times[i])
    return peaks


def analyze_audio(video_path: Path, work_dir: Path) -> tuple[list[Event], list[dict]]:
    wav_path = work_dir / "audio.wav"
    try:
        extract_audio(video_path, wav_path)
    except Exception:
        return [], []
    samples, rate = read_wav_mono(wav_path)
    times, rms = envelope(samples, rate)
    peaks = detect_onsets(rms, times)
    events: list[Event] = []
    payload: list[dict] = []
    if rms.size:
        p95 = float(np.percentile(rms, 95))
    else:
        p95 = 0.0
    for t, energy in peaks:
        kind = "explosion" if energy >= max(p95 * 1.6, 0.18) else "audio_peak"
        if energy >= max(p95 * 1.15, 0.08) and energy < max(p95 * 1.6, 0.18):
            kind = "weapon_fire"
        conf = min(0.95, 0.55 + energy)
        event = Event(
            id=f"aud_{int(round(t * 1000)):07d}",
            time=round(t, 3),
            type=kind,  # type: ignore[arg-type]
            confidence=round(conf, 3),
            source="audio",
            meta={"energy": round(energy, 4)},
        )
        events.append(event)
        payload.append({"time": event.time, "energy": round(energy, 4), "type": kind})
    return events, payload


def write_silence_wav(path: Path, duration: float, rate: int = 16000) -> None:
    n = int(duration * rate)
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        handle.writeframes(b"\x00\x00" * n)


def mix_beeps(samples: np.ndarray, rate: int, times: list[float], freq: int = 880) -> np.ndarray:
    out = samples.copy()
    for t in times:
        start = int(t * rate)
        length = int(0.09 * rate)
        if start >= out.size:
            continue
        end = min(out.size, start + length)
        tone = np.sin(2 * np.pi * freq * np.arange(end - start) / rate).astype(np.float32)
        out[start:end] += 0.7 * tone
    return np.clip(out, -1.0, 1.0)


def write_wav(path: Path, samples: np.ndarray, rate: int) -> None:
    pcm = (np.clip(samples, -1, 1) * 32767).astype(np.int16)
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        handle.writeframes(pcm.tobytes())
