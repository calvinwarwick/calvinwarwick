from pathlib import Path

from fastapi.testclient import TestClient

from bfclips.config import get_settings
from bfclips.db import init_db, reset_engine
from bfclips.main import app
from bfclips.pipeline.sample import generate_sample


def test_health_and_sample_pipeline(tmp_path: Path, monkeypatch):
    settings = get_settings()
    settings.incoming_dir = tmp_path / "incoming"
    settings.output_dir = tmp_path / "output"
    settings.work_dir = tmp_path / "work"
    settings.data_dir = tmp_path / "data"
    settings.db_path = tmp_path / "data" / "test.db"
    settings.whisper_enabled = False
    settings.ollama_enabled = False
    settings.ffmpeg_preset = "ultrafast"
    settings.ffmpeg_crf = 32
    settings.ensure_dirs()
    reset_engine()
    init_db()

    client = TestClient(app)
    health = client.get("/api/health")
    assert health.status_code == 200
    assert health.json()["ok"] is True

    sample = tmp_path / "incoming" / "unit.mp4"
    generate_sample(sample, duration=8.0)
    created = client.post("/api/jobs", json={"path": str(sample), "auto_analyze": False})
    assert created.status_code == 200
    job_id = created.json()["id"]

    from bfclips.db import session_factory
    from bfclips.services.jobs import run_pipeline

    session = session_factory()()
    run_pipeline(session, job_id)
    session.close()

    job = client.get(f"/api/jobs/{job_id}")
    assert job.status_code == 200
    body = job.json()
    assert body["status"] in {"ready", "analysed"}
    assert body["clips"]
    assert any(clip["kill_count"] >= 1 for clip in body["clips"])
