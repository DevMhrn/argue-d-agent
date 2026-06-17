"""Builds the Evidence Ledger graph from a case's documents + statutes.

Offline/mock mode returns a deterministic graph (no keys, no network). Live mode
runs the extraction agent over the document text, then prunes any Fact whose
verbatim_quote does not anchor to its source — so the graph that leaves this lane
always passes the downstream Fact Gate.
"""
from __future__ import annotations
import json
import re

from backend.app.config import MODELS
from backend.app.providers import chat, is_mock
from backend.app.types import ClaimInput, Statute, EvidenceLedger, Fact

from .graph import LedgerGraph
from .mock_graphs import MOCK_GRAPHS, CLEAN
from .prompts import EXTRACTION_PROMPT


def _normalize(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip().lower()


def _docs_map(claim: ClaimInput) -> dict[str, str]:
    return {d.name: d.text for d in claim.documents}


def _safe_json(raw: str) -> dict:
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        m = re.search(r"\{[\s\S]*\}", raw)
        if m:
            return json.loads(m.group(0))
        raise ValueError(f"Expected JSON from extraction agent, got: {raw[:200]}")


def _prune_invalid_facts(graph: LedgerGraph, documents: dict[str, str]) -> LedgerGraph:
    """Drop Fact nodes whose verbatim_quote doesn't substring-match its source, plus
    any edges that dangle as a result. Keeps the emitted graph Fact-Gate-clean."""
    norm_docs = {name: _normalize(text) for name, text in documents.items()}
    keep_ids: set[str] = set()
    kept_nodes = []
    for n in graph.nodes:
        if n.type == "Fact":
            doc = next((t for name, t in norm_docs.items() if (n.source_document or "").startswith(name)), None)
            if not n.verbatim_quote or doc is None or _normalize(n.verbatim_quote) not in doc:
                continue
        kept_nodes.append(n)
        keep_ids.add(n.node_id)
    kept_edges = [e for e in graph.edges if e.from_id in keep_ids and e.to_id in keep_ids]
    return LedgerGraph(caseId=graph.caseId, nodes=kept_nodes, edges=kept_edges)


async def build_ledger(claim: ClaimInput, statutes: list[Statute]) -> LedgerGraph:
    if is_mock():
        return MOCK_GRAPHS.get(claim.caseId, MOCK_GRAPHS[CLEAN])

    docs_text = "\n\n".join(f"### {d.name} (page 1 · {d.kind})\n{d.text}" for d in claim.documents)
    stat_text = "\n".join(f"[{s.id}] {s.title}" for s in statutes)
    raw = await chat(
        provider="featherless",
        model=MODELS["evidence"],
        system=EXTRACTION_PROMPT,
        user=f"CASE {claim.caseId}\n\nDOCUMENTS:\n{docs_text}\n\nAVAILABLE STATUTES:\n{stat_text}\n\nExtract the evidence-ledger graph.",
        mock_key="ledger_graph",
        json=True,
    )
    data = _safe_json(raw)
    graph = LedgerGraph(caseId=claim.caseId, nodes=data.get("nodes", []), edges=data.get("edges", []))
    return _prune_invalid_facts(graph, _docs_map(claim))


def graph_to_evidence_ledger(graph: LedgerGraph) -> EvidenceLedger:
    """Project the graph's Fact nodes into the flat EvidenceLedger the orchestration
    pipeline consumes today — the seam that lets the debate run on a real graph."""
    facts = [
        Fact(
            id=n.node_id,
            statement=str(n.props.get("label") or n.verbatim_quote or n.node_id),
            source=n.source_document or "unknown",
            verbatimQuote=n.verbatim_quote or "",
            confidence=n.confidence if n.confidence is not None else 0.5,
        )
        for n in graph.by_type("Fact")
    ]
    return EvidenceLedger(caseId=graph.caseId, facts=facts)
