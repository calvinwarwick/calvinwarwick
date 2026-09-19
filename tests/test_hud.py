import numpy as np
import cv2

from bfclips.pipeline.feed import classify_row, is_still, tophat_mask
from bfclips.pipeline.hud import classify_screen, detect_hud_events, load_regions, peak_indices
from bfclips.pipeline.sample import _battlefield_frame, _paint_death, _paint_kill


def test_peak_indices_finds_spikes():
    values = [10] * 20 + [80] + [12] * 20 + [90] + [11] * 10
    peaks = peak_indices(values, z_thresh=2.0, min_gap=3)
    assert len(peaks) == 2


def test_hud_regions_include_right_feed_and_medals():
    regions = load_regions("bf6")
    names = {rect.name for group in regions.values() for rect in group}
    assert "kill_feed_right" in names
    assert "hit_marker" in names
    assert any(rect.name == "medals" or "medal" in rect.name.lower() for group in regions.values() for rect in group)


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


def test_idle_gameplay_is_not_a_kill():
    frames = [_battlefield_frame(1280, 720, i / 8) for i in range(24)]
    times = [i / 8 for i in range(24)]
    events, _, _, _ = detect_hud_events(
        "unused.mp4",
        preset="bf6",
        sample_fps=8,
        frames=frames,
        times=times,
    )
    assert not [e for e in events if e.type == "kill"]


def test_second_victim_is_a_new_kill():
    fps = 8
    frames = []
    times = []
    for i in range(int(5 * fps)):
        t = i / fps
        frame = _battlefield_frame(1280, 720, t)
        if 1.2 <= t <= 1.7:
            _paint_kill(frame, 1.0 - (t - 1.2) / 0.5, headshot=False, victim="ALPHA")
        if 2.4 <= t <= 2.9:
            _paint_kill(frame, 1.0 - (t - 2.4) / 0.5, headshot=True, victim="BRAVO")
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


def test_relative_sat_left_is_kill_right_is_death():
    kill = np.zeros((22, 160, 3), dtype=np.uint8)
    kill[:, :80] = (230, 230, 230)
    kill[:, 80:] = (30, 70, 210)
    death = np.zeros((22, 160, 3), dtype=np.uint8)
    death[:, :80] = (30, 70, 210)
    death[:, 80:] = (230, 230, 230)
    mask = np.zeros((22, 160), dtype=bool)
    mask[:, 8:72] = True
    mask[:, 88:152] = True
    assert classify_row(kill, mask)[0] == "kill"
    assert classify_row(death, mask)[0] == "death"
    assert tophat_mask(kill).shape == kill.shape[:2]


def test_stillness_detects_frozen_overlay():
    frame = np.full((80, 120, 3), 40, dtype=np.uint8)
    assert is_still(frame, frame.copy())
    moved = frame.copy()
    moved[:, 60:] = 200
    assert not is_still(frame, moved)


def test_scoreboard_overlay_is_not_gameplay():
    frame = np.zeros((720, 1280, 3), dtype=np.uint8)
    frame[:] = (18, 12, 12)
    frame[:, :560] = (40, 28, 12)
    frame[:, 720:] = (12, 12, 48)
    for i in range(12):
        y = 80 + i * 40
        cv2.putText(frame, f"PLAYER{i:02d}  12-{i}", (40, y), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (230, 230, 230), 2)
        cv2.putText(frame, f"ENEMY{i:02d}   9-{i}", (760, y), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (230, 230, 230), 2)
    assert classify_screen(frame) == "scoreboard"
    events, _, _, _ = detect_hud_events(
        "unused.mp4",
        preset="bf6",
        sample_fps=8,
        frames=[frame] * 10,
        times=[i / 8 for i in range(10)],
    )
    assert not [e for e in events if e.type == "kill"]
