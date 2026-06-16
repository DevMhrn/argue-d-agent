"""Ledger / statute rendering + the set of valid citation ids (mirrors src/ledger.ts)."""
from __future__ import annotations

from .types import EvidenceLedger, Statute


def valid_citation_ids(ledger: EvidenceLedger, statutes: list[Statute]) -> set[str]:
    ids = {f.id for f in ledger.facts}
    ids.update(s.id for s in statutes)
    return ids


def render_ledger(ledger: EvidenceLedger) -> str:
    return "\n".join(
        f"[{f.id}] {f.statement}  (source: {f.source}; confidence {f.confidence})" for f in ledger.facts
    )


def render_statutes(statutes: list[Statute]) -> str:
    return "\n\n".join(f'[{s.id}] {s.title} ({s.jurisdiction})\n"""{s.text.strip()}"""' for s in statutes)
