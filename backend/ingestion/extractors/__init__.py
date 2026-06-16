"""Per-format text extractors used by the ingestion pipeline.

Each extractor is a small class implementing `Extractor` from `base.py`.
Dispatch is by MIME type — see `registry.get_extractor()`.
"""
from .base import ExtractedDocument, ExtractedPage, Extractor
from .registry import get_extractor, supported_mime_types

__all__ = [
    "ExtractedDocument",
    "ExtractedPage",
    "Extractor",
    "get_extractor",
    "supported_mime_types",
]
