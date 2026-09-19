from __future__ import annotations

import json
from pathlib import Path

from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session

from bfclips.config import get_settings
from bfclips.db import get_session, init_db, session_factory
from bfclips.models import Job, SettingRow
from bfclips.pipeline.sample import generate_sample
from bfclips.schemas import (
    ClipPatch,
    EditDocument,
    FeedbackIn,
    JobCreate,
    RenderRequest,
    SettingsOut,
    SettingsUpdate,
    TimelineOptions,
)
from bfclips.services.jobs import (
    create_job_from_path,
    job_output_dir,
    job_work_dir,
    patch_clip,
    record_feedback,
    run_pipeline,
    run_render,
    serialize_job,
    spawn,
)
from bfclips.services.ollama import ollama_ready
from bfclips.services.watcher import watch_service


app = FastAPI(title="BF Auto Editor", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup() -> None:
    settings = get_settings()
    settings.ensure_dirs()
    init_db()
    watch_service.start(settings.incoming_dir)


@app.get("/api/health")
def health() -> dict:
    settings = get_settings()
    return {
        "ok": True,
        "incoming": str(settings.incoming_dir),
        "watch": watch_service.running,
        "ollama": ollama_ready(settings.ollama_url) if settings.ollama_enabled else False,
        "whisper": settings.whisper_enabled,
        "gpu": settings.whisper_device,
    }


@app.get("/api/settings", response_model=SettingsOut)
def read_settings() -> SettingsOut:
    s = get_settings()
    return SettingsOut(
        incoming_dir=str(s.incoming_dir),
        output_dir=str(s.output_dir),
        hud_preset=s.hud_preset,
        player_name=s.player_name,
        ollama_url=s.ollama_url,
        ollama_model=s.ollama_model,
        ollama_enabled=s.ollama_enabled,
        whisper_model=s.whisper_model,
        whisper_device=s.whisper_device,
        whisper_enabled=s.whisper_enabled,
        sample_fps=s.sample_fps,
        ffmpeg_preset=s.ffmpeg_preset,
        ffmpeg_crf=s.ffmpeg_crf,
    )


@app.put("/api/settings", response_model=SettingsOut)
def update_settings(payload: SettingsUpdate, session: Session = Depends(get_session)) -> SettingsOut:
    settings = get_settings()
    data = payload.model_dump(exclude_none=True)
    for key, value in data.items():
        setattr(settings, key, type(getattr(settings, key))(value) if value is not None else value)
        session.merge(SettingRow(key=key, value=str(value)))
    if "incoming_dir" in data:
        settings.incoming_dir = Path(data["incoming_dir"])
        settings.incoming_dir.mkdir(parents=True, exist_ok=True)
        watch_service.stop()
        watch_service.start(settings.incoming_dir)
    settings.ensure_dirs()
    return read_settings()


@app.get("/api/jobs")
def list_jobs(session: Session = Depends(get_session)) -> list[dict]:
    jobs = session.query(Job).order_by(Job.created_at.desc()).all()
    return [serialize_job(job) for job in jobs]


@app.post("/api/jobs")
def create_job(payload: JobCreate, session: Session = Depends(get_session)) -> dict:
    if not payload.path:
        raise HTTPException(400, "Provide a source path or upload a file")
    try:
        job = create_job_from_path(session, Path(payload.path), copy_into_work=False)
    except Exception as exc:
        raise HTTPException(400, str(exc)) from exc
    if payload.auto_analyze:
        spawn(session_factory(), job.id, run_pipeline)
    return serialize_job(job)


@app.post("/api/jobs/upload")
async def upload_job(
    file: UploadFile = File(...),
    session: Session = Depends(get_session),
) -> dict:
    settings = get_settings()
    dest = settings.incoming_dir / (file.filename or "upload.mp4")
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(await file.read())
    job = create_job_from_path(session, dest, copy_into_work=False, reuse_recent=True)
    if job.status == "queued":
        spawn(session_factory(), job.id, run_pipeline)
    return serialize_job(job)


@app.post("/api/jobs/sample")
def create_sample(session: Session = Depends(get_session)) -> dict:
    settings = get_settings()
    dest = settings.work_dir / "sample_battlefield.mp4"
    generate_sample(dest)
    job = create_job_from_path(session, dest, copy_into_work=False)
    spawn(session_factory(), job.id, run_pipeline)
    return serialize_job(job)


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str, session: Session = Depends(get_session)) -> dict:
    job = session.get(Job, job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return serialize_job(job)


@app.get("/api/jobs/{job_id}/events")
def get_events(job_id: str, session: Session = Depends(get_session)) -> dict:
    job = session.get(Job, job_id)
    if not job or not job.events_json:
        raise HTTPException(404, "No events yet")
    return json.loads(job.events_json)


@app.get("/api/jobs/{job_id}/edit")
def get_edit(job_id: str, session: Session = Depends(get_session)) -> dict:
    job = session.get(Job, job_id)
    if not job or not job.edit_json:
        raise HTTPException(404, "No edit yet")
    return json.loads(job.edit_json)


@app.patch("/api/jobs/{job_id}/clips/{clip_id}")
def update_clip(
    job_id: str,
    clip_id: str,
    payload: ClipPatch,
    session: Session = Depends(get_session),
) -> dict:
    try:
        job = patch_clip(
            session,
            job_id,
            clip_id,
            enabled=payload.enabled,
            score=payload.score,
            reason=payload.reason,
            caption=payload.caption,
        )
    except Exception as exc:
        raise HTTPException(400, str(exc)) from exc
    return serialize_job(job)


@app.post("/api/jobs/{job_id}/feedback")
def feedback(job_id: str, payload: FeedbackIn, session: Session = Depends(get_session)) -> dict:
    try:
        row = record_feedback(session, job_id, payload)
    except Exception as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"id": row.id, "approved": row.approved, "clip_id": row.clip_id}


@app.post("/api/jobs/{job_id}/render")
def render(job_id: str, payload: RenderRequest, session: Session = Depends(get_session)) -> dict:
    job = session.get(Job, job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    if job.edit_json:
        edit = EditDocument.model_validate_json(job.edit_json)
        edit.timeline = TimelineOptions(
            auto_captions=payload.auto_captions,
            punch_in=payload.punch_in,
            remove_dead_time=payload.remove_dead_time,
            audio_enhance=payload.audio_enhance,
        )
        job.edit_json = edit.model_dump_json()
        job.status = "rendering"
        job.stage = "render"
        job.progress = 0.02
        session.commit()

    def _run(db: Session, jid: str) -> None:
        run_render(db, jid, payload)

    spawn(session_factory(), job_id, _run)
    session.refresh(job)
    return serialize_job(job)


@app.get("/api/jobs/{job_id}/source")
def source_file(job_id: str, session: Session = Depends(get_session)) -> FileResponse:
    job = session.get(Job, job_id)
    if not job or not Path(job.source_path).exists():
        raise HTTPException(404, "Source missing")
    return FileResponse(job.source_path, media_type="video/mp4", filename=job.filename)


@app.get("/api/jobs/{job_id}/calibration")
def calibration(job_id: str) -> FileResponse:
    path = job_work_dir(job_id) / "hud_calibration.jpg"
    if not path.exists():
        raise HTTPException(404, "Calibration overlay not ready")
    return FileResponse(path, media_type="image/jpeg")


@app.get("/api/jobs/{job_id}/file")
def output_file(job_id: str, path: str, session: Session = Depends(get_session)) -> FileResponse:
    job = session.get(Job, job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    root = job_output_dir(job).resolve()
    target = Path(path).resolve()
    if not str(target).startswith(str(root)) or not target.exists():
        raise HTTPException(404, "File not found")
    return FileResponse(target)


frontend_dist = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if frontend_dist.exists():
    app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="ui")
