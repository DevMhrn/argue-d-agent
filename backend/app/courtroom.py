"""Courtroom protocol helpers for bounded issue-by-issue orchestration."""
from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, Field

from .types import EvidenceLedger, Statute


IssueKey = Literal["primary_liability", "comparative_fault", "damages", "legal_basis"]


class CourtIssue(BaseModel):
    key: IssueKey
    title: str
    question: str
    fact_ids: list[str] = Field(default_factory=list)
    statute_ids: list[str] = Field(default_factory=list)


class CourtTurn(BaseModel):
    phase: Literal["opening", "direct", "cross", "redirect", "judge_question", "closing"]
    issue_key: IssueKey | None
    speaker: str
    instruction: str


class CourtroomPlan(BaseModel):
    case_id: str
    issues: list[CourtIssue]
    turns: list[CourtTurn]


def build_courtroom_plan(ledger: EvidenceLedger, statutes: list[Statute]) -> CourtroomPlan:
    """Create a deterministic, bounded docket from the locked ledger."""
    issues = [
        CourtIssue(
            key="primary_liability",
            title="Primary liability",
            question="Which facts best prove the other driver's negligence or primary fault?",
            fact_ids=_matching_fact_ids(ledger, ("red", "stop", "signal", "citation", "cited", "fault", "rear", "struck")),
            statute_ids=_matching_statute_ids(statutes, ("red", "signal", "stop", "following", "closely")),
        ),
        CourtIssue(
            key="comparative_fault",
            title="Comparative fault",
            question="Which facts could shift fault back onto our insured?",
            fact_ids=_matching_fact_ids(ledger, ("speed", "mph", "brak", "following", "wet", "contribut", "over")),
            statute_ids=_matching_statute_ids(statutes, ("comparative", "fault", "allocated", "proportion")),
        ),
        CourtIssue(
            key="damages",
            title="Damages",
            question="What documented damages support a recovery demand?",
            fact_ids=_matching_fact_ids(ledger, ("damage", "damages", "repair", "medical", "total", "$")),
        ),
        CourtIssue(
            key="legal_basis",
            title="Legal basis",
            question="Which statutes or rules govern the liability analysis?",
            statute_ids=[s.id for s in statutes],
        ),
    ]
    issues = [_fill_empty_issue(issue, ledger) for issue in issues]

    turns: list[CourtTurn] = [
        CourtTurn(
            phase="opening",
            issue_key=None,
            speaker="Court Clerk",
            instruction="Open the docket and identify the bounded issues for argument.",
        )
    ]
    for issue in issues:
        turns.extend(
            [
                CourtTurn(
                    phase="direct",
                    issue_key=issue.key,
                    speaker="Liability Advocate",
                    instruction=f"Argue our position on {issue.title.lower()} using only this issue packet.",
                ),
                CourtTurn(
                    phase="cross",
                    issue_key=issue.key,
                    speaker="Opposing-Carrier Red Team",
                    instruction=f"Cross-examine our position on {issue.title.lower()} using only this issue packet.",
                ),
                CourtTurn(
                    phase="redirect",
                    issue_key=issue.key,
                    speaker="Liability Advocate",
                    instruction=f"Rebut or concede the defense attack on {issue.title.lower()}.",
                ),
            ]
        )
    turns.append(
        CourtTurn(
            phase="closing",
            issue_key=None,
            speaker="Court Clerk",
            instruction="Close arguments and send the issue record to neutral adjudicators.",
        )
    )
    return CourtroomPlan(case_id=ledger.caseId, issues=issues, turns=turns)


def render_docket(plan: CourtroomPlan) -> str:
    lines = ["Courtroom docket:"]
    for issue in plan.issues:
        sources = ", ".join([*issue.fact_ids, *issue.statute_ids]) or "not in evidence"
        lines.append(f"- {issue.title}: {issue.question} Sources: {sources}.")
    return "\n".join(lines)


def render_issue_context(issue: CourtIssue, ledger: EvidenceLedger, statutes: list[Statute]) -> str:
    facts_by_id = {fact.id: fact for fact in ledger.facts}
    statutes_by_id = {statute.id: statute for statute in statutes}
    lines = [f"Issue: {issue.title}", f"Question: {issue.question}", "Facts:"]
    for fact_id in issue.fact_ids:
        fact = facts_by_id.get(fact_id)
        if fact is None:
            continue
        lines.append(f"[{fact.id}] {fact.statement}")
        lines.append(f"Source: {fact.source}")
        lines.append(f"Quote: {fact.verbatimQuote}")
    if not issue.fact_ids:
        lines.append("not in evidence")
    lines.append("Statutes:")
    for statute_id in issue.statute_ids:
        statute = statutes_by_id.get(statute_id)
        if statute is None:
            continue
        lines.append(f"[{statute.id}] {statute.title}: {statute.text}")
    if not issue.statute_ids:
        lines.append("not in this issue packet")
    return "\n".join(lines)


def _matching_fact_ids(ledger: EvidenceLedger, terms: tuple[str, ...]) -> list[str]:
    matches: list[str] = []
    for fact in ledger.facts:
        haystack = f"{fact.id} {fact.statement} {fact.source} {fact.verbatimQuote}".lower()
        if any(_has_term(haystack, term) for term in terms):
            matches.append(fact.id)
    return matches[:4]


def _matching_statute_ids(statutes: list[Statute], terms: tuple[str, ...]) -> list[str]:
    matches: list[str] = []
    for statute in statutes:
        haystack = f"{statute.id} {statute.title} {statute.text}".lower()
        if any(_has_term(haystack, term) for term in terms):
            matches.append(statute.id)
    return matches[:4]


def _has_term(haystack: str, term: str) -> bool:
    if term == "$":
        return "$" in haystack
    tokens = re.findall(r"[a-z0-9]+", haystack)
    return any(token == term or (len(term) >= 4 and token.startswith(term)) for token in tokens)


def _fill_empty_issue(issue: CourtIssue, ledger: EvidenceLedger) -> CourtIssue:
    if issue.fact_ids or issue.statute_ids:
        return issue
    fallback = [fact.id for fact in ledger.facts[:2]]
    return issue.model_copy(update={"fact_ids": fallback})
