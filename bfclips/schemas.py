from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


EventType = Literal[
    "kill",
    "headshot",
    "longshot",
    "blindside",
    "multikill",
    "vehicle_destroyed",
    "explosion",
    "death",
    "hit_marker",
    "score",
    "objective",
    "audio_peak",
    "scene_cut",
    "reaction",
    "idle",
    "weapon_fire",
]


class Rect(BaseModel):
    name: str = "region"
    x: float
    y: float
    w: float
    h: float


class TranscriptWord(BaseModel):
    start: float
    end: float
    text: str


class Event(BaseModel):
    id: str
    time: float
    type: EventType
    confidence: float = 0.5
    end: float | None = None
    source: str = "hud"
    meta: dict[str, Any] = Field(default_factory=dict)


class SourceInfo(BaseModel):
    path: str
    duration: float
    width: int
    height: int
    fps: float
    audio: bool = True


class EventsDocument(BaseModel):
    source: SourceInfo
    events: list[Event] = Field(default_factory=list)
    transcript: list[TranscriptWord] = Field(default_factory=list)
    scenes: list[dict[str, Any]] = Field(default_factory=list)
    audio_peaks: list[dict[str, Any]] = Field(default_factory=list)
    hud_preset: str = "bf6"
    notes: list[str] = Field(default_factory=list)


class Effect(BaseModel):
    type: Literal["zoom", "slowmo", "freeze", "caption", "flash"]
    time: float | None = None
    start: float | None = None
    end: float | None = None
    scale: float | None = None
    rate: float | None = None
    duration: float | None = None
    text: str | None = None


class ClipDecision(BaseModel):
    id: str
    start: float
    end: float
    score: float
    reason: str
    enabled: bool = True
    effects: list[Effect] = Field(default_factory=list)
    caption: str | None = None
    event_ids: list[str] = Field(default_factory=list)
    kill_count: int = 1


class TimelineOptions(BaseModel):
    aspect: str = "16:9"
    auto_captions: bool = True
    punch_in: bool = True
    remove_dead_time: bool = True
    audio_enhance: bool = True


class EditDocument(BaseModel):
    clips: list[ClipDecision] = Field(default_factory=list)
    timeline: TimelineOptions = Field(default_factory=TimelineOptions)
    editor: str = "rules-v1"


class JobCreate(BaseModel):
    path: str | None = None
    auto_analyze: bool = True


class ClipPatch(BaseModel):
    enabled: bool | None = None
    score: float | None = None
    reason: str | None = None
    caption: str | None = None


class RenderRequest(BaseModel):
    targets: list[Literal["youtube", "shorts", "clips"]] = Field(
        default_factory=lambda: ["youtube", "shorts", "clips"]
    )
    auto_captions: bool = True
    punch_in: bool = True
    remove_dead_time: bool = True
    audio_enhance: bool = True


class FeedbackIn(BaseModel):
    clip_id: str
    approved: bool
    notes: str = ""


class SettingsOut(BaseModel):
    incoming_dir: str
    output_dir: str
    hud_preset: str
    player_name: str
    ollama_url: str
    ollama_model: str
    ollama_enabled: bool
    whisper_model: str
    whisper_device: str
    whisper_enabled: bool
    sample_fps: float
    ffmpeg_preset: str
    ffmpeg_crf: int


class SettingsUpdate(BaseModel):
    incoming_dir: str | None = None
    output_dir: str | None = None
    hud_preset: str | None = None
    player_name: str | None = None
    ollama_enabled: bool | None = None
    ollama_model: str | None = None
    whisper_enabled: bool | None = None
    whisper_model: str | None = None
    whisper_device: str | None = None
    sample_fps: float | None = None
    ffmpeg_preset: str | None = None
    ffmpeg_crf: int | None = None
