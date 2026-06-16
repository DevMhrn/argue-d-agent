"""Typed Supabase queries for the ingestion lane.

A thin layer between the ingestion service and the Postgres client. Each
method takes Pydantic models from `backend/schemas/` so the service code is
strongly typed end to end.

The Supabase client is created via the official `supabase-py` SDK using the
service-role key (server-side only — never exposed to the frontend). Auth and
RLS are deferred until production hardening.
"""
from __future__ import annotations

import os
from typing import Optional
from uuid import UUID

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


class IngestionRepository:
    """All DB operations the ingestion lane needs, in one typed surface.

    Stubbed in this commit. The real implementation uses `supabase-py` with the
    service-role key once SUPABASE_URL and SUPABASE_SERVICE_KEY are available.
    Method signatures are final so the service layer can be written against them.
    """

    def __init__(self, url: Optional[str] = None, service_key: Optional[str] = None) -> None:
        self._url = url or os.environ.get("SUPABASE_URL", "")
        self._service_key = service_key or os.environ.get("SUPABASE_SERVICE_KEY", "")

    # ----- cases ---------------------------------------------------------------

    async def create_case(self, payload: CaseCreate) -> CaseRow:
        raise NotImplementedError

    async def get_case(self, case_id: UUID) -> Optional[CaseRow]:
        raise NotImplementedError

    async def update_case_status(self, case_id: UUID, payload: CaseStatusUpdate) -> CaseRow:
        raise NotImplementedError

    # ----- documents -----------------------------------------------------------

    async def create_document(self, payload: DocumentCreate) -> DocumentRow:
        """Idempotent on (case_id, sha256) — returns the existing row if found."""
        raise NotImplementedError

    async def get_document(self, document_id: UUID) -> Optional[DocumentRow]:
        raise NotImplementedError

    async def update_document_status(
        self, document_id: UUID, payload: DocumentStatusUpdate
    ) -> DocumentRow:
        raise NotImplementedError

    async def list_documents_for_case(self, case_id: UUID) -> list[DocumentRow]:
        raise NotImplementedError

    # ----- document_pages ------------------------------------------------------

    async def insert_pages(self, pages: list[DocumentPageCreate]) -> list[DocumentPageRow]:
        """Bulk insert for one document's extracted pages."""
        raise NotImplementedError

    async def get_pages(self, document_id: UUID) -> list[DocumentPageRow]:
        raise NotImplementedError

    # ----- statutes ------------------------------------------------------------

    async def list_statutes(self, jurisdiction: Optional[str] = None) -> list[StatuteRow]:
        raise NotImplementedError
