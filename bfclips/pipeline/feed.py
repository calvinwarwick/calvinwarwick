from __future__ import annotations

from dataclasses import dataclass, field

import cv2
import numpy as np


@dataclass
class FeedGrid:
    pitch: int
    phase: int


@dataclass
class RowObs:
    y: int
    fp: tuple[int, ...]
    kind: str | None
    sat_left: float
    sat_right: float
    name_x: int = -1
    name_score: float = 0.0


@dataclass
class SlotTrack:
    fp: tuple[int, ...]
    first_t: float
    last_t: float
    y: int
    name_x: int = -1
    stacked: bool = False
    votes: dict[str, int] = field(default_factory=lambda: {"kill": 0, "death": 0, "other": 0})
    emitted: bool = False


def tophat_mask(crop: np.ndarray) -> np.ndarray:
    """Glyph strokes independent of bright sky / walls."""
    if crop.size < 16:
        return np.zeros(crop.shape[:2], dtype=bool)
    gray = crop if crop.ndim == 2 else cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (17, 3))
    hat = cv2.morphologyEx(gray, cv2.MORPH_TOPHAT, kernel)
    high = cv2.subtract(gray, cv2.GaussianBlur(gray, (9, 9), 0))
    mask = (hat >= 36) & (high >= 14) & (gray >= 145)
    if crop.ndim == 3:
        red_hat = cv2.morphologyEx(crop[:, :, 2], cv2.MORPH_TOPHAT, kernel)
        mask = mask | ((red_hat >= 40) & (crop[:, :, 2] >= 150))
    return mask


def is_still(prev: np.ndarray | None, cur: np.ndarray, thresh: float = 0.55) -> bool:
    if prev is None or prev.size == 0 or cur.size == 0:
        return False
    a = cv2.resize(prev, (64, 36), interpolation=cv2.INTER_AREA).astype(np.float32)
    b = cv2.resize(cur, (64, 36), interpolation=cv2.INTER_AREA).astype(np.float32)
    return float(np.mean(np.abs(a - b))) < thresh


def learn_feed_grid(masks: list[np.ndarray], min_pitch: int = 18, max_pitch: int = 40) -> FeedGrid:
    if not masks:
        return FeedGrid(30, 8)
    height = min(m.shape[0] for m in masks)
    if height < min_pitch * 2:
        energy = np.mean([m[:height].mean(axis=1) for m in masks], axis=0)
        peak = int(np.argmax(energy)) if energy.size else 8
        pitch = max(20, min(36, height if height >= 20 else 28))
        return FeedGrid(pitch, max(0, peak - pitch // 2))
    energy = np.mean([m[:height].mean(axis=1) for m in masks], axis=0)
    centered = energy - float(energy.mean())
    corr = np.correlate(centered, centered, mode="full")
    corr = corr[len(corr) // 2 :]
    lo, hi = min_pitch, min(max_pitch, len(corr) - 1)
    if hi <= lo or energy.max() < 0.008:
        peak = int(np.argmax(energy))
        return FeedGrid(28, max(0, peak - 14))
    pitch = int(lo + np.argmax(corr[lo : hi + 1]))
    best_off, best_score = 0, -1.0
    for offset in range(pitch):
        ys = np.arange(offset, height, pitch)
        score = float(energy[ys].sum())
        if score > best_score:
            best_off, best_score = offset, score
    search = np.arange(best_off, height, pitch)
    if search.size:
        local = int(search[int(np.argmax(energy[search]))])
        phase = max(0, local - pitch // 2)
    else:
        phase = best_off
    return FeedGrid(pitch=pitch, phase=phase)


def _glyph_sat(bgr: np.ndarray, mask: np.ndarray) -> float:
    if bgr.size == 0 or not np.any(mask):
        return 0.0
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    return float(hsv[:, :, 1][mask].mean())


def _glyph_val(bgr: np.ndarray, mask: np.ndarray) -> float:
    if bgr.size == 0 or not np.any(mask):
        return 0.0
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    return float(hsv[:, :, 2][mask].mean())


def _row_fingerprint(mask: np.ndarray) -> tuple[int, ...]:
    if mask.size < 8:
        return ()
    small = cv2.resize(mask.astype(np.float32), (32, 6), interpolation=cv2.INTER_AREA)
    return tuple((small.ravel() > 0.10).astype(int).tolist())


def _fp_dist(left: tuple[int, ...], right: tuple[int, ...]) -> int:
    if not left or not right or len(left) != len(right):
        return 999
    return int(np.count_nonzero(np.asarray(left) != np.asarray(right)))


def _glyph_span(mask: np.ndarray) -> tuple[int, int] | None:
    if mask.size == 0 or not np.any(mask):
        return None
    cols = np.where(mask.any(axis=0))[0]
    if cols.size < 8:
        return None
    return int(cols[0]), int(cols[-1] + 1)


def classify_row(strip: np.ndarray, mask: np.ndarray) -> tuple[str | None, float, float]:
    """Relative sat + side. Desat left = my kill, desat right = my death."""
    if strip.size < 16 or mask.mean() < 0.015:
        return None, 0.0, 0.0
    span = _glyph_span(mask)
    if span is None:
        return None, 0.0, 0.0
    x0, x1 = span
    mid = x0 + max(8, (x1 - x0) // 2)
    left, right = strip[:, x0:mid], strip[:, mid:x1]
    left_m, right_m = mask[:, x0:mid], mask[:, mid:x1]
    if float(left_m.mean()) < 0.012 or float(right_m.mean()) < 0.012:
        return None, 0.0, 0.0
    sat_l = _glyph_sat(left, left_m)
    sat_r = _glyph_sat(right, right_m)
    kind: str | None = None
    if sat_l < sat_r - 15 and sat_l < 55:
        kind = "kill"
    elif sat_r < sat_l - 15 and sat_r < 55:
        kind = "death"
    else:
        val_l = _glyph_val(left, left_m)
        val_r = _glyph_val(right, right_m)
        if val_l > val_r + 25 and sat_l < sat_r:
            kind = "kill"
        elif val_r > val_l + 25 and sat_r < sat_l:
            kind = "death"
    return kind, sat_l, sat_r


def locate_names(
    image: np.ndarray,
    template: np.ndarray | None,
    thresh: float = 0.72,
) -> list[tuple[float, int, int, int, int]]:
    """All name-template hits (score, x, y, w, h), NMS'd by row."""
    if template is None or image.size < 16:
        return []
    gray = image if image.ndim == 2 else cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    tmpl = template if template.ndim == 2 else cv2.cvtColor(template, cv2.COLOR_BGR2GRAY)
    th0, tw0 = tmpl.shape[:2]
    raw: list[tuple[float, int, int, int, int]] = []
    for height in (10, 11, 12, 13, 14, 16, 18):
        width = max(8, int(tw0 * height / max(th0, 1)))
        if gray.shape[0] < height or gray.shape[1] < width:
            continue
        resized = cv2.resize(tmpl, (width, height), interpolation=cv2.INTER_AREA)
        result = cv2.matchTemplate(gray, resized, cv2.TM_CCOEFF_NORMED)
        ys, xs = np.where(result >= thresh)
        for y, x in zip(ys.tolist(), xs.tolist()):
            raw.append((float(result[y, x]), int(x), int(y), width, height))
    raw.sort(key=lambda item: item[0], reverse=True)
    kept: list[tuple[float, int, int, int, int]] = []
    for hit in raw:
        cy = hit[2] + hit[4] / 2
        if any(abs(cy - (k[2] + k[4] / 2)) < 14 and abs(hit[1] - k[1]) < 40 for k in kept):
            continue
        kept.append(hit)
    return kept


def classify_around_name(strip: np.ndarray, x: int, w: int) -> tuple[str | None, float, float]:
    """Partner name sits beside our name: coloured-right = kill, coloured-left = death."""
    gap = 6
    left = strip[:, : max(0, x - gap)]
    right = strip[:, min(strip.shape[1], x + w + gap) :]
    left_m = tophat_mask(left) if left.size >= 16 else np.zeros((1, 1), dtype=bool)
    right_m = tophat_mask(right) if right.size >= 16 else np.zeros((1, 1), dtype=bool)
    dens_l = float(left_m.mean()) if left_m.size else 0.0
    dens_r = float(right_m.mean()) if right_m.size else 0.0
    sat_l = _glyph_sat(left, left_m) if left.size >= 16 else 0.0
    sat_r = _glyph_sat(right, right_m) if right.size >= 16 else 0.0
    if dens_r >= 0.008 and sat_r > sat_l + 8:
        return "kill", sat_l, sat_r
    if dens_l >= 0.008 and sat_l > sat_r + 8:
        return "death", sat_l, sat_r
    if dens_r > dens_l + 0.01:
        return "kill", sat_l, sat_r
    if dens_l > dens_r + 0.01:
        return "death", sat_l, sat_r
    return None, sat_l, sat_r


def confirm_name_side(
    strip: np.ndarray,
    template: np.ndarray | None,
    thresh: float = 0.72,
) -> str | None:
    hits = locate_names(strip, template, thresh=thresh)
    if not hits:
        return None
    score, x, _y, w, _h = hits[0]
    kind, _sl, _sr = classify_around_name(strip, x, w)
    if kind is not None:
        return "left" if kind == "kill" else "right"
    mid = strip.shape[1] // 2
    return "left" if x + w / 2 < mid else "right"


def extract_rows(
    crop: np.ndarray,
    grid: FeedGrid,
    template: np.ndarray | None = None,
) -> list[RowObs]:
    if template is not None:
        return _extract_named_rows(crop, grid, template)
    return _extract_sat_rows(crop, grid)


def _extract_named_rows(crop: np.ndarray, grid: FeedGrid, template: np.ndarray) -> list[RowObs]:
    hits = locate_names(crop, template, thresh=0.72)
    rows: list[RowObs] = []
    for score, x, y, w, h in hits:
        y0 = max(0, y - 4)
        y1 = min(crop.shape[0], y + h + 4)
        strip = crop[y0:y1]
        kind, sat_l, sat_r = classify_around_name(strip, x, w)
        if kind is None:
            continue
        if kind == "kill":
            partner = tophat_mask(strip[:, min(strip.shape[1], x + w) :])
        else:
            partner = tophat_mask(strip[:, : max(0, x)])
        fp = _row_fingerprint(partner)
        if not fp:
            fp = _row_fingerprint(tophat_mask(strip))
        if not fp:
            continue
        rows.append(
            RowObs(
                y=y0,
                fp=fp,
                kind=kind,
                sat_left=sat_l,
                sat_right=sat_r,
                name_x=x,
                name_score=score,
            )
        )
    _ = grid
    return rows


def _extract_sat_rows(crop: np.ndarray, grid: FeedGrid) -> list[RowObs]:
    mask = tophat_mask(crop)
    height = crop.shape[0]
    rows: list[RowObs] = []
    y = grid.phase
    if y > grid.pitch:
        y = y % grid.pitch
    while y < height:
        y0 = max(0, y)
        y1 = min(height, y + grid.pitch)
        y += grid.pitch
        if y1 - y0 < 8:
            continue
        strip = crop[y0:y1]
        band = mask[y0:y1]
        if float(band.mean()) < 0.012:
            continue
        kind, sat_l, sat_r = classify_row(strip, band)
        if kind is None:
            continue
        fp = _row_fingerprint(band)
        if not fp:
            continue
        rows.append(RowObs(y=y0, fp=fp, kind=kind, sat_left=sat_l, sat_right=sat_r))
    return rows


def read_feed(
    crops: list[np.ndarray],
    times: list[float],
    active: list[bool],
    name_template: np.ndarray | None = None,
    ignore_lead: float = 0.5,
    refractory: float = 1.3,
    identity_ttl: float = 14.0,
) -> list[tuple[float, str, dict]]:
    """Return (time, kind, meta) for my kills/deaths."""
    if name_template is not None:
        probes = [crop for crop, on in zip(crops, active) if on and crop.size > 16][::3]
        if not any(locate_names(crop, name_template, thresh=0.72) for crop in probes):
            name_template = None
    masks = [tophat_mask(c) for c, on in zip(crops, active) if on and c.size > 16]
    grid = learn_feed_grid(masks)
    tracks: list[SlotTrack] = []
    events: list[tuple[float, str, dict]] = []
    last_emit: dict[str, float] = {}
    recent: list[tuple[float, tuple[int, ...], str, int]] = []

    def _flush(track: SlotTrack, now: float) -> None:
        del now
        if track.emitted or track.first_t < ignore_lead:
            return
        kind = "kill" if track.votes["kill"] >= track.votes["death"] else "death"
        if track.votes[kind] < 2:
            return
        cool = refractory if kind == "death" else min(0.35, refractory)
        if track.first_t - last_emit.get(kind, -99.0) < cool:
            return
        if name_template is not None and not track.stacked:
            for seen_t, seen_fp, seen_kind, seen_x in recent:
                age = track.first_t - seen_t
                if seen_kind != kind:
                    continue
                same_fp = age <= identity_ttl and _fp_dist(track.fp, seen_fp) <= 36
                same_x = (
                    age <= identity_ttl
                    and track.name_x >= 0
                    and seen_x >= 0
                    and abs(track.name_x - seen_x) <= 24
                )
                if same_fp or same_x:
                    track.emitted = True
                    return
        track.emitted = True
        last_emit[kind] = track.first_t
        recent.append((track.first_t, track.fp, kind, track.name_x))
        events.append(
            (
                track.first_t,
                kind,
                {"source": "kill_feed_right", "votes": dict(track.votes), "grid": grid.pitch},
            )
        )

    for crop, t, on in zip(crops, times, active):
        if not on or crop.size < 16:
            continue
        rows = extract_rows(crop, grid, template=name_template)
        newest = max((row.y for row in rows), default=0)
        leftover_stack = False
        if name_template is not None and rows and recent:
            known = 0
            for row in rows:
                if any(
                    sx >= 0 and abs(row.name_x - sx) <= 24 and t - st <= 24.0
                    for st, _fp, sk, sx in recent
                    if sk == "kill"
                ):
                    known += 1
            leftover_stack = len(rows) >= 2 and known == len(rows)
        claimed: set[int] = set()
        for row in rows:
            match_i = None
            best = 28
            for i, track in enumerate(tracks):
                if i in claimed:
                    continue
                dist = _fp_dist(row.fp, track.fp)
                same_name = (
                    row.name_x >= 0
                    and track.name_x >= 0
                    and abs(row.name_x - track.name_x) <= 24
                    and abs(row.y - track.y) <= 40
                )
                if dist <= best or same_name:
                    if same_name:
                        best = min(best, dist)
                    else:
                        best = dist
                    match_i = i
            if match_i is None:
                # New self-rows spawn at the bottom; leftover names sit higher.
                if name_template is not None and row.y < newest - 8:
                    continue
                if name_template is not None and row.y < crop.shape[0] * 0.35:
                    continue
                # Killcam leftover is a single self-row. A real follow-up kill
                # stacks under the previous name.
                if leftover_stack:
                    continue
                if (
                    name_template is not None
                    and len(rows) < 2
                    and t - last_emit.get("kill", -99.0) < identity_ttl
                ):
                    continue
                track = SlotTrack(
                    fp=row.fp,
                    first_t=t,
                    last_t=t,
                    y=row.y,
                    name_x=row.name_x,
                    stacked=len(rows) >= 2,
                )
                tracks.append(track)
                match_i = len(tracks) - 1
            claimed.add(match_i)
            track = tracks[match_i]
            track.last_t = t
            track.y = row.y
            track.fp = row.fp
            track.name_x = row.name_x
            track.votes[row.kind or "other"] += 1
            if not track.emitted and (track.votes["kill"] >= 2 or track.votes["death"] >= 2):
                _flush(track, t)
        alive = []
        for i, track in enumerate(tracks):
            if i not in claimed:
                _flush(track, t)
            else:
                alive.append(track)
        tracks = alive

    end = times[-1] if times else 0.0
    for track in tracks:
        _flush(track, end + 1.0)
    events.sort(key=lambda item: item[0])
    return events
