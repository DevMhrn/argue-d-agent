"""Source-Alignment Verifier helpers (ported from src/verifier.py).

Collects (claim, factId) pairs from the transcript and summarizes the verifier's
alignment verdicts. Statute citations are excluded — those are the Citation Gate's job.
"""
from __future__ import annotations
import re
from dataclasses import dataclass, field

from .types import Point, Rebuttal, AlignmentResult

_FACT_ID = re.compile(r"^F\d+", re.IGNORECASE)


@dataclass
class VerifierTask:
    pointIndex: int
    pointSource: str
    claim: str
    citationId: str


def collect_verifier_tasks(
    advocate_points: list[Point],
    opposing_theory: list[Point],
    attack_points: list[Point],
    rebuttal: Rebuttal,
) -> list[VerifierTask]:
    tasks: list[VerifierTask] = []

    def push_all(points: list[Point], source: str) -> None:
        for i, p in enumerate(points):
            for c in p.citations:
                if _FACT_ID.match(c):
                    tasks.append(VerifierTask(i, source, p.claim, c))

    push_all(advocate_points, "advocate_position")
    push_all(opposing_theory, "opposing_independent")
    push_all(attack_points, "opposing_attack")
    for i, r in enumerate(rebuttal.responses):
        for c in r.citations:
            if _FACT_ID.match(c):
                tasks.append(VerifierTask(i, f"advocate_rebuttal:{r.stance}", r.claim, c))
    return tasks


@dataclass
class VerifierSummary:
    total: int = 0
    supported: int = 0
    contradicted: int = 0
    overreach: int = 0
    neutral: int = 0
    contradicted_details: list[AlignmentResult] = field(default_factory=list)
    overreach_details: list[AlignmentResult] = field(default_factory=list)


def summarize_alignment(results: list[AlignmentResult]) -> VerifierSummary:
    s = VerifierSummary(total=len(results))
    for r in results:
        if r.alignment == "supported":
            s.supported += 1
        elif r.alignment == "contradicted":
            s.contradicted += 1
            s.contradicted_details.append(r)
        elif r.alignment == "overreach":
            s.overreach += 1
            s.overreach_details.append(r)
        else:
            s.neutral += 1
    return s
