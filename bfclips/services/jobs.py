from __future__ import annotations

import json
import shutil
import threading
import uuid
from datetime import datetime
from pathlib import Path

from sqlalchemy.orm import Session

from bfclips.config import Settings, get_settings
from bfclips.models import ClipRow, Feedback, Job
from bfclips.pipeline.analyze import analyze_video
from bfclips.pipeline.editor import build_edit
from bfclips.pipeline.render import render_job
from bfclips.schemas import (
    ClipDecision,
    EditDocument,
    EventsDocument,
    FeedbackIn,
    RenderRequest,
    TimelineOptions,
)
from bfclips.services.ollama import ollama_ready


VIDEO_SUFFIXES = {".mp4", ".mov", ".mkv", ".avi", ".m4v", ".webm"}


class JobError(RuntimeError):
    pass


def job_work_dir(job_id: str, settings: Settings | None = None) -> Path:
    settings = settings or get_settings()
    path = settings.work_dir / job_id
    path.mkdir(parents=True, exist_ok=True)
    return path


def job_output_dir(job: Job, settings: Settings | None = None) -> Path:
    settings = settings or get_settings()
    stem = Path(job.filename).stem
    path = settings.output_dir / stem
    path.mkdir(parents=True, exist_ok=True)
    return path


def existing_job_for_path(session: Session, source: Path, recent_s: float = 90.0) -> Job | None:
    path = str(source.expanduser().resolve())
    job = (
        session.query(Job)
        .filter(Job.source_path == path)
        .order_by(Job.created_at.desc())
        .first()
    )
    if not job or not job.created_at:
        return None
    age = (datetime.utcnow() - job.created_at).total_seconds()
    if age <= recent_s:
        return job
    return None


def create_job_from_path(
    session: Session,
    source: Path,
    copy_into_work: bool = False,
    reuse_recent: bool = False,
) -> Job:
    settings = get_settings()
    source = source.expanduser().resolve()
    if not source.exists():
        raise JobError(f"File not found: {source}")
    if source.suffix.lower() not in VIDEO_SUFFIXES:
        raise JobError(f"Unsupported video type: {source.suffix}")
    if reuse_recent:
        found = existing_job_for_path(session, source)
        if found:
            return found
    job_id = uuid.uuid4().hex[:12]
    dest = source
    if copy_into_work:
        dest = job_work_dir(job_id, settings) / source.name
        shutil.copy2(source, dest)
    job = Job(
        id=job_id,
        filename=source.name,
        source_path=str(dest),
        status="queued",
        stage="queued",
    )
    session.add(job)
    session.commit()
    session.refresh(job)
    return job


def serialize_job(job: Job) -> dict:
    clips = []
    if job.edit_json:
        edit = EditDocument.model_validate_json(job.edit_json)
        clips = [c.model_dump() for c in edit.clips]
    outputs = json.loads(job.outputs_json) if job.outputs_json else {}
    notes = []
    if job.events_json:
        notes = EventsDocument.model_validate_json(job.events_json).notes
    return {
        "id": job.id,
        "filename": job.filename,
        "source_path": job.source_path,
        "status": job.status,
        "stage": job.stage,
        "progress": job.progress,
        "error": job.error,
        "duration": job.duration,
        "width": job.width,
        "height": job.height,
        "fps": job.fps,
        "clips": clips,
        "outputs": outputs,
        "notes": notes,
        "created_at": job.created_at.isoformat() if job.created_at else None,
        "updated_at": job.updated_at.isoformat() if job.updated_at else None,
    }


def _touch(session: Session, job: Job, **fields) -> None:
    for key, value in fields.items():
        setattr(job, key, value)
    job.updated_at = datetime.utcnow()
    session.add(job)
    session.commit()


def run_analysis(session: Session, job_id: str) -> Job:
    settings = get_settings()
    job = session.get(Job, job_id)
    if not job:
        raise JobError("Job not found")
    work = job_work_dir(job.id, settings)

    def progress(value: float, stage: str) -> None:
        _touch(session, job, progress=value, stage=stage, status="analysing")

    _touch(session, job, status="analysing", stage="start", progress=0.02, error=None)
    try:
        doc = analyze_video(Path(job.source_path), work, settings, progress)
    except Exception as exc:
        _touch(session, job, status="error", stage="analyse-failed", error=str(exc))
        raise
    _touch(
        session,
        job,
        events_json=doc.model_dump_json(),
        duration=doc.source.duration,
        width=doc.source.width,
        height=doc.source.height,
        fps=doc.source.fps,
        status="analysed",
        stage="analysed",
        progress=1.0,
    )
    return job


def run_edit(session: Session, job_id: str, options: TimelineOptions | None = None) -> Job:
    settings = get_settings()
    job = session.get(Job, job_id)
    if not job or not job.events_json:
        raise JobError("Analyse the job before editing")
    events = EventsDocument.model_validate_json(job.events_json)
    use_llm = settings.ollama_enabled and ollama_ready(settings.ollama_url)
    edit = build_edit(
        events,
        options or TimelineOptions(),
        use_ollama=use_llm,
        ollama_url=settings.ollama_url,
        ollama_model=settings.ollama_model,
    )
    job.clips.clear()
    for clip in edit.clips:
        job.clips.append(_clip_row(job.id, clip))
    _touch(
        session,
        job,
        edit_json=edit.model_dump_json(),
        status="ready",
        stage="ready",
        progress=1.0,
    )
    return job


def run_pipeline(session: Session, job_id: str) -> Job:
    run_analysis(session, job_id)
    return run_edit(session, job_id)


def patch_clip(session: Session, job_id: str, clip_id: str, enabled: bool | None = None, **fields) -> Job:
    job = session.get(Job, job_id)
    if not job or not job.edit_json:
        raise JobError("Job has no edit yet")
    edit = EditDocument.model_validate_json(job.edit_json)
    found = next((c for c in edit.clips if c.id == clip_id), None)
    if not found:
        raise JobError("Clip not found")
    if enabled is not None:
        found.enabled = enabled
    for key, value in fields.items():
        if value is not None and hasattr(found, key):
            setattr(found, key, value)
    row = next((c for c in job.clips if c.id == clip_id), None)
    if row:
        row.enabled = found.enabled
        row.score = found.score
        row.reason = found.reason
        row.caption = found.caption
    _touch(session, job, edit_json=edit.model_dump_json(), status="ready", stage="ready")
    return job


def run_render(session: Session, job_id: str, request: RenderRequest) -> Job:
    settings = get_settings()
    job = session.get(Job, job_id)
    if not job or not job.events_json or not job.edit_json:
        raise JobError("Analyse and edit before rendering")
    events = EventsDocument.model_validate_json(job.events_json)
    edit = EditDocument.model_validate_json(job.edit_json)
    edit.timeline.auto_captions = request.auto_captions
    edit.timeline.punch_in = request.punch_in
    edit.timeline.remove_dead_time = request.remove_dead_time
    edit.timeline.audio_enhance = request.audio_enhance
    if request.remove_dead_time:
        # Montage already concatenates enabled clips only.
        pass
    _touch(session, job, status="rendering", stage="render", progress=0.05)

    def progress(value: float, stage: str) -> None:
        _touch(session, job, progress=value, stage=stage, status="rendering")

    try:
        outputs = render_job(
            source=Path(job.source_path),
            events=events,
            edit=edit,
            output_dir=job_output_dir(job, settings),
            work_dir=job_work_dir(job.id, settings),
            targets=list(request.targets),
            settings=settings,
            stem=Path(job.filename).stem,
            progress=progress,
        )
    except Exception as exc:
        _touch(session, job, status="error", stage="render-failed", error=str(exc))
        raise
    meta = {
        "job_id": job.id,
        "filename": job.filename,
        "outputs": outputs,
        "clips": [c.model_dump() for c in edit.clips],
    }
    meta_path = job_output_dir(job, settings) / "metadata.json"
    meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    _touch(
        session,
        job,
        outputs_json=json.dumps(outputs),
        edit_json=edit.model_dump_json(),
        status="done",
        stage="done",
        progress=1.0,
    )
    return job


def record_feedback(session: Session, job_id: str, payload: FeedbackIn) -> Feedback:
    job = session.get(Job, job_id)
    if not job or not job.edit_json:
        raise JobError("Job has no clips")
    edit = EditDocument.model_validate_json(job.edit_json)
    clip = next((c for c in edit.clips if c.id == payload.clip_id), None)
    if not clip:
        raise JobError("Clip not found")
    events = EventsDocument.model_validate_json(job.events_json) if job.events_json else None
    snapshot = {
        "clip": clip.model_dump(),
        "nearby_events": [
            e.model_dump()
            for e in (events.events if events else [])
            if clip.start - 1 <= e.time <= clip.end + 1
        ],
        "transcript": [
            w.model_dump()
            for w in (events.transcript if events else [])
            if clip.start <= w.start <= clip.end
        ],
    }
    row = Feedback(
        job_id=job.id,
        clip_id=clip.id,
        approved=payload.approved,
        notes=payload.notes,
        snapshot_json=json.dumps(snapshot),
    )
    session.add(row)
    clip.enabled = payload.approved
    _touch(session, job, edit_json=edit.model_dump_json())
    return row


def _clip_row(job_id: str, clip: ClipDecision) -> ClipRow:
    return ClipRow(
        id=f"{job_id}_{clip.id}",
        job_id=job_id,
        start=clip.start,
        end=clip.end,
        score=clip.score,
        reason=clip.reason,
        caption=clip.caption,
        enabled=clip.enabled,
        effects_json=json.dumps([e.model_dump() for e in clip.effects]),
        event_ids_json=json.dumps(clip.event_ids),
        kill_count=clip.kill_count,
    )


_lock = threading.Lock()
_threads: dict[str, threading.Thread] = {}


def spawn(session_factory, job_id: str, fn) -> None:
    def runner() -> None:
        session = session_factory()
        try:
            fn(session, job_id)
        finally:
            session.close()
            with _lock:
                _threads.pop(job_id, None)

    with _lock:
        existing = _threads.get(job_id)
        if existing and existing.is_alive():
            return
        thread = threading.Thread(target=runner, name=f"bfclips-{job_id}", daemon=True)
        _threads[job_id] = thread
        thread.start()
