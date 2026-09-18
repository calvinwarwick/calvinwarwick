from __future__ import annotations

import json

import httpx

from bfclips.schemas import EditDocument, EventsDocument


PROMPT = """You are editing a Battlefield kill montage for the BFCLIPS channel.
Given detected events and candidate clips, rewrite each clip reason in 6-12 words
and suggest a short uppercase caption. Do not add or remove clips.
Do not invent kills that are not in the events.
Return JSON: {"clips": [{"id": "...", "reason": "...", "caption": "..."}]}
"""


def enrich_edit(
    edit: EditDocument,
    events: EventsDocument,
    url: str,
    model: str,
) -> EditDocument:
    payload = {
        "model": model,
        "stream": False,
        "format": "json",
        "messages": [
            {"role": "system", "content": PROMPT},
            {
                "role": "user",
                "content": json.dumps(
                    {
                        "events": [e.model_dump() for e in events.events[:80]],
                        "clips": [c.model_dump() for c in edit.clips],
                    }
                ),
            },
        ],
    }
    try:
        response = httpx.post(f"{url.rstrip('/')}/api/chat", json=payload, timeout=20)
        response.raise_for_status()
        content = response.json().get("message", {}).get("content", "")
        data = json.loads(content)
    except Exception:
        return edit

    by_id = {item.get("id"): item for item in data.get("clips", []) if item.get("id")}
    for clip in edit.clips:
        extra = by_id.get(clip.id)
        if not extra:
            continue
        if extra.get("reason"):
            clip.reason = str(extra["reason"])[:160]
        if extra.get("caption"):
            clip.caption = str(extra["caption"])[:40]
    edit.editor = f"rules-v1+{model}"
    return edit


def ollama_ready(url: str) -> bool:
    try:
        response = httpx.get(f"{url.rstrip('/')}/api/tags", timeout=1.5)
        return response.status_code == 200
    except Exception:
        return False
