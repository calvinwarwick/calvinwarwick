from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

import cv2
import numpy as np

from bfclips.config import hud_config
from bfclips.pipeline.feed import is_still, read_feed
from bfclips.pipeline.scenes import frame_hist
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
    # Kill-feed rows and hit markers occupy a small slice of a large crop.
    # p90 / max react to a new line; mean often does not.
    brightness = float(np.percentile(gray, 90))
    b, g, r = cv2.split(bgr)
    mask = gray >= max(40.0, np.percentile(gray, 75))
    if np.any(mask):
        red_ratio = float((np.mean(r[mask]) + 1.0) / (np.mean(b[mask]) + np.mean(g[mask]) + 1.0))
    else:
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


def sample_hud_stream(
    path: str,
    fps: float,
    regions: dict[str, list[Rect]],
    frames: list[np.ndarray] | None = None,
    times: list[float] | None = None,
    max_frames: int | None = None,
) -> dict[str, Any]:
    """Decode once. Keep HUD crops + tiny previews, not full-res frames."""
    feed_rect = (regions.get("kill_feed") or [None])[0]
    medal_rect = (regions.get("medals") or [None])[0]
    hit_rect = (regions.get("hit_marker") or [None])[0]
    death_rect = (regions.get("death_banner") or [None])[0]
    score_rect = (regions.get("score_popup") or [None])[0]

    out: dict[str, Any] = {
        "times": [],
        "feed": [],
        "medals": [],
        "hit": [],
        "death": [],
        "score": [],
        "previews": [],
        "scene_hists": [],
        "cal_frame": None,
        "kinds": [],
    }

    def _take(frame: np.ndarray, t: float) -> None:
        preview = cv2.resize(frame, (160, 90), interpolation=cv2.INTER_AREA)
        out["times"].append(t)
        out["feed"].append(crop_norm(frame, feed_rect) if feed_rect else preview)
        out["medals"].append(crop_norm(frame, medal_rect) if medal_rect else preview[0:1, 0:1])
        out["hit"].append(crop_norm(frame, hit_rect) if hit_rect else preview[0:1, 0:1])
        out["death"].append(crop_norm(frame, death_rect) if death_rect else preview[0:1, 0:1])
        out["score"].append(crop_norm(frame, score_rect) if score_rect else preview[0:1, 0:1])
        out["previews"].append(preview)
        out["scene_hists"].append(frame_hist(preview))
        if out["cal_frame"] is None:
            out["cal_frame"] = cv2.resize(frame, (960, 540), interpolation=cv2.INTER_AREA)

    if frames is not None and times is not None:
        for frame, t in zip(frames, times):
            _take(frame, t)
            if max_frames and len(out["times"]) >= max_frames:
                break
        return out

    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        raise RuntimeError(f"Could not open video: {path}")
    native_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    step = max(1, int(round(native_fps / max(fps, 0.5))))
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
            _take(frame, index / native_fps)
            del frame
            if max_frames and len(out["times"]) >= max_frames:
                break
        index += 1
    cap.release()
    return out


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
    delta = np.abs(np.diff(arr, prepend=arr[0]))
    median = np.median(arr)
    mad = np.median(np.abs(arr - median)) + 1e-6
    z = (arr - median) / (1.4826 * mad)
    d_med = np.median(delta)
    d_mad = np.median(np.abs(delta - d_med)) + 1e-6
    z_delta = (delta - d_med) / (1.4826 * d_mad)
    score = np.maximum(z, 0.65 * z_delta)
    peaks: list[int] = []
    last = -min_gap
    for i, value in enumerate(score):
        # Ignore recoveries from a dark overlay (death/menu): those have a
        # large delta but sit back at the baseline, not a true HUD pop.
        if value >= z_thresh and z[i] >= 1.15 and arr[i] > median and i - last >= min_gap:
            left = max(0, i - 1)
            right = min(len(arr), i + 2)
            if arr[i] >= np.max(arr[left:right]) * 0.96:
                peaks.append(i)
                last = i
    return peaks


def _event_id(prefix: str, time_s: float) -> str:
    return f"{prefix}_{int(round(time_s * 1000)):07d}"


def _emit_or_attach_medal(
    events: list[Event],
    t: float,
    score: float,
    red: float,
    kind: str | None,
) -> None:
    headshot = kind == "headshot" or red >= 0.012
    medal_kind = kind if kind in {"longshot", "blindside", "headshot"} else None
    near = [e for e in events if e.type == "kill" and abs(e.time - t) < 1.0]
    if near:
        for event in near:
            event.meta["medal"] = True
            if headshot:
                event.meta["headshot"] = True
            if medal_kind:
                event.meta["kind"] = medal_kind
                event.meta[medal_kind] = True
        if medal_kind and not any(e.type == medal_kind and abs(e.time - t) < 0.55 for e in events):
            prefix = {"headshot": "hs", "longshot": "ls", "blindside": "bs"}[medal_kind]
            events.append(
                Event(
                    id=_event_id(prefix, t),
                    time=round(t, 3),
                    type=medal_kind,  # type: ignore[arg-type]
                    confidence=0.86,
                    source="medals",
                    meta={},
                )
            )
        if headshot and not any(e.type == "headshot" and abs(e.time - t) < 0.55 for e in events):
            events.append(
                Event(
                    id=_event_id("hs", t),
                    time=round(t, 3),
                    type="headshot",
                    confidence=0.82,
                    source="medals",
                    meta={},
                )
            )
        return
    # Medals confirm a feed kill; they do not mint one.


def _gray(crop: np.ndarray) -> np.ndarray:
    if crop.size == 0:
        return np.zeros((1, 1), dtype=np.uint8)
    if crop.ndim == 2:
        return crop
    return cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)


def hud_text_mask(crop: np.ndarray) -> np.ndarray:
    """Near-white / red HUD glyphs, not terrain grain."""
    gray = _gray(crop)
    if gray.size < 16:
        return np.zeros(gray.shape, dtype=bool)
    high = cv2.subtract(gray, cv2.GaussianBlur(gray, (7, 7), 0))
    white = (gray >= 175) & (high >= 16)
    if crop.ndim == 3:
        _b, g, r = cv2.split(crop)
        red = (r >= 160) & (r.astype(np.int16) > g.astype(np.int16) + 30) & (
            r.astype(np.int16) > _b.astype(np.int16) + 20
        )
        return white | red
    return white


def text_row_spans(
    mask: np.ndarray,
    min_h: int = 6,
    max_h: int = 22,
    min_dens: float = 0.035,
) -> list[tuple[int, int, float]]:
    if mask.size < 16:
        return []
    row = mask.mean(axis=1)
    bands = row >= min_dens
    runs: list[tuple[int, int, float]] = []
    start = None
    for i, on in enumerate(bands):
        if on and start is None:
            start = i
        elif not on and start is not None:
            if min_h <= i - start <= max_h:
                runs.append((start, i, float(row[start:i].mean())))
            start = None
    if start is not None and min_h <= len(bands) - start <= max_h:
        runs.append((start, len(bands), float(row[start:].mean())))
    return runs


def _row_has_chevron(crop: np.ndarray, y0: int, y1: int, gap_min: int = 7) -> bool:
    """Self/squad rows: small ►, a gap, then the name. Letter spacing is 1-3px."""
    strip = crop[max(0, y0) : max(y0 + 1, y1)]
    if strip.size < 16:
        return False
    col = hud_text_mask(strip).mean(axis=0)
    on = np.where(col > 0.08)[0]
    if on.size < 4:
        return False
    start = int(on[0])
    end = start
    while end < len(col) and col[end] > 0.04:
        end += 1
    width = end - start
    nxt = end
    while nxt < len(col) and col[nxt] <= 0.04:
        nxt += 1
    gap = nxt - end
    rest = float(col[nxt:].sum()) if nxt < len(col) else 0.0
    xfrac = start / max(len(col), 1)
    return 5 <= width <= 16 and gap_min <= gap <= 22 and rest >= 1.5 and xfrac < 0.65


def self_row_count(crop: np.ndarray, gap_min: int = 7) -> int:
    rows = text_row_spans(hud_text_mask(crop))
    return sum(1 for y0, y1, _ in rows if _row_has_chevron(crop, y0, y1, gap_min))


def medal_word_score(crop: np.ndarray, min_width: int = 48) -> tuple[float, float]:
    """Wide HUD words (HEADSHOT / BLINDSIDE / LONGSHOT), not rock texture."""
    feat = medal_features(crop, min_width=min_width)
    return feat.score, feat.red


@dataclass
class MedalFeat:
    score: float
    red: float
    kind: str | None
    template: float
    matches: dict[str, float]


def load_hud_templates(templates_dir: str | Path | None) -> tuple[np.ndarray | None, dict[str, np.ndarray]]:
    if not templates_dir:
        return None, {}
    root = Path(templates_dir)
    name = None
    path = root / "player_name.png"
    if path.exists():
        name = cv2.imread(str(path))
    medals: dict[str, np.ndarray] = {}
    # Headshot templates false-match terrain; classify those from red + a real medal.
    for kind in ("longshot", "blindside"):
        medal_path = root / f"medal_{kind}.png"
        if medal_path.exists():
            image = cv2.imread(str(medal_path))
            if image is not None:
                medals[kind] = image
    return name, medals


def _match_multiscale(
    image: np.ndarray,
    template: np.ndarray,
    heights: Iterable[int],
    thresh: float = 0.0,
) -> tuple[float, int, int, int, int]:
    """Best TM_CCOEFF_NORMED hit. Returns score, y, x, h, w."""
    gray = _gray(image)
    tmpl = _gray(template)
    if gray.size < 16 or tmpl.size < 16:
        return 0.0, 0, 0, 0, 0
    th0, tw0 = tmpl.shape[:2]
    best = (0.0, 0, 0, 0, 0)
    for height in heights:
        height = int(height)
        if height < 4:
            continue
        width = max(8, int(tw0 * height / max(th0, 1)))
        if gray.shape[0] < height or gray.shape[1] < width:
            continue
        resized = cv2.resize(tmpl, (width, height), interpolation=cv2.INTER_AREA)
        result = cv2.matchTemplate(gray, resized, cv2.TM_CCOEFF_NORMED)
        _, max_val, _, max_loc = cv2.minMaxLoc(result)
        score = float(max_val)
        if score >= thresh and score > best[0]:
            best = (score, int(max_loc[1]), int(max_loc[0]), height, width)
    return best


def find_player_hits(
    crop: np.ndarray,
    template: np.ndarray,
    thresh: float = 0.55,
) -> list[tuple[float, int, int, int, int]]:
    """Whole-feed name hits. Chevron rows miss the name when the band splits."""
    hits: list[tuple[float, int, int, int, int]] = []
    gray = _gray(crop)
    tmpl = _gray(template)
    if gray.size < 16 or tmpl.size < 16:
        return hits
    th0, tw0 = tmpl.shape[:2]
    raw: list[tuple[float, int, int, int, int]] = []
    for height in (10, 12, 14, 16, 18):
        width = max(8, int(tw0 * height / max(th0, 1)))
        if gray.shape[0] < height or gray.shape[1] < width:
            continue
        resized = cv2.resize(tmpl, (width, height), interpolation=cv2.INTER_AREA)
        result = cv2.matchTemplate(gray, resized, cv2.TM_CCOEFF_NORMED)
        ys, xs = np.where(result >= thresh)
        for y, x in zip(ys.tolist(), xs.tolist()):
            raw.append((float(result[y, x]), int(y), int(x), height, width))
    raw.sort(reverse=True)
    kept: list[tuple[float, int, int, int, int]] = []
    for hit in raw:
        if any(abs(hit[1] - other[1]) < 8 for other in kept):
            continue
        kept.append(hit)
    return kept


def _strip_fingerprint(crop: np.ndarray) -> tuple[int, ...]:
    if crop.size < 8:
        return ()
    band = hud_text_mask(crop)
    if band.size < 8:
        return ()
    small = cv2.resize(band.astype(np.float32), (32, 6), interpolation=cv2.INTER_AREA)
    return tuple((small.ravel() > 0.12).astype(int).tolist())


def _band_fingerprint(crop: np.ndarray, y: int, height: int) -> tuple[int, ...]:
    y0 = max(0, y)
    y1 = min(crop.shape[0], y + max(height, 6))
    return _strip_fingerprint(crop[y0:y1])


def _victim_fingerprint(crop: np.ndarray, y: int, x: int, height: int, width: int) -> tuple[int, ...]:
    y0 = max(0, y)
    y1 = min(crop.shape[0], y + max(height, 6))
    x0 = min(crop.shape[1], x + width)
    x1 = min(crop.shape[1], x0 + 140)
    return _strip_fingerprint(crop[y0:y1, x0:x1])


def chevron_fingerprints(crop: np.ndarray, gap_min: int = 7) -> list[tuple[int, ...]]:
    prints: list[tuple[int, ...]] = []
    for y0, y1, _ in text_row_spans(hud_text_mask(crop)):
        if _row_has_chevron(crop, y0, y1, gap_min):
            prints.append(_band_fingerprint(crop, y0, y1 - y0))
    return prints


def _fp_close(left: tuple[int, ...], right: tuple[int, ...], max_dist: int = 42) -> bool:
    if not left or not right or len(left) != len(right):
        return False
    return int(np.count_nonzero(np.asarray(left) != np.asarray(right))) <= max_dist


def _fp_distance(left: tuple[int, ...], right: tuple[int, ...]) -> int:
    if not left or not right or len(left) != len(right):
        return 999
    return int(np.count_nonzero(np.asarray(left) != np.asarray(right)))


def _stacked_medal_bands(crop: np.ndarray) -> int:
    rows = text_row_spans(hud_text_mask(crop), min_h=4, max_h=28, min_dens=0.03)
    if not rows:
        return 0
    mid0, mid1 = int(crop.shape[0] * 0.15), int(crop.shape[0] * 0.92)
    return sum(1 for y0, y1, _ in rows if mid0 <= y0 and y1 <= mid1)


def _word_components(crop: np.ndarray, min_width: int) -> tuple[float, int, int]:
    mask = hud_text_mask(crop)
    if not np.any(mask):
        return 0.0, 0, 0
    binary = mask.astype(np.uint8) * 255
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (11, 1))
    joined = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel)
    n_labels, _, stats, _ = cv2.connectedComponentsWithStats(joined)
    strong = 0
    weak = 0
    extras = 0
    area = 0
    for i in range(1, n_labels):
        _x, _y, w, h, a = stats[i]
        ratio = w / max(h, 1)
        if w >= 100 and 8 <= h <= 32 and ratio >= 3.4 and a >= 800:
            strong += 1
            area += int(a)
        elif w >= min_width and 5 <= h <= 28 and ratio >= 2.6 and a >= 180:
            weak += 1
            area += int(a)
        elif h >= 4 and w >= 8 and a >= 20:
            extras += 1
    if strong:
        return float(strong * 3.2 + area / 160.0), strong, weak
    if 1 <= weak <= 3 and extras <= 18:
        return float(weak * 1.4 + area / 140.0), strong, weak
    return 0.0, strong, weak


def medal_features(
    crop: np.ndarray,
    templates: dict[str, np.ndarray] | None = None,
    min_width: int = 48,
    template_thresh: float = 0.70,
) -> MedalFeat:
    word, _strong, _weak = _word_components(crop, min_width)
    red = _red_ratio(crop)
    matches: dict[str, float] = {}
    kind: str | None = None
    tmpl_best = 0.0
    if templates:
        for name, tmpl in templates.items():
            native = int(_gray(tmpl).shape[0])
            heights = sorted({native, native - 1, native + 1, *range(14, 30, 2)})
            score, *_ = _match_multiscale(crop, tmpl, heights)
            matches[name] = score
            if score > tmpl_best:
                tmpl_best = score
                kind = name if score >= template_thresh else kind
        if tmpl_best < template_thresh:
            kind = None
    if kind and tmpl_best >= template_thresh:
        score = max(word, 10.0 * tmpl_best)
    else:
        score = word
        if kind is None and word >= 3.5 and _stacked_medal_bands(crop) >= 2:
            kind = "longshot"
        elif kind is None and word >= 3.5:
            kind = "blindside"
    return MedalFeat(score=score, red=red, kind=kind, template=tmpl_best, matches=matches)


def _signal_fades(values: list[float], idx: int, hold: int, floor: float = 0.4) -> bool:
    if hold <= 0 or idx >= len(values):
        return True
    later = values[min(len(values) - 1, idx + hold)]
    return later < max(1.0, values[idx] * floor)


def classify_screen(frame: np.ndarray, overlay_value: float = 52.0) -> str:
    """Skip scoreboard / deploy-map frames so they cannot mint kills."""
    small = cv2.resize(frame, (320, 180))
    hsv = cv2.cvtColor(small, cv2.COLOR_BGR2HSV)
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    val = float(hsv[:, :, 2].mean())
    sat = float(hsv[:, :, 1].mean())
    mask = hud_text_mask(small)
    left = float(mask[:, :140].mean())
    right = float(mask[:, 180:].mean())
    if val < overlay_value and left > 0.015 and right > 0.015:
        return "scoreboard"
    edges = cv2.Canny(gray, 40, 100)
    if 45 <= val <= 70 and float(edges.mean()) < 40 and sat < 110 and left < 0.02:
        return "map"
    return "gameplay"


def onset_indices(values: list[float], min_delta: float, min_gap: int, persist: int = 1) -> list[int]:
    """Rising edges that stay up. Re-arms after the signal drops so double kills count."""
    if len(values) < 4:
        return []
    arr = np.asarray(values, dtype=np.float64)
    window = max(3, min(8, len(arr) // 6))
    onsets: list[int] = []
    last = -min_gap
    armed = True
    floor = float(np.percentile(arr, 40))
    for i in range(1, len(arr)):
        if not armed:
            if float(arr[i]) <= floor + min_delta * 0.4:
                armed = True
            continue
        prev = float(np.median(arr[max(0, i - window) : i]))
        cur = float(arr[i])
        if cur - prev < min_delta or i - last < min_gap:
            continue
        hold = arr[i : min(len(arr), i + persist + 1)]
        if float(np.mean(hold)) < prev + min_delta * 0.45:
            continue
        onsets.append(i)
        last = i
        armed = False
        floor = prev
    return onsets


def _smooth_counts(values: list[int], window: int = 3) -> list[int]:
    if not values:
        return []
    out: list[int] = []
    for i in range(len(values)):
        chunk = values[max(0, i - window + 1) : i + 1]
        out.append(int(np.median(chunk)))
    return out


def _red_ratio(crop: np.ndarray) -> float:
    if crop.size == 0 or crop.ndim < 3:
        return 0.0
    _b, g, r = cv2.split(crop)
    # Fraction of strongly red HUD pixels (headshot skull / red X), not terrain.
    strong = (r > 140) & (r.astype(np.int16) > g.astype(np.int16) + 25) & (
        r.astype(np.int16) > _b.astype(np.int16) + 25
    )
    return float(np.mean(strong))


def _saturation(frame: np.ndarray) -> float:
    hsv = cv2.cvtColor(cv2.resize(frame, (160, 90)), cv2.COLOR_BGR2HSV)
    return float(np.mean(hsv[:, :, 1]))


def detect_hud_events(
    path: str,
    preset: str = "bf6",
    sample_fps: float = 4.0,
    frames: list[np.ndarray] | None = None,
    times: list[float] | None = None,
    player_name: str | None = None,
    name_template: np.ndarray | None = None,
    medal_templates: dict[str, np.ndarray] | None = None,
) -> tuple[list[Event], dict[str, Any], list[float], list[np.ndarray]]:
    cfg = hud_config().get("detection", {})
    regions = load_regions(preset)
    stream = sample_hud_stream(path, sample_fps, regions, frames=frames, times=times)
    times = stream["times"]
    min_gap = max(2, int(round((cfg.get("min_event_gap", 0.55) * sample_fps))))
    events: list[Event] = []
    _ = player_name

    overlay_value = float(cfg.get("overlay_value", 52))
    word_min = int(cfg.get("medal_word_min_width", 48))
    ignore_lead = float(cfg.get("ignore_lead_s", 0.5))
    medal_thresh = float(cfg.get("medal_template", 0.70))

    kinds: list[str] = []
    screens: list[str] = []
    medal_scores: list[float] = []
    medal_reds: list[float] = []
    medal_kinds: list[str | None] = []
    longshot_scores: list[float] = []
    blindside_scores: list[float] = []
    hit_scores: list[float] = []
    hit_reds: list[float] = []
    death_scores: list[float] = []
    prev_preview: np.ndarray | None = None
    source_frames = frames

    for idx, preview in enumerate(stream["previews"]):
        still = is_still(prev_preview, preview)
        prev_preview = preview
        if source_frames is not None and idx < len(source_frames):
            kind = classify_screen(source_frames[idx], overlay_value)
        else:
            kind = classify_screen(preview, overlay_value)
        screens.append(kind)
        if still:
            kind = "overlay"
        kinds.append(kind)
        if kind != "gameplay":
            medal_scores.append(0.0)
            medal_reds.append(0.0)
            medal_kinds.append(None)
            longshot_scores.append(0.0)
            blindside_scores.append(0.0)
            hit_scores.append(0.0)
            hit_reds.append(0.0)
            death_scores.append(0.0)
            continue
        feat = medal_features(
            stream["medals"][idx],
            templates=medal_templates,
            min_width=word_min,
            template_thresh=medal_thresh,
        )
        medal_scores.append(feat.score)
        medal_reds.append(feat.red)
        medal_kinds.append(feat.kind)
        ls = feat.matches.get("longshot", 0.0)
        bs = feat.matches.get("blindside", 0.0)
        if ls >= medal_thresh and ls >= bs:
            longshot_scores.append(10.0)
            blindside_scores.append(0.0)
        elif bs >= medal_thresh:
            longshot_scores.append(0.0)
            blindside_scores.append(10.0)
        else:
            longshot_scores.append(0.0)
            blindside_scores.append(0.0)
        crop = stream["hit"][idx]
        gray = _gray(crop)
        edges = cv2.Canny(gray, 80, 170) if gray.size > 4 else np.zeros((1, 1), dtype=np.uint8)
        hit_scores.append(float(np.mean(edges) + np.percentile(gray, 92) * 0.08) if gray.size > 4 else 0.0)
        hit_reds.append(_red_ratio(crop))
        death_scores.append(medal_word_score(stream["death"][idx], 36)[0])

    active = [screen != "scoreboard" for screen in screens]
    for t, kind, meta in read_feed(
        stream["feed"],
        times,
        active,
        name_template=name_template,
        ignore_lead=ignore_lead,
        refractory=float(cfg.get("feed_refractory", 1.3)),
        identity_ttl=float(cfg.get("identity_ttl", 14.0)),
    ):
        events.append(
            Event(
                id=_event_id(kind, t),
                time=round(t, 3),
                type=kind,  # type: ignore[arg-type]
                confidence=0.86,
                source="kill_feed_right",
                meta=meta,
            )
        )

    def _template_medal(series: list[float], forced_kind: str) -> None:
        for idx in onset_indices(
            series or [0.0],
            4.0,
            min_gap,
            persist=max(1, int(round(0.2 * sample_fps))),
        ):
            t = times[idx]
            if t < ignore_lead or kinds[idx] != "gameplay":
                continue
            if not any(e.type == "kill" and abs(e.time - t) < 1.0 for e in events):
                continue
            _emit_or_attach_medal(events, t, max(medal_scores[idx], 10.0), medal_reds[idx], forced_kind)

    def _word_attach() -> None:
        onset = cfg.get("medal_onset", 1.6)
        for idx in onset_indices(
            medal_scores or [0.0],
            onset,
            min_gap,
            persist=max(1, int(round(0.25 * sample_fps))),
        ):
            t = times[idx]
            if t < ignore_lead or kinds[idx] != "gameplay":
                continue
            if medal_scores[idx] < onset:
                continue
            near_kill = any(e.type == "kill" and abs(e.time - t) < 1.0 for e in events)
            if not near_kill:
                continue
            kind = "headshot" if medal_reds[idx] >= 0.012 else None
            _emit_or_attach_medal(events, t, medal_scores[idx], medal_reds[idx], kind)

    _template_medal(longshot_scores, "longshot")
    _template_medal(blindside_scores, "blindside")
    _word_attach()

    if hit_scores:
        for idx in peak_indices(hit_scores, cfg.get("hit_marker_z", 2.8), max(1, min_gap - 1)):
            t = times[idx]
            if kinds[idx] != "gameplay":
                continue
            near_kill = any(e.type == "kill" and abs(e.time - t) <= 0.85 for e in events)
            if not near_kill:
                continue
            red = hit_reds[idx] if idx < len(hit_reds) else 0.0
            headshot = red >= cfg.get("headshot_red_ratio", 0.012)
            events.append(
                Event(
                    id=_event_id("hit", t),
                    time=round(t, 3),
                    type="hit_marker",
                    confidence=round(min(0.9, 0.58 + hit_scores[idx] / 80.0), 3),
                    source="hit_marker",
                    meta={"headshot": headshot},
                )
            )
            if headshot and not any(e.type == "headshot" and abs(e.time - t) < 0.6 for e in events):
                events.append(
                    Event(
                        id=_event_id("hs", t),
                        time=round(t, 3),
                        type="headshot",
                        confidence=0.8,
                        source="hit_marker",
                        meta={},
                    )
                )

    scores = [medal_word_score(crop, 28)[0] for crop in stream["score"]]
    for idx in onset_indices(scores, 1.4, min_gap, persist=1):
        t = times[idx]
        if kinds[idx] != "gameplay":
            continue
        if any(e.type in {"kill", "score"} and abs(e.time - t) < 0.6 for e in events):
            continue
        events.append(
            Event(
                id=_event_id("score", t),
                time=round(t, 3),
                type="score",
                confidence=0.68,
                source="score_popup",
            )
        )

    events.sort(key=lambda e: (e.time, e.type))
    cal = stream["cal_frame"]
    aux = {"scene_hists": stream["scene_hists"], "cal_frame": cal}
    return events, aux, times, [cal] if cal is not None else []


def draw_calibration(frame: np.ndarray, preset: str = "bf6") -> np.ndarray:
    overlay = frame.copy()
    colors = {
        "kill_feed": (0, 165, 255),
        "medals": (0, 220, 255),
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
