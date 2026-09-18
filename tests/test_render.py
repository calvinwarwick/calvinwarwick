from pathlib import Path

from bfclips.config import Settings
from bfclips.pipeline.editor import build_edit
from bfclips.pipeline.render import atempo_filters, build_plan, escape_drawtext, map_after_slowmo
from bfclips.schemas import Event, EventsDocument, SourceInfo


def test_atempo_chains_below_half_speed():
    filt = atempo_filters(0.42)
    assert "atempo=0.5" in filt
    assert filt.count("atempo") >= 2


def test_drawtext_escapes_colon():
    assert "\\:" in escape_drawtext("TIME 01:23")


def test_slowmo_time_remap():
    assert map_after_slowmo(5, 6, 8, 0.5) == 5
    assert abs(map_after_slowmo(7, 6, 8, 0.5) - 8) < 1e-6


def test_render_plan_emits_youtube_shorts_and_clips(tmp_path: Path):
    events = EventsDocument(
        source=SourceInfo(path="in.mp4", duration=30, width=1280, height=720, fps=30, audio=True),
        events=[
            Event(id="k1", time=5.0, type="kill", confidence=0.9),
            Event(id="k2", time=6.5, type="kill", confidence=0.9),
        ],
    )
    edit = build_edit(events)
    settings = Settings(ffmpeg_preset="ultrafast", ffmpeg_crf=32)
    plan = build_plan(
        Path("in.mp4"),
        events,
        edit,
        tmp_path / "out",
        tmp_path / "work",
        ["youtube", "shorts", "clips"],
        settings,
        "demo",
    )
    names = [step.name for step in plan.steps]
    assert any(name.startswith("cut-") for name in names)
    assert any(name.startswith("style-") for name in names)
    assert "youtube-concat" in names
    assert any(name.startswith("short-") for name in names)
    assert plan.outputs["youtube"]
    assert plan.outputs["clips"]
    joined = " ".join(" ".join(step.cmd) for step in plan.steps)
    assert "drawtext" in joined or "overlay" in joined
