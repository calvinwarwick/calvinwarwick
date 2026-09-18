# BF Auto Editor

Local Battlefield kill-clip pipeline for Windows / WSL with an RTX 3060. AI decides *what* to keep and *when* to punch in. FFmpeg does every cut, zoom, speed ramp, caption, and export.

```
PS5 / OBS footage
        ↓
 incoming/  (watched folder)
        ↓
 1. VIDEO ANALYSIS     → events.json
 2. AI / RULES EDITOR  → edit.json
 3. FFMPEG RENDER      → youtube / shorts / clips
```

The durable contract is `events.json` → `edit.json`. Improve detection and taste without rewriting the renderer.

## What you get

- Drop a clip into `incoming/` or the React UI
- HUD-region kill / hit-marker / death / score detection (template-free OpenCV)
- Audio onset peaks for gunfire and explosions
- Optional Whisper / WhisperX commentary + reaction scoring
- Optional Ollama VLM/LLM pass for captions and reasons
- Excitement scoring (multi-kills, headshots, vehicles, reactions, dead time)
- Approve / reject moments — stored as a future “would Calvin use this?” dataset
- Deterministic FFmpeg export:
  - `output/<clip>/youtube/` 16:9 montage
  - `output/<clip>/shorts/` 9:16 punch-ins
  - `output/<clip>/clips/` individual windows
  - `output/<clip>/metadata.json`

MVP default: 5 seconds before / 3 seconds after each kill, cluster multi-kills, rank, let you unstar junk, then render.

## Quick start (WSL or Linux)

Requires Python 3.11+, Node 20+, and FFmpeg on PATH.

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
cd frontend && npm install && cd ..

# terminal 1
python -m bfclips serve

# terminal 2
cd frontend && npm run dev
```

UI: [http://127.0.0.1:5173](http://127.0.0.1:5173)  
API: [http://127.0.0.1:8000/api/health](http://127.0.0.1:8000/api/health)

Or one script: `bash scripts/dev.sh`

Generate a synthetic Battlefield-like clip (known kills at 3.0s, 6.4s, 7.1s):

```bash
python -m bfclips sample
```

Then click **Sample clip** in the UI, or drop `incoming/sample_battlefield.mp4` and wait for analysis.

## Windows native (GPU path)

Keep heavy decode / Whisper on native Windows or WSL with NVIDIA drivers, not Docker.

1. Install [FFmpeg](https://ffmpeg.org/download.html) and add it to PATH.
2. Install CUDA-enabled PyTorch only if you want Whisper GPU.
3. Optional speech: `pip install -e ".[speech]"` (faster-whisper). WhisperX works the same once installed — word timestamps land on `events.transcript`.
4. Optional local model: install [Ollama](https://ollama.com), pull `llama3.2-vision` or `qwen2.5vl`.
5. Point the watcher at your capture folder:

```powershell
$env:BFCLIPS_INCOMING_DIR = "D:\Battlefield\Incoming"
$env:BFCLIPS_WHISPER_DEVICE = "cuda"
python -m bfclips serve
```

Drop `BF6_20260918_203422.mp4` in that folder. The watcher waits until the file size is stable, then analyses automatically.

## CLI

```bash
python -m bfclips analyze path/to/gameplay.mp4
python -m bfclips edit work/<stem>/events.json
python -m bfclips render path/to/gameplay.mp4 work/<stem>/events.json work/<stem>/edit.json
python -m bfclips run path/to/gameplay.mp4
python -m bfclips watch
```

## events.json → edit.json

Analysis writes timestamped signals, not a finished movie:

```json
{
  "events": [
    { "time": 18.42, "type": "kill", "confidence": 0.97, "meta": { "headshot": true } },
    { "time": 21.16, "type": "kill", "confidence": 0.94 },
    { "time": 22.83, "type": "explosion", "confidence": 0.88 }
  ]
}
```

The editor clusters and scores them:

```json
{
  "clips": [
    {
      "start": 14.5,
      "end": 25.0,
      "score": 94,
      "reason": "double kill + explosion",
      "effects": [
        { "type": "zoom", "time": 18.42 },
        { "type": "zoom", "time": 21.16 },
        { "type": "slowmo", "start": 21.0, "end": 23.1 }
      ]
    }
  ]
}
```

Default score weights (see `configs/scoring.yaml`):

| Signal | Points |
| --- | --- |
| Kill | +20 |
| Headshot | +10 |
| Second kill within 4s | +25 |
| Third kill within 6s | +40 |
| Vehicle destroyed | +30 |
| Explosion / big boom | +12 / +10 |
| “OH MY GOD” / reaction | +20 |
| Death | −10 |
| 10s idle | −30 |

## HUD detection

No YOLO in v1. Fixed normalized crops in `configs/hud.yaml` plus brightness / red-ratio / edge spikes:

- kill feed (left + right, BF6 vs older titles)
- center hit marker (redder burst → headshot)
- score popup
- death banner
- global flash → explosion candidate

After each analyse pass the UI shows `hud_calibration.jpg` with the crop boxes. If your BF6 HUD padding is aggressive, nudge the rectangles and re-run.

Optional PNG templates can be dropped in `templates/` later; the spike detector does not need them.

## Project layout

```
bfclips/            FastAPI service, CLI, pipeline
configs/            HUD + scoring YAML
frontend/           Vite + React review UI
incoming/           watched drop folder
output/             youtube / shorts / clips
work/               events.json, edit.json, temp encodes
tests/              scorer, HUD, audio, render plan, e2e
```

## Training from your taste

Every Keep / Skip click stores clip features, nearby events, and transcript in SQLite (`data/bfclips.db`, table `feedback`). After a few hundred decisions you can train a ranker whose question is not “is something happening?” but “would this go in a BFCLIPS montage?”

## Tests

```bash
pip install -e ".[dev]"
pytest -q
```
