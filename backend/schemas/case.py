"""Pydantic models for the `cases` table.

`CaseRow` mirrors a row read from the database.
`CaseCreate` is the shape accepted when inserting a new case.
`CaseStatusUpdate` toggles the three pipeline-handoff flags.
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

# The default tenant UUID for single-tenant demo writes. Matches the DB column
# default in 001_initial.sql; production deployments override per request.
DEMO_TENANT_ID: UUID = UUID("00000000-0000-0000-0000-000000000001")


class CaseRow(BaseModel):
    """One row from `cases` — the case-lifecycle record."""

    model_config = ConfigDict(frozen=True)

    id: UUID
    tenant_id: UUID
    case_id: str
    title: str
    summary: Optional[str] = None
    jurisdiction: str
    damages_usd: Optional[Decimal] = None
    insured_name: Optional[str] = None
    other_party_name: Optional[str] = None
    ingestion_complete: bool
    ledger_complete: bool
    finalized: bool
    last_run_at: Optional[datetime] = None
    metadata: dict[str, Any]
    created_at: datetime
    updated_at: datetime


class CaseCreate(BaseModel):
    """Payload to create a new case. `id`, timestamps, and status flags default in the DB."""

    case_id: str = Field(min_length=1, max_length=128)
    title: str
    summary: Optional[str] = None
    jurisdiction: str
    damages_usd: Optional[Decimal] = None
    insured_name: Optional[str] = None
    other_party_name: Optional[str] = None
    tenant_id: Optional[UUID] = None  # omit to use the DB-side default
    metadata: dict[str, Any] = Field(default_factory=dict)


class CaseStatusUpdate(BaseModel):
    """Partial update for the three pipeline-handoff flags + last-run rollup."""

    ingestion_complete: Optional[bool] = None
    ledger_complete: Optional[bool] = None
    finalized: Optional[bool] = None
    last_run_at: Optional[datetime] = None
    metadata: Optional[dict[str, Any]] = None
