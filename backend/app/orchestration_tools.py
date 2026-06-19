"""Safe read-only tools exposed to orchestration agents."""
from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel

from .types import EvidenceLedger, Fact, Statute


class LookupResult(BaseModel):
    id: str
    kind: Literal["fact", "statute"]
    text: str
    source: str | None = None
    quote: str | None = None
    confidence: float | None = None


class LedgerLookupTool:
    """Small read-only tool surface over the current run's trusted context."""

    def __init__(self, ledger: EvidenceLedger, statutes: list[Statute]):
        self._facts = {fact.id: fact for fact in ledger.facts}
        self._statutes = {statute.id: statute for statute in statutes}

    def search_ledger(self, query: str, *, limit: int = 5) -> list[LookupResult]:
        terms = _terms(query)
        scored: list[tuple[int, Fact]] = []
        for fact in self._facts.values():
            haystack = f"{fact.id} {fact.statement} {fact.source} {fact.verbatimQuote}".lower()
            tokens = set(re.findall(r"[a-z0-9$]+", haystack))
            score = sum(1 for term in terms if term in tokens)
            if score > 0:
                scored.append((score, fact))
        scored.sort(key=lambda item: (-item[0], item[1].id))
        return [self._fact_result(fact) for _, fact in scored[:limit]]

    def get_node(self, node_id: str) -> LookupResult | None:
        fact = self._facts.get(node_id)
        if fact is None:
            return None
        return self._fact_result(fact)

    def lookup_statute(self, statute_id: str) -> LookupResult | None:
        statute = self._statutes.get(statute_id)
        if statute is None:
            return None
        return LookupResult(
            id=statute.id,
            kind="statute",
            text=statute.text,
            source=f"{statute.jurisdiction} · {statute.title}",
        )

    @staticmethod
    def _fact_result(fact: Fact) -> LookupResult:
        return LookupResult(
            id=fact.id,
            kind="fact",
            text=fact.statement,
            source=fact.source,
            quote=fact.verbatimQuote,
            confidence=fact.confidence,
        )


def _terms(query: str) -> list[str]:
    stopwords = {
        "a",
        "an",
        "and",
        "are",
        "back",
        "best",
        "could",
        "from",
        "onto",
        "our",
        "the",
        "this",
        "to",
        "what",
        "which",
    }
    terms = [
        term
        for term in re.split(r"[^a-zA-Z0-9$]+", query.lower())
        if term and term not in stopwords
    ]
    synonyms = {
        "signal": ["signal", "light"],
        "light": ["light", "signal"],
        "red": ["red"],
    }
    expanded: list[str] = []
    for term in terms:
        expanded.extend(synonyms.get(term, [term]))
    return sorted(set(expanded))
