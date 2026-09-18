from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable

import cv2
import numpy as np

from bfclips.config import hud_config
from bfclips.schemas import Event, Rect


@dataclass
class RegionSignal:
    name: str
    times: list[float]
    brightness: list[float]
    red_ratio: list[float]
    edges: list[float]


def _rect_from_dict(data: dict[str, Any], default_name: str) -> Rect:
    return Rect(
        name=data.get("name", default_name),
        x=float(data["x"]),
        y=float(data["y"]),
        w=float(data["w"]),
        h=float(data["h"]),
    )


def load_regions(preset: str | None = None) -> dict[str, list[Rect]]:
    cfg = hud_config()
    name = preset or cfg.get("active_preset") or "bf6"
    preset_cfg = cfg.get("presets", {}).get(name) or cfg["presets"]["bf6"]
    regions: dict[str, list[Rect]] = {}
    for key, value in preset_cfg.items():
        if isinstance(value, list):
            regions[key] = [_rect_from_dict(item, key) for item in value]
        else:
            regions[key] = [_rect_from_dict(value, key)]
    return regions


def crop_norm(frame: np.ndarray, rect: Rect) -> np.ndarray:
    h, w = frame.shape[:2]
    x0 = max(0, int(rect.x * w))
    y0 = max(0, int(rect.y * h))
    x1 = min(w, int((rect.x + rect.w) * w))
    y1 = min(h, int((rect.y + rect.h) * h))
    if x1 <= x0 or y1 <= y0:
        return frame[0:1, 0:1]
    return frame[y0:y1, x0:x1]


def region_features(crop: np.ndarray) -> tuple[float, float, float]:
    if crop.size == 0:
        return 0.0, 0.0, 0.0
    if len(crop.shape) == 2:
        gray = crop
        bgr = cv2.cvtColor(crop, cv2.COLOR_GRAY2BGR)
    else:
        bgr = crop
        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    brightness = float(np.mean(gray))
    b, g, r = cv2.split(bgr)
    red_ratio = float((np.mean(r) + 1.0) / (np.mean(b) + np.mean(g) + 1.0))
    edges = cv2.Canny(gray, 60, 140)
    edge_energy = float(np.mean(edges))
    return brightness, red_ratio, edge_energy


def sample_video(
    path: str,
    fps: float,
    max_frames: int | None = None,
) -> tuple[list[float], list[np.ndarray]]:
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        raise RuntimeError(f"Could not open video: {path}")
    native_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    step = max(1, int(round(native_fps / max(fps, 0.5))))
    times: list[float] = []
    frames: list[np.ndarray] = []
    index = 0
    grabbed = True
    while grabbed:
        grabbed = cap.grab()
        if not grabbed:
            break
        if index % step == 0:
            ok, frame = cap.retrieve()
            if not ok:
                break
            times.append(index / native_fps)
            frames.append(frame)
            if max_frames and len(frames) >= max_frames:
                break
        index += 1
    cap.release()
    return times, frames


def collect_signals(
    frames: list[np.ndarray],
    times: list[float],
    regions: dict[str, list[Rect]],
) -> dict[str, RegionSignal]:
    signals: dict[str, RegionSignal] = {}
    for group, rects in regions.items():
        for rect in rects:
            brightness: list[float] = []
            reds: list[float] = []
            edges: list[float] = []
            for frame in frames:
                crop = crop_norm(frame, rect)
                b, r, e = region_features(crop)
                brightness.append(b)
                reds.append(r)
                edges.append(e)
            signals[rect.name] = RegionSignal(rect.name, list(times), brightness, reds, edges)
    return signals


def peak_indices(values: list[float], z_thresh: float, min_gap: int) -> list[int]:
    if len(values) < 5:
        return []
    arr = np.asarray(values, dtype=np.float64)
    median = np.median(arr)
    mad = np.median(np.abs(arr - median)) + 1e-6
    z = (arr - median) / (1.4826 * mad)
    peaks: list[int] = []
    last = -min_gap
    for i, score in enumerate(z):
        if score >= z_thresh and i - last >= min_gap:
            # local maximum in a tiny window
            left = max(0, i - 1)
            right = min(len(arr), i + 2)
            if arr[i] >= np.max(arr[left:right]) * 0.98:
                peaks.append(i)
                last = i
    return peaks


def _event_id(prefix: str, time_s: float) -> str:
    return f"{prefix}_{int(round(time_s * 1000)):07d}"


def detect_hud_events(
    path: str,
    preset: str = "bf6",
    sample_fps: float = 4.0,
    frames: list[np.ndarray] | None = None,
    times: list[float] | None = None,
) -> tuple[list[Event], dict[str, RegionSignal], list[float], list[np.ndarray]]:
    cfg = hud_config().get("detection", {})
    regions = load_regions(preset)
    if frames is None or times is None:
        times, frames = sample_video(path, sample_fps)
    signals = collect_signals(frames, times, regions)
    min_gap = max(1, int(round((cfg.get("min_event_gap", 0.35) * sample_fps))))
    events: list[Event] = []

    feed_peaks: list[tuple[float, float, str]] = []
    for name, signal in signals.items():
        if "kill_feed" not in name:
            continue
        for idx in peak_indices(signal.brightness, cfg.get("peak_z", 2.4), min_gap):
            t = signal.times[idx]
            conf = min(0.99, 0.72 + (signal.brightness[idx] / 255.0) * 0.2)
            feed_peaks.append((t, conf, name))

    hit_signal = signals.get("hit_marker")
    hit_peaks: list[tuple[float, bool, float]] = []
    if hit_signal:
        for idx in peak_indices(
            hit_signal.brightness, cfg.get("hit_marker_z", 2.1), max(1, min_gap - 1)
        ):
            red = hit_signal.red_ratio[idx]
            headshot = red >= cfg.get("headshot_red_ratio", 1.25)
            hit_peaks.append((hit_signal.times[idx], headshot, min(0.98, 0.7 + red * 0.08)))

    used_hits: set[int] = set()
    for t, conf, source in feed_peaks:
        headshot = False
        match_conf = conf
        for i, (ht, hs, hconf) in enumerate(hit_peaks):
            if i in used_hits:
                continue
            if abs(ht - t) <= 0.7:
                headshot = hs
                match_conf = max(conf, hconf)
                used_hits.add(i)
                break
        events.append(
            Event(
                id=_event_id("kill", t),
                time=round(t, 3),
                type="kill",
                confidence=round(match_conf, 3),
                source=source,
                meta={"headshot": headshot},
            )
        )
        if headshot:
            events.append(
                Event(
                    id=_event_id("hs", t),
                    time=round(t, 3),
                    type="headshot",
                    confidence=round(match_conf, 3),
                    source="hit_marker",
                    meta={},
                )
            )

    for i, (ht, hs, hconf) in enumerate(hit_peaks):
        if i in used_hits:
            continue
        events.append(
            Event(
                id=_event_id("hit", ht),
                time=round(ht, 3),
                type="hit_marker",
                confidence=round(hconf, 3),
                source="hit_marker",
                meta={"headshot": hs},
            )
        )

    score_signal = signals.get("score_popup")
    if score_signal:
        for idx in peak_indices(score_signal.brightness, cfg.get("peak_z", 2.4), min_gap):
            t = score_signal.times[idx]
            events.append(
                Event(
                    id=_event_id("score", t),
                    time=round(t, 3),
                    type="score",
                    confidence=0.7,
                    source="score_popup",
                )
            )

    death_signal = signals.get("death_banner")
    if death_signal:
        # Deaths often darken the centre and add a red banner.
        dark = [-v for v in death_signal.brightness]
        for idx in peak_indices(dark, cfg.get("death_darken_z", 2.0), min_gap + 2):
            if death_signal.red_ratio[idx] >= 1.05:
                t = death_signal.times[idx]
                events.append(
                    Event(
                        id=_event_id("death", t),
                        time=round(t, 3),
                        type="death",
                        confidence=0.68,
                        source="death_banner",
                    )
                )

    # Global flash / explosion: sudden whole-frame brightness jump.
    global_brightness = [float(np.mean(cv2.cvtColor(f, cv2.COLOR_BGR2GRAY))) for f in frames]
    for idx in peak_indices(global_brightness, cfg.get("explosion_global_z", 2.8), min_gap + 1):
        t = times[idx]
        # Ignore if it already lines up with a kill-feed-only UI pop.
        events.append(
            Event(
                id=_event_id("boom", t),
                time=round(t, 3),
                type="explosion",
                confidence=0.62,
                source="global_flash",
            )
        )

    events.sort(key=lambda e: (e.time, e.type))
    return events, signals, times, frames


def draw_calibration(frame: np.ndarray, preset: str = "bf6") -> np.ndarray:
    overlay = frame.copy()
    colors = {
        "kill_feed": (0, 165, 255),
        "hit_marker": (255, 255, 255),
        "score_popup": (0, 215, 255),
        "death_banner": (0, 0, 255),
        "health": (80, 255, 80),
        "objective": (255, 180, 80),
    }
    h, w = frame.shape[:2]
    for group, rects in load_regions(preset).items():
        color = colors.get(group, (200, 200, 200))
        for rect in rects:
            x0, y0 = int(rect.x * w), int(rect.y * h)
            x1, y1 = int((rect.x + rect.w) * w), int((rect.y + rect.h) * h)
            cv2.rectangle(overlay, (x0, y0), (x1, y1), color, 2)
            cv2.putText(
                overlay,
                rect.name,
                (x0 + 6, max(18, y0 + 18)),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.5,
                color,
                1,
                cv2.LINE_AA,
            )
    return overlay


def iter_peak_times(signals: Iterable[RegionSignal], z_thresh: float, fps: float) -> list[float]:
    times: list[float] = []
    for signal in signals:
        gap = max(1, int(round(0.35 * fps)))
        for idx in peak_indices(signal.brightness, z_thresh, gap):
            times.append(signal.times[idx])
    return times
