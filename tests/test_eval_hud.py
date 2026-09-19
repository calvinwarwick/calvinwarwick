import json
from pathlib import Path

import pytest

from bfclips.eval_hud import LABEL_DIR, evaluate_label, match_times, resolve_video, score_events
from bfclips.schemas import Event


def test_match_times_counts_tp_fp_fn():
    metrics = match_times([20.1, 22.0, 40.0], [20.0, 22.0, 24.0], window=0.6)
    assert metrics["tp"] == 2
    assert metrics["fp"] == 1
    assert metrics["fn"] == 1
    assert metrics["precision"] == pytest.approx(2 / 3)
    assert metrics["recall"] == pytest.approx(2 / 3)


def test_score_events_splits_types():
    events = [
        Event(id="k1", time=20.0, type="kill"),
        Event(id="d1", time=21.0, type="death"),
    ]
    metrics = score_events(events, {"kills": [20.0], "deaths": [21.0]})
    assert metrics["kill"]["f1"] == pytest.approx(1.0)
    assert metrics["death"]["f1"] == pytest.approx(1.0)


@pytest.mark.parametrize("label_path", sorted(LABEL_DIR.glob("*.json")))
def test_labeled_clip_floors(label_path: Path):
    data = json.loads(label_path.read_text(encoding="utf-8"))
    video = resolve_video(data.get("video") or "")
    if video is None:
        pytest.skip(f"video not found for {label_path.name}")
    result = evaluate_label(label_path)
    assert not result["skipped"]
    if data.get("kills"):
        assert result["metrics"]["kill"]["f1"] >= 0.75
    if data.get("deaths"):
        assert result["metrics"]["death"]["f1"] >= 0.80
