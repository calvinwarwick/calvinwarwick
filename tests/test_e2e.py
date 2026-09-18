from pathlib import Path

from bfclips.config import get_settings
from bfclips.db import init_db, reset_engine, session_factory
from bfclips.pipeline.sample import DEFAULT_KILLS, generate_sample
from bfclips.schemas import EventsDocument, RenderRequest
from bfclips.services.jobs import create_job_from_path, run_pipeline, run_render


def test_sample_clip_detects_kills_and_renders(tmp_path: Path):
    settings = get_settings()
    settings.incoming_dir = tmp_path / "incoming"
    settings.output_dir = tmp_path / "output"
    settings.work_dir = tmp_path / "work"
    settings.data_dir = tmp_path / "data"
    settings.db_path = tmp_path / "data" / "e2e.db"
    settings.whisper_enabled = False
    settings.ollama_enabled = False
    settings.ffmpeg_preset = "ultrafast"
    settings.ffmpeg_crf = 32
    settings.ensure_dirs()
    reset_engine()
    init_db()

    video = tmp_path / "incoming" / "bf6_sample.mp4"
    generate_sample(video, duration=10.0)
    session = session_factory()()
    job = create_job_from_path(session, video)
    run_pipeline(session, job.id)
    session.refresh(job)
    assert job.events_json
    events = EventsDocument.model_validate_json(job.events_json)
    kill_times = [e.time for e in events.events if e.type == "kill"]
    assert len(kill_times) >= 2
    for expected in DEFAULT_KILLS:
        assert any(abs(found - expected) < 0.55 for found in kill_times)

    assert job.edit_json
    run_render(
        session,
        job.id,
        RenderRequest(targets=["clips", "youtube", "shorts"]),
    )
    session.refresh(job)
    assert job.status == "done"
    assert job.outputs_json
    session.close()
    clips_dir = settings.output_dir / "bf6_sample" / "clips"
    assert any(clips_dir.glob("*.mp4"))
    youtube = settings.output_dir / "bf6_sample" / "youtube" / "bf6_sample.mp4"
    assert youtube.exists() and youtube.stat().st_size > 1000
