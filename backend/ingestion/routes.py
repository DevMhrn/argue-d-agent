"""FastAPI router for the ingestion lane.

Mounts at /api/ingest. Each endpoint is a thin shim around the IngestService.
Request and response shapes are Pydantic models so the OpenAPI doc is auto-generated.
"""
from __future__ import annotations

from functools import lru_cache
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from backend.schemas import CaseCreate, CaseRow, DocumentRow

from .queue import ExtractionQueue
from .repository import IngestionRepository
from .service import IngestService, PreparedUpload
from .storage import ObjectStorage

router = APIRouter(prefix="/api/ingest", tags=["ingestion"])


# Dependency injection — one IngestService per FastAPI process, lazily built
# on first request. lru_cache(maxsize=1) makes this a process-wide singleton.
# Credentials are read from env at construction time; missing vars raise a
# clear RuntimeError so the failure surfaces immediately.
@lru_cache(maxsize=1)
def get_service() -> IngestService:
    repo = IngestionRepository()
    storage = ObjectStorage()
    queue = ExtractionQueue()
    return IngestService(repo=repo, storage=storage, queue=queue)


# ---- request / response shapes ----------------------------------------------


class PrepareUploadRequest(BaseModel):
    case_id: UUID
    filename: str = Field(min_length=1, max_length=512)
    mime_type: str
    size: int = Field(ge=1, le=50 * 1024 * 1024)  # 50 MB hard cap per file
    sha256: str = Field(min_length=64, max_length=64)
    document_kind: Optional[str] = None


class PrepareUploadResponse(BaseModel):
    document_id: UUID
    upload_url: str
    upload_fields: dict[str, str]
    storage_key: str


class CommitUploadRequest(BaseModel):
    document_id: UUID


# ---- routes ------------------------------------------------------------------


@router.post("/case", response_model=CaseRow, summary="Create a new case shell")
async def create_case(
    payload: CaseCreate,
    service: IngestService = Depends(get_service),
) -> CaseRow:
    return await service.create_case(payload)


@router.post(
    "/sign-upload",
    response_model=PrepareUploadResponse,
    summary="Reserve a document row and return a pre-signed upload URL",
)
async def sign_upload(
    payload: PrepareUploadRequest,
    service: IngestService = Depends(get_service),
) -> PrepareUploadResponse:
    try:
        prepared: PreparedUpload = await service.prepare_upload(
            case_id=payload.case_id,
            filename=payload.filename,
            mime_type=payload.mime_type,
            size=payload.size,
            sha256=payload.sha256,
            document_kind=payload.document_kind,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return PrepareUploadResponse(
        document_id=prepared.document_id,
        upload_url=prepared.upload.url,
        upload_fields=prepared.upload.fields,
        storage_key=prepared.upload.key,
    )


@router.post(
    "/commit",
    response_model=DocumentRow,
    summary="Confirm an uploaded file and enqueue extraction",
)
async def commit_upload(
    payload: CommitUploadRequest,
    service: IngestService = Depends(get_service),
) -> DocumentRow:
    try:
        return await service.commit_upload(document_id=payload.document_id)
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@router.get(
    "/status/{case_id}",
    summary="Per-case ingestion status (documents + flags)",
)
async def case_status(
    case_id: UUID,
    service: IngestService = Depends(get_service),
):
    case = await service._repo.get_case(case_id)
    if case is None:
        raise HTTPException(status_code=404, detail="Case not found")
    docs = await service._repo.list_documents_for_case(case_id)
    return {
        "case": case.model_dump(),
        "documents": [d.model_dump() for d in docs],
        "ingestion_complete": case.ingestion_complete,
    }


@router.post(
    "/finalize/{case_id}",
    response_model=CaseRow,
    summary="Flip the case's ingestion_complete flag",
)
async def finalize(
    case_id: UUID,
    service: IngestService = Depends(get_service),
) -> CaseRow:
    return await service.finalize_case(case_id)
