from __future__ import annotations

from bfclips.config import scoring_config
from bfclips.pipeline.scorer import Cluster, cluster_kills, merge_overlapping, score_cluster
from bfclips.schemas import ClipDecision, EditDocument, Effect, EventsDocument, TimelineOptions
from bfclips.services.ollama import enrich_edit


def build_edit(
    events_doc: EventsDocument,
    options: TimelineOptions | None = None,
    use_ollama: bool = False,
    ollama_url: str = "http://127.0.0.1:11434",
    ollama_model: str = "llama3.2-vision",
) -> EditDocument:
    options = options or TimelineOptions()
    cfg = scoring_config()
    windows = cfg["windows"]
    effects_cfg = cfg["effects"]
    groups = cluster_kills(events_doc.events, windows["cluster_gap"])
    clusters = [
        score_cluster(group, events_doc.events, events_doc.transcript) for group in groups
    ]
    clusters = merge_overlapping(clusters, windows["merge_overlap"])

    clips: list[ClipDecision] = []
    duration = events_doc.source.duration
    keep = cfg["thresholds"]["keep_score"]

    for index, cluster in enumerate(clusters, start=1):
        start, end = _window(cluster, windows, duration)
        effects = _effects(cluster, effects_cfg, options)
        clip = ClipDecision(
            id=f"clip_{index:03d}",
            start=round(start, 3),
            end=round(end, 3),
            score=round(cluster.score, 1),
            reason=cluster.reason,
            enabled=cluster.score >= keep,
            effects=effects,
            caption=cluster.caption if options.auto_captions else None,
            event_ids=[e.id for e in cluster.kills],
            kill_count=len(cluster.kills),
        )
        clips.append(clip)

    clips.sort(key=lambda c: c.score, reverse=True)
    # Stable visual order later uses start time for montage if remove_dead_time.
    edit = EditDocument(clips=clips, timeline=options, editor="rules-v1")
    if use_ollama:
        edit = enrich_edit(edit, events_doc, ollama_url, ollama_model)
    return edit


def _window(cluster: Cluster, windows: dict, duration: float) -> tuple[float, float]:
    start = max(0.0, cluster.kills[0].time - windows["pre_roll"])
    end = min(duration, cluster.kills[-1].time + windows["post_roll"])
    extras = cluster.extras
    if extras:
        start = min(start, max(0.0, min(e.time for e in extras) - 1.0))
        end = max(end, min(duration, max(e.time for e in extras) + 1.2))
    length = end - start
    if length < windows["min_clip"]:
        extra = (windows["min_clip"] - length) / 2
        start = max(0.0, start - extra)
        end = min(duration, end + extra)
    if end - start > windows["max_clip"]:
        # Keep the action centred on kills.
        mid = (cluster.kills[0].time + cluster.kills[-1].time) / 2
        start = max(0.0, mid - windows["max_clip"] / 2)
        end = min(duration, start + windows["max_clip"])
    return start, end


def _effects(cluster: Cluster, cfg: dict, options: TimelineOptions) -> list[Effect]:
    effects: list[Effect] = []
    if options.punch_in:
        for kill in cluster.kills:
            effects.append(
                Effect(
                    type="zoom",
                    time=round(kill.time, 3),
                    scale=cfg["zoom_scale"],
                    duration=cfg["zoom_duration"],
                )
            )
    if len(cluster.kills) >= 2:
        last = cluster.kills[-1].time
        boom = next((e.time for e in cluster.extras if e.type == "explosion"), None)
        start = last - cfg["slowmo_pad"]
        end = (boom if boom and boom >= last else last) + cfg["slowmo_pad"] + 0.4
        effects.append(
            Effect(
                type="slowmo",
                start=round(start, 3),
                end=round(end, 3),
                rate=cfg["slowmo_rate"],
            )
        )
    if options.auto_captions and cluster.caption:
        effects.append(
            Effect(
                type="caption",
                time=round(cluster.kills[0].time, 3),
                duration=cfg["caption_hold"],
                text=cluster.caption,
            )
        )
    return effects
