"""Pydantic models for the `nodes` table (Gowtham's ledger lane).

A node is the smallest unit of the Evidence Ledger graph. `node_id` is the
human-readable display id ("F1", "P1", "V1"...), unique within a case. `type`
drives the shape of `props`; Fact nodes additionally carry `verbatim_quote`
plus a `(source_document_id, source_page_number)` anchor that the Fact Gate
verifies.
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

# Types enumerated by the CHECK constraint in 001_initial.sql. Extending the
# DB constraint also requires extending this literal.
NodeType = Literal[
    "Fact",
    "Party",
    "Vehicle",
    "Event",
    "Location",
    "Statute",
    "Damage",
    "Document",
]


class NodeRow(BaseModel):
    """One row from `nodes` — a typed graph node in the Evidence Ledger."""

    model_config = ConfigDict(frozen=True)

    id: UUID
    case_id: UUID
    node_id: str
    type: NodeType
    props: dict[str, Any]
    verbatim_quote: Optional[str] = None
    source_document_id: Optional[UUID] = None
    source_page_number: Optional[int] = None
    confidence: Optional[Decimal] = Field(default=None, ge=0, le=1)
    created_at: datetime
    updated_at: datetime


class NodeCreate(BaseModel):
    """Payload to insert a new ledger node."""

    case_id: UUID
    node_id: str
    type: NodeType
    props: dict[str, Any] = Field(default_factory=dict)
    verbatim_quote: Optional[str] = None
    source_document_id: Optional[UUID] = None
    source_page_number: Optional[int] = None
    confidence: Optional[Decimal] = Field(default=None, ge=0, le=1)
