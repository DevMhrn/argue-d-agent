"""Persistence for the orchestration lane — runs, transcript, decisions.

Writes (and reads) every artifact a debate run produces:
  - one `runs` row at start (status='running') → updated at end (status + duration)
  - one `transcript` row per `room.post()` while the debate is happening
  - one `decisions` row at completion (with the audit hash over the persisted rows)

Uses asyncpg directly via the shared pool from `backend.ingestion.db.get_pool()` —
same pool the ingestion + ledger lanes use, one process-wide connection set.

The orchestration lane is allowed to write into `runs`, `transcript`, and
`decisions`; it never touches the ingestion/ledger tables (read-only there).
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Optional
from uuid import UUID

from backend.ingestion.db import get_pool
from backend.schemas import (
    DecisionCreate,
    DecisionRow,
    RunCreate,
    RunRow,
    RunStatus,
    RunUpdate,
    TranscriptCreate,
    TranscriptRow,
)

log = logging.getLogger("lumen.app.run_repository")


def _jsonb(v: Any) -> Optional[dict[str, Any] | list[Any]]:
    """asyncpg returns JSONB columns as str by default; normalize to dict/list."""
    if v is None:
        return None
    if isinstance(v, (dict, list)):
        return v
    if isinstance(v, str):
        return json.loads(v)
    return v


class RunRepository:
    """asyncpg-backed writer + reader for runs / transcript / decisions."""

    # ---- writes -------------------------------------------------------------

    async def insert_run(self, payload: RunCreate) -> RunRow:
        pool = await get_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                insert into runs (case_id, mode, status, triggered_by)
                values ($1, $2, 'running', $3)
                returning *
                """,
                payload.case_id,
                payload.mode,
                payload.triggered_by,
            )
            return self._row_to_run(row)

    async def update_run(self, run_id: UUID, payload: RunUpdate) -> RunRow:
        """Partial update — set whichever fields are non-None on payload."""
        fields: list[str] = []
        values: list[Any] = []
        for name in ("status", "ended_at", "duration_ms", "error_message"):
            v = getattr(payload, name)
            if v is not None:
                fields.append(f"{name} = ${len(values) + 1}")
                values.append(v)
        if not fields:
            existing = await self.get_run(run_id)
            if existing is None:
                raise LookupError(f"run {run_id} not found")
            return existing
        values.append(run_id)
        sql = f"update runs set {', '.join(fields)} where id = ${len(values)} returning *"
        pool = await get_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow(sql, *values)
            if row is None:
                raise LookupError(f"run {run_id} not found")
            return self._row_to_run(row)

    async def complete_run(
        self,
        run_id: UUID,
        *,
        status: RunStatus,
        started_at: datetime,
        error_message: Optional[str] = None,
    ) -> RunRow:
        """Mark a run finished and stamp duration_ms relative to its start time."""
        ended_at = datetime.now(timezone.utc)
        duration_ms = int((ended_at - started_at).total_seconds() * 1000)
        return await self.update_run(
            run_id,
            RunUpdate(
                status=status,
                ended_at=ended_at,
                duration_ms=duration_ms,
                error_message=error_message,
            ),
        )

    async def insert_posting(self, payload: TranscriptCreate) -> TranscriptRow:
        """One transcript row per room.post(). Sequence is owned by the caller
        (Room._seq), so (run_id, seq) is unique by construction."""
        pool = await get_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                insert into transcript (
                  case_id, run_id, seq, agent_name, color, kind, content
                )
                values ($1, $2, $3, $4, $5, $6, $7)
                returning *
                """,
                payload.case_id,
                payload.run_id,
                payload.seq,
                payload.agent_name,
                payload.color,
                payload.kind,
                payload.content,
            )
            return self._row_to_transcript(row)

    async def insert_decision(self, payload: DecisionCreate) -> DecisionRow:
        """One decisions row per run. The audit_hash is computed by the caller
        over the persisted transcript + this decision so the chain stays honest."""
        pool = await get_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                insert into decisions (
                  case_id, run_id, other_driver_fault_pct, confidence, recovery_usd,
                  escalate, escalate_reasons, near_fifty_fifty,
                  consensus_type, consensus_delta, fault_table, reasoning,
                  secondary_decision, letter, audit_hash
                )
                values (
                  $1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10,
                  $11::jsonb, $12, $13::jsonb, $14, $15
                )
                returning *
                """,
                payload.case_id,
                payload.run_id,
                payload.other_driver_fault_pct,
                payload.confidence,
                payload.recovery_usd,
                payload.escalate,
                json.dumps(payload.escalate_reasons),
                payload.near_fifty_fifty,
                payload.consensus_type,
                payload.consensus_delta,
                json.dumps([f.model_dump() for f in payload.fault_table]),
                payload.reasoning,
                json.dumps(payload.secondary_decision) if payload.secondary_decision is not None else None,
                payload.letter,
                payload.audit_hash,
            )
            return self._row_to_decision(row)

    # ---- reads --------------------------------------------------------------

    async def get_run(self, run_id: UUID) -> Optional[RunRow]:
        pool = await get_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow("select * from runs where id = $1", run_id)
            return self._row_to_run(row) if row else None

    async def list_runs_for_case(
        self, case_id: UUID, *, limit: int = 20, stale_after_seconds: int = 600
    ) -> list[RunRow]:
        """Most recent runs first. Sweeps stale 'running' runs (started >
        stale_after_seconds ago) to 'failed' before reading — covers the case
        where the FastAPI process was killed mid-debate or the client cancelled
        the SSE stream so the finally-block update never landed.

        The window is 10 min, not seconds: a LIVE debate makes ~8 sequential
        model calls (the Source-Alignment Verifier alone can take ~2 min), so a
        shorter timeout would sweep an in-flight live run to 'failed' before it
        finishes — which is exactly the spurious 'failed' we saw at 180s."""
        pool = await get_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                """
                update runs
                   set status = 'failed',
                       ended_at = now(),
                       error_message = coalesce(error_message,
                                                'stale (no heartbeat for > '
                                                || $2::text || 's)')
                 where case_id = $1
                   and status = 'running'
                   and started_at < now() - make_interval(secs => $2)
                """,
                case_id,
                stale_after_seconds,
            )
            rows = await conn.fetch(
                """
                select * from runs
                where case_id = $1
                order by started_at desc
                limit $2
                """,
                case_id,
                limit,
            )
            return [self._row_to_run(r) for r in rows]

    async def list_transcript_for_run(
        self, run_id: UUID
    ) -> list[TranscriptRow]:
        """Ordered postings — drives the frontend's replay-on-mount and also
        any future agent that wants to read the prior debate in-context."""
        pool = await get_pool()
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                select * from transcript
                where run_id = $1
                order by seq asc
                """,
                run_id,
            )
            return [self._row_to_transcript(r) for r in rows]

    async def get_decision_for_run(self, run_id: UUID) -> Optional[DecisionRow]:
        pool = await get_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                "select * from decisions where run_id = $1", run_id
            )
            return self._row_to_decision(row) if row else None

    # ---- row mappers --------------------------------------------------------

    @staticmethod
    def _row_to_run(r: Any) -> RunRow:
        return RunRow(
            id=r["id"],
            case_id=r["case_id"],
            mode=r["mode"],
            status=r["status"],
            triggered_by=r["triggered_by"],
            started_at=r["started_at"],
            ended_at=r["ended_at"],
            duration_ms=r["duration_ms"],
            error_message=r["error_message"],
            created_at=r["created_at"],
            updated_at=r["updated_at"],
        )

    @staticmethod
    def _row_to_transcript(r: Any) -> TranscriptRow:
        return TranscriptRow(
            id=r["id"],
            case_id=r["case_id"],
            run_id=r["run_id"],
            seq=r["seq"],
            agent_name=r["agent_name"],
            color=r["color"],
            kind=r["kind"],
            content=r["content"],
            posted_at=r["posted_at"],
            created_at=r["created_at"],
            updated_at=r["updated_at"],
        )

    @staticmethod
    def _row_to_decision(r: Any) -> DecisionRow:
        from backend.schemas.decision import FaultTableRow

        fault_table_raw = _jsonb(r["fault_table"]) or []
        return DecisionRow(
            id=r["id"],
            case_id=r["case_id"],
            run_id=r["run_id"],
            other_driver_fault_pct=r["other_driver_fault_pct"],
            confidence=r["confidence"],
            recovery_usd=r["recovery_usd"],
            escalate=r["escalate"],
            escalate_reasons=_jsonb(r["escalate_reasons"]) or [],
            near_fifty_fifty=r["near_fifty_fifty"],
            consensus_type=r["consensus_type"],
            consensus_delta=r["consensus_delta"],
            fault_table=[FaultTableRow.model_validate(f) for f in fault_table_raw],
            reasoning=r["reasoning"],
            secondary_decision=_jsonb(r["secondary_decision"]),
            letter=r["letter"],
            audit_hash=r["audit_hash"],
            finalized_at=r["finalized_at"],
            created_at=r["created_at"],
            updated_at=r["updated_at"],
        )
