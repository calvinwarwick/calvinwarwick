from __future__ import annotations

import argparse
import json
from pathlib import Path

import uvicorn

from bfclips.config import get_settings
from bfclips.db import init_db, session_factory
from bfclips.pipeline.analyze import analyze_video
from bfclips.pipeline.editor import build_edit
from bfclips.pipeline.render import render_job
from bfclips.pipeline.sample import generate_sample
from bfclips.schemas import EventsDocument, RenderRequest, TimelineOptions
from bfclips.services.jobs import create_job_from_path, run_pipeline, run_render
from bfclips.services.watcher import watch_service


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="bfclips", description="Battlefield auto editor")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_an = sub.add_parser("analyze", help="Write events.json for a video")
    p_an.add_argument("video")
    p_an.add_argument("-o", "--out", default=None)

    p_ed = sub.add_parser("edit", help="Turn events.json into edit.json")
    p_ed.add_argument("events")
    p_ed.add_argument("-o", "--out", default=None)

    p_rn = sub.add_parser("render", help="Render an edit.json")
    p_rn.add_argument("video")
    p_rn.add_argument("events")
    p_rn.add_argument("edit")
    p_rn.add_argument("-o", "--out", default=None)

    p_run = sub.add_parser("run", help="Full local pipeline on one file")
    p_run.add_argument("video")
    p_run.add_argument("-o", "--out", default=None)

    sub.add_parser("serve", help="Start the API + UI + incoming watcher")
    sub.add_parser("watch", help="Watch incoming/ only (no UI)")
    p_s = sub.add_parser("sample", help="Generate a synthetic Battlefield test clip")
    p_s.add_argument("-o", "--out", default="incoming/sample_battlefield.mp4")

    args = parser.parse_args(argv)
    settings = get_settings()
    settings.ensure_dirs()

    if args.cmd == "analyze":
        video = Path(args.video)
        work = Path(args.out) if args.out else settings.work_dir / video.stem
        doc = analyze_video(video, work, settings)
        print(work / "events.json")
        print(f"{len(doc.events)} events, {len([e for e in doc.events if e.type == 'kill'])} kills")
        return

    if args.cmd == "edit":
        events = EventsDocument.model_validate_json(Path(args.events).read_text(encoding="utf-8"))
        edit = build_edit(events)
        dest = Path(args.out) if args.out else Path(args.events).with_name("edit.json")
        dest.write_text(edit.model_dump_json(indent=2), encoding="utf-8")
        print(dest)
        print(f"{len(edit.clips)} clips")
        return

    if args.cmd == "render":
        events = EventsDocument.model_validate_json(Path(args.events).read_text(encoding="utf-8"))
        from bfclips.schemas import EditDocument

        edit = EditDocument.model_validate_json(Path(args.edit).read_text(encoding="utf-8"))
        out = Path(args.out) if args.out else settings.output_dir / Path(args.video).stem
        outputs = render_job(
            Path(args.video),
            events,
            edit,
            out,
            settings.work_dir / Path(args.video).stem,
            ["youtube", "shorts", "clips"],
            settings,
            Path(args.video).stem,
        )
        print(json.dumps(outputs, indent=2))
        return

    if args.cmd == "run":
        init_db()
        session = session_factory()()
        job = create_job_from_path(session, Path(args.video))
        run_pipeline(session, job.id)
        run_render(
            session,
            job.id,
            RenderRequest(
                targets=["youtube", "shorts", "clips"],
                auto_captions=True,
                punch_in=True,
                remove_dead_time=True,
                audio_enhance=True,
            ),
        )
        session.refresh(job)
        print(job.id, job.status, job.outputs_json)
        session.close()
        return

    if args.cmd == "serve":
        uvicorn.run("bfclips.main:app", host=settings.host, port=settings.port, reload=False)
        return

    if args.cmd == "watch":
        init_db()
        folder = watch_service.start()
        print(f"Watching {folder} — drop Battlefield clips here.")
        try:
            import time

            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            watch_service.stop()
        return

    if args.cmd == "sample":
        path = generate_sample(Path(args.out))
        print(path)


if __name__ == "__main__":
    main()
