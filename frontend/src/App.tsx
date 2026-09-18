import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type Clip, type EventItem, type Health, type Job, type Settings } from "./api";

const EVENT_STYLE: Record<string, { label: string; color: string }> = {
  kill: { label: "Kill", color: "#ff4d2e" },
  headshot: { label: "Headshot", color: "#ffb020" },
  multikill: { label: "Multikill", color: "#facc15" },
  vehicle_destroyed: { label: "Vehicle", color: "#fb7185" },
  explosion: { label: "Explosion", color: "#ff7a18" },
  death: { label: "Death", color: "#94a3b8" },
  hit_marker: { label: "Hit", color: "#f2e9a0" },
  score: { label: "Score", color: "#7ad4ff" },
  objective: { label: "Objective", color: "#38bdf8" },
  audio_peak: { label: "Audio", color: "#6ee7b7" },
  scene_cut: { label: "Cut", color: "#9aa0a6" },
  reaction: { label: "Reaction", color: "#c084fc" },
  idle: { label: "Idle", color: "#64748b" },
  weapon_fire: { label: "Fire", color: "#d4a574" },
};

function eventStyle(type: string) {
  return EVENT_STYLE[type] || { label: type.replaceAll("_", " "), color: "#a3b18a" };
}

function formatClock(seconds: number, precise = false): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  if (precise) return `${String(m).padStart(2, "0")}:${s.toFixed(1).padStart(4, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(Math.floor(s)).padStart(2, "0")}`;
}

function formatMeta(job: Job): string {
  const bits = [];
  if (job.duration) bits.push(formatClock(job.duration));
  if (job.width && job.height) bits.push(`${job.width}×${job.height}`);
  if (job.fps) bits.push(`${Math.round(job.fps)} fps`);
  return bits.join(" · ") || "Waiting for probe";
}

function eventsForClip(events: EventItem[], clip: Clip): EventItem[] {
  const byId = new Set(clip.event_ids || []);
  return events.filter((event) => {
    if (byId.has(event.id)) return true;
    return event.time >= clip.start && event.time <= clip.end;
  });
}

function eventDetail(event: EventItem): string {
  const bits: string[] = [];
  if (event.meta?.headshot) bits.push("headshot");
  const energy = event.meta?.energy;
  if (typeof energy === "number") bits.push(`energy ${energy.toFixed(2)}`);
  const delta = event.meta?.delta;
  if (typeof delta === "number") bits.push(`delta ${delta.toFixed(2)}`);
  bits.push(`${Math.round(event.confidence * 100)}%`);
  bits.push(event.source);
  return bits.join(" · ");
}

function statusLabel(job: Job): string {
  if (job.status === "analysing") return `Analysing ${job.stage}`;
  if (job.status === "rendering") return `Rendering ${Math.round((job.progress || 0) * 100)}%`;
  return job.status;
}

export function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [eventFilter, setEventFilter] = useState("all");
  const [momentOnly, setMomentOnly] = useState(false);
  const [hot, setHot] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [showHud, setShowHud] = useState(true);
  const [options, setOptions] = useState({
    auto_captions: true,
    punch_in: true,
    remove_dead_time: true,
    audio_enhance: true,
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const eventListRef = useRef<HTMLDivElement>(null);

  const selected = useMemo(
    () => jobs.find((job) => job.id === selectedId) || jobs[0] || null,
    [jobs, selectedId],
  );
  const events = selected?.events || [];
  const clips = selected?.clips || [];
  const selectedClip = clips.find((clip) => clip.id === selectedClipId) || null;

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
    const active = ["queued", "analysing", "analysed", "rendering"].includes(selected.status);
    if (!active) return;
    const timer = window.setInterval(() => {
      api.job(selected.id).then((job) => {
        setJobs((prev) => prev.map((item) => (item.id === job.id ? job : item)));
      });
    }, 1200);
    return () => window.clearInterval(timer);
  }, [selected?.id, selected?.status]);

  useEffect(() => {
    setSelectedClipId(null);
    setEventFilter("all");
    setMomentOnly(false);
    setPlayhead(0);
  }, [selected?.id]);

  const visibleEvents = useMemo(() => {
    let list = events;
    if (momentOnly && selectedClip) list = eventsForClip(list, selectedClip);
    if (eventFilter !== "all") list = list.filter((event) => event.type === eventFilter);
    return list.slice().sort((a, b) => a.time - b.time);
  }, [events, eventFilter, momentOnly, selectedClip]);

  const activeEventId = useMemo(() => {
    let current: EventItem | null = null;
    for (const event of events) {
      if (event.time <= playhead + 0.12) current = event;
    }
    return current?.id ?? null;
  }, [events, playhead]);

  useEffect(() => {
    if (!activeEventId || !eventListRef.current) return;
    const node = eventListRef.current.querySelector(`[data-event-id="${activeEventId}"]`);
    if (node instanceof HTMLElement && momentOnly) {
      node.scrollIntoView({ block: "nearest" });
    }
  }, [activeEventId, momentOnly]);

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
    video.currentTime = Math.max(0, seconds);
    void video.play();
  }

  function selectClip(clip: Clip) {
    setSelectedClipId(clip.id);
    seekTo(clip.start);
  }

  const kept = clips.filter((clip) => clip.enabled).length;
  const analysing = selected && ["queued", "analysing", "analysed"].includes(selected.status);
  const canRender = Boolean(selected && kept > 0 && ["ready", "done"].includes(selected.status));

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <small>BFCLIPS // LOCAL PIPELINE</small>
          <h1>BF Auto Editor</h1>
        </div>
        <p className="lede">
          Drop footage, review every detected event, keep the moments you want, then render.
        </p>
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
        <aside className="panel library">
          <div className="panel-head">
            Incoming
            <button type="button" className="btn ghost mini" onClick={() => inputRef.current?.click()}>
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
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") inputRef.current?.click();
            }}
          >
            <strong>Drop PS5 / OBS clips</strong>
            <span>or pick files from Downloads</span>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept="video/*"
            hidden
            multiple
            onChange={(event) => void onFiles(event.target.files)}
          />
          <div className="actions pad">
            <button type="button" className="btn ghost" disabled={busy} onClick={() => void makeSample()}>
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
                <span className="job-meta">
                  {statusLabel(job)}
                  {job.duration ? ` · ${formatClock(job.duration)}` : ""}
                </span>
                <span className="job-counts">
                  {job.event_count || 0} events · {job.clips.length} moments
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
                <div>
                  <h2>{selected.filename}</h2>
                  <p className="file-meta">{formatMeta(selected)}</p>
                </div>
                <span className={`stage ${selected.status}`}>{selected.stage.toUpperCase()}</span>
              </div>
              <div className="bar" aria-hidden="true">
                <i style={{ width: `${Math.round((selected.progress || 0) * 100)}%` }} />
              </div>
              {error && (
                <p className="error">
                  {error}{" "}
                  <button type="button" className="linkish" onClick={() => setError(null)}>
                    dismiss
                  </button>
                </p>
              )}
              {selected.error && <p className="error">{selected.error}</p>}
              {selected.notes.map((note) => (
                <p key={note} className="notes">
                  {note}
                </p>
              ))}

              <div className="preview">
                <div className="player">
                  <video
                    ref={videoRef}
                    controls
                    src={selected.id ? `/api/jobs/${selected.id}/source` : undefined}
                    onTimeUpdate={(event) => setPlayhead(event.currentTarget.currentTime)}
                  />
                  <Timeline
                    duration={selected.duration || 0}
                    events={events}
                    clips={clips}
                    playhead={playhead}
                    activeClipId={selectedClipId}
                    onSeek={seekTo}
                  />
                </div>
                <aside className="preview-side">
                  <label className="toggle compact">
                    <input
                      type="checkbox"
                      checked={showHud}
                      onChange={(event) => setShowHud(event.target.checked)}
                    />
                    HUD calibration
                  </label>
                  {showHud && (
                    <img
                      alt="HUD calibration overlay with detection boxes"
                      src={`/api/jobs/${selected.id}/calibration`}
                      onError={(event) => {
                        event.currentTarget.style.display = "none";
                      }}
                    />
                  )}
                  {Object.keys(selected.event_summary || {}).length > 0 && (
                    <div className="summary-grid">
                      {Object.entries(selected.event_summary)
                        .sort((a, b) => b[1] - a[1])
                        .map(([type, count]) => (
                          <button
                            key={type}
                            type="button"
                            className={`chip ${eventFilter === type ? "on" : ""}`}
                            onClick={() => setEventFilter((current) => (current === type ? "all" : type))}
                          >
                            <i style={{ background: eventStyle(type).color }} />
                            {eventStyle(type).label} {count}
                          </button>
                        ))}
                    </div>
                  )}
                </aside>
              </div>

              <div className="review">
                <section className="review-col">
                  <div className="panel-head tight">
                    <span>Moments · {kept} kept</span>
                    {clips.length > 0 && (
                      <span className="hint">Click a row to preview its events</span>
                    )}
                  </div>
                  <div className="moments">
                    {clips
                      .slice()
                      .sort((a, b) => a.start - b.start)
                      .map((clip) => {
                        const clipEvents = eventsForClip(events, clip);
                        const open = selectedClipId === clip.id;
                        return (
                          <article
                            key={clip.id}
                            className={`moment ${clip.enabled ? "" : "off"} ${open ? "open" : ""}`}
                          >
                            <button type="button" className="moment-main" onClick={() => selectClip(clip)}>
                              <span className="star">★</span>
                              <span className="score">{Math.round(clip.score)}</span>
                              <span className="time">
                                {formatClock(clip.start, true)}–{formatClock(clip.end, true)}
                              </span>
                              <span className="reason">{clip.reason}</span>
                              <span className="count">{clipEvents.length} events</span>
                            </button>
                            <button
                              type="button"
                              className="btn ghost mini"
                              onClick={() => void toggleClip(clip.id, !clip.enabled)}
                            >
                              {clip.enabled ? "Keep" : "Skip"}
                            </button>
                            {open && (
                              <ul className="moment-events">
                                {clipEvents.length === 0 && <li className="notes">No events in this window.</li>}
                                {clipEvents.map((event) => (
                                  <li key={event.id}>
                                    <EventRow
                                      event={event}
                                      active={event.id === activeEventId}
                                      onSeek={seekTo}
                                    />
                                  </li>
                                ))}
                              </ul>
                            )}
                          </article>
                        );
                      })}
                    {analysing && clips.length === 0 && (
                      <p className="notes">Reading HUD, audio peaks, and scene cuts…</p>
                    )}
                    {selected.status === "ready" && clips.length === 0 && (
                      <p className="notes">No scored moments. Check the HUD calibration overlay.</p>
                    )}
                  </div>
                </section>

                <section className="review-col events-col">
                  <div className="panel-head tight">
                    <span>
                      All events · {visibleEvents.length}
                      {visibleEvents.length !== events.length ? ` / ${events.length}` : ""}
                    </span>
                    <div className="event-tools">
                      <button
                        type="button"
                        className={`btn ghost mini ${eventFilter === "all" ? "on" : ""}`}
                        onClick={() => setEventFilter("all")}
                      >
                        All types
                      </button>
                      <button
                        type="button"
                        className={`btn ghost mini ${momentOnly ? "on" : ""}`}
                        disabled={!selectedClip}
                        onClick={() => setMomentOnly((value) => !value)}
                      >
                        This moment
                      </button>
                    </div>
                  </div>
                  <div className="event-list" ref={eventListRef}>
                    {events.length === 0 && (
                      <p className="notes">
                        {analysing
                          ? "Events will appear here as soon as analysis finishes."
                          : "No events yet for this clip."}
                      </p>
                    )}
                    {visibleEvents.map((event) => (
                      <EventRow
                        key={event.id}
                        event={event}
                        active={event.id === activeEventId}
                        dim={Boolean(selectedClip && !eventsForClip([event], selectedClip).length)}
                        onSeek={seekTo}
                      />
                    ))}
                  </div>
                </section>
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
                  type="button"
                  className="btn"
                  disabled={busy || !canRender}
                  onClick={() => void render(["youtube", "clips"])}
                >
                  Generate YouTube video
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  disabled={busy || !canRender}
                  onClick={() => void render(["shorts"])}
                >
                  Generate shorts
                </button>
              </div>

              {Object.entries(selected.outputs).map(([kind, files]) => (
                <div key={kind} className="outputs">
                  <strong>{kind}</strong>
                  {files.map((file) => (
                    <a key={file} href={`/api/jobs/${selected.id}/file?path=${encodeURIComponent(file)}`}>
                      {file.split(/[\\/]/).slice(-2).join("/")}
                    </a>
                  ))}
                </div>
              ))}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function EventRow({
  event,
  active,
  dim,
  onSeek,
}: {
  event: EventItem;
  active?: boolean;
  dim?: boolean;
  onSeek: (time: number) => void;
}) {
  const style = eventStyle(event.type);
  return (
    <button
      type="button"
      data-event-id={event.id}
      className={`event-row ${active ? "active" : ""} ${dim ? "dim" : ""}`}
      onClick={() => onSeek(event.time)}
    >
      <span className="badge" style={{ background: style.color }}>
        {style.label}
      </span>
      <span className="time">{formatClock(event.time, true)}</span>
      <span className="detail">{eventDetail(event)}</span>
    </button>
  );
}

function Timeline({
  duration,
  events,
  clips,
  playhead,
  activeClipId,
  onSeek,
}: {
  duration: number;
  events: EventItem[];
  clips: Clip[];
  playhead: number;
  activeClipId: string | null;
  onSeek: (time: number) => void;
}) {
  if (!duration) return null;
  return (
    <div
      className="timeline"
      role="slider"
      aria-label="Clip timeline"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(playhead)}
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const ratio = (event.clientX - rect.left) / rect.width;
        onSeek(ratio * duration);
      }}
    >
      {clips.map((clip) => (
        <i
          key={clip.id}
          className={`clip-span ${clip.enabled ? "" : "off"} ${activeClipId === clip.id ? "on" : ""}`}
          style={{
            left: `${(clip.start / duration) * 100}%`,
            width: `${((clip.end - clip.start) / duration) * 100}%`,
          }}
        />
      ))}
      {events.map((event) => (
        <b
          key={event.id}
          className="tick"
          title={`${eventStyle(event.type).label} ${formatClock(event.time, true)}`}
          style={{
            left: `${(event.time / duration) * 100}%`,
            background: eventStyle(event.type).color,
          }}
        />
      ))}
      <em className="playhead" style={{ left: `${(playhead / duration) * 100}%` }} />
    </div>
  );
}
