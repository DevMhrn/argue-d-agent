"""Pydantic models for the `statutes` table.

The public legal-text store the Citation Gate validates against. `statute_id`
is globally unique (e.g. "CA-1431.2") — jurisdictions are not expected to
collide on identifier syntax.
"""
from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class StatuteRow(BaseModel):
    """One row from `statutes` — a referenceable piece of public legal text."""

    model_config = ConfigDict(frozen=True)

    id: UUID
    statute_id: str
    jurisdiction: str
    title: str
    text: str
    created_at: datetime


class StatuteCreate(BaseModel):
    """Payload to insert a new statute (admin-only; not user-facing)."""

    statute_id: str
    jurisdiction: str
    title: str
    text: str
