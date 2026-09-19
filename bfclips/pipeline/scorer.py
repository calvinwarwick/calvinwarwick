from __future__ import annotations

from dataclasses import dataclass, field

from bfclips.config import scoring_config
from bfclips.schemas import Event, TranscriptWord


@dataclass
class Cluster:
    kills: list[Event]
    extras: list[Event] = field(default_factory=list)
    score: float = 0.0
    reason: str = ""
    caption: str = ""


def cluster_kills(events: list[Event], gap: float) -> list[list[Event]]:
    kills = [e for e in events if e.type == "kill"]
    if not kills:
        return []
    groups: list[list[Event]] = [[kills[0]]]
    for kill in kills[1:]:
        if kill.time - groups[-1][-1].time <= gap:
            groups[-1].append(kill)
        else:
            groups.append([kill])
    return groups


def nearby(events: list[Event], start: float, end: float) -> list[Event]:
    return [e for e in events if start <= e.time <= end]


def score_cluster(
    kills: list[Event],
    events: list[Event],
    transcript: list[TranscriptWord],
    weights: dict | None = None,
) -> Cluster:
    cfg = scoring_config()
    weights = weights or cfg["weights"]
    windows = cfg["windows"]
    cluster = Cluster(kills=kills)
    first, last = kills[0].time, kills[-1].time
    extras = nearby(events, first - windows["nearby_pad"], last + windows["nearby_pad"])
    cluster.extras = [e for e in extras if e.id not in {k.id for k in kills}]

    score = 0.0
    reasons: list[str] = []
    score += weights["kill"] * len(kills)
    if len(kills) == 1:
        reasons.append("kill")
    elif len(kills) == 2:
        reasons.append("double kill")
    elif len(kills) == 3:
        reasons.append("triple kill")
    else:
        reasons.append(f"{len(kills)}-kill streak")

    if any(k.meta.get("headshot") for k in kills) or any(e.type == "headshot" for e in extras):
        score += weights["headshot"]
        reasons.append("headshot")
    if any(k.meta.get("longshot") or k.meta.get("kind") == "longshot" for k in kills) or any(
        e.type == "longshot" for e in extras
    ):
        score += weights.get("longshot", 15)
        reasons.append("longshot")
    if any(k.meta.get("blindside") or k.meta.get("kind") == "blindside" for k in kills) or any(
        e.type == "blindside" for e in extras
    ):
        score += weights.get("blindside", 12)
        reasons.append("blindside")

    if len(kills) >= 2 and kills[1].time - kills[0].time <= weights["second_kill_within_s"]["window"]:
        score += weights["second_kill_within_s"]["points"]
    if len(kills) >= 3 and kills[2].time - kills[0].time <= weights["third_kill_within_s"]["window"]:
        score += weights["third_kill_within_s"]["points"]

    if any(e.type == "vehicle_destroyed" for e in extras):
        score += weights["vehicle_destroyed"]
        reasons.append("vehicle destroyed")
    if any(e.type == "explosion" for e in extras):
        score += weights["explosion"]
        reasons.append("explosion")
    if any(e.type in {"audio_peak", "weapon_fire"} and e.meta.get("energy", 0) >= 0.12 for e in extras):
        score += weights["large_audio_transient"]

    if any(e.type == "reaction" for e in extras) or _reaction_in_window(
        transcript, first - 1.0, last + 2.5, cfg.get("reactions", [])
    ):
        score += weights["reaction_line"]
        reasons.append("reaction")

    if any(e.type == "death" for e in extras):
        score += weights["death"]
        reasons.append("died after")

    # Idle penalty is applied at timeline level, not here.

    cluster.score = max(0.0, score)
    cluster.reason = _join_reason(reasons)
    cluster.caption = _caption(kills, reasons)
    return cluster


def _reaction_in_window(
    transcript: list[TranscriptWord], start: float, end: float, phrases: list[str]
) -> bool:
    text = " ".join(w.text for w in transcript if start <= w.start <= end).lower()
    return any(str(p).lower() in text for p in phrases)


def _join_reason(parts: list[str]) -> str:
    if not parts:
        return "action"
    if len(parts) == 1:
        return parts[0]
    return parts[0] + " + " + ", ".join(parts[1:])


def _caption(kills: list[Event], reasons: list[str]) -> str:
    n = len(kills)
    if n >= 4:
        label = f"{n} KILL STREAK"
    elif n == 3:
        label = "TRIPLE KILL"
    elif n == 2:
        label = "DOUBLE KILL"
    elif "longshot" in reasons:
        label = "LONGSHOT HEADSHOT" if "headshot" in reasons else "LONGSHOT"
    elif "blindside" in reasons:
        label = "BLINDSIDE"
    elif "headshot" in reasons:
        label = "HEADSHOT"
    else:
        label = "ENEMY DOWN"
    if "vehicle destroyed" in reasons:
        label = "VEHICLE DOWN"
    if "explosion" in reasons and n >= 2:
        label = label + " / BOOM"
    return label


def merge_overlapping(clusters: list[Cluster], overlap: float) -> list[Cluster]:
    if not clusters:
        return []
    ordered = sorted(clusters, key=lambda c: c.kills[0].time)
    merged: list[Cluster] = [ordered[0]]
    for cluster in ordered[1:]:
        prev = merged[-1]
        prev_end = prev.kills[-1].time
        if cluster.kills[0].time - prev_end <= overlap:
            prev.kills.extend(cluster.kills)
            prev.extras.extend(cluster.extras)
            prev.score = max(prev.score, cluster.score) + 8
            prev.reason = _join_reason(
                [p.strip() for p in (prev.reason + " + " + cluster.reason).split("+") if p.strip()]
            )
            prev.caption = _caption(prev.kills, [prev.reason])
        else:
            merged.append(cluster)
    return merged
