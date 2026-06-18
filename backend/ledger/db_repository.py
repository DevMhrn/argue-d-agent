"""asyncpg persistence for the ledger lane — writes nodes/edges, flips ledger_complete.

This is the real ingestion→ledger→room path. It replaces the sync supabase-py
seam (`repository.py::LedgerRepository`, kept only for the standalone build_demo
--persist tool) because supabase-py is blocking and the team standardized on
asyncpg. It reuses the shared connection pool from the ingestion lane's `db.py`
(one DATABASE_URL, one pool per process).

Lane contract: reads of documents/pages live in the ingestion repository (it
owns those tables); this module owns the WRITES to nodes/edges + the
ledger_complete flip, which is Gowtham's lane.
"""
from __future__ import annotations

import json
from uuid import UUID

from backend.ingestion.db import get_pool

from .graph import LedgerGraph
from .repository import to_node_creates, to_edge_creates


class LedgerWriteRepository:
    """asyncpg writes for the persisted Evidence Ledger graph."""

    async def document_ids(self, case_id: UUID) -> dict[str, UUID]:
        """Map each ingested document's filename -> its UUID, so Fact nodes can
        anchor source_document_id. The `documents` column is `filename`."""
        pool = await get_pool()
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                "select id, filename from documents where case_id = $1", case_id
            )
        return {r["filename"]: r["id"] for r in rows}

    def _resolve_sources(
        self, graph: LedgerGraph, doc_ids: dict[str, UUID]
    ) -> dict[str, UUID]:
        """Map each node's `source_document` string to a document UUID using a
        startswith match (the model may append "(page 1 · police_report)" to the
        filename, mirroring how validate_graph anchors quotes). Keyed by the raw
        source_document string so `to_node_creates`' exact `.get()` resolves."""
        resolved: dict[str, UUID] = {}
        for n in graph.nodes:
            src = n.source_document
            if not src or src in resolved:
                continue
            match = next((u for fn, u in doc_ids.items() if src.startswith(fn)), None)
            if match is not None:
                resolved[src] = match
        return resolved

    async def write_graph(self, case_id: UUID, graph: LedgerGraph) -> tuple[int, int]:
        """Idempotent two-phase write in one transaction: replace any prior graph,
        insert nodes (capturing each generated UUID by display node_id), then insert
        edges referencing those UUIDs. Returns (node_count, edge_count)."""
        doc_ids = await self.document_ids(case_id)
        node_creates = to_node_creates(graph, case_id, self._resolve_sources(graph, doc_ids))

        pool = await get_pool()
        async with pool.acquire() as conn:
            async with conn.transaction():
                # Serialize concurrent builds for the SAME case. Two triggers can race
                # past arq's queue-only de-dup and run at once; without this they both
                # delete-then-insert and collide on the (case_id, node_id) unique key.
                # The advisory lock is held only for these fast DB writes (the slow
                # model call already happened in build_ledger) and releases at commit.
                await conn.execute("select pg_advisory_xact_lock(hashtext($1)::bigint)", str(case_id))
                # Replace any prior graph so a re-run (arq retry / second trigger) is idempotent.
                # Deleting nodes cascades to edges; we delete edges first to be explicit.
                await conn.execute("delete from edges where case_id = $1", case_id)
                await conn.execute("delete from nodes where case_id = $1", case_id)

                node_uuids: dict[str, UUID] = {}
                for c in node_creates:
                    row = await conn.fetchrow(
                        """
                        insert into nodes (
                          case_id, node_id, type, props, verbatim_quote,
                          source_document_id, source_page_number, confidence
                        )
                        values ($1, $2, $3, $4::jsonb, $5, $6, $7, $8)
                        returning id, node_id
                        """,
                        c.case_id, c.node_id, c.type, json.dumps(c.props),
                        c.verbatim_quote, c.source_document_id, c.source_page_number,
                        c.confidence,  # Decimal | None — asyncpg maps to numeric
                    )
                    node_uuids[row["node_id"]] = row["id"]

                edge_creates = to_edge_creates(graph, case_id, node_uuids)
                for e in edge_creates:
                    await conn.execute(
                        """
                        insert into edges (case_id, edge_id, from_id, to_id, type, props)
                        values ($1, $2, $3, $4, $5, $6::jsonb)
                        """,
                        e.case_id, e.edge_id, e.from_id, e.to_id, e.type, json.dumps(e.props),
                    )

        return len(node_creates), len(edge_creates)

    async def mark_ledger_complete(self, case_id: UUID) -> bool:
        """Atomically flip cases.ledger_complete = true IFF not already set.
        Race-safe (mirrors ingestion's maybe_finalize_ingestion). Returns True if
        this call flipped it, False if it was already complete / case missing."""
        pool = await get_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                update cases
                   set ledger_complete = true
                 where id = $1
                   and not ledger_complete
                 returning id
                """,
                case_id,
            )
        return row is not None
