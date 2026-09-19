from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


ROOT = Path(__file__).resolve().parent.parent
CONFIG_DIR = ROOT / "configs"


def load_yaml(name: str) -> dict[str, Any]:
    path = CONFIG_DIR / name
    with path.open("r", encoding="utf-8") as handle:
        return yaml.safe_load(handle) or {}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="BFCLIPS_", extra="ignore")

    incoming_dir: Path = ROOT / "incoming"
    output_dir: Path = ROOT / "output"
    work_dir: Path = ROOT / "work"
    data_dir: Path = ROOT / "data"
    templates_dir: Path = ROOT / "templates"
    db_path: Path = ROOT / "data" / "bfclips.db"
    downloads_dir: Path = Path.home() / "Downloads"

    host: str = "0.0.0.0"
    port: int = 8000

    hud_preset: str = "bf6"
    player_name: str = "buy-bitcoin-247"
    sample_fps: float = 6.0
    refine_fps: float = 12.0

    ollama_url: str = "http://127.0.0.1:11434"
    ollama_model: str = "llama3.2-vision"
    ollama_enabled: bool = True

    whisper_model: str = "small"
    whisper_device: str = "cuda"
    whisper_enabled: bool = True

    ffmpeg_preset: str = "veryfast"
    ffmpeg_crf: int = 18
    render_audio_enhance: bool = True

    auto_analyze: bool = True

    def extra_watch_dirs(self) -> list[Path]:
        extras = [
            self.downloads_dir,
            Path.home() / ".cursor" / "projects" / "workspace" / "uploads",
            Path.home() / ".cursor" / "projects" / "workspace" / "downloads",
        ]
        seen: set[Path] = set()
        ordered: list[Path] = []
        for path in extras:
            resolved = path.expanduser()
            if resolved in seen:
                continue
            seen.add(resolved)
            ordered.append(resolved)
        return ordered

    def watch_dirs(self) -> list[Path]:
        return [self.incoming_dir, *self.extra_watch_dirs()]

    def ensure_dirs(self) -> None:
        for path in (
            self.incoming_dir,
            self.output_dir,
            self.work_dir,
            self.data_dir,
            self.templates_dir,
            *self.extra_watch_dirs(),
        ):
            path.mkdir(parents=True, exist_ok=True)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)


_settings: Settings | None = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings()
        _settings.ensure_dirs()
    return _settings


def reset_settings() -> None:
    global _settings
    _settings = None


def hud_config() -> dict[str, Any]:
    return load_yaml("hud.yaml")


def scoring_config() -> dict[str, Any]:
    return load_yaml("scoring.yaml")


class RuntimeOptions(BaseSettings):
    """Per-render toggles from the UI."""

    model_config = SettingsConfigDict(extra="ignore")

    auto_captions: bool = True
    punch_in: bool = True
    remove_dead_time: bool = True
    audio_enhance: bool = True
    include_music: bool = False
    music_path: Path | None = None
    aspect: str = Field(default="16:9")
