"""Plain-text extractor — the trivial case, used as the reference implementation."""
from __future__ import annotations

from .base import ExtractedDocument, ExtractedPage


class TextExtractor:
    mime_types = ("text/plain", "text/markdown")

    def extract(self, file_bytes: bytes, *, filename: str) -> ExtractedDocument:
        text = file_bytes.decode("utf-8", errors="replace")
        return ExtractedDocument(
            pages=[ExtractedPage(page_number=1, text=text)],
            document_metadata={"extractor": "text"},
        )
