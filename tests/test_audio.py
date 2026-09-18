import numpy as np

from bfclips.pipeline.audio import detect_onsets, envelope


def test_onset_detects_impulses():
    rate = 16000
    samples = np.random.randn(rate * 3).astype(np.float32) * 0.03
    for t in (0.8, 1.7):
        start = int(t * rate)
        samples[start : start + 400] += 0.9
    times, rms = envelope(samples, rate, hop_s=0.05)
    peaks = detect_onsets(rms, times, z_thresh=2.2)
    found = [t for t, _ in peaks]
    assert any(abs(t - 0.8) < 0.2 for t in found)
    assert any(abs(t - 1.7) < 0.2 for t in found)
