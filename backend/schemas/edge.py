"""Pydantic models for the `edges` table.

An edge is a typed directional relationship between two nodes. The edge types
capture the semantics the orchestration agents reason over (corroborates,
contradicts, attributed_to, etc.). `props` carries optional metadata like
edge weight or extraction confidence.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

# Types enumerated by the CHECK constraint in 001_initial.sql. Extending here
# requires extending the DB constraint too.
EdgeType = Literal[
    "mentioned_in",
    "corroborates",
    "contradicts",
    "attributed_to",
    "governed_by",
    "caused",
    "involves",
    "occurred_at",
    "drives",
]


class EdgeRow(BaseModel):
    """One row from `edges` — a directional typed relationship between two nodes."""

    model_config = ConfigDict(frozen=True)

    id: UUID
    case_id: UUID
    edge_id: str
    from_id: UUID
    to_id: UUID
    type: EdgeType
    props: dict[str, Any]
    created_at: datetime


class EdgeCreate(BaseModel):
    """Payload to insert a new edge."""

    case_id: UUID
    edge_id: str
    from_id: UUID
    to_id: UUID
    type: EdgeType
    props: dict[str, Any] = Field(default_factory=dict)
