"""Top-level orchestrator for the ingestion lane.

Owns the upload-then-commit-then-extract flow:

    1. `prepare_upload`   — caller posts {filename, mime_type, size, sha256};
                            we create a documents row (status='pending') and
                            return a pre-signed object-storage URL.
    2. `commit_upload`    — caller posts {document_id}; we verify the file is
                            in storage, flip status to 'uploaded', enqueue
                            extraction. Idempotent: a second call returns the
                            current row without re-enqueueing.
    3. `extract_document` — the worker function; runs the right extractor,
                            writes pages, tracks duration, auto-finalizes the
                            case when the last document completes.
    4. `finalize_case`    — explicit flip of `cases.ingestion_complete = true`
                            (safety net for cases with no documents; auto-flip
                            handles the normal path).
"""
from __future__ import annotations

import asyncio
import hashlib
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

import asyncpg
from botocore.exceptions import (
    BotoCoreError,
    ClientError,
    ConnectionError as BotoConnectionError,
    EndpointConnectionError,
    ReadTimeoutError,
)

from backend.schemas import (
    CaseCreate,
    CaseRow,
    CaseStatusUpdate,
    DocumentCreate,
    DocumentPageCreate,
    DocumentRow,
    DocumentStatusUpdate,
)

from .extractors import ExtractedDocument, get_extractor, supported_mime_types
from .queue import ExtractionQueue
from .repository import IngestionRepository
from .storage import ObjectStorage, SignedUpload


@dataclass(frozen=True)
class PreparedUpload:
    """Returned from prepare_upload — everything the client needs to POST the file."""

    document_id: UUID
    upload: SignedUpload


# Status values that mean "do not re-enqueue extraction" — commit_upload uses
# these to be idempotent against network retries.
_NO_REENQUEUE_STATUSES = {"uploaded", "extracting", "extracted"}

# S3/B2 error codes that indicate a transient server-side problem (worth retrying).
# Anything else (auth errors, bad request, 404) is permanent.
_TRANSIENT_S3_CODES = {
    "InternalError",
    "ServiceUnavailable",
    "SlowDown",
    "RequestTimeout",
    "RequestTimeoutException",
    "503",
    "500",
}


def _is_transient(exc: Exception) -> bool:
    """Classify whether an extraction exception is worth retrying.

    Transient: network blips, B2 5xx, Postgres connection drops, timeouts.
    Permanent: unsupported MIME, corrupted file, missing storage object,
               authentication failure, schema violation.
    """
    # Network / connection / timeout
    if isinstance(exc, (TimeoutError, ConnectionError, OSError)):
        return True
    if isinstance(exc, (BotoConnectionError, EndpointConnectionError, ReadTimeoutError)):
        return True
    # asyncpg disconnect / pool exhaustion
    if isinstance(exc, asyncpg.PostgresConnectionError):
        return True
    # asyncpg's "connection lost" is a connection-class exception too
    if isinstance(exc, asyncpg.InterfaceError):
        return True
    # B2/S3 ClientError — retry on transient codes only
    if isinstance(exc, ClientError):
        code = str(exc.response.get("Error", {}).get("Code", ""))
        if code in _TRANSIENT_S3_CODES:
            return True
        # 5xx HTTP status codes are also transient
        status = exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode", 0)
        if 500 <= int(status) < 600:
            return True
        return False
    # Other botocore errors default to transient (network-layer problems)
    if isinstance(exc, BotoCoreError):
        return True
    # Everything else (ValueError, LookupError, parser errors) is permanent.
    return False


class IngestService:
    """Top-level orchestrator wired with repository + storage + queue."""

    def __init__(
        self,
        repo: IngestionRepository,
        storage: ObjectStorage,
        queue: ExtractionQueue,
    ) -> None:
        self._repo = repo
        self._storage = storage
        self._queue = queue

    # ----- case lifecycle ------------------------------------------------------

    async def create_case(self, payload: CaseCreate) -> CaseRow:
        """Create a new case shell. Status flags start false; documents come next."""
        return await self._repo.create_case(payload)

    async def finalize_case(self, case_id: UUID) -> CaseRow:
        """Explicitly flip `cases.ingestion_complete = true`.

        Normally the auto-finalize in `extract_document` handles this when the
        last document reaches 'extracted'. This endpoint exists as a manual
        override and as the only path for cases with zero documents.
        """
        return await self._repo.update_case_status(
            case_id,
            CaseStatusUpdate(ingestion_complete=True),
        )

    # ----- per-document flow --------------------------------------------------

    async def prepare_upload(
        self,
        *,
        case_id: UUID,
        filename: str,
        mime_type: str,
        size: int,
        sha256: str,
        document_kind: Optional[str] = None,
    ) -> PreparedUpload:
        """Reserve a documents row + return a pre-signed upload URL.

        Idempotent on (case_id, sha256) via the unique constraint — if the
        same file was already registered for this case, returns the existing
        document_id with a fresh signed URL (in case the original expired).
        """
        if get_extractor(mime_type) is None:
            raise ValueError(
                f"Unsupported mime type {mime_type!r}. "
                f"Supported: {supported_mime_types()}"
            )
        key = self._storage_key(case_id, sha256, filename)
        doc = await self._repo.create_document(
            DocumentCreate(
                case_id=case_id,
                filename=filename,
                document_kind=document_kind,
                mime_type=mime_type,
                sha256=sha256,
                file_size_bytes=size,
                storage_bucket=self._storage.bucket,
                storage_key=key,
            )
        )
        # boto3 is sync — bridge into the async caller.
        signed = await asyncio.to_thread(
            self._storage.sign_upload, key=key, mime_type=mime_type
        )
        return PreparedUpload(document_id=doc.id, upload=signed)

    async def commit_upload(self, *, document_id: UUID) -> DocumentRow:
        """Confirm the file is in storage and enqueue extraction.

        Idempotent: if status is already past 'pending', this returns the
        current row without verifying storage or re-enqueueing. Safe under
        network retries from the frontend.
        """
        doc = await self._repo.get_document(document_id)
        if doc is None:
            raise LookupError(f"Document {document_id} not found")
        if doc.status in _NO_REENQUEUE_STATUSES:
            return doc

        head = await asyncio.to_thread(self._storage.head, doc.storage_key)
        if head is None:
            raise LookupError(
                f"Object {doc.storage_key} not found in storage — was the upload completed?"
            )
        updated = await self._repo.update_document_status(
            document_id,
            DocumentStatusUpdate(status="uploaded"),
        )
        await self._queue.enqueue_extract(document_id)
        return updated

    # ----- extraction worker --------------------------------------------------

    async def extract_document(
        self,
        document_id: UUID,
        *,
        job_try: int = 1,
        max_tries: int = 3,
    ) -> DocumentRow:
        """Worker entry point. Reads the file, runs the extractor, writes pages,
        tracks duration, and auto-finalizes the case if this was the last doc.

        Retry semantics:
          - Transient errors (B2 5xx, network blips, asyncpg disconnects) on a
            non-final attempt: record retry_count, propagate the exception so
            arq retries with backoff. The document stays in status='extracting'.
          - Permanent errors (unsupported MIME, missing object, parse errors):
            mark status='failed' with the error message, swallow the exception.
          - Transient error on the FINAL attempt: mark failed, swallow. arq has
            no more retries to give us.

        `job_try` is arq's 1-indexed try counter from ctx['job_try'].
        `max_tries` must match WorkerSettings.max_tries.
        """
        doc = await self._repo.get_document(document_id)
        if doc is None:
            raise LookupError(f"Document {document_id} not found")

        await self._repo.update_document_status(
            document_id, DocumentStatusUpdate(status="extracting")
        )

        start_ns = time.perf_counter_ns()
        try:
            extractor = get_extractor(doc.mime_type)
            if extractor is None:
                raise ValueError(f"No extractor for {doc.mime_type!r}")

            file_bytes = await asyncio.to_thread(self._storage.download, doc.storage_key)
            extracted: ExtractedDocument = await asyncio.to_thread(
                extractor.extract, file_bytes, filename=doc.filename
            )

            pages = [
                DocumentPageCreate(
                    document_id=doc.id,
                    page_number=p.page_number,
                    extracted_text=p.text,
                    char_count=len(p.text),
                    extraction_metadata=p.metadata,
                )
                for p in extracted.pages
            ]
            await self._repo.insert_pages(pages)

            duration_ms = (time.perf_counter_ns() - start_ns) // 1_000_000
            updated = await self._repo.update_document_status(
                document_id,
                DocumentStatusUpdate(
                    status="extracted",
                    page_count=extracted.page_count,
                    extraction_duration_ms=int(duration_ms),
                    ingested_at=datetime.now(timezone.utc),
                ),
            )
            # Race-safe auto-finalize: only flips when all docs in the case are extracted.
            await self._repo.maybe_finalize_ingestion(doc.case_id)
            return updated

        except Exception as e:  # noqa: BLE001
            duration_ms = (time.perf_counter_ns() - start_ns) // 1_000_000
            transient = _is_transient(e)
            is_final_attempt = job_try >= max_tries
            now = datetime.now(timezone.utc)

            if transient and not is_final_attempt:
                # Record retry attempt; let arq see the exception and requeue.
                await self._repo.update_document_status(
                    document_id,
                    DocumentStatusUpdate(
                        retry_count=job_try,
                        last_retry_at=now,
                        extraction_duration_ms=int(duration_ms),
                    ),
                )
                raise  # arq catches and retries with exponential backoff

            # Permanent error OR final retry exhausted → mark failed, swallow.
            error_prefix = "Exhausted retries: " if transient and is_final_attempt else ""
            return await self._repo.update_document_status(
                document_id,
                DocumentStatusUpdate(
                    status="failed",
                    extraction_error=f"{error_prefix}{e!s}",
                    extraction_duration_ms=int(duration_ms),
                    retry_count=job_try,
                    last_retry_at=now if job_try > 1 else None,
                ),
            )

    # ----- helpers ------------------------------------------------------------

    def _storage_key(self, case_id: UUID, sha256: str, filename: str) -> str:
        """Object-store key convention — namespaced by case, content-addressed."""
        return f"cases/{case_id}/{sha256}-{filename}"

    @staticmethod
    def compute_sha256(data: bytes) -> str:
        """Helper for callers that want to compute the digest locally."""
        return hashlib.sha256(data).hexdigest()
