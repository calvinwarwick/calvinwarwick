import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type Health, type Job, type Settings } from "./api";

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hot, setHot] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [options, setOptions] = useState({
    auto_captions: true,
    punch_in: true,
    remove_dead_time: true,
    audio_enhance: true,
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const selected = useMemo(
    () => jobs.find((job) => job.id === selectedId) || jobs[0] || null,
    [jobs, selectedId],
  );

  const refresh = useCallback(async () => {
    const [nextJobs, nextHealth, nextSettings] = await Promise.all([
      api.jobs(),
      api.health(),
      api.settings(),
    ]);
    setJobs(nextJobs);
    setHealth(nextHealth);
    setSettings(nextSettings);
    setSelectedId((current) => current ?? nextJobs[0]?.id ?? null);
  }, []);

  useEffect(() => {
    refresh().catch((err) => setError(String(err)));
  }, [refresh]);

  useEffect(() => {
    if (!selected) return;
    const active = ["queued", "analysing", "rendering"].includes(selected.status);
    if (!active) return;
    const timer = window.setInterval(() => {
      api.job(selected.id).then((job) => {
        setJobs((prev) => prev.map((item) => (item.id === job.id ? job : item)));
      });
    }, 1200);
    return () => window.clearInterval(timer);
  }, [selected]);

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    try {
      let last: Job | null = null;
      for (const file of Array.from(files)) {
        last = await api.upload(file);
      }
      await refresh();
      if (last) setSelectedId(last.id);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function makeSample() {
    setBusy(true);
    try {
      const job = await api.sample();
      await refresh();
      setSelectedId(job.id);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function toggleClip(clipId: string, enabled: boolean) {
    if (!selected) return;
    const job = await api.patchClip(selected.id, clipId, { enabled });
    await api.feedback(selected.id, clipId, enabled);
    setJobs((prev) => prev.map((item) => (item.id === job.id ? job : item)));
  }

  async function render(targets: string[]) {
    if (!selected) return;
    setBusy(true);
    try {
      const job = await api.render(selected.id, targets, options);
      setJobs((prev) => prev.map((item) => (item.id === job.id ? job : item)));
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  function seekTo(seconds: number) {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, seconds - 0.4);
    void video.play();
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <small>BFCLIPS // LOCAL PIPELINE</small>
          <h1>BF Auto Editor</h1>
        </div>
        <div className="status-pills">
          <span className={`pill ${health?.watch ? "on" : ""}`}>Watch {health?.watch ? "live" : "off"}</span>
          <span className={`pill ${health?.ollama ? "on" : "warn"}`}>
            Ollama {health?.ollama ? "ready" : "optional"}
          </span>
          <span className={`pill ${health?.whisper ? "on" : "warn"}`}>
            Whisper {health?.whisper ? health.gpu : "off"}
          </span>
          <span className="pill warn">{settings?.hud_preset?.toUpperCase() || "HUD"}</span>
        </div>
      </header>

      <div className="layout">
        <aside className="panel">
          <div className="panel-head">
            Incoming
            <button className="btn ghost" onClick={() => inputRef.current?.click()}>
              Browse
            </button>
          </div>
          <div
            className={`drop ${hot ? "hot" : ""}`}
            onDragOver={(event) => {
              event.preventDefault();
              setHot(true);
            }}
            onDragLeave={() => setHot(false)}
            onDrop={(event) => {
              event.preventDefault();
              setHot(false);
              void onFiles(event.dataTransfer.files);
            }}
            onClick={() => inputRef.current?.click()}
          >
            Drop PS5 / OBS footage
            <br />
            or generate a test clip
          </div>
          <input
            ref={inputRef}
            type="file"
            accept="video/*"
            hidden
            multiple
            onChange={(event) => void onFiles(event.target.files)}
          />
          <div className="actions" style={{ padding: "0 14px 12px" }}>
            <button className="btn ghost" disabled={busy} onClick={() => void makeSample()}>
              Sample clip
            </button>
          </div>
          <ul className="job-list">
            {jobs.map((job) => (
              <li
                key={job.id}
                className={selected?.id === job.id ? "active" : ""}
                onClick={() => setSelectedId(job.id)}
              >
                <strong>{job.filename}</strong>
                <span>
                  {job.status} · {Math.round((job.progress || 0) * 100)}%
                </span>
              </li>
            ))}
          </ul>
        </aside>

        <section className="panel workspace">
          {!selected && <p className="notes">No jobs yet. Drop a Battlefield recording to start.</p>}
          {selected && (
            <>
              <div className="file-title">
                <h2>{selected.filename}</h2>
                <span className="stage">{selected.stage.toUpperCase()}</span>
              </div>
              <div className="bar">
                <i style={{ width: `${Math.round((selected.progress || 0) * 100)}%` }} />
              </div>
              {selected.error && <p className="error">{selected.error}</p>}
              {selected.notes.map((note) => (
                <p key={note} className="notes">
                  {note}
                </p>
              ))}

              <div className="moments">
                {selected.clips
                  .slice()
                  .sort((a, b) => b.score - a.score)
                  .map((clip) => (
                    <div
                      key={clip.id}
                      className={`moment ${clip.enabled ? "" : "off"}`}
                      onClick={() => seekTo(clip.start)}
                    >
                      <span className="star">★</span>
                      <span className="score">{Math.round(clip.score)}</span>
                      <span className="time">{formatTime(clip.start)}</span>
                      <span className="reason">{clip.reason}</span>
                      <button
                        className={`btn ghost`}
                        onClick={(event) => {
                          event.stopPropagation();
                          void toggleClip(clip.id, !clip.enabled);
                        }}
                      >
                        {clip.enabled ? "Keep" : "Skip"}
                      </button>
                    </div>
                  ))}
                {selected.status === "ready" && selected.clips.length === 0 && (
                  <p className="notes">No scored moments. Check the HUD calibration overlay.</p>
                )}
              </div>

              <div className="toggles">
                {(
                  [
                    ["auto_captions", "Auto captions"],
                    ["punch_in", "Punch-in on kills"],
                    ["remove_dead_time", "Remove dead time"],
                    ["audio_enhance", "Audio enhancement"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="toggle">
                    <input
                      type="checkbox"
                      checked={options[key]}
                      onChange={(event) =>
                        setOptions((current) => ({ ...current, [key]: event.target.checked }))
                      }
                    />
                    {label}
                  </label>
                ))}
              </div>

              <div className="actions">
                <button
                  className="btn"
                  disabled={busy || selected.clips.every((clip) => !clip.enabled)}
                  onClick={() => void render(["youtube", "clips"])}
                >
                  Generate YouTube video
                </button>
                <button
                  className="btn ghost"
                  disabled={busy || selected.clips.every((clip) => !clip.enabled)}
                  onClick={() => void render(["shorts"])}
                >
                  Generate 5 shorts
                </button>
              </div>

              <div className="preview">
                <video
                  ref={videoRef}
                  controls
                  src={selected.id ? `/api/jobs/${selected.id}/source` : undefined}
                />
                <div className="cal">
                  <img
                    alt="HUD calibration"
                    src={`/api/jobs/${selected.id}/calibration`}
                    onError={(event) => {
                      event.currentTarget.style.display = "none";
                    }}
                  />
                  {Object.entries(selected.outputs).map(([kind, files]) => (
                    <div key={kind} className="outputs">
                      <strong>{kind}</strong>
                      {files.map((file) => (
                        <a
                          key={file}
                          href={`/api/jobs/${selected.id}/file?path=${encodeURIComponent(file)}`}
                        >
                          {file.split(/[\\/]/).slice(-2).join("/")}
                        </a>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
