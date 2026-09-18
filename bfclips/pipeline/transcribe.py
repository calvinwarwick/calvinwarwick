from __future__ import annotations

from pathlib import Path

from bfclips.config import Settings
from bfclips.schemas import Event, TranscriptWord


def transcribe(wav_path: Path, settings: Settings) -> list[TranscriptWord]:
    if not settings.whisper_enabled:
        return []
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        return []
    if not wav_path.exists():
        return []
    device = settings.whisper_device
    try:
        model = WhisperModel(settings.whisper_model, device=device, compute_type="int8")
    except Exception:
        if device != "cpu":
            try:
                model = WhisperModel(settings.whisper_model, device="cpu", compute_type="int8")
            except Exception:
                return []
        else:
            return []
    try:
        segments, _ = model.transcribe(str(wav_path), word_timestamps=True)
    except Exception:
        return []
    words: list[TranscriptWord] = []
    for segment in segments:
        if getattr(segment, "words", None):
            for word in segment.words:
                text = (word.word or "").strip()
                if text:
                    words.append(
                        TranscriptWord(start=float(word.start), end=float(word.end), text=text)
                    )
        elif segment.text.strip():
            words.append(
                TranscriptWord(
                    start=float(segment.start),
                    end=float(segment.end),
                    text=segment.text.strip(),
                )
            )
    return words


def reaction_events(words: list[TranscriptWord], phrases: list[str]) -> list[Event]:
    events: list[Event] = []
    if not words:
        return events
    # Slide over a 2.2s window of words.
    text = " ".join(w.text for w in words)
    lower_phrases = [p.lower() for p in phrases]
    for i, word in enumerate(words):
        window = " ".join(w.text for w in words[i : i + 6]).lower()
        for phrase in lower_phrases:
            if phrase in window:
                events.append(
                    Event(
                        id=f"say_{int(round(word.start * 1000)):07d}",
                        time=round(word.start, 3),
                        type="reaction",
                        confidence=0.8,
                        source="whisper",
                        meta={"text": window[:80], "phrase": phrase},
                    )
                )
                break
    # Dedup close reactions
    deduped: list[Event] = []
    for event in events:
        if deduped and event.time - deduped[-1].time < 1.5:
            continue
        deduped.append(event)
    _ = text
    return deduped
