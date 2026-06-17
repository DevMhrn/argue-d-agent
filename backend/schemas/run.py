"""Pydantic models for the `runs` table.

One row per pipeline execution. The orchestrator inserts a row at run start
(status='running'), then updates it at run end with `ended_at`, `duration_ms`,
final `status`, and `error_message` if applicable. `transcript` and `decisions`
foreign-key to this table.
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

RunMode = Literal["mock", "live"]
RunStatus = Literal["running", "completed", "failed", "escalated"]


class RunRow(BaseModel):
    """One row from `runs` — a single pipeline execution."""

    model_config = ConfigDict(frozen=True)

    id: UUID
    case_id: UUID
    mode: RunMode
    status: RunStatus
    triggered_by: Optional[str] = None
    started_at: datetime
    ended_at: Optional[datetime] = None
    duration_ms: Optional[int] = None
    error_message: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class RunCreate(BaseModel):
    """Payload to insert at the start of a pipeline run.

    The orchestrator generates this when an `/api/run/:case_id` request lands.
    status defaults to 'running' in the DB; ended_at, duration_ms, and
    error_message are filled in by the subsequent RunUpdate at run end.
    """

    case_id: UUID
    mode: RunMode
    triggered_by: Optional[str] = Field(default=None, max_length=64)


class RunUpdate(BaseModel):
    """Partial update emitted by the orchestrator at run end (or on failure)."""

    status: Optional[RunStatus] = None
    ended_at: Optional[datetime] = None
    duration_ms: Optional[int] = None
    error_message: Optional[str] = None
