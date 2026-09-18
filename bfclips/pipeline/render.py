from __future__ import annotations

import shlex
from dataclasses import dataclass, field
from pathlib import Path

from bfclips.config import Settings, get_settings
from bfclips.schemas import ClipDecision, EditDocument, EventsDocument
from bfclips.services.ffmpeg import find_font, run, which_ffmpeg


@dataclass
class RenderStep:
    name: str
    cmd: list[str]
    output: Path


@dataclass
class RenderPlan:
    steps: list[RenderStep] = field(default_factory=list)
    outputs: dict[str, list[str]] = field(default_factory=dict)


def escape_drawtext(text: str) -> str:
    return (
        text.replace("\\", "\\\\")
        .replace(":", "\\:")
        .replace("'", "\\'")
        .replace("%", "%%")
    )


def relative_time(abs_time: float, clip_start: float) -> float:
    return max(0.0, abs_time - clip_start)


def map_after_slowmo(t: float, start: float, end: float, rate: float) -> float:
    if t <= start:
        return t
    if t <= end:
        return start + (t - start) / max(rate, 0.05)
    return start + (end - start) / max(rate, 0.05) + (t - end)


def atempo_filters(rate: float) -> str:
    # FFmpeg atempo accepts 0.5–100. Chain to reach slower rates.
    filters: list[str] = []
    remaining = rate
    if remaining >= 0.5:
        return f"atempo={remaining:.3f}"
    while remaining < 0.5:
        filters.append("atempo=0.5")
        remaining /= 0.5
    filters.append(f"atempo={remaining:.3f}")
    return ",".join(filters)


def clip_video_filter(
    clip: ClipDecision,
    punch_in: bool,
    captions: bool,
    font: str | None,
    width: int,
    height: int,
) -> str:
    filters = [f"scale={width}:{height}:force_original_aspect_ratio=decrease"]
    filters.append(f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2")
    filters.append("setsar=1")
    chain = "[0:v]" + ",".join(filters)
    current = "v0"
    parts = [f"{chain}[{current}]"]

    if punch_in:
        zooms = [e for e in clip.effects if e.type == "zoom" and e.time is not None]
        for i, zoom in enumerate(zooms):
            t = relative_time(zoom.time or 0, clip.start)
            dur = zoom.duration or 0.38
            scale = zoom.scale or 1.16
            src = current
            zname = f"z{i}"
            oname = f"v{i + 1}"
            parts.append(
                f"[{src}]split[{src}b][{src}z];"
                f"[{src}z]scale=iw*{scale:.3f}:ih*{scale:.3f},"
                f"crop={width}:{height}:(iw-{width})/2:(ih-{height})/2[{zname}];"
                f"[{src}b][{zname}]overlay=enable='between(t,{t:.3f},{t + dur:.3f})'[{oname}]"
            )
            current = oname

    caption = next((e for e in clip.effects if e.type == "caption" and e.text), None)
    if captions and caption and caption.text and font:
        t = relative_time(caption.time or clip.start, clip.start)
        dur = caption.duration or 2.2
        nxt = current + "c"
        text = escape_drawtext(caption.text.upper())
        parts.append(
            f"[{current}]drawtext=fontfile='{font}':text='{text}':"
            f"fontsize=64:fontcolor=white:borderw=4:bordercolor=black:"
            f"x=(w-text_w)/2:y=h*0.10:enable='between(t,{t:.3f},{t + dur:.3f})'[{nxt}]"
        )
        current = nxt

    parts.append(f"[{current}]format=yuv420p[vout]")
    return ";".join(parts)


def slowmo_filter(clip: ClipDecision, has_audio: bool) -> str | None:
    effect = next((e for e in clip.effects if e.type == "slowmo" and e.start and e.end), None)
    if not effect:
        return None
    start = relative_time(effect.start or 0, clip.start)
    end = relative_time(effect.end or 0, clip.start)
    length = clip.end - clip.start
    start = min(max(0.05, start), length - 0.2)
    end = min(max(start + 0.15, end), length - 0.02)
    rate = effect.rate or 0.42
    video = (
        f"[0:v]trim=0:{start:.3f},setpts=PTS-STARTPTS[v0];"
        f"[0:v]trim={start:.3f}:{end:.3f},setpts=PTS-STARTPTS,setpts=PTS/{rate:.3f}[v1];"
        f"[0:v]trim={end:.3f}:{length:.3f},setpts=PTS-STARTPTS[v2];"
        f"[v0][v1][v2]concat=n=3:v=1:a=0[vout]"
    )
    if not has_audio:
        return video
    audio = (
        f"[0:a]atrim=0:{start:.3f},asetpts=PTS-STARTPTS[a0];"
        f"[0:a]atrim={start:.3f}:{end:.3f},asetpts=PTS-STARTPTS,{atempo_filters(rate)}[a1];"
        f"[0:a]atrim={end:.3f}:{length:.3f},asetpts=PTS-STARTPTS[a2];"
        f"[a0][a1][a2]concat=n=3:v=0:a=1[aout]"
    )
    return video + ";" + audio


def vertical_filter(width: int = 1080, height: int = 1920) -> str:
    return (
        f"[0:v]scale={height}:{height}:force_original_aspect_ratio=increase,"
        f"crop={width}:{height},setsar=1,format=yuv420p[vout]"
    )


def build_plan(
    source: Path,
    events: EventsDocument,
    edit: EditDocument,
    output_dir: Path,
    work_dir: Path,
    targets: list[str],
    settings: Settings | None = None,
    stem: str = "bfclips",
) -> RenderPlan:
    settings = settings or get_settings()
    font = find_font()
    has_audio = events.source.audio
    enabled = [c for c in edit.clips if c.enabled]
    enabled_chrono = sorted(enabled, key=lambda c: c.start)
    plan = RenderPlan()
    clips_dir = output_dir / "clips"
    youtube_dir = output_dir / "youtube"
    shorts_dir = output_dir / "shorts"
    tmp = work_dir / "render"
    tmp.mkdir(parents=True, exist_ok=True)

    clip_files: list[Path] = []
    for clip in enabled_chrono:
        raw = tmp / f"{clip.id}_raw.mp4"
        styled = tmp / f"{clip.id}_styled.mp4"
        final = clips_dir / f"{clip.id}.mp4"
        plan.steps.append(
            RenderStep(
                name=f"cut-{clip.id}",
                cmd=_cut_cmd(source, clip, raw, settings, has_audio),
                output=raw,
            )
        )
        plan.steps.append(
            RenderStep(
                name=f"style-{clip.id}",
                cmd=_style_cmd(
                    raw,
                    styled,
                    clip,
                    edit,
                    font,
                    has_audio,
                    settings,
                    1920,
                    1080,
                ),
                output=styled,
            )
        )
        if any(e.type == "slowmo" for e in clip.effects):
            slowed = tmp / f"{clip.id}_slow.mp4"
            plan.steps.append(
                RenderStep(
                    name=f"slowmo-{clip.id}",
                    cmd=_slowmo_cmd(styled, slowed, clip, has_audio, settings),
                    output=slowed,
                )
            )
            styled = slowed
        plan.steps.append(
            RenderStep(
                name=f"publish-{clip.id}",
                cmd=_copy_cmd(styled, final),
                output=final,
            )
        )
        clip_files.append(final)

    if "clips" in targets:
        plan.outputs.setdefault("clips", [str(p) for p in clip_files])

    if "youtube" in targets and clip_files:
        youtube_dir.mkdir(parents=True, exist_ok=True)
        concat_list = tmp / "youtube.txt"
        youtube = youtube_dir / f"{stem}.mp4"
        plan.steps.append(
            RenderStep(
                name="youtube-concat",
                cmd=_concat_cmd(concat_list, clip_files, youtube, settings),
                output=youtube,
            )
        )
        plan.outputs.setdefault("youtube", [str(youtube)])

    if "shorts" in targets:
        shorts_dir.mkdir(parents=True, exist_ok=True)
        scored = sorted(enabled, key=lambda c: c.score, reverse=True)
        limit = 5
        short_files: list[Path] = []
        for clip in scored[:limit]:
            src = clips_dir / f"{clip.id}.mp4"
            dest = shorts_dir / f"{stem}-{clip.id}.mp4"
            plan.steps.append(
                RenderStep(
                    name=f"short-{clip.id}",
                    cmd=_vertical_cmd(src, dest, has_audio, settings),
                    output=dest,
                )
            )
            short_files.append(dest)
        plan.outputs.setdefault("shorts", [str(p) for p in short_files])

    return plan


def execute_plan(plan: RenderPlan, progress=None) -> dict[str, list[str]]:
    total = max(1, len(plan.steps))
    for i, step in enumerate(plan.steps, start=1):
        step.output.parent.mkdir(parents=True, exist_ok=True)
        if step.name == "youtube-concat":
            _write_concat_list(step.cmd)
        run(step.cmd)
        if progress:
            progress(i / total, step.name)
    return plan.outputs


def render_job(
    source: Path,
    events: EventsDocument,
    edit: EditDocument,
    output_dir: Path,
    work_dir: Path,
    targets: list[str],
    settings: Settings | None = None,
    stem: str = "bfclips",
    progress=None,
) -> dict[str, list[str]]:
    plan = build_plan(source, events, edit, output_dir, work_dir, targets, settings, stem)
    return execute_plan(plan, progress)


def _cut_cmd(
    source: Path, clip: ClipDecision, dest: Path, settings: Settings, has_audio: bool
) -> list[str]:
    cmd = [
        which_ffmpeg(),
        "-y",
        "-ss",
        f"{clip.start:.3f}",
        "-to",
        f"{clip.end:.3f}",
        "-i",
        str(source),
        "-c:v",
        "libx264",
        "-preset",
        settings.ffmpeg_preset,
        "-crf",
        str(settings.ffmpeg_crf),
        "-pix_fmt",
        "yuv420p",
    ]
    if has_audio:
        cmd += ["-c:a", "aac", "-b:a", "192k"]
    else:
        cmd += ["-an"]
    cmd.append(str(dest))
    return cmd


def _style_cmd(
    source: Path,
    dest: Path,
    clip: ClipDecision,
    edit: EditDocument,
    font: str | None,
    has_audio: bool,
    settings: Settings,
    width: int,
    height: int,
) -> list[str]:
    vf = clip_video_filter(
        clip,
        punch_in=edit.timeline.punch_in,
        captions=edit.timeline.auto_captions,
        font=font,
        width=width,
        height=height,
    )
    cmd = [
        which_ffmpeg(),
        "-y",
        "-i",
        str(source),
        "-filter_complex",
        vf,
        "-map",
        "[vout]",
        "-c:v",
        "libx264",
        "-preset",
        settings.ffmpeg_preset,
        "-crf",
        str(settings.ffmpeg_crf),
    ]
    if has_audio:
        audio_f = "aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo"
        if edit.timeline.audio_enhance:
            audio_f = "highpass=f=70,dynaudnorm=f=120:g=12," + audio_f
        cmd += ["-filter:a", audio_f, "-c:a", "aac", "-b:a", "192k"]
    else:
        cmd += ["-an"]
    cmd.append(str(dest))
    return cmd


def _slowmo_cmd(
    source: Path, dest: Path, clip: ClipDecision, has_audio: bool, settings: Settings
) -> list[str]:
    graph = slowmo_filter(clip, has_audio)
    assert graph
    cmd = [
        which_ffmpeg(),
        "-y",
        "-i",
        str(source),
        "-filter_complex",
        graph,
        "-map",
        "[vout]",
        "-c:v",
        "libx264",
        "-preset",
        settings.ffmpeg_preset,
        "-crf",
        str(settings.ffmpeg_crf),
    ]
    if has_audio:
        cmd += ["-map", "[aout]", "-c:a", "aac", "-b:a", "192k"]
    else:
        cmd += ["-an"]
    cmd.append(str(dest))
    return cmd


def _copy_cmd(source: Path, dest: Path) -> list[str]:
    return [which_ffmpeg(), "-y", "-i", str(source), "-c", "copy", str(dest)]


def _concat_cmd(list_path: Path, files: list[Path], dest: Path, settings: Settings) -> list[str]:
    # The list file is written just-in-time in execute_plan / _write_concat_list.
    list_path.write_text(
        "".join(f"file {shlex.quote(str(path.resolve()))}\n" for path in files),
        encoding="utf-8",
    )
    return [
        which_ffmpeg(),
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        str(list_path),
        "-c",
        "copy",
        str(dest),
    ]


def _write_concat_list(cmd: list[str]) -> None:
    # Already written by _concat_cmd; hook kept for execute_plan symmetry.
    return


def _vertical_cmd(source: Path, dest: Path, has_audio: bool, settings: Settings) -> list[str]:
    cmd = [
        which_ffmpeg(),
        "-y",
        "-i",
        str(source),
        "-filter_complex",
        vertical_filter(),
        "-map",
        "[vout]",
        "-c:v",
        "libx264",
        "-preset",
        settings.ffmpeg_preset,
        "-crf",
        str(settings.ffmpeg_crf),
    ]
    if has_audio:
        cmd += ["-map", "0:a?", "-c:a", "aac", "-b:a", "192k"]
    else:
        cmd += ["-an"]
    cmd.append(str(dest))
    return cmd
