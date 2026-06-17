"""Ingestion lane — file uploads, text extraction, source-anchored persistence.

Public surface:
    routes.router            FastAPI router mounted at /api/ingest
    service.IngestService    Top-level orchestrator
    repository.IngestionRepository   Typed Supabase queries
    storage.ObjectStorage    Backblaze B2 wrapper
    queue.ExtractionQueue    Redis-backed async job queue (enqueue side)
    worker.WorkerSettings    arq worker entry point (run: arq backend.ingestion.worker.WorkerSettings)
    adapters.load_case_from_db   Seam for orchestration to read a ClaimInput from the DB
    extractors.*             Per-format text extractors
"""
from .adapters import load_case_from_db
from .db import close_pool, get_pool
from .extractors import (
    ExtractedDocument,
    ExtractedPage,
    get_extractor,
    supported_mime_types,
)
from .queue import ExtractionQueue, QueueConfig
from .repository import IngestionRepository
from .routes import router
from .service import IngestService, PreparedUpload
from .storage import ObjectStorage, SignedUpload, StorageConfig

__all__ = [
    "router",
    "IngestService",
    "PreparedUpload",
    "IngestionRepository",
    "ObjectStorage",
    "SignedUpload",
    "StorageConfig",
    "ExtractionQueue",
    "QueueConfig",
    "ExtractedDocument",
    "ExtractedPage",
    "get_extractor",
    "supported_mime_types",
    "load_case_from_db",
    "get_pool",
    "close_pool",
]
