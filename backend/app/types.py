"""Pydantic models — the Evidence Ledger and agent I/O schemas (mirrors src/types.ts).

Validation here is the same guarantee the zod schemas give the Node side: a model
that returns the wrong shape is rejected and retried.
"""
from __future__ import annotations
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, field_validator


def _coerce_unit_interval(v: Any) -> Any:
    """Best-effort coercion of LLM-returned confidence/probability to a 0-1 float.

    Handles the three common ways an LLM violates a strict 0-1 numeric:
      - returns 0-100 scale by mistake (85 instead of 0.85) → divide by 100
      - returns semantic words ("high", "medium", "low") → map to typical fractions
      - returns "0.85" / "85%" / "0.85 (high)" → strip + parse
    A genuinely unparseable value falls back to 0.5 rather than crashing the run —
    the gates and the consensus check will catch a downstream nonsense decision.
    """
    if v is None:
        return 0.5
    if isinstance(v, bool):  # bool is a subclass of int — handle before numeric
        return 1.0 if v else 0.0
    if isinstance(v, (int, float)):
        f = float(v)
        return f / 100.0 if f > 1.0 else f
    if isinstance(v, str):
        t = v.strip().lower().rstrip("%").strip()
        if t in {"", "n/a", "na", "unknown", "not in evidence", "null", "none"}:
            return 0.5
        if t in {"very high", "high"}: return 0.9
        if t in {"medium", "moderate"}: return 0.6
        if t in {"low"}: return 0.3
        if t in {"very low", "negligible"}: return 0.1
        try:
            f = float(t)
            return f / 100.0 if f > 1.0 else f
        except ValueError:
            return 0.5
    return v


class Fact(BaseModel):
    id: str  # "F1"
    statement: str
    source: str  # "police_report.pdf p.2"
    verbatimQuote: str  # contiguous substring of the source — checked by the Fact Gate
    confidence: float = Field(ge=0, le=1)

    @field_validator("confidence", mode="before")
    @classmethod
    def _normalize_confidence(cls, v: Any) -> Any:
        return _coerce_unit_interval(v)


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


def _coerce_unknown_str(v: Any) -> Any:
    """Coerce None / empty / "null" to the literal 'not in evidence' sentinel.
    Lets agents that hand back a null/missing field still produce a usable
    record instead of a crash — the string sentinel is what the prompt asks
    for on unknown content."""
    if v is None:
        return "not in evidence"
    if isinstance(v, str) and v.strip().lower() in {"", "null", "none"}:
        return "not in evidence"
    return v


class Intake(BaseModel):
    class Parties(BaseModel):
        insured: str
        otherParty: str

        @field_validator("insured", "otherParty", mode="before")
        @classmethod
        def _normalize_party(cls, v: Any) -> Any:
            return _coerce_unknown_str(v)

    parties: Parties
    date: str
    location: str

    @field_validator("date", "location", mode="before")
    @classmethod
    def _normalize_text(cls, v: Any) -> Any:
        return _coerce_unknown_str(v)
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
    # citations defaults to [] so an agent omitting the field doesn't crash —
    # the Citation Gate will catch an empty citation list with its retry path.
    citations: list[str] = Field(default_factory=list)


class Points(BaseModel):
    points: list[Point]


def _coerce_stance(v: Any) -> Any:
    """Coerce an Advocate's rebuttal stance to "rebut" or "concede".
    Defaults to "rebut" on unknown strings — the Advocate's primary job is to
    defend, so a misclassified row is safest as a rebuttal that the Verifier
    can audit downstream. Crashing the whole run on a novel synonym is worse."""
    if not isinstance(v, str):
        return v
    t = v.strip().lower()
    if any(k in t for k in ("concede", "concession", "agree", "accept", "yield")):
        return "concede"
    if any(k in t for k in ("rebut", "reject", "dispute", "deny", "challenge", "push back", "contest")):
        return "rebut"
    return "rebut"


class RebuttalItem(BaseModel):
    stance: Literal["rebut", "concede"]
    claim: str
    citations: list[str] = Field(default_factory=list)

    @field_validator("stance", mode="before")
    @classmethod
    def _normalize_stance(cls, v: Any) -> Any:
        return _coerce_stance(v)


class Rebuttal(BaseModel):
    responses: list[RebuttalItem]


def _coerce_favors(v: Any) -> Any:
    """Coerce a fault-row 'favors' label to one of us / them / neutral.
    Defaults to "neutral" on unknown — neutral contributes nothing to either
    side of the math-gate computation, so it's the safest unclassified bucket."""
    if not isinstance(v, str):
        return v
    t = v.strip().lower()
    if t in {"us", "ours", "our", "our insured", "our side", "plaintiff", "insured"}:
        return "us"
    if t in {"them", "theirs", "their", "the other", "other", "defendant",
             "opposing", "tortfeasor", "at-fault", "at fault"}:
        return "them"
    if t in {"neutral", "neither", "both", "tie", "even", "balanced", "mixed", "n/a", ""}:
        return "neutral"
    return "neutral"


def _coerce_weight(v: Any) -> Any:
    """Coerce per-fact weight to a 0-1 float. Same logic as confidence —
    handles 0-100 scale, semantic words, '0.6 (moderate)' strings, etc."""
    return _coerce_unit_interval(v)


class FaultRow(BaseModel):
    factId: str
    favors: Literal["us", "them", "neutral"]
    weight: float

    @field_validator("favors", mode="before")
    @classmethod
    def _normalize_favors(cls, v: Any) -> Any:
        return _coerce_favors(v)

    @field_validator("weight", mode="before")
    @classmethod
    def _normalize_weight(cls, v: Any) -> Any:
        return _coerce_weight(v)


def _coerce_percent(v: Any) -> Any:
    """Coerce 'other driver fault %' to a 0-100 float. Handles '85%' (str with
    suffix), '0.85' (mistakenly returned as fraction), and 'approximately 85'."""
    if v is None:
        return v  # let Pydantic reject — there's no defensible default for fault %
    if isinstance(v, bool):
        return 100.0 if v else 0.0
    if isinstance(v, (int, float)):
        f = float(v)
        return f * 100.0 if 0 < f <= 1 else f
    if isinstance(v, str):
        t = v.strip().lower().rstrip("%").strip()
        # strip common qualifiers: "approximately 85", "about 85", "~85"
        for prefix in ("approximately", "approx", "about", "roughly", "around", "~"):
            if t.startswith(prefix):
                t = t[len(prefix):].strip()
        try:
            f = float(t)
            return f * 100.0 if 0 < f <= 1 else f
        except ValueError:
            return v
    return v


class Decision(BaseModel):
    faultTable: list[FaultRow]
    otherDriverFaultPct: float = Field(ge=0, le=100)
    confidence: float = Field(ge=0, le=1)
    reasoning: str

    @field_validator("otherDriverFaultPct", mode="before")
    @classmethod
    def _normalize_pct(cls, v: Any) -> Any:
        return _coerce_percent(v)

    @field_validator("confidence", mode="before")
    @classmethod
    def _normalize_confidence(cls, v: Any) -> Any:
        return _coerce_unit_interval(v)


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


def _coerce_alignment(v: Any) -> Any:
    """Coerce a verifier alignment label to the strict Literal set.
    Defaults to "neutral" on unknown — neutral is informational only and
    doesn't shift the escalation decision, so it's the safest unknown."""
    if not isinstance(v, str):
        return v
    t = v.strip().lower()
    if "contradic" in t or "conflict" in t or "opposes" in t:
        return "contradicted"
    if "overreach" in t or "exaggerat" in t or "stretch" in t or "goes beyond" in t:
        return "overreach"
    if "neutral" in t or "silent" in t or "irrelevant" in t or "unrelated" in t:
        return "neutral"
    if "support" in t or "consistent" in t or "confirm" in t or t == "yes":
        return "supported"
    return "neutral"


class AlignmentResult(BaseModel):
    pointIndex: int
    pointSource: str
    claim: str
    citationId: str
    alignment: Literal["supported", "contradicted", "overreach", "neutral"]
    reasoning: str

    @field_validator("alignment", mode="before")
    @classmethod
    def _normalize_alignment(cls, v: Any) -> Any:
        return _coerce_alignment(v)


class Alignment(BaseModel):
    results: list[AlignmentResult]
