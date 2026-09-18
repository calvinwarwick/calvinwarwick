from bfclips.pipeline.editor import build_edit
from bfclips.pipeline.scorer import cluster_kills, score_cluster
from bfclips.schemas import Event, EventsDocument, SourceInfo, TranscriptWord


def ev(time: float, type_: str, **meta) -> Event:
    return Event(
        id=f"{type_}_{int(time * 1000)}",
        time=time,
        type=type_,  # type: ignore[arg-type]
        confidence=0.9,
        meta=meta,
    )


def test_edit_clip_keeps_every_in_window_event():
    events = [
        ev(3.0, "kill"),
        ev(3.1, "hit_marker"),
        ev(3.2, "explosion"),
        ev(3.4, "score"),
        ev(20.0, "audio_peak"),
    ]
    doc = EventsDocument(
        source=SourceInfo(path="x.mp4", duration=24.0, width=1280, height=720, fps=30),
        events=events,
    )
    edit = build_edit(doc)
    assert edit.clips
    clip = edit.clips[0]
    window = [event for event in events if clip.start <= event.time <= clip.end]
    assert {event.id for event in window} == set(clip.event_ids)
    assert "hit_marker_3100" in clip.event_ids
    assert "audio_peak_20000" not in clip.event_ids


def test_double_kill_clusters_and_scores_higher_than_single():
    events = [ev(18.42, "kill"), ev(21.16, "kill"), ev(22.83, "explosion")]
    groups = cluster_kills(events, gap=6.0)
    assert len(groups) == 1
    assert len(groups[0]) == 2
    cluster = score_cluster(groups[0], events, [])
    assert cluster.score >= 20 + 20 + 25 + 12
    assert "double" in cluster.reason or "kill" in cluster.reason
    assert cluster.caption.startswith("DOUBLE")


def test_reaction_line_adds_points():
    events = [ev(10.0, "kill"), ev(10.4, "reaction", text="oh my god")]
    cluster = score_cluster([events[0]], events, [])
    assert cluster.score >= 40
    assert "reaction" in cluster.reason


def test_transcript_reaction_without_event():
    events = [ev(10.0, "kill")]
    words = [TranscriptWord(start=10.2, end=11.0, text="oh my god")]
    cluster = score_cluster(events, events, words)
    assert cluster.score >= 40


def test_editor_builds_zoom_and_slowmo():
    doc = EventsDocument(
        source=SourceInfo(path="x.mp4", duration=60, width=1920, height=1080, fps=60),
        events=[
            ev(18.42, "kill"),
            ev(21.16, "kill"),
            ev(22.83, "explosion"),
        ],
    )
    edit = build_edit(doc)
    assert edit.clips
    top = edit.clips[0]
    assert top.start < 18.42 < top.end
    kinds = {e.type for e in top.effects}
    assert "zoom" in kinds
    assert "slowmo" in kinds
    assert top.kill_count == 2
