"""Per-format extractor protocol.

Each extractor reads raw file bytes and returns a list of `ExtractedPage`s plus
optional document-level metadata. The extractor knows nothing about storage or
the database — it is a pure transformation.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol


@dataclass(frozen=True)
class ExtractedPage:
    """One logical page of extracted text.

    page_number is 1-indexed. metadata is per-page (OCR confidence, layout
    info, etc.). For formats without natural pages (HTML, plain text) the
    extractor decides what counts as a page — typically heading boundaries.
    """

    page_number: int
    text: str
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ExtractedDocument:
    """A complete extracted document, ready to write to `document_pages`."""

    pages: list[ExtractedPage]
    document_metadata: dict[str, Any] = field(default_factory=dict)

    @property
    def page_count(self) -> int:
        return len(self.pages)

    @property
    def total_chars(self) -> int:
        return sum(len(p.text) for p in self.pages)


class Extractor(Protocol):
    """All extractors implement this single method."""

    mime_types: tuple[str, ...]

    def extract(self, file_bytes: bytes, *, filename: str) -> ExtractedDocument:
        ...
