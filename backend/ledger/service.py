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
from backend.app.types import ClaimInput, Document, EvidenceLedger, Fact, Statute
from backend.ingestion.repository import IngestionRepository
from backend.schemas import CaseRow, DocumentRow, NodeRow

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


async def _read_documents(
    repo: IngestionRepository, case_id: UUID
) -> list[tuple[DocumentRow, str]]:
    """Each document paired with its full text (pages concatenated in page order)."""
    out: list[tuple[DocumentRow, str]] = []
    for d in await repo.list_documents_for_case(case_id):
        pages = await repo.get_pages(d.id)
        out.append((d, "\n\n".join(p.extracted_text for p in pages)))
    return out


def _reconstruct_claim(case: CaseRow, docs: list[tuple[DocumentRow, str]]) -> ClaimInput:
    return ClaimInput(
        caseId=case.case_id,
        insured=case.insured_name or "Insured",
        otherParty=case.other_party_name or "Other Party",
        jurisdiction=case.jurisdiction,
        damagesUsd=float(case.damages_usd) if case.damages_usd is not None else 0.0,
        documents=[
            Document(name=d.filename, kind=d.document_kind or "document", text=text)
            for d, text in docs
        ],
    )


def _rows_to_evidence_ledger(
    case_label: str, nodes: list[NodeRow], doc_names: dict[UUID, str]
) -> EvidenceLedger:
    """Project the persisted Fact nodes into the flat EvidenceLedger the debate
    consumes — the read-side twin of builder.graph_to_evidence_ledger, but sourced
    from DB rows. `source` resolves source_document_id back to a filename."""
    facts = [
        Fact(
            id=n.node_id,
            statement=str(n.props.get("label") or n.verbatim_quote or n.node_id),
            source=doc_names.get(n.source_document_id, "unknown") if n.source_document_id else "unknown",
            verbatimQuote=n.verbatim_quote or "",
            confidence=float(n.confidence) if n.confidence is not None else 0.5,
        )
        for n in nodes
        if n.type == "Fact"
    ]
    return EvidenceLedger(caseId=case_label, facts=facts)


async def _load_claim(
    repo: IngestionRepository, case_id: UUID
) -> tuple[ClaimInput, dict[str, str]]:
    """Reconstruct a ClaimInput from persisted rows + a {filename: full_text} map."""
    case = await repo.get_case(case_id)
    if case is None:
        raise LookupError(f"ledger build: case {case_id} not found")
    docs = await _read_documents(repo, case_id)
    return _reconstruct_claim(case, docs), {d.filename: text for d, text in docs}


async def load_run_inputs(case_id: UUID) -> tuple[ClaimInput, list[Statute], EvidenceLedger]:
    """Read everything the orchestration needs to run the debate on a REAL case
    over its already-persisted ledger graph: the reconstructed claim, the
    jurisdiction's statutes, and the EvidenceLedger projected from the stored
    Fact nodes. Callers should first confirm cases.ledger_complete is true."""
    repo = IngestionRepository()
    case = await repo.get_case(case_id)
    if case is None:
        raise LookupError(f"run: case {case_id} not found")
    docs = await _read_documents(repo, case_id)
    claim = _reconstruct_claim(case, docs)
    statutes = await _load_statutes(repo, claim.jurisdiction)
    doc_names = {d.id: d.filename for d, _ in docs}
    nodes = await repo.list_nodes_for_case(case_id)
    ledger = _rows_to_evidence_ledger(case.case_id, nodes, doc_names)
    return claim, statutes, ledger


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
