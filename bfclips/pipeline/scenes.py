from __future__ import annotations

import numpy as np

from bfclips.schemas import Event


def detect_scene_cuts(
    frames: list[np.ndarray],
    times: list[float],
    threshold: float = 0.42,
) -> tuple[list[Event], list[dict]]:
    scenes: list[dict] = []
    events: list[Event] = []
    if len(frames) < 2:
        return events, scenes
    prev = _hist(frames[0])
    start = times[0]
    for frame, t in zip(frames[1:], times[1:]):
        hist = _hist(frame)
        delta = float(cv_chi(prev, hist))
        if delta >= threshold:
            scenes.append({"start": round(start, 3), "end": round(t, 3), "score": round(delta, 3)})
            events.append(
                Event(
                    id=f"cut_{int(round(t * 1000)):07d}",
                    time=round(t, 3),
                    type="scene_cut",
                    confidence=min(0.95, 0.5 + delta),
                    source="framediff",
                    meta={"delta": round(delta, 3)},
                )
            )
            start = t
        prev = hist
    if times:
        scenes.append({"start": round(start, 3), "end": round(times[-1], 3), "score": 0.0})
    return events, scenes


def _hist(frame: np.ndarray) -> np.ndarray:
    import cv2

    small = cv2.resize(frame, (160, 90))
    hsv = cv2.cvtColor(small, cv2.COLOR_BGR2HSV)
    hist = cv2.calcHist([hsv], [0, 1], None, [16, 16], [0, 180, 0, 256])
    cv2.normalize(hist, hist)
    return hist.flatten()


def cv_chi(a: np.ndarray, b: np.ndarray) -> float:
    denom = a + b + 1e-6
    return float(0.5 * np.sum((a - b) ** 2 / denom))
