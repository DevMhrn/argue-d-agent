"""Audio extractor — two-call pipeline: Whisper + Claude events.

CALL 1 — OpenAI Whisper (`whisper-1` by default):
  Transcribes the audio with `verbose_json` + `timestamp_granularities=[segment]`.
  Whisper-1 is intentional: it's the only OpenAI transcription model that
  emits per-segment timestamps, and those segments are what make audio
  citations resolve back to a (start_sec, end_sec) window in the original
  recording. The cost is the same as gpt-4o-transcribe ($0.006/min) but
  with the segment payload we don't get from the newer models.

  Env override: set `LUMEN_AUDIO_MODEL=gpt-4o-transcribe` if you want
  marginal accuracy gains and don't need segment-level anchoring.

CALL 2 — Claude (`claude-sonnet-4-6`) extracts structured EVENTS:
  The transcript is fed back to Claude with [HH:MM:SS] markers per segment.
  Claude returns an EVENTS block — typed event bullets with timestamps
  (admissions, dispatch instructions, citations, requests, etc.). These
  bullets become substring-anchorable Facts downstream.

PAGE TEXT shape:

    TRANSCRIPT:
    Dispatch, this is unit 12. We have a collision at 5th and Main...
    Vehicle 2 driver admits running the red...

    EVENTS:
    - [00:03:42] [admission] Vehicle 2 driver admits running the red signal.
    - [00:04:18] [request] Officer Rivera requests tow truck for Vehicle 1.
    - [00:05:02] [statement] Both drivers confirm no injuries on scene.

Both blocks are substring-anchorable, so a downstream Fact can cite either.
The transcript stays in its native form for citation flexibility; the EVENTS
block makes the ledger lane's job much easier because the "ledger-worthy"
items are already typed and timestamped.

SIZE HANDLING: Whisper's hard cap is 25 MB. For larger files we transcode
to a small mono mp3 first; if still too large we chunk via ffmpeg with
`copy` segmentation and merge timestamps. EVENTS extraction runs once per
chunk after transcription.

GRACEFUL DEGRADATION: if the EVENTS call fails (network blip, Claude key
missing) the transcript is still persisted — the page just lacks the
typed events block. The page is never lost over a secondary call failure.

MOCK MODE (`LUMEN_MOCK=1` or no `OPENAI_API_KEY`): returns a canned
transcript + EVENTS so the full pipeline runs without any spend.
"""
from __future__ import annotations

import asyncio
import logging
import os
import shutil
import subprocess
import tempfile
from typing import Any, Optional

import httpx

from backend.app.providers import is_mock

from .base import ExtractedDocument, ExtractedPage

log = logging.getLogger("lumen.ingestion.audio")

# Whisper (transcription) ------------------------------------------------------
WHISPER_URL = "https://api.openai.com/v1/audio/transcriptions"
DEFAULT_WHISPER_MODEL = "whisper-1"           # only model with segment timestamps
WHISPER_MAX_BYTES = 25 * 1024 * 1024          # OpenAI documented limit
MAX_DURATION_SEC = 60 * 60                    # 1-hour hard cap (~$0.36 worst case)
CHUNK_SECONDS = 15 * 60                       # 15-min chunks when we must split

# Strong vocabulary prompt — biases the model toward proper nouns and statute
# IDs typical of vehicle subrogation audio (dispatch logs, recorded statements,
# arbitration calls). Max 224 tokens per OpenAI docs; we sit well under.
WHISPER_PROMPT = (
    "Insurance subrogation case audio. Vocabulary likely to appear: "
    "subrogation, recovery, demand, fault, comparative negligence, "
    "FNOL, EDR, CVC, CHP, citation, intersection, signal, red light, "
    "rear-end, T-bone, totaled, deductible, claimant, insured, "
    "adjuster, arbitration, ten-codes (10-4, 10-20), case numbers in "
    "the form CLM-YYYY-NNNN, vehicle identifiers, license plates."
)

# Claude (events extraction) ---------------------------------------------------
ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_VERSION = "2023-06-01"
DEFAULT_EVENTS_MODEL = "claude-sonnet-4-6"

EVENTS_SYSTEM_PROMPT = """You read a verbatim transcript of an audio recording from an insurance subrogation case and extract a structured list of EVENTS. The transcript is presented as a sequence of segments, each prefixed with its start timestamp in [HH:MM:SS] form.

Return EXACTLY one block under the header "EVENTS:". One bullet per discrete event. Format each bullet as:

  - [HH:MM:SS] [type] <one factual sentence under 30 words>

Allowed event types (use the EXACT tag, lowercase, in square brackets):
  [admission]  - someone admits fault or a violation
  [statement]  - a factual claim by a speaker (witness, party, officer)
  [request]    - a request for resources (tow, ambulance, backup, info)
  [citation]   - a ticket / charge / statute reference issued or mentioned
  [dispatch]   - dispatcher instruction or radio call
  [observation]- something a speaker reports observing (state of road, signals, damage)
  [identifier] - a named identifier (claim id, plate, badge number, location)

Rules:
- The timestamp MUST be one that actually appears in the transcript (pick the segment that contains the event).
- One event per bullet; do not bundle multiple events into one line.
- Use ONLY information present in the transcript. Never infer beyond what was said.
- If the transcript contains no ledger-worthy events, return: "EVENTS:\\n- [00:00:00] [observation] no extractable events in this recording."
- No preamble, no commentary, no closing notes. Just the EVENTS block.
"""

EVENTS_USER_TEMPLATE = (
    "TRANSCRIPT (segments with [HH:MM:SS] start markers):\n\n{segmented}\n\n"
    "Extract the EVENTS block following the system rules."
)


class AudioExtractor:
    mime_types = (
        "audio/mpeg",      # mp3
        "audio/mp4",       # mp4 audio container
        "audio/x-m4a",     # m4a (Apple)
        "audio/m4a",
        "audio/wav",
        "audio/x-wav",
        "audio/webm",
    )

    def extract(self, file_bytes: bytes, *, filename: str) -> ExtractedDocument:
        if is_mock() or not os.environ.get("OPENAI_API_KEY"):
            return _mock_transcript(filename, len(file_bytes))
        return asyncio.run(_extract_async(file_bytes, filename))


# ----- mock --------------------------------------------------------------------

def _mock_transcript(filename: str, byte_count: int) -> ExtractedDocument:
    """Canned transcript + EVENTS for mock mode. Substring-quotable so the
    Fact Gate can anchor against either block in tests."""
    transcript = (
        "Dispatch, this is unit twelve. We have a two-vehicle collision at "
        "Fifth Avenue and Main Street. "
        "Officer Rivera on scene, badge four four two one. "
        "Driver of Vehicle Two admits entering the intersection on a red signal. "
        "No injuries reported on scene. "
        "Tow truck requested for Vehicle One, front-end totaled. "
        "Vehicle Two driver cited under CVC twenty-one four five three for "
        "failing to stop at a red signal."
    )
    segments = [
        {"start": 0.0,  "end": 6.4,  "text": "Dispatch, this is unit twelve. We have a two-vehicle collision at Fifth Avenue and Main Street."},
        {"start": 6.4,  "end": 12.1, "text": "Officer Rivera on scene, badge four four two one."},
        {"start": 12.1, "end": 19.8, "text": "Driver of Vehicle Two admits entering the intersection on a red signal."},
        {"start": 19.8, "end": 23.5, "text": "No injuries reported on scene."},
        {"start": 23.5, "end": 28.2, "text": "Tow truck requested for Vehicle One, front-end totaled."},
        {"start": 28.2, "end": 36.0, "text": "Vehicle Two driver cited under CVC twenty-one four five three for failing to stop at a red signal."},
    ]
    events = (
        "- [00:00:00] [dispatch] Unit twelve reports a two-vehicle collision at Fifth Avenue and Main Street.\n"
        "- [00:00:06] [identifier] Officer Rivera, badge four four two one, on scene.\n"
        "- [00:00:12] [admission] Vehicle Two driver admits entering the intersection on a red signal.\n"
        "- [00:00:19] [statement] No injuries reported by either party on scene.\n"
        "- [00:00:23] [request] Tow truck requested for Vehicle One, declared front-end totaled.\n"
        "- [00:00:28] [citation] Vehicle Two driver cited under CVC 21453 for failing to stop at a red signal."
    )
    page_text = _compose_page_text(transcript, events)
    return ExtractedDocument(
        pages=[
            ExtractedPage(
                page_number=1,
                text=page_text,
                metadata={
                    "extractor": "audio",
                    "model": "mock",
                    "events_model": "mock",
                    "language": "english",
                    "duration_sec": 36.0,
                    "chunk_start_sec": 0.0,
                    "segments": segments,
                    "events": events,
                    "source_location": f"00:00-00:36 in {filename}",
                    "mock": True,
                },
            )
        ],
        document_metadata={
            "extractor": "audio",
            "model": "mock",
            "events_model": "mock",
            "mock": True,
            "byte_count": byte_count,
            "chunk_count": 1,
        },
    )


# ----- real extraction ---------------------------------------------------------

async def _extract_async(file_bytes: bytes, filename: str) -> ExtractedDocument:
    openai_key = os.environ["OPENAI_API_KEY"]
    anthropic_key = os.environ.get("ANTHROPIC_API_KEY")
    whisper_model = os.environ.get("LUMEN_AUDIO_MODEL", DEFAULT_WHISPER_MODEL)
    events_model = os.environ.get("LUMEN_AUDIO_EVENTS_MODEL", DEFAULT_EVENTS_MODEL)

    chunks = _prepare_chunks(file_bytes, filename)
    pages: list[ExtractedPage] = []

    async with httpx.AsyncClient(timeout=httpx.Timeout(180.0, connect=10.0)) as client:
        for idx, (chunk_bytes, chunk_filename, chunk_start_sec) in enumerate(chunks, start=1):
            # Call 1: Whisper transcription with segments.
            whisper_result = await _call_whisper(
                client, openai_key, whisper_model, chunk_bytes, chunk_filename
            )

            # Build segments with global timestamps (chunk_start_sec offset).
            transcript_text: str = whisper_result.get("text", "").strip()
            segments = _segments_with_offset(whisper_result, chunk_start_sec)
            duration = float(whisper_result.get("duration", 0.0))
            language = whisper_result.get("language")

            # Call 2: Claude reads the segmented transcript and emits EVENTS.
            events_text = await _extract_events(
                client, anthropic_key, events_model, segments, transcript_text,
            )

            page_text = _compose_page_text(transcript_text, events_text)
            chunk_end_sec = chunk_start_sec + duration
            pages.append(
                ExtractedPage(
                    page_number=idx,
                    text=page_text,
                    metadata={
                        "extractor": "audio",
                        "model": whisper_model,
                        "events_model": events_model if events_text else None,
                        "language": language,
                        "duration_sec": duration,
                        "chunk_start_sec": chunk_start_sec,
                        "segments": segments,
                        "events": events_text,
                        "source_location": (
                            f"{_fmt_time(chunk_start_sec)}-{_fmt_time(chunk_end_sec)} "
                            f"in {filename}"
                        ),
                    },
                )
            )

    return ExtractedDocument(
        pages=pages,
        document_metadata={
            "extractor": "audio",
            "model": whisper_model,
            "events_model": events_model,
            "chunk_count": len(pages),
        },
    )


async def _call_whisper(
    client: httpx.AsyncClient,
    api_key: str,
    model: str,
    chunk_bytes: bytes,
    chunk_filename: str,
) -> dict[str, Any]:
    files = {"file": (chunk_filename, chunk_bytes, "application/octet-stream")}
    data: dict[str, Any] = {
        "model": model,
        "response_format": "verbose_json",
        "timestamp_granularities[]": "segment",
        "prompt": WHISPER_PROMPT,
        "temperature": "0",
    }
    resp = await client.post(
        WHISPER_URL,
        headers={"Authorization": f"Bearer {api_key}"},
        files=files,
        data=data,
    )
    if resp.status_code >= 400:
        raise RuntimeError(
            f"Whisper API {resp.status_code}: {resp.text[:300]}"
        )
    return resp.json()


def _segments_with_offset(
    whisper_result: dict[str, Any], chunk_start_sec: float
) -> list[dict[str, Any]]:
    """Apply the chunk offset so all segments carry global timestamps."""
    raw = whisper_result.get("segments", []) or []
    return [
        {
            "start": float(s["start"]) + chunk_start_sec,
            "end": float(s["end"]) + chunk_start_sec,
            "text": s.get("text", "").strip(),
        }
        for s in raw
    ]


async def _extract_events(
    client: httpx.AsyncClient,
    anthropic_key: Optional[str],
    events_model: str,
    segments: list[dict[str, Any]],
    transcript_fallback: str,
) -> str:
    """Send the segmented transcript to Claude and return its EVENTS block.

    Graceful degradation: any failure here (missing key, network error, API
    error, parse error) is logged and we return an empty string. The
    transcript itself is already persisted; losing the events block does
    not lose the page.
    """
    if not anthropic_key:
        log.info("audio events: ANTHROPIC_API_KEY not set; skipping events extraction")
        return ""
    if not segments and not transcript_fallback.strip():
        return ""

    segmented = _render_segments_for_events(segments, transcript_fallback)
    user_text = EVENTS_USER_TEMPLATE.format(segmented=segmented)

    body = {
        "model": events_model,
        "max_tokens": 1024,
        "system": EVENTS_SYSTEM_PROMPT,
        "messages": [{"role": "user", "content": user_text}],
    }

    try:
        resp = await client.post(
            ANTHROPIC_URL,
            headers={
                "x-api-key": anthropic_key,
                "anthropic-version": ANTHROPIC_VERSION,
                "content-type": "application/json",
            },
            json=body,
        )
        if resp.status_code >= 400:
            log.warning(
                "audio events: Claude API %s: %s",
                resp.status_code, resp.text[:200],
            )
            return ""
        data = resp.json()
    except httpx.HTTPError as e:
        log.warning("audio events: network error: %s", e)
        return ""

    full_text = _extract_assistant_text(data)
    return _extract_events_block(full_text)


def _render_segments_for_events(
    segments: list[dict[str, Any]], transcript_fallback: str
) -> str:
    """Render the segmented transcript with [HH:MM:SS] start markers per line.

    If the segments list is empty (some Whisper responses don't include
    them), fall back to a single line with the full transcript at 00:00:00.
    """
    if not segments:
        return f"[00:00:00] {transcript_fallback.strip()}"
    return "\n".join(
        f"[{_fmt_time(seg['start'])}] {seg['text']}"
        for seg in segments
    )


def _extract_assistant_text(api_resp: dict[str, Any]) -> str:
    parts: list[str] = []
    for block in api_resp.get("content", []):
        if block.get("type") == "text":
            parts.append(block.get("text", ""))
    return "\n".join(parts).strip()


def _extract_events_block(text: str) -> str:
    """Pull out the EVENTS:\\n... block. Tolerate the model occasionally
    prefixing the block with stray prose by anchoring on the header."""
    m = re_events_header.search(text)
    if not m:
        return text.strip()
    return text[m.end():].strip()


import re  # late import: only needed for the header pattern

re_events_header = re.compile(r"^\s*EVENTS\s*:\s*$", re.IGNORECASE | re.MULTILINE)


# ----- page composition --------------------------------------------------------

def _compose_page_text(transcript: str, events: str) -> str:
    """Page text = TRANSCRIPT block + EVENTS block. Both substring-anchorable;
    downstream Facts can cite either."""
    parts: list[str] = [f"TRANSCRIPT:\n{transcript.strip()}"]
    if events:
        parts.append(f"EVENTS:\n{events.strip()}")
    return "\n\n".join(parts)


def _fmt_time(sec: float) -> str:
    m, s = divmod(int(sec), 60)
    h, m = divmod(m, 60)
    return f"{h:02d}:{m:02d}:{s:02d}"


# ----- chunking ----------------------------------------------------------------

def _prepare_chunks(
    file_bytes: bytes, filename: str
) -> list[tuple[bytes, str, float]]:
    """Return list of (bytes, filename-for-upload, chunk_start_sec).

    Files ≤ 25 MB go as-is. Larger files: transcode to mono mp3 32 kbps
    (collapses ~10× for typical voice). Still > 25 MB: ffmpeg segment-copy
    into 15-min slices, each with its own start offset."""
    if len(file_bytes) <= WHISPER_MAX_BYTES:
        return [(file_bytes, filename, 0.0)]

    if not _has_ffmpeg():
        raise RuntimeError(
            "Audio file is > 25 MB and ffmpeg is not on PATH. "
            "Install ffmpeg or upload a smaller file (< 25 MB)."
        )

    with tempfile.TemporaryDirectory(prefix="lumen-audio-") as tmp:
        in_path = os.path.join(tmp, "input" + _ext_of(filename))
        with open(in_path, "wb") as f:
            f.write(file_bytes)

        duration = _ffprobe_duration_sec(in_path)
        if duration > MAX_DURATION_SEC:
            raise RuntimeError(
                f"Audio duration {duration:.0f}s exceeds the "
                f"{MAX_DURATION_SEC}s hard cap. Trim or split before upload."
            )

        compact_path = os.path.join(tmp, "compact.mp3")
        _run(
            "ffmpeg", "-y", "-loglevel", "error",
            "-i", in_path, "-ac", "1", "-ar", "16000", "-b:a", "32k",
            compact_path,
        )
        compact_bytes = _read(compact_path)
        if len(compact_bytes) <= WHISPER_MAX_BYTES:
            return [(compact_bytes, "compact.mp3", 0.0)]

        seg_pattern = os.path.join(tmp, "chunk%03d.mp3")
        _run(
            "ffmpeg", "-y", "-loglevel", "error",
            "-i", compact_path,
            "-f", "segment", "-segment_time", str(CHUNK_SECONDS),
            "-c", "copy",
            seg_pattern,
        )

        chunks: list[tuple[bytes, str, float]] = []
        for i in range(0, int(duration / CHUNK_SECONDS) + 2):
            path = os.path.join(tmp, f"chunk{i:03d}.mp3")
            if not os.path.exists(path):
                break
            data = _read(path)
            if not data:
                continue
            chunks.append((data, f"chunk{i:03d}.mp3", float(i * CHUNK_SECONDS)))
        if not chunks:
            raise RuntimeError("ffmpeg produced no chunks — segment step failed.")
        return chunks


def _has_ffmpeg() -> bool:
    return shutil.which("ffmpeg") is not None


def _ffprobe_duration_sec(path: str) -> float:
    try:
        out = subprocess.check_output(
            [
                "ffprobe", "-v", "error", "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1", path,
            ],
            text=True,
        )
        return float(out.strip())
    except (subprocess.CalledProcessError, FileNotFoundError, ValueError):
        return 0.0


def _run(*args: str) -> None:
    res = subprocess.run(list(args), capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"{args[0]} failed: {res.stderr[:300]}")


def _read(path: str) -> bytes:
    with open(path, "rb") as f:
        return f.read()


def _ext_of(filename: str) -> str:
    return os.path.splitext(filename)[1] or ".bin"
