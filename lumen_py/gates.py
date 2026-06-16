"""The verification gates — CODE, not prompts (ported from src/citationGate.ts,
factGate.ts, mathGate.ts). These are the hard guarantees the LLMs cannot bypass.
"""
from __future__ import annotations
import re
from dataclasses import dataclass, field

from .types import Point, EvidenceLedger, ClaimInput, Decision


def _truncate(s: str, n: int = 48) -> str:
    return s if len(s) <= n else s[: n - 1] + "…"


# ----------------------------------------------------------------- citation gate
@dataclass
class GateResult:
    ok: bool
    violations: list[str] = field(default_factory=list)


def check_points(points: list[Point], valid_ids: set[str]) -> GateResult:
    """Every point must carry >=1 citation, each resolving to a known fact/statute id."""
    violations: list[str] = []
    for i, p in enumerate(points):
        label = f'point #{i + 1} ("{_truncate(p.claim)}")'
        if not p.citations:
            violations.append(f"{label} has NO citation — every claim must cite evidence.")
            continue
        for c in p.citations:
            if c not in valid_ids:
                violations.append(f"{label} cites unknown id [{c}] — not in the evidence ledger or statute store.")
    return GateResult(ok=len(violations) == 0, violations=violations)


# ----------------------------------------------------------------- fact gate
def _normalize(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip().lower()


def check_ledger_anchoring(ledger: EvidenceLedger, claim: ClaimInput) -> GateResult:
    """Every fact's verbatimQuote must be a contiguous substring of its source doc."""
    docs = [(d.name, _normalize(d.text)) for d in claim.documents]
    violations: list[str] = []
    for fact in ledger.facts:
        label = f"[{fact.id}] ({_truncate(fact.statement)})"
        if not fact.verbatimQuote or not fact.verbatimQuote.strip():
            violations.append(f"{label} has no verbatimQuote — every fact must anchor to a source substring.")
            continue
        matching = next((t for (name, t) in docs if fact.source.startswith(name)), None)
        if matching is None:
            violations.append(f'{label} source "{fact.source}" does not match any input document.')
            continue
        if _normalize(fact.verbatimQuote) not in matching:
            violations.append(f'{label} verbatimQuote not found in source: "{_truncate(fact.verbatimQuote, 80)}"')
    return GateResult(ok=len(violations) == 0, violations=violations)


# ----------------------------------------------------------------- math gate
@dataclass
class MathGateResult:
    ok: bool
    computed_pct: int
    stated_pct: float
    delta: float
    violation: str | None = None


def check_adjudicator_math(decision: Decision, tolerance: float = 10) -> MathGateResult:
    """Independently compute the % implied by the fault table; reject if it disagrees.

    favors 'us'   -> raises otherDriverFaultPct
    favors 'them' -> lowers it
    favors 'neutral' -> no contribution
    """
    w_other = sum(r.weight for r in decision.faultTable if r.favors == "us")
    w_ours = sum(r.weight for r in decision.faultTable if r.favors == "them")
    total = w_other + w_ours
    computed = 50 if total == 0 else round((w_other / total) * 100)
    stated = decision.otherDriverFaultPct
    delta = abs(computed - stated)
    if delta > tolerance:
        return MathGateResult(
            ok=False, computed_pct=computed, stated_pct=stated, delta=delta,
            violation=f"Math gate: fault table implies {computed}% but Adjudicator stated {stated}% (delta {delta}pp > tolerance {tolerance}pp).",
        )
    return MathGateResult(ok=True, computed_pct=computed, stated_pct=stated, delta=delta)
