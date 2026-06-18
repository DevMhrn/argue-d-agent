"""Per-MIME-class upload caps — single source of truth.

Lumen accepts three classes of evidence files, each with its own size cap and
per-case file-count cap:

    document   PDF, DOCX, XLSX, CSV, HTML, TXT, MD         10 MB ·  50 files / case
    image      JPEG, PNG, WebP, GIF                        10 MB ·  15 files / case
    audio      MP3, MP4, M4A, WAV, WebM                    50 MB ·  10 files / case

These limits are mirrored in frontend/lib/fileSupport.ts (LIMITS) — keep them
in sync. The backend is authoritative; the frontend pre-validates so users get
instant feedback instead of a 400 after the upload PUT.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

_MB = 1024 * 1024

DOCUMENT_MIME_TYPES = frozenset({
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/csv",
    "application/csv",
    "text/html",
    "application/xhtml+xml",
    "text/plain",
    "text/markdown",
})

IMAGE_MIME_TYPES = frozenset({
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
})

AUDIO_MIME_TYPES = frozenset({
    "audio/mpeg",
    "audio/mp4",
    "audio/x-m4a",
    "audio/m4a",
    "audio/wav",
    "audio/x-wav",
    "audio/webm",
})


@dataclass(frozen=True)
class CategoryLimits:
    name: str
    max_bytes: int
    max_files_per_case: int

    @property
    def max_mb(self) -> int:
        return self.max_bytes // _MB


DOCUMENT = CategoryLimits(name="document", max_bytes=10 * _MB, max_files_per_case=50)
IMAGE = CategoryLimits(name="image", max_bytes=10 * _MB, max_files_per_case=15)
AUDIO = CategoryLimits(name="audio", max_bytes=50 * _MB, max_files_per_case=10)

CATEGORIES: tuple[CategoryLimits, ...] = (DOCUMENT, IMAGE, AUDIO)

# Outer envelope — the largest cap across categories. Used by the FastAPI
# request-schema validator so a 500 MB file is rejected before the service
# ever sees the call. The service then applies the tighter per-class cap.
MAX_SIZE_BYTES = max(c.max_bytes for c in CATEGORIES)


def classify(mime_type: str) -> Optional[CategoryLimits]:
    """Return the CategoryLimits for a MIME type, or None if unsupported."""
    if mime_type in DOCUMENT_MIME_TYPES:
        return DOCUMENT
    if mime_type in IMAGE_MIME_TYPES:
        return IMAGE
    if mime_type in AUDIO_MIME_TYPES:
        return AUDIO
    return None
