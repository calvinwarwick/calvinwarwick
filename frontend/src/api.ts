export type EventItem = {
  id: string;
  time: number;
  type: string;
  confidence: number;
  end: number | null;
  source: string;
  meta: Record<string, unknown>;
};

export type Clip = {
  id: string;
  start: number;
  end: number;
  score: number;
  reason: string;
  enabled: boolean;
  caption: string | null;
  kill_count: number;
  event_ids: string[];
  effects: Array<Record<string, unknown>>;
};

export type Job = {
  id: string;
  filename: string;
  source_path: string;
  status: string;
  stage: string;
  progress: number;
  error: string | null;
  duration: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  clips: Clip[];
  events: EventItem[];
  event_summary: Record<string, number>;
  event_count: number;
  outputs: Record<string, string[]>;
  notes: string[];
  created_at: string | null;
};

export type Health = {
  ok: boolean;
  incoming: string;
  watch: boolean;
  ollama: boolean;
  whisper: boolean;
  gpu: string;
};

export type Settings = {
  incoming_dir: string;
  output_dir: string;
  hud_preset: string;
  ollama_model: string;
  ollama_enabled: boolean;
  whisper_model: string;
  whisper_device: string;
  whisper_enabled: boolean;
  sample_fps: number;
  ffmpeg_preset: string;
  ffmpeg_crf: number;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || response.statusText);
  }
  return response.json() as Promise<T>;
}

export const api = {
  health: () => request<Health>("/api/health"),
  settings: () => request<Settings>("/api/settings"),
  saveSettings: (body: Partial<Settings>) =>
    request<Settings>("/api/settings", { method: "PUT", body: JSON.stringify(body) }),
  jobs: () => request<Job[]>("/api/jobs"),
  job: (id: string) => request<Job>(`/api/jobs/${id}`),
  events: (id: string) => request<{ events: EventItem[] }>(`/api/jobs/${id}/events`),
  upload: async (file: File) => {
    const data = new FormData();
    data.append("file", file);
    const response = await fetch("/api/jobs/upload", { method: "POST", body: data });
    if (!response.ok) throw new Error(await response.text());
    return response.json() as Promise<Job>;
  },
  sample: () => request<Job>("/api/jobs/sample", { method: "POST" }),
  patchClip: (jobId: string, clipId: string, body: Partial<Clip>) =>
    request<Job>(`/api/jobs/${jobId}/clips/${clipId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  feedback: (jobId: string, clipId: string, approved: boolean) =>
    request(`/api/jobs/${jobId}/feedback`, {
      method: "POST",
      body: JSON.stringify({ clip_id: clipId, approved }),
    }),
  render: (
    jobId: string,
    targets: string[],
    options: {
      auto_captions: boolean;
      punch_in: boolean;
      remove_dead_time: boolean;
      audio_enhance: boolean;
    },
  ) =>
    request<Job>(`/api/jobs/${jobId}/render`, {
      method: "POST",
      body: JSON.stringify({ targets, ...options }),
    }),
};
