"""Pydantic models for the `document_pages` table.

One row per logical page of extracted text. Page is a logical unit: PDFs use
native pages, DOCX/HTML use heading or section boundaries, plain text is a
single page. Fact nodes downstream reference (document_id, page_number) so the
Fact Gate can verify verbatim quotes against the source.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class DocumentPageRow(BaseModel):
    """One row from `document_pages` — extracted text for one page."""

    model_config = ConfigDict(frozen=True)

    id: UUID
    document_id: UUID
    page_number: int = Field(ge=1)
    extracted_text: str
    char_count: int = Field(ge=0)
    extraction_metadata: Optional[dict[str, Any]] = None
    created_at: datetime
    updated_at: datetime


class DocumentPageCreate(BaseModel):
    """Payload to insert a new extracted page."""

    document_id: UUID
    page_number: int = Field(ge=1)
    extracted_text: str
    char_count: int = Field(ge=0)
    extraction_metadata: Optional[dict[str, Any]] = None
