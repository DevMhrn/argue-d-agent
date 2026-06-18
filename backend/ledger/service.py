"""The ledger lane's real-flow entry point.

`build_and_persist_ledger(case_id)` is what the worker runs the moment a case's
`ingestion_complete` flips true. It:

  1. reads the case + documents + pages + statutes (through the ingestion
     repository, which owns those tables),
  2. builds the typed Evidence Ledger graph (deterministic mock graph with no
     keys; the real Gemini extraction agent in live mode),
  3. in live mode validates every Fact's verbatim_quote against the real page
     text (the builder already prunes non-anchoring facts; we re-check + log),
  4. writes nodes/edges via the asyncpg LedgerWriteRepository, and
  5. atomically flips cases.ledger_complete = true — which opens the Argument
     Room in the UI.

Mock note: a mock graph is a fixture anchored to the sample claim, not to the
uploaded documents, so the strict anchor check is skipped under is_mock(). This
keeps the full upload→ingest→ledger→room flow demoable with zero API keys.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from uuid import UUID

from backend.app.providers import is_mock
from backend.app.types import ClaimInput, Document, Statute
from backend.ingestion.repository import IngestionRepository

from .builder import build_ledger
from .db_repository import LedgerWriteRepository
from .graph import validate_graph

log = logging.getLogger("lumen.ledger.service")


@dataclass
class LedgerBuildResult:
    case_id: UUID
    node_count: int
    edge_count: int
    flipped: bool
    valid: bool
    violations: list[str]


async def _load_claim(
    repo: IngestionRepository, case_id: UUID
) -> tuple[ClaimInput, dict[str, str]]:
    """Reconstruct a ClaimInput from persisted rows + a {filename: full_text} map.
    A document's text is its pages concatenated in page order."""
    case = await repo.get_case(case_id)
    if case is None:
        raise LookupError(f"ledger build: case {case_id} not found")

    documents: list[Document] = []
    docmap: dict[str, str] = {}
    for d in await repo.list_documents_for_case(case_id):
        pages = await repo.get_pages(d.id)
        text = "\n\n".join(p.extracted_text for p in pages)
        documents.append(Document(name=d.filename, kind=d.document_kind or "document", text=text))
        docmap[d.filename] = text

    claim = ClaimInput(
        caseId=case.case_id,
        insured=case.insured_name or "Insured",
        otherParty=case.other_party_name or "Other Party",
        jurisdiction=case.jurisdiction,
        damagesUsd=float(case.damages_usd) if case.damages_usd is not None else 0.0,
        documents=documents,
    )
    return claim, docmap


async def _load_statutes(repo: IngestionRepository, jurisdiction: str) -> list[Statute]:
    """Statutes for the case's jurisdiction, falling back to the full table if
    none are scoped to that jurisdiction yet."""
    rows = await repo.list_statutes(jurisdiction)
    if not rows:
        rows = await repo.list_statutes()
    return [
        Statute(id=r.statute_id, jurisdiction=r.jurisdiction, title=r.title, text=r.text)
        for r in rows
    ]


async def build_and_persist_ledger(case_id: UUID) -> LedgerBuildResult:
    repo = IngestionRepository()
    claim, docmap = await _load_claim(repo, case_id)
    statutes = await _load_statutes(repo, claim.jurisdiction)

    graph = await build_ledger(claim, statutes)

    if is_mock():
        valid, violations = True, []
        log.info(
            "ledger build (mock fixture, anchors not checked vs uploads): "
            "%d nodes, %d edges for case %s",
            len(graph.nodes), len(graph.edges), case_id,
        )
    else:
        v = validate_graph(graph, docmap)
        valid, violations = v.ok, v.violations
        if not v.ok:
            log.warning("ledger build validation violations for %s: %s", case_id, v.violations)

    writer = LedgerWriteRepository()
    node_count, edge_count = await writer.write_graph(case_id, graph)
    flipped = await writer.mark_ledger_complete(case_id)
    log.info(
        "ledger persisted for %s: %d nodes, %d edges, ledger_complete flipped=%s",
        case_id, node_count, edge_count, flipped,
    )
    return LedgerBuildResult(case_id, node_count, edge_count, flipped, valid, violations)
