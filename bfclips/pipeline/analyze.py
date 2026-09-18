from __future__ import annotations

from pathlib import Path

import cv2

from bfclips.config import Settings, get_settings, scoring_config
from bfclips.pipeline.audio import analyze_audio
from bfclips.pipeline.hud import detect_hud_events, draw_calibration
from bfclips.pipeline.scenes import detect_scene_cuts
from bfclips.pipeline.transcribe import reaction_events, transcribe
from bfclips.schemas import Event, EventsDocument
from bfclips.services.ffmpeg import probe


def analyze_video(
    video_path: Path,
    work_dir: Path,
    settings: Settings | None = None,
    progress=None,
) -> EventsDocument:
    settings = settings or get_settings()
    work_dir.mkdir(parents=True, exist_ok=True)
    _emit(progress, 0.05, "probe")
    source = probe(video_path)

    _emit(progress, 0.15, "hud")
    hud_events, _signals, times, frames = detect_hud_events(
        str(video_path),
        preset=settings.hud_preset,
        sample_fps=settings.sample_fps,
    )

    _emit(progress, 0.45, "scenes")
    scene_events, scenes = detect_scene_cuts(frames, times)

    _emit(progress, 0.55, "audio")
    audio_events, audio_peaks = analyze_audio(video_path, work_dir)

    _emit(progress, 0.7, "speech")
    wav_path = work_dir / "audio.wav"
    words = transcribe(wav_path, settings)
    phrases = scoring_config().get("reactions", [])
    speech_events = reaction_events(words, phrases)

    events = _dedupe(hud_events + scene_events + audio_events + speech_events)
    notes = []
    if not words:
        notes.append("No transcript (Whisper disabled or not installed).")
    if not any(e.type == "kill" for e in events):
        notes.append("No kill-feed spikes found. Check HUD preset / calibration overlay.")

    if frames:
        overlay = draw_calibration(frames[min(len(frames) // 2, len(frames) - 1)], settings.hud_preset)
        cv2.imwrite(str(work_dir / "hud_calibration.jpg"), overlay)

    _emit(progress, 0.95, "write-events")
    doc = EventsDocument(
        source=source,
        events=events,
        transcript=words,
        scenes=scenes,
        audio_peaks=audio_peaks,
        hud_preset=settings.hud_preset,
        notes=notes,
    )
    (work_dir / "events.json").write_text(doc.model_dump_json(indent=2), encoding="utf-8")
    _emit(progress, 1.0, "analysed")
    return doc


def _dedupe(events: list[Event]) -> list[Event]:
    events = sorted(events, key=lambda e: (e.time, e.type))
    kept: list[Event] = []
    for event in events:
        twin = next(
            (
                k
                for k in kept
                if k.type == event.type and abs(k.time - event.time) < 0.28
            ),
            None,
        )
        if twin:
            if event.confidence > twin.confidence:
                kept.remove(twin)
                kept.append(event)
            continue
        kept.append(event)
    return sorted(kept, key=lambda e: (e.time, e.type))


def _emit(progress, value: float, stage: str) -> None:
    if progress:
        progress(value, stage)
