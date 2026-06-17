"""Typed Supabase queries for the ingestion lane.

A thin layer between the ingestion service and the Postgres backing store.
Each method takes/returns Pydantic models from `backend/schemas/` so the
service code is strongly typed end to end.

Implementation choice: asyncpg with the shared pool from `db.py`. supabase-py
is sync-only in its current Python form and would block the async FastAPI
event loop. asyncpg is native async, faster, and we already have DATABASE_URL.

Error-handling convention:
  - asyncpg.UniqueViolationError on create_document → caught, returns existing row.
  - All other asyncpg exceptions propagate to the caller.
  - Methods return None for not-found, raise for invalid state.
"""
from __future__ import annotations

import json
from typing import Any, Optional
from uuid import UUID

import asyncpg

from backend.schemas import (
    CaseCreate,
    CaseRow,
    CaseStatusUpdate,
    DocumentCreate,
    DocumentPageCreate,
    DocumentPageRow,
    DocumentRow,
    DocumentStatusUpdate,
    StatuteRow,
)

from .db import get_pool

# ---------------------------------------------------------------------------
# Row mappers — turn asyncpg.Record into typed Pydantic models.
# ---------------------------------------------------------------------------


def _row_to_case(r: asyncpg.Record) -> CaseRow:
    return CaseRow(
        id=r["id"],
        tenant_id=r["tenant_id"],
        case_id=r["case_id"],
        title=r["title"],
        summary=r["summary"],
        jurisdiction=r["jurisdiction"],
        damages_usd=r["damages_usd"],
        insured_name=r["insured_name"],
        other_party_name=r["other_party_name"],
        ingestion_complete=r["ingestion_complete"],
        ledger_complete=r["ledger_complete"],
        finalized=r["finalized"],
        last_run_at=r["last_run_at"],
        metadata=_jsonb(r["metadata"]) or {},
        created_at=r["created_at"],
        updated_at=r["updated_at"],
    )


def _row_to_document(r: asyncpg.Record) -> DocumentRow:
    return DocumentRow(
        id=r["id"],
        case_id=r["case_id"],
        filename=r["filename"],
        document_kind=r["document_kind"],
        mime_type=r["mime_type"],
        sha256=r["sha256"],
        file_size_bytes=r["file_size_bytes"],
        storage_provider=r["storage_provider"],
        storage_bucket=r["storage_bucket"],
        storage_key=r["storage_key"],
        storage_url=r["storage_url"],
        page_count=r["page_count"],
        status=r["status"],
        extraction_error=r["extraction_error"],
        extraction_duration_ms=r["extraction_duration_ms"],
        retry_count=r["retry_count"],
        last_retry_at=r["last_retry_at"],
        ingested_at=r["ingested_at"],
        created_at=r["created_at"],
        updated_at=r["updated_at"],
    )


def _row_to_page(r: asyncpg.Record) -> DocumentPageRow:
    return DocumentPageRow(
        id=r["id"],
        document_id=r["document_id"],
        page_number=r["page_number"],
        extracted_text=r["extracted_text"],
        char_count=r["char_count"],
        extraction_metadata=_jsonb(r["extraction_metadata"]),
        created_at=r["created_at"],
        updated_at=r["updated_at"],
    )


def _row_to_statute(r: asyncpg.Record) -> StatuteRow:
    return StatuteRow(
        id=r["id"],
        statute_id=r["statute_id"],
        jurisdiction=r["jurisdiction"],
        title=r["title"],
        text=r["text"],
        created_at=r["created_at"],
        updated_at=r["updated_at"],
    )


def _jsonb(value: Any) -> Optional[dict[str, Any]]:
    """asyncpg returns JSONB as str by default unless a codec is registered.
    Handle both cases defensively."""
    if value is None:
        return None
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, str):
        return json.loads(value)
    return value


# ---------------------------------------------------------------------------
# Repository
# ---------------------------------------------------------------------------


class IngestionRepository:
    """All DB operations the ingestion lane needs, in one typed surface."""

    # ----- cases -------------------------------------------------------------

    async def create_case(self, payload: CaseCreate) -> CaseRow:
        pool = await get_pool()
        async with pool.acquire() as conn:
            tenant_id = payload.tenant_id  # may be None — DB default applies
            row = await conn.fetchrow(
                """
                insert into cases (
                  tenant_id, case_id, title, summary, jurisdiction,
                  damages_usd, insured_name, other_party_name, metadata
                ) values (
                  coalesce($1, '00000000-0000-0000-0000-000000000001'::uuid),
                  $2, $3, $4, $5, $6, $7, $8, $9::jsonb
                )
                returning *
                """,
                tenant_id,
                payload.case_id,
                payload.title,
                payload.summary,
                payload.jurisdiction,
                payload.damages_usd,
                payload.insured_name,
                payload.other_party_name,
                json.dumps(payload.metadata),
            )
            return _row_to_case(row)

    async def get_case(self, case_id: UUID) -> Optional[CaseRow]:
        pool = await get_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow("select * from cases where id = $1", case_id)
            return _row_to_case(row) if row else None

    async def update_case_status(
        self, case_id: UUID, payload: CaseStatusUpdate
    ) -> CaseRow:
        # Build a dynamic SET clause only for fields that were actually provided.
        fields: list[str] = []
        values: list[Any] = []
        for name in ("ingestion_complete", "ledger_complete", "finalized", "last_run_at"):
            v = getattr(payload, name)
            if v is not None:
                fields.append(f"{name} = ${len(values) + 1}")
                values.append(v)
        if payload.metadata is not None:
            fields.append(f"metadata = ${len(values) + 1}::jsonb")
            values.append(json.dumps(payload.metadata))
        if not fields:
            existing = await self.get_case(case_id)
            if existing is None:
                raise LookupError(f"Case {case_id} not found")
            return existing
        values.append(case_id)
        sql = (
            f"update cases set {', '.join(fields)} "
            f"where id = ${len(values)} returning *"
        )
        pool = await get_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow(sql, *values)
            if row is None:
                raise LookupError(f"Case {case_id} not found")
            return _row_to_case(row)

    # ----- documents ---------------------------------------------------------

    async def create_document(self, payload: DocumentCreate) -> DocumentRow:
        """Idempotent on (case_id, sha256) — returns the existing row if the
        UNIQUE constraint catches a duplicate."""
        pool = await get_pool()
        async with pool.acquire() as conn:
            try:
                row = await conn.fetchrow(
                    """
                    insert into documents (
                      case_id, filename, document_kind, mime_type, sha256,
                      file_size_bytes, storage_provider, storage_bucket,
                      storage_key, storage_url
                    ) values (
                      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
                    )
                    returning *
                    """,
                    payload.case_id,
                    payload.filename,
                    payload.document_kind,
                    payload.mime_type,
                    payload.sha256,
                    payload.file_size_bytes,
                    payload.storage_provider,
                    payload.storage_bucket,
                    payload.storage_key,
                    payload.storage_url,
                )
                return _row_to_document(row)
            except asyncpg.UniqueViolationError:
                # Same file uploaded twice for the same case — return the existing row.
                existing = await conn.fetchrow(
                    "select * from documents where case_id = $1 and sha256 = $2",
                    payload.case_id,
                    payload.sha256,
                )
                if existing is None:
                    raise
                return _row_to_document(existing)

    async def get_document(self, document_id: UUID) -> Optional[DocumentRow]:
        pool = await get_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                "select * from documents where id = $1", document_id
            )
            return _row_to_document(row) if row else None

    async def update_document_status(
        self, document_id: UUID, payload: DocumentStatusUpdate
    ) -> DocumentRow:
        fields: list[str] = []
        values: list[Any] = []
        for name in (
            "status",
            "extraction_error",
            "extraction_duration_ms",
            "retry_count",
            "last_retry_at",
            "ingested_at",
            "page_count",
            "storage_url",
        ):
            v = getattr(payload, name)
            if v is not None:
                fields.append(f"{name} = ${len(values) + 1}")
                values.append(v)
        if not fields:
            existing = await self.get_document(document_id)
            if existing is None:
                raise LookupError(f"Document {document_id} not found")
            return existing
        values.append(document_id)
        sql = (
            f"update documents set {', '.join(fields)} "
            f"where id = ${len(values)} returning *"
        )
        pool = await get_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow(sql, *values)
            if row is None:
                raise LookupError(f"Document {document_id} not found")
            return _row_to_document(row)

    async def list_documents_for_case(self, case_id: UUID) -> list[DocumentRow]:
        pool = await get_pool()
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                "select * from documents where case_id = $1 order by created_at asc",
                case_id,
            )
            return [_row_to_document(r) for r in rows]

    # ----- document_pages ----------------------------------------------------

    async def insert_pages(
        self, pages: list[DocumentPageCreate]
    ) -> list[DocumentPageRow]:
        """Bulk insert for one document's extracted pages, in one transaction."""
        if not pages:
            return []
        pool = await get_pool()
        async with pool.acquire() as conn:
            async with conn.transaction():
                rows = await conn.fetch(
                    """
                    insert into document_pages (
                      document_id, page_number, extracted_text, char_count,
                      extraction_metadata
                    )
                    select * from unnest(
                      $1::uuid[], $2::int[], $3::text[], $4::int[], $5::jsonb[]
                    )
                    returning *
                    """,
                    [p.document_id for p in pages],
                    [p.page_number for p in pages],
                    [p.extracted_text for p in pages],
                    [p.char_count for p in pages],
                    [json.dumps(p.extraction_metadata) if p.extraction_metadata else None
                     for p in pages],
                )
                return [_row_to_page(r) for r in rows]

    async def get_pages(self, document_id: UUID) -> list[DocumentPageRow]:
        pool = await get_pool()
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                select * from document_pages
                where document_id = $1
                order by page_number asc
                """,
                document_id,
            )
            return [_row_to_page(r) for r in rows]

    # ----- statutes ----------------------------------------------------------

    async def list_statutes(
        self, jurisdiction: Optional[str] = None
    ) -> list[StatuteRow]:
        pool = await get_pool()
        async with pool.acquire() as conn:
            if jurisdiction:
                rows = await conn.fetch(
                    "select * from statutes where jurisdiction = $1 order by statute_id",
                    jurisdiction,
                )
            else:
                rows = await conn.fetch(
                    "select * from statutes order by statute_id"
                )
            return [_row_to_statute(r) for r in rows]

    # ----- auto-finalize race-free helper ------------------------------------

    async def maybe_finalize_ingestion(self, case_id: UUID) -> bool:
        """Atomically flip cases.ingestion_complete = true IFF every document
        for the case has status='extracted'. Returns True if the flag was
        flipped by this call, False otherwise.

        Race-safe: the WHERE clause makes the flip a no-op when multiple
        workers finish simultaneously. Only one wins; the rest see it already
        flipped and return False.
        """
        pool = await get_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                update cases
                   set ingestion_complete = true
                 where id = $1
                   and not ingestion_complete
                   and (select count(*) from documents where case_id = $1) > 0
                   and (select count(*) from documents where case_id = $1) =
                       (select count(*) from documents where case_id = $1
                                                       and status = 'extracted')
                 returning id
                """,
                case_id,
            )
            return row is not None
