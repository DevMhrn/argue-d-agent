"""Pydantic models for the `decisions` table.

One row per pipeline run, mirroring the `FinalDecision` shape from
`backend/app/types.py`. `secondary_decision` carries Adjudicator B's full output
when dual-adjudication is on. `fault_table` is a structured array; we model it
as a typed list here even though the DB stores it as JSONB.
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

ConsensusType = Literal["agreement", "disagreement", "single", "none"]
DecisionOutcome = Literal["pursue", "escalate", "decline"]
FaultFavors = Literal["us", "them", "neutral"]


class FaultTableRow(BaseModel):
    """One row inside the Adjudicator's fault table.

    favors='us' raises the other driver's fault share; favors='them' lowers it.
    Mirrors `FaultRow` in `backend/app/types.py`.
    """

    factId: str
    favors: FaultFavors
    weight: float = Field(ge=0)


class DecisionRow(BaseModel):
    """One row from `decisions` — the per-run FinalDecision payload."""

    model_config = ConfigDict(frozen=True)

    id: UUID
    case_id: UUID
    run_id: UUID
    other_driver_fault_pct: Decimal = Field(ge=0, le=100)
    confidence: Decimal = Field(ge=0, le=1)
    recovery_usd: Decimal
    escalate: bool
    escalate_reasons: list[str]
    outcome: DecisionOutcome
    pursue: bool
    decline_reason: Optional[str] = None
    near_fifty_fifty: bool
    consensus_type: ConsensusType
    consensus_delta: Decimal
    fault_table: list[FaultTableRow]
    reasoning: str
    secondary_decision: Optional[dict[str, Any]] = None
    letter: str
    audit_hash: Optional[str] = None
    finalized_at: datetime
    created_at: datetime
    updated_at: datetime


class DecisionCreate(BaseModel):
    """Payload to insert the final decision after a pipeline run completes."""

    case_id: UUID
    run_id: UUID
    other_driver_fault_pct: Decimal = Field(ge=0, le=100)
    confidence: Decimal = Field(ge=0, le=1)
    recovery_usd: Decimal
    escalate: bool
    escalate_reasons: list[str] = Field(default_factory=list)
    outcome: DecisionOutcome = "pursue"
    pursue: bool = True
    decline_reason: Optional[str] = None
    near_fifty_fifty: bool
    consensus_type: ConsensusType
    consensus_delta: Decimal
    fault_table: list[FaultTableRow]
    reasoning: str
    secondary_decision: Optional[dict[str, Any]] = None
    letter: str
    audit_hash: Optional[str] = None
