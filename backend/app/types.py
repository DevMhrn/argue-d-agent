"""Pydantic models — the Evidence Ledger and agent I/O schemas (mirrors src/types.ts).

Validation here is the same guarantee the zod schemas give the Node side: a model
that returns the wrong shape is rejected and retried.
"""
from __future__ import annotations
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, field_validator


class Fact(BaseModel):
    id: str  # "F1"
    statement: str
    source: str  # "police_report.pdf p.2"
    verbatimQuote: str  # contiguous substring of the source — checked by the Fact Gate
    confidence: float = Field(ge=0, le=1)


class EvidenceLedger(BaseModel):
    caseId: str
    facts: list[Fact]


class Document(BaseModel):
    name: str
    kind: str
    text: str


class ClaimInput(BaseModel):
    caseId: str
    insured: str
    otherParty: str
    jurisdiction: str
    damagesUsd: float
    documents: list[Document]


class Statute(BaseModel):
    id: str
    jurisdiction: str
    title: str
    text: str


class Intake(BaseModel):
    class Parties(BaseModel):
        insured: str
        otherParty: str

    parties: Parties
    date: str
    location: str
    # Agents are explicitly allowed to return null when damages aren't in the
    # uploaded documents — that's the "'not in evidence' is allowed and
    # rewarded" rule. The validator coerces common LLM sentinels (literal
    # strings like "not in evidence" / "unknown" / "") to None so a schema
    # crash never punishes correct refusal-to-hallucinate behavior. The
    # pipeline falls back to claim.damagesUsd (the case-level figure) for
    # display + the fault-math, so a null here is non-fatal.
    damagesUsd: Optional[float] = None

    @field_validator("damagesUsd", mode="before")
    @classmethod
    def _coerce_sentinel(cls, v: Any) -> Any:
        if v is None:
            return None
        if isinstance(v, str):
            cleaned = v.strip().lower()
            if cleaned in {"", "not in evidence", "unknown", "n/a", "na", "null", "none"}:
                return None
        return v


class Point(BaseModel):
    claim: str
    citations: list[str]


class Points(BaseModel):
    points: list[Point]


class RebuttalItem(BaseModel):
    stance: Literal["rebut", "concede"]
    claim: str
    citations: list[str]


class Rebuttal(BaseModel):
    responses: list[RebuttalItem]


class FaultRow(BaseModel):
    factId: str
    favors: Literal["us", "them", "neutral"]
    weight: float


class Decision(BaseModel):
    faultTable: list[FaultRow]
    otherDriverFaultPct: float = Field(ge=0, le=100)
    confidence: float = Field(ge=0, le=1)
    reasoning: str


class FinalDecision(Decision):
    recoveryUsd: int
    escalate: bool
    escalateReasons: list[str]
    nearFiftyFifty: bool
    secondary: Optional[Decision] = None
    consensus: Literal["agreement", "disagreement", "single", "none"]
    consensusDelta: float
    # Viability recommendation: 'pursue' worth chasing, 'escalate' needs a human,
    # 'decline' not worth the cost (close the file).
    outcome: Literal["pursue", "escalate", "decline"] = "pursue"
    pursue: bool = True
    declineReason: Optional[str] = None


class AlignmentResult(BaseModel):
    pointIndex: int
    pointSource: str
    claim: str
    citationId: str
    alignment: Literal["supported", "contradicted", "overreach", "neutral"]
    reasoning: str


class Alignment(BaseModel):
    results: list[AlignmentResult]
