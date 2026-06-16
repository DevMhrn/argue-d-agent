"""MIME-type -> extractor dispatch.

Use `get_extractor(mime_type)` to pick the right extractor for an uploaded
file. Returns None for unsupported types so callers can surface a clear error
to the user rather than blow up inside an extractor.
"""
from __future__ import annotations

from typing import Optional

from .base import Extractor
from .docx import DocxExtractor
from .html import HtmlExtractor
from .pdf import PdfExtractor
from .text import TextExtractor

_REGISTRY: list[Extractor] = [
    PdfExtractor(),
    DocxExtractor(),
    HtmlExtractor(),
    TextExtractor(),
]

# Flat map for fast lookup; built once at import.
_BY_MIME: dict[str, Extractor] = {
    mime: ext for ext in _REGISTRY for mime in ext.mime_types
}


def get_extractor(mime_type: str) -> Optional[Extractor]:
    """Return the extractor for a MIME type, or None if unsupported."""
    return _BY_MIME.get(mime_type)


def supported_mime_types() -> list[str]:
    """All MIME types the ingestion pipeline currently handles."""
    return sorted(_BY_MIME.keys())
