"""Persists the ledger graph to Supabase — the swappable infra seam.

`to_node_creates` / `to_edge_creates` are pure mappers (testable offline). `dry_run`
assigns placeholder UUIDs so you can inspect the exact rows without a database.
`LedgerRepository` performs the real two-phase write (nodes first to obtain their
UUIDs, then edges referencing them) and flips cases.ledger_complete. The Supabase
client is imported lazily, so this module imports fine with no DB configured.
"""
from __future__ import annotations
import os
from decimal import Decimal
from uuid import UUID, uuid4

from backend.schemas.node import NodeCreate
from backend.schemas.edge import EdgeCreate

from .graph import LedgerGraph


def to_node_creates(graph: LedgerGraph, case_id: UUID, document_ids: dict[str, UUID] | None = None) -> list[NodeCreate]:
    document_ids = document_ids or {}
    out: list[NodeCreate] = []
    for n in graph.nodes:
        src = document_ids.get(n.source_document) if n.source_document else None
        out.append(NodeCreate(
            case_id=case_id, node_id=n.node_id, type=n.type, props=n.props,
            verbatim_quote=n.verbatim_quote, source_document_id=src,
            source_page_number=n.source_page_number,
            confidence=Decimal(str(n.confidence)) if n.confidence is not None else None,
        ))
    return out


def to_edge_creates(graph: LedgerGraph, case_id: UUID, node_uuids: dict[str, UUID]) -> list[EdgeCreate]:
    return [
        EdgeCreate(case_id=case_id, edge_id=e.edge_id, from_id=node_uuids[e.from_id],
                   to_id=node_uuids[e.to_id], type=e.type, props=e.props)
        for e in graph.edges
    ]


def dry_run(graph: LedgerGraph, case_id: UUID | None = None) -> tuple[list[NodeCreate], list[EdgeCreate]]:
    """Build the exact rows we'd insert, with placeholder UUIDs — for offline inspection."""
    cid = case_id or uuid4()
    node_uuids = {n.node_id: uuid4() for n in graph.nodes}
    return to_node_creates(graph, cid), to_edge_creates(graph, cid, node_uuids)


class LedgerRepository:
    """Real Supabase writes. Construct via from_env() once SUPABASE_URL +
    SUPABASE_SERVICE_KEY are set. Methods are no-ops to write until then."""

    def __init__(self, client):
        self.client = client

    @classmethod
    def from_env(cls) -> "LedgerRepository":
        from supabase import create_client  # lazy: only needed for real writes
        url, key = os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"]
        return cls(create_client(url, key))

    def _document_ids(self, case_id: UUID) -> dict[str, UUID]:
        rows = self.client.table("documents").select("id, name").eq("case_id", str(case_id)).execute()
        return {r["name"]: UUID(r["id"]) for r in (rows.data or [])}

    def write_graph(self, case_id: UUID, graph: LedgerGraph) -> None:
        # Phase 1: insert nodes, capture their generated UUIDs by display node_id.
        node_payload = [c.model_dump(mode="json") for c in to_node_creates(graph, case_id, self._document_ids(case_id))]
        inserted = self.client.table("nodes").insert(node_payload).execute()
        node_uuids = {r["node_id"]: UUID(r["id"]) for r in (inserted.data or [])}
        # Phase 2: insert edges referencing the node UUIDs.
        edge_payload = [c.model_dump(mode="json") for c in to_edge_creates(graph, case_id, node_uuids)]
        if edge_payload:
            self.client.table("edges").insert(edge_payload).execute()

    def mark_ledger_complete(self, case_id: UUID) -> None:
        self.client.table("cases").update({"ledger_complete": True}).eq("id", str(case_id)).execute()

    _TENANT = "00000000-0000-0000-0000-000000000001"

    def upsert_case(self, claim) -> UUID:
        """Ensure a `cases` row exists for this claim (by tenant_id, case_id) and return its UUID.

        In the full flow the ingestion lane creates this row; this lets the ledger lane
        run standalone (e.g. the build_demo --persist path) without ingestion."""
        payload = {
            "tenant_id": self._TENANT,
            "case_id": claim.caseId,
            "title": f"{claim.insured} v. {claim.otherParty}",
            "jurisdiction": claim.jurisdiction,
            "damages_usd": claim.damagesUsd,
            "insured_name": claim.insured,
            "other_party_name": claim.otherParty,
        }
        res = self.client.table("cases").upsert(payload, on_conflict="tenant_id,case_id").execute()
        return UUID(res.data[0]["id"])

    def persist_case_graph(self, claim, graph: LedgerGraph) -> UUID:
        """End-to-end: upsert the case, write the graph's nodes/edges, flip ledger_complete.
        Returns the case UUID. (source_document_id stays null until ingestion writes documents.)"""
        case_uuid = self.upsert_case(claim)
        # Replace any prior graph for an idempotent re-run.
        self.client.table("nodes").delete().eq("case_id", str(case_uuid)).execute()
        self.write_graph(case_uuid, graph)
        self.mark_ledger_complete(case_uuid)
        return case_uuid
