"""Pydantic models for the `documents` table.

A `documents` row is the metadata record for one uploaded file. The raw bytes
live in object storage (Backblaze B2 by default); we keep the bucket + key here
so signed URLs can be regenerated on demand.

`(case_id, sha256)` is unique — re-uploading the same file to the same case is
a no-op handled by the ingest service.
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

# Lifecycle of a single file through the ingestion pipeline.
DocumentStatus = Literal["pending", "uploaded", "extracting", "extracted", "failed"]

# Object-store backends the documents table supports. The default is Backblaze B2;
# 'supabase' and 's3' are allowed for future migration.
StorageProvider = Literal["backblaze", "supabase", "s3"]


class DocumentRow(BaseModel):
    """One row from `documents` — the per-file metadata record."""

    model_config = ConfigDict(frozen=True)

    id: UUID
    case_id: UUID
    filename: str
    document_kind: Optional[str] = None  # free-text category like "police report" or "FNOL"
    mime_type: str
    sha256: str
    file_size_bytes: int
    storage_provider: StorageProvider
    storage_bucket: str
    storage_key: str
    storage_url: Optional[str] = None
    page_count: Optional[int] = None
    status: DocumentStatus
    extraction_error: Optional[str] = None
    extraction_duration_ms: Optional[int] = None
    retry_count: int
    last_retry_at: Optional[datetime] = None
    ingested_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime


class DocumentCreate(BaseModel):
    """Payload to register a newly uploaded document.

    Status starts at 'pending' (DB default). The worker moves it through
    'uploaded' -> 'extracting' -> 'extracted' or 'failed'.
    """

    case_id: UUID
    filename: str
    document_kind: Optional[str] = None
    mime_type: str
    sha256: str = Field(min_length=64, max_length=64)
    file_size_bytes: int = Field(ge=0)
    storage_provider: StorageProvider = "backblaze"
    storage_bucket: str
    storage_key: str
    storage_url: Optional[str] = None


class DocumentStatusUpdate(BaseModel):
    """Partial update emitted by the extraction worker as it progresses."""

    status: Optional[DocumentStatus] = None
    extraction_error: Optional[str] = None
    extraction_duration_ms: Optional[int] = None
    retry_count: Optional[int] = None
    last_retry_at: Optional[datetime] = None
    ingested_at: Optional[datetime] = None
    page_count: Optional[int] = None
    storage_url: Optional[str] = None
    storage_url: Optional[str] = None
