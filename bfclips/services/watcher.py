from __future__ import annotations

import shutil
import threading
import time
from pathlib import Path

from watchdog.events import FileSystemEventHandler
from watchdog.observers import Observer

from bfclips.config import get_settings
from bfclips.db import session_factory
from bfclips.services.jobs import VIDEO_SUFFIXES, create_job_from_path, run_pipeline, spawn


class IncomingHandler(FileSystemEventHandler):
    def __init__(self) -> None:
        self._seen: set[str] = set()

    def on_created(self, event) -> None:  # type: ignore[override]
        if event.is_directory:
            return
        self._maybe(Path(event.src_path))

    def on_moved(self, event) -> None:  # type: ignore[override]
        if event.is_directory:
            return
        self._maybe(Path(event.dest_path))

    def _maybe(self, path: Path) -> None:
        if path.suffix.lower() not in VIDEO_SUFFIXES:
            return
        if path.name.startswith("."):
            return
        key = str(path.resolve()) if path.exists() else str(path)
        if key in self._seen:
            return
        self._seen.add(key)
        thread = threading.Thread(target=_ingest, args=(path,), daemon=True)
        thread.start()


def _wait_stable(path: Path, timeout: float = 90.0) -> bool:
    last = -1
    stable = 0
    start = time.time()
    while time.time() - start < timeout:
        if not path.exists():
            time.sleep(0.4)
            continue
        size = path.stat().st_size
        if size > 0 and size == last:
            stable += 1
            if stable >= 3:
                return True
        else:
            stable = 0
            last = size
        time.sleep(0.8)
    return path.exists()


def _stage_into_incoming(path: Path) -> Path:
    settings = get_settings()
    incoming = settings.incoming_dir.expanduser().resolve()
    incoming.mkdir(parents=True, exist_ok=True)
    source = path.expanduser().resolve()
    if source.parent == incoming:
        return source
    dest = incoming / source.name
    if not dest.exists() or dest.stat().st_size != source.stat().st_size:
        shutil.copy2(source, dest)
    return dest


def _ingest(path: Path) -> None:
    if not _wait_stable(path):
        return
    staged = _stage_into_incoming(path)
    SessionLocal = session_factory()
    session = SessionLocal()
    try:
        job = create_job_from_path(
            session,
            staged,
            copy_into_work=False,
            reuse_recent=True,
            reuse_any=True,
        )
        if job.status == "queued":
            spawn(session_factory(), job.id, run_pipeline)
    finally:
        session.close()


class WatchService:
    def __init__(self) -> None:
        self._observers: list[Observer] = []
        self._handler = IncomingHandler()

    def start(self, folder: Path | None = None) -> Path:
        settings = get_settings()
        settings.ensure_dirs()
        folders = [settings.incoming_dir, *settings.extra_watch_dirs()]
        if folder is not None:
            folders.insert(0, folder)
        resolved: list[Path] = []
        seen: set[Path] = set()
        for item in folders:
            path = item.expanduser().resolve()
            path.mkdir(parents=True, exist_ok=True)
            if path in seen:
                continue
            seen.add(path)
            resolved.append(path)
        if not self._observers:
            for path in resolved:
                observer = Observer()
                observer.schedule(self._handler, str(path), recursive=False)
                observer.start()
                self._observers.append(observer)
            self.scan(resolved)
        return resolved[0]

    def scan(self, folders: list[Path] | None = None) -> None:
        settings = get_settings()
        targets = folders or [settings.incoming_dir, *settings.extra_watch_dirs()]
        for folder in targets:
            folder = folder.expanduser()
            if not folder.exists():
                continue
            for path in sorted(folder.iterdir()):
                if path.is_file() and path.suffix.lower() in VIDEO_SUFFIXES:
                    self._handler._maybe(path)

    def stop(self) -> None:
        for observer in self._observers:
            observer.stop()
            observer.join(timeout=3)
        self._observers = []

    @property
    def running(self) -> bool:
        return any(observer.is_alive() for observer in self._observers)


watch_service = WatchService()
