import numpy as np

from bfclips.pipeline.hud import detect_hud_events, load_regions, peak_indices
from bfclips.pipeline.sample import _battlefield_frame, _paint_kill


def test_peak_indices_finds_spikes():
    values = [10] * 20 + [80] + [12] * 20 + [90] + [11] * 10
    peaks = peak_indices(values, z_thresh=2.0, min_gap=3)
    assert len(peaks) == 2


def test_hud_regions_include_left_feed_and_hit_marker():
    regions = load_regions("bf6")
    names = {rect.name for group in regions.values() for rect in group}
    assert "kill_feed_left" in names
    assert "hit_marker" in names


def test_kill_flashes_become_kill_events():
    fps = 8
    duration = 6
    frames = []
    times = []
    kills = [1.5, 2.2]
    for i in range(int(duration * fps)):
        t = i / fps
        frame = _battlefield_frame(1280, 720, t)
        for kill in kills:
            if 0 <= t - kill <= 0.4:
                _paint_kill(frame, 1.0 - (t - kill) / 0.4, headshot=kill == kills[0])
        frames.append(frame)
        times.append(t)
    events, _, _, _ = detect_hud_events(
        "unused.mp4",
        preset="bf6",
        sample_fps=fps,
        frames=frames,
        times=times,
    )
    kill_times = [e.time for e in events if e.type == "kill"]
    assert len(kill_times) >= 2
    assert any(abs(t - 1.5) < 0.3 for t in kill_times)
    assert any(e.type == "headshot" for e in events)
