"""The Evidence Ledger graph — the typed nodes/edges this lane produces.

This is a DB-agnostic, display-id-keyed representation (node_id = "F1", "P1", ...).
The repository maps it to NodeCreate/EdgeCreate rows when writing to Supabase; the
build_demo runner just prints it. Reuses the NodeType/EdgeType literals from
backend/schemas so the graph stays in lockstep with the DB CHECK constraints.
"""
from __future__ import annotations
import re

from pydantic import BaseModel, ConfigDict, Field

from backend.schemas.node import NodeType
from backend.schemas.edge import EdgeType


class LedgerNode(BaseModel):
    node_id: str  # display id, unique within a case: F1, P1, V1, EV1, L1, D1, S1, DOC1
    type: NodeType
    props: dict = Field(default_factory=dict)
    # Fact-only anchor (the Fact Gate substring-checks verbatim_quote vs the source page).
    verbatim_quote: str | None = None
    source_document: str | None = None  # document filename; repo resolves to a UUID
    source_page_number: int | None = None
    confidence: float | None = Field(default=None, ge=0, le=1)


class LedgerEdge(BaseModel):
    edge_id: str  # E1, E2, ...
    from_id: str  # display node_id
    to_id: str
    type: EdgeType
    props: dict = Field(default_factory=dict)


class LedgerGraph(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    caseId: str
    nodes: list[LedgerNode]
    edges: list[LedgerEdge]

    def by_type(self, t: NodeType) -> list[LedgerNode]:
        return [n for n in self.nodes if n.type == t]


def _normalize(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip().lower()


class GraphValidation(BaseModel):
    ok: bool
    violations: list[str]


def validate_graph(graph: LedgerGraph, documents: dict[str, str]) -> GraphValidation:
    """Pre-flight the graph the same way the downstream gates will judge it:

    - Every Fact node carries a verbatim_quote + source_document, and that quote is a
      contiguous substring of the named document's text (the Fact Gate's check).
    - node_id is unique within the case.
    - Every edge endpoint references an existing node.

    `documents` maps document filename -> full extracted text.
    """
    violations: list[str] = []

    seen: set[str] = set()
    for n in graph.nodes:
        if n.node_id in seen:
            violations.append(f"duplicate node_id [{n.node_id}]")
        seen.add(n.node_id)

    for n in graph.nodes:
        if n.type != "Fact":
            continue
        if not n.verbatim_quote or not n.source_document:
            violations.append(f"Fact [{n.node_id}] missing verbatim_quote / source_document")
            continue
        doc = next((text for name, text in documents.items() if n.source_document.startswith(name)), None)
        if doc is None:
            violations.append(f"Fact [{n.node_id}] source '{n.source_document}' matches no document")
        elif _normalize(n.verbatim_quote) not in _normalize(doc):
            violations.append(f"Fact [{n.node_id}] verbatim_quote not found in {n.source_document}")

    ids = {n.node_id for n in graph.nodes}
    for e in graph.edges:
        if e.from_id not in ids:
            violations.append(f"edge [{e.edge_id}] from unknown node [{e.from_id}]")
        if e.to_id not in ids:
            violations.append(f"edge [{e.edge_id}] to unknown node [{e.to_id}]")

    return GraphValidation(ok=not violations, violations=violations)


def render_graph(graph: LedgerGraph) -> str:
    """Human-readable dump for the CLI / logs."""
    lines: list[str] = [f"Evidence Ledger graph — case {graph.caseId}: {len(graph.nodes)} nodes, {len(graph.edges)} edges"]
    order: list[NodeType] = ["Fact", "Party", "Vehicle", "Event", "Location", "Damage", "Statute", "Document"]
    for t in order:
        ns = graph.by_type(t)
        if not ns:
            continue
        lines.append(f"\n  {t}:")
        for n in ns:
            label = n.props.get("label") or n.props.get("name") or n.verbatim_quote or ""
            anchor = f"  «{n.source_document}»" if n.source_document else ""
            lines.append(f"    [{n.node_id}] {label}{anchor}")
    if graph.edges:
        lines.append("\n  Edges:")
        for e in graph.edges:
            lines.append(f"    {e.from_id} --{e.type}--> {e.to_id}")
    return "\n".join(lines)
