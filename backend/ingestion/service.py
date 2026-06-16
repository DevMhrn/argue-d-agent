"""Top-level orchestrator for the ingestion lane.

Owns the upload-then-commit-then-extract flow:

    1. `prepare_upload`   — caller posts {filename, mime_type, size, sha256};
                            we create a documents row (status='pending') and
                            return a pre-signed object-storage URL.
    2. `commit_upload`    — caller posts {document_id}; we verify the file is
                            in storage, flip status to 'uploaded', enqueue
                            extraction.
    3. `extract_document` — the worker function; runs the right extractor and
                            writes pages.
    4. `finalize_case`    — flip `cases.ingestion_complete = true` so the
                            ledger stage can pick the case up.
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

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


class IngestService:
    """Top-level orchestrator wired with repository + storage + queue.

    The constructor takes injected dependencies so tests can pass fakes.
    """

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
        """Flip `cases.ingestion_complete = true`. Called when all documents reach 'extracted'."""
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
        """Reserve a documents row + return a pre-signed upload URL."""
        if get_extractor(mime_type) is None:
            raise ValueError(
                f"Unsupported mime type {mime_type!r}. Supported: {supported_mime_types()}"
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
                storage_bucket=self._storage._config.bucket,
                storage_key=key,
            )
        )
        signed = self._storage.sign_upload(key=key, mime_type=mime_type)
        return PreparedUpload(document_id=doc.id, upload=signed)

    async def commit_upload(self, *, document_id: UUID) -> DocumentRow:
        """Confirm the file is in storage and enqueue extraction."""
        doc = await self._repo.get_document(document_id)
        if doc is None:
            raise LookupError(f"Document {document_id} not found")
        head = self._storage.head(doc.storage_key)
        if head is None:
            raise LookupError(f"Object {doc.storage_key} not found in storage")
        updated = await self._repo.update_document_status(
            document_id,
            DocumentStatusUpdate(status="uploaded"),
        )
        await self._queue.enqueue_extract(document_id)
        return updated

    # ----- extraction worker --------------------------------------------------

    async def extract_document(self, document_id: UUID) -> DocumentRow:
        """Worker entry point. Reads the file, runs the extractor, writes pages."""
        doc = await self._repo.get_document(document_id)
        if doc is None:
            raise LookupError(f"Document {document_id} not found")

        await self._repo.update_document_status(
            document_id, DocumentStatusUpdate(status="extracting")
        )

        try:
            extractor = get_extractor(doc.mime_type)
            if extractor is None:
                raise ValueError(f"No extractor for {doc.mime_type!r}")

            file_bytes = self._fetch_bytes(doc)
            extracted: ExtractedDocument = extractor.extract(file_bytes, filename=doc.filename)

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

            return await self._repo.update_document_status(
                document_id,
                DocumentStatusUpdate(
                    status="extracted",
                    page_count=extracted.page_count,
                    ingested_at=datetime.now(timezone.utc),
                ),
            )
        except Exception as e:  # noqa: BLE001
            return await self._repo.update_document_status(
                document_id,
                DocumentStatusUpdate(status="failed", extraction_error=str(e)),
            )

    # ----- helpers ------------------------------------------------------------

    def _storage_key(self, case_id: UUID, sha256: str, filename: str) -> str:
        """Object-store key convention — namespaced by case, content-addressed."""
        return f"cases/{case_id}/{sha256}-{filename}"

    def _fetch_bytes(self, doc: DocumentRow) -> bytes:
        """Read the raw file from object storage. Stubbed until storage is wired."""
        raise NotImplementedError("File-bytes fetch pending storage wiring.")

    @staticmethod
    def compute_sha256(data: bytes) -> str:
        """Helper for callers that want to compute the digest locally."""
        return hashlib.sha256(data).hexdigest()
