from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from bfclips.config import ROOT, get_settings
from bfclips.pipeline.hud import detect_hud_events, load_hud_templates
from bfclips.schemas import Event

LABEL_DIR = ROOT / "eval" / "labels"
VIDEO_SEARCH = [
    Path("/mnt/c/Users/calvi/Downloads"),
    Path.home() / "Downloads",
    ROOT / "incoming",
]


def resolve_video(spec: str) -> Path | None:
    if not spec:
        return None
    path = Path(spec).expanduser()
    if path.is_file():
        return path
    name = path.name
    for folder in VIDEO_SEARCH:
        candidate = folder / name
        if candidate.is_file():
            return candidate
    return None


def load_label(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    data["kills"] = [float(t) for t in data.get("kills") or []]
    data["deaths"] = [float(t) for t in data.get("deaths") or []]
    data["video"] = str(data.get("video") or "")
    return data


def match_times(
    predicted: list[float],
    labeled: list[float],
    window: float = 0.6,
) -> dict[str, float]:
    pred = sorted(predicted)
    gold = list(labeled)
    used: set[int] = set()
    tp = 0
    for time in pred:
        best_i = None
        best_d = window + 1
        for i, truth in enumerate(gold):
            if i in used:
                continue
            dist = abs(time - truth)
            if dist <= window and dist < best_d:
                best_d = dist
                best_i = i
        if best_i is not None:
            used.add(best_i)
            tp += 1
    fp = len(pred) - tp
    fn = len(gold) - tp
    prec = tp / (tp + fp) if tp + fp else 1.0
    rec = tp / (tp + fn) if tp + fn else 1.0
    f1 = 2 * prec * rec / (prec + rec) if prec + rec else 0.0
    return {
        "tp": float(tp),
        "fp": float(fp),
        "fn": float(fn),
        "precision": prec,
        "recall": rec,
        "f1": f1,
    }


def score_events(events: list[Event], labels: dict[str, Any], window: float = 0.6) -> dict[str, dict[str, float]]:
    return {
        "kill": match_times([e.time for e in events if e.type == "kill"], labels["kills"], window),
        "death": match_times([e.time for e in events if e.type == "death"], labels["deaths"], window),
    }


def evaluate_label(label_path: Path, sample_fps: float = 6.0, window: float = 0.6) -> dict[str, Any]:
    labels = load_label(label_path)
    video = resolve_video(labels["video"])
    if video is None:
        return {"skipped": True, "reason": f"video not found: {labels['video']}", "path": str(label_path)}
    settings = get_settings()
    name_template, medal_templates = load_hud_templates(settings.templates_dir)
    events, _aux, _times, _frames = detect_hud_events(
        str(video),
        preset=settings.hud_preset,
        sample_fps=sample_fps,
        player_name=settings.player_name,
        name_template=name_template,
        medal_templates=medal_templates,
    )
    metrics = score_events(events, labels, window)
    return {
        "skipped": False,
        "video": str(video),
        "path": str(label_path),
        "metrics": metrics,
        "predicted": {
            "kill": [e.time for e in events if e.type == "kill"],
            "death": [e.time for e in events if e.type == "death"],
        },
        "labels": {"kills": labels["kills"], "deaths": labels["deaths"]},
    }


def _print_report(result: dict[str, Any]) -> None:
    if result.get("skipped"):
        print(f"SKIP {result['path']}: {result.get('reason')}")
        return
    print(f"{result['video']}")
    for kind, row in result["metrics"].items():
        print(
            f"  {kind:6} P={row['precision']:.2f} R={row['recall']:.2f} F1={row['f1']:.2f} "
            f"tp={int(row['tp'])} fp={int(row['fp'])} fn={int(row['fn'])}"
        )
        print(f"         pred={result['predicted'][kind]}")
        key = "kills" if kind == "kill" else "deaths"
        print(f"         gold={result['labels'][key]}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Precision/recall for HUD events on labeled clips")
    parser.add_argument("labels", nargs="*", help="Label JSON files (default: eval/labels/*.json)")
    parser.add_argument("--fps", type=float, default=6.0)
    parser.add_argument("--window", type=float, default=0.6)
    args = parser.parse_args(argv)
    paths = [Path(p) for p in args.labels] if args.labels else sorted(LABEL_DIR.glob("*.json"))
    if not paths:
        print("No label files")
        return 1
    code = 0
    for path in paths:
        result = evaluate_label(path, sample_fps=args.fps, window=args.window)
        _print_report(result)
        if result.get("skipped"):
            continue
        kills = result["metrics"]["kill"]
        deaths = result["metrics"]["death"]
        if result["labels"]["kills"] and kills["f1"] < 0.75:
            code = 2
        if result["labels"]["deaths"] and deaths["f1"] < 0.80:
            code = 2
    return code


if __name__ == "__main__":
    raise SystemExit(main())
