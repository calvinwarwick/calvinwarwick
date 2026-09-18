from __future__ import annotations

import threading
import time
from pathlib import Path

from watchdog.events import FileSystemEventHandler
from watchdog.observers import Observer

from bfclips.config import get_settings
from bfclips.db import session_factory
from bfclips.services.jobs import VIDEO_SUFFIXES, create_job_from_path, spawn, run_pipeline


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
        key = str(path.resolve())
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


def _ingest(path: Path) -> None:
    if not _wait_stable(path):
        return
    SessionLocal = session_factory()
    session = SessionLocal()
    try:
        job = create_job_from_path(session, path, copy_into_work=False)
        spawn(session_factory(), job.id, run_pipeline)
    finally:
        session.close()


class WatchService:
    def __init__(self) -> None:
        self._observer: Observer | None = None

    def start(self, folder: Path | None = None) -> Path:
        settings = get_settings()
        folder = (folder or settings.incoming_dir).expanduser().resolve()
        folder.mkdir(parents=True, exist_ok=True)
        if self._observer:
            return folder
        observer = Observer()
        observer.schedule(IncomingHandler(), str(folder), recursive=False)
        observer.start()
        self._observer = observer
        return folder

    def stop(self) -> None:
        if self._observer:
            self._observer.stop()
            self._observer.join(timeout=3)
            self._observer = None

    @property
    def running(self) -> bool:
        return self._observer is not None and self._observer.is_alive()


watch_service = WatchService()
