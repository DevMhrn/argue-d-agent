"""Image extractor — Claude vision with a three-block forced prompt.

The Fact Gate downstream substring-checks every cited claim's verbatim_quote
against `document_pages.extracted_text`. Images have no native text, so the
vision model's description IS the canonical "page text" — and the prompt
forces the model into three syntactically separated blocks:

    OBSERVED:
    - <one short factual bullet per line — what is literally visible>
    ...

    NOT_VISIBLE:
    - <what the model explicitly cannot determine>
    ...

    EVENTS:
    - [type] <one bullet per ledger-worthy event derived from OBSERVED>
    ...

`OBSERVED` + `EVENTS` are concatenated into `extracted_text`. Downstream
Facts can cite either — they're both factual, derived from the image, and
substring-anchorable.

`NOT_VISIBLE` is kept in `extraction_metadata` ONLY. Any Fact whose
verbatim_quote substring-anchors inside `NOT_VISIBLE` is a regex-detectable
gate violation in post-processing — the harness catches speculation by
syntax, not by trust in the model.

Cost: Claude Sonnet 4.6 vision is ~$0.0035 input + ~$0.0015 output per
~1100×1100 image (≈$0.005/image, slightly more with the EVENTS block — call
it $0.007/image). We resize images > 2000 px on the long side before
sending.
"""
from __future__ import annotations

import asyncio
import base64
import io
import logging
import os
import re
from typing import Any

import httpx

from backend.app.providers import is_mock

from .base import ExtractedDocument, ExtractedPage

log = logging.getLogger("lumen.ingestion.image")

ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_VERSION = "2023-06-01"

# Env-overridable model choice — defaults to Sonnet 4.6 for balance of
# accuracy + cost. Bump to claude-opus-4-8 via `LUMEN_VISION_MODEL` for
# high-stakes cases where the marginal accuracy is worth the price.
DEFAULT_VISION_MODEL = "claude-sonnet-4-6"

MAX_DIMENSION_PX = 2000          # downscale longer side to this before sending
MAX_INPUT_BYTES = 9 * 1024 * 1024   # under Anthropic's 10 MB base64 limit

SYSTEM_PROMPT = """You analyze a single image submitted as evidence in a vehicle subrogation claim. Capture everything visually relevant — trace the image carefully pixel by pixels, do not skip elements that could matter to a fault / damages / liability analysis downstream.

Return EXACTLY THREE blocks, in this order, separated by one blank line. Use the EXACT headers shown. Do not add a preamble, summary, commentary, or trailing notes outside these blocks.

OBSERVED:
- One short factual bullet per line. Describe ONLY what is visually present.
- Cover (be exhaustive on what applies): vehicles (make / model / color / position / orientation), visible damage (per-vehicle, per-location, per-severity), road surface and any debris or skid marks, traffic signals or signage (state, direction, posted limit if visible), weather indicators (precipitation, lighting, shadows), license plates if readable (transcribe characters EXACTLY), people if visible (count only — no identification), time-of-day cues, anything labeled in-frame (badge numbers, ID strips, evidence markers).
- Each bullet is one sentence under 25 words. Neutral language only. No inferences.

NOT_VISIBLE:
- One short bullet per line stating what you CANNOT determine from this image.
- Cover: driver identity, fault or cause, speed, who-entered-first, anything obscured, anything outside the frame, anything inferred-but-not-shown.
- Be explicit. If a category truly does not apply, write: "n/a — not relevant to this image".

EVENTS:
- One short bullet per line per discrete event or condition that could later be cited as a Fact in a subrogation case. Each EVENT must be directly derivable from one or more OBSERVED bullets — no new content, no speculation, no synthesis with anything outside the image.
- Lead each bullet with a typed prefix in square brackets, then one factual sentence.
  Allowed types: [impact], [position], [damage], [signal], [signage], [road], [weather], [debris], [time], [identifier], [persons].
- Cover at minimum: the impact event itself if visible, position of each involved vehicle, each distinct damage location, every visible traffic-control device state, road / weather / lighting conditions, any readable identifier (plate, badge, evidence tag).
- Be exhaustive but factual — one event per discrete visible thing.

Refuse to speculate. If the image cannot be interpreted (corrupt, opaque, irrelevant), reply with the three headers anyway: OBSERVED gets one bullet "image is unreadable"; NOT_VISIBLE gets "n/a — image unreadable"; EVENTS gets one bullet "[identifier] image is unreadable".
"""

USER_PROMPT = (
    "Describe this evidence image using the three-block format "
    "(OBSERVED / NOT_VISIBLE / EVENTS). Follow the system rules exactly."
)


class ImageExtractor:
    mime_types = (
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/gif",
    )

    def extract(self, file_bytes: bytes, *, filename: str) -> ExtractedDocument:
        if is_mock() or not os.environ.get("ANTHROPIC_API_KEY"):
            return _mock_image(filename, len(file_bytes))
        return asyncio.run(_extract_async(file_bytes, filename))


# ----- mock --------------------------------------------------------------------

def _mock_image(filename: str, byte_count: int) -> ExtractedDocument:
    observed = (
        "- Silver four-door sedan, front-end damage to driver-side wheel well.\n"
        "- Traffic light visible, showing a red signal facing the silver sedan.\n"
        "- Two vehicles in the intersection at a near-perpendicular collision angle.\n"
        "- Dry pavement, daylight, no visible weather indicators.\n"
        "- License plate on near vehicle not readable from this angle."
    )
    not_visible = (
        "- Driver identity for either vehicle.\n"
        "- Which vehicle entered the intersection first.\n"
        "- Vehicle speeds at impact.\n"
        "- Conditions outside the frame."
    )
    events = (
        "- [impact] Front-end-to-driver-side collision between the silver sedan and a second vehicle.\n"
        "- [position] Two vehicles occupy the intersection at a near-perpendicular angle.\n"
        "- [damage] Front-end damage concentrated at the silver sedan's driver-side wheel well.\n"
        "- [signal] Traffic light facing the silver sedan displays a red signal.\n"
        "- [road] Dry pavement surface visible in the frame.\n"
        "- [weather] Daylight conditions with no precipitation indicators.\n"
        "- [identifier] License plate on the near vehicle is not readable in this image."
    )
    page_text = _compose_page_text(observed, events)
    return ExtractedDocument(
        pages=[
            ExtractedPage(
                page_number=1,
                text=page_text,
                metadata={
                    "extractor": "image",
                    "vision_model": "mock",
                    "not_visible": not_visible,
                    "events": events,
                    "refusal_detected": False,
                    "source_location": f"image:{filename}",
                    "mock": True,
                },
            )
        ],
        document_metadata={
            "extractor": "image",
            "vision_model": "mock",
            "mock": True,
            "byte_count": byte_count,
        },
    )


# ----- real extraction ---------------------------------------------------------

async def _extract_async(file_bytes: bytes, filename: str) -> ExtractedDocument:
    api_key = os.environ["ANTHROPIC_API_KEY"]
    model = os.environ.get("LUMEN_VISION_MODEL", DEFAULT_VISION_MODEL)

    prepared_bytes, prepared_media_type, prepared_size_px = _prepare_image(
        file_bytes, filename
    )

    body = {
        "model": model,
        "max_tokens": 1536,
        "system": SYSTEM_PROMPT,
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": prepared_media_type,
                            "data": base64.b64encode(prepared_bytes).decode("ascii"),
                        },
                    },
                    {"type": "text", "text": USER_PROMPT},
                ],
            }
        ],
    }
    async with httpx.AsyncClient(timeout=httpx.Timeout(90.0, connect=10.0)) as client:
        resp = await client.post(
            ANTHROPIC_URL,
            headers={
                "x-api-key": api_key,
                "anthropic-version": ANTHROPIC_VERSION,
                "content-type": "application/json",
            },
            json=body,
        )
        if resp.status_code >= 400:
            raise RuntimeError(
                f"Claude vision API {resp.status_code}: {resp.text[:300]}"
            )
        data = resp.json()

    full_text = _extract_assistant_text(data)
    observed, not_visible, events = _split_three_blocks(full_text)
    refusal = _looks_like_refusal(observed)
    page_text = _compose_page_text(observed, events)

    return ExtractedDocument(
        pages=[
            ExtractedPage(
                page_number=1,
                text=page_text,
                metadata={
                    "extractor": "image",
                    "vision_model": model,
                    "image_size_px": prepared_size_px,
                    "not_visible": not_visible,
                    "events": events,
                    "refusal_detected": refusal,
                    "source_location": f"image:{filename}",
                },
            )
        ],
        document_metadata={"extractor": "image", "vision_model": model},
    )


def _compose_page_text(observed: str, events: str) -> str:
    """Page text = OBSERVED block + EVENTS block. Both are factual, both are
    substring-anchorable. NOT_VISIBLE deliberately omitted — it lives in
    extraction_metadata only so quotes landing inside it are a regex-
    detectable gate violation rather than a silent leak."""
    parts: list[str] = [f"OBSERVED:\n{observed}"]
    if events:
        parts.append(f"EVENTS:\n{events}")
    return "\n\n".join(parts)


def _extract_assistant_text(api_resp: dict[str, Any]) -> str:
    """Anthropic responds with content blocks; concatenate the text parts."""
    parts: list[str] = []
    for block in api_resp.get("content", []):
        if block.get("type") == "text":
            parts.append(block.get("text", ""))
    return "\n".join(parts).strip()


_BLOCK_HEADER = re.compile(
    r"^\s*(OBSERVED|NOT_VISIBLE|EVENTS)\s*:\s*$",
    re.IGNORECASE | re.MULTILINE,
)


def _split_three_blocks(text: str) -> tuple[str, str, str]:
    """Split the model output into (OBSERVED, NOT_VISIBLE, EVENTS).

    The system prompt asks for blocks in that order; we tolerate any
    ordering and any subset (a refusal might only emit OBSERVED). Missing
    blocks come back empty. If the model ignored the format entirely we
    treat the whole response as OBSERVED so the Fact Gate can still anchor
    against something — refusal_detected will then flag it in metadata.
    """
    matches = list(_BLOCK_HEADER.finditer(text))
    if not matches:
        return text.strip(), "", ""

    sections: dict[str, str] = {"OBSERVED": "", "NOT_VISIBLE": "", "EVENTS": ""}
    for i, m in enumerate(matches):
        name = m.group(1).upper()
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        sections[name] = text[start:end].strip()

    return sections["OBSERVED"], sections["NOT_VISIBLE"], sections["EVENTS"]


_REFUSAL_PATTERNS = re.compile(
    r"(?:I (?:cannot|can't|am unable to|will not)|"
    r"insufficient detail|"
    r"unable to interpret|"
    r"image is unreadable)",
    re.IGNORECASE,
)


def _looks_like_refusal(observed: str) -> bool:
    return bool(_REFUSAL_PATTERNS.search(observed)) or len(observed) < 30


# ----- image preprocessing -----------------------------------------------------

def _prepare_image(
    file_bytes: bytes, filename: str
) -> tuple[bytes, str, tuple[int, int]]:
    """Resize the longer side to MAX_DIMENSION_PX if needed; re-encode as
    JPEG (or PNG for transparent images) and return (bytes, media_type, (w,h))."""
    try:
        from PIL import Image
    except ImportError as e:
        raise RuntimeError(
            "Pillow is required for image preprocessing. Run: pip install Pillow"
        ) from e

    img = Image.open(io.BytesIO(file_bytes))
    img.load()
    w, h = img.size

    if max(w, h) > MAX_DIMENSION_PX:
        scale = MAX_DIMENSION_PX / max(w, h)
        new_size = (int(w * scale), int(h * scale))
        img = img.resize(new_size, Image.Resampling.LANCZOS)
        w, h = img.size

    has_alpha = img.mode in ("RGBA", "LA") or "transparency" in img.info
    out = io.BytesIO()
    if has_alpha:
        img.save(out, format="PNG", optimize=True)
        media_type = "image/png"
    else:
        if img.mode != "RGB":
            img = img.convert("RGB")
        img.save(out, format="JPEG", quality=85, optimize=True)
        media_type = "image/jpeg"
    data = out.getvalue()

    if len(data) > MAX_INPUT_BYTES:
        if not has_alpha:
            out = io.BytesIO()
            img.save(out, format="JPEG", quality=65, optimize=True)
            data = out.getvalue()
        if len(data) > MAX_INPUT_BYTES:
            raise RuntimeError(
                f"Image {filename} is too large after resize "
                f"({len(data)} bytes > {MAX_INPUT_BYTES})."
            )
    return data, media_type, (w, h)
