"""Pydantic models for the `transcript` table.

Per-run record of Band-room postings. `run_id` is a foreign key into the
`runs` table (the orchestrator inserts a `runs` row at run start, then writes
transcript rows referencing it). `(run_id, seq)` is the canonical ordering.
A single case can have many runs; the UI typically shows the latest.
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

# Posting kinds enumerated by the CHECK constraint in 001_initial.sql.
PostingKind = Literal["message", "handoff", "gate", "decision", "system"]


class TranscriptRow(BaseModel):
    """One row from `transcript` — a single Band-room posting."""

    model_config = ConfigDict(frozen=True)

    id: UUID
    case_id: UUID
    run_id: UUID
    seq: int
    agent_name: str
    color: int
    kind: PostingKind
    content: str
    posted_at: datetime
    created_at: datetime
    updated_at: datetime


class TranscriptCreate(BaseModel):
    """Payload to insert a posting from the orchestrator's Room."""

    case_id: UUID
    run_id: UUID
    seq: int = Field(ge=0)
    agent_name: str
    color: int
    kind: PostingKind
    content: str
