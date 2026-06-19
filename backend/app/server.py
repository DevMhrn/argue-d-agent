"""FastAPI backend — serves the static frontend and streams a run over SSE.

This is the production backend (Python) that can talk to the real Band SDK. It
exposes the same routes the frontend already calls, so the UI is unchanged.

Run:  uvicorn backend.app.server:app  (or: python -m backend.app.run_server)
"""
from __future__ import annotations
import asyncio
import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from .providers import is_mock
from .room import make_room, Posting
from .pipeline import run_lumen
from .run_repository import RunRepository
from .types import ClaimInput, Statute
from backend.ingestion.routes import router as ingestion_router

# Pace the mock so the live web room is watchable.
os.environ.setdefault("LUMEN_MOCK_DELAY_MS", "650")

# File is now at backend/app/server.py; project root is three parents up.
ROOT = Path(__file__).resolve().parent.parent.parent
DATA = ROOT / "data"
FRONTEND = ROOT / "frontend"

app = FastAPI(title="Lumen — Subrogation Recovery Intelligence")

# CORS for the Next.js dev server. In dev, Next.js on :3000 proxies /api/* via
# next.config.ts rewrites so requests arrive same-origin and CORS isn't hit —
# this is the belt-and-braces fallback for direct browser → backend calls
# (e.g. EventSource bypassing the proxy, or a deployed frontend on a different
# origin in production).
_DEV_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_DEV_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _load_cases() -> list[dict]:
    return json.loads((DATA / "cases.json").read_text())


def _sse(event: str, data) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def _stage_of(case: dict[str, Any]) -> str:
    """Single-string stage indicator for the home page badge.

    Mirrors the same logic the frontend uses for static-case badges.
    """
    outcome = (case.get("metadata") or {}).get("outcome")
    if outcome == "decline":
        return "declined"
    if case.get("finalized"):
        return "finalized"
    if case.get("ledger_complete"):
        return "ready"
    if case.get("ingestion_complete"):
        return "ledger"
    return "ingesting"


def _serialize_case(c) -> dict[str, Any]:
    """CaseRow → JSON-safe dict for the /api/cases response."""
    return {
        "source": "db",
        "id": str(c.id),
        "case_id": c.case_id,
        "title": c.title,
        "summary": c.summary,
        "jurisdiction": c.jurisdiction,
        "damages_usd": float(c.damages_usd) if c.damages_usd is not None else None,
        "insured_name": c.insured_name,
        "other_party_name": c.other_party_name,
        "ingestion_complete": c.ingestion_complete,
        "ledger_complete": c.ledger_complete,
        "finalized": c.finalized,
        "last_run_at": c.last_run_at.isoformat() if c.last_run_at else None,
        "updated_at": c.updated_at.isoformat(),
        "stage": _stage_of(
            {
                "metadata": dict(c.metadata or {}),
                "ingestion_complete": c.ingestion_complete,
                "ledger_complete": c.ledger_complete,
                "finalized": c.finalized,
            }
        ),
    }


@app.get("/api/cases")
async def api_cases():
    """Unified cases list — demo (JSON) cases + real (Supabase) cases.

    Demo cases come from data/cases.json and drive the canned-mock orchestration
    (clean / loser). Real cases live in Supabase and were created via the
    /api/ingest/case upload flow. Both are returned so the home page surfaces
    everything; the frontend disambiguates with the `source` discriminator.

    Supabase failures are swallowed (the home page still shows demo cases even
    if the DB pool can't be built — e.g. missing DATABASE_URL).
    """
    demo_cases = [{"source": "demo", **c} for c in _load_cases()]
    db_cases: list[dict[str, Any]] = []
    db_error: Optional[str] = None
    try:
        # Lazy import so /api/cases keeps working in pure-mock dev without
        # Supabase creds. ingestion.repository imports asyncpg + dotenv at module load.
        from backend.ingestion.repository import IngestionRepository

        repo = IngestionRepository()
        rows = await repo.list_cases(limit=100)
        db_cases = [_serialize_case(r) for r in rows]
    except Exception as e:  # noqa: BLE001
        db_error = f"{type(e).__name__}: {e}"

    return {
        "mock": is_mock(),
        "cases": demo_cases,        # legacy key — kept for backward-compat
        "demo_cases": demo_cases,
        "db_cases": db_cases,
        "db_error": db_error,
    }


def _is_uuid(s: str) -> bool:
    """Cheap detect: 36 chars with dashes in the canonical positions."""
    if len(s) != 36:
        return False
    try:
        import uuid as _uuid
        _uuid.UUID(s)
        return True
    except (ValueError, AttributeError):
        return False


@app.get("/api/case/{case_id}")
async def api_case(case_id: str):
    """Unified case lookup — handles both demo IDs and real Supabase UUIDs.

    Demo IDs ('clean'/'loser') from data/cases.json return the legacy
    {meta, claim} shape the existing UI expects.

    Real UUIDs return {source: 'db', case, documents, has_ledger, nodes?,
    edges?} so the frontend can render the staged Argument Room flow with the
    actual ingestion/ledger state instead of pretending to be a demo case.
    """
    if _is_uuid(case_id):
        from uuid import UUID as _UUID
        from backend.ingestion.repository import IngestionRepository

        repo = IngestionRepository()
        case_uuid = _UUID(case_id)
        case = await repo.get_case(case_uuid)
        if case is None:
            return JSONResponse({"error": "unknown case"}, status_code=404)
        documents = await repo.list_documents_for_case(case_uuid)
        nodes_payload: list[dict[str, Any]] = []
        edges_payload: list[dict[str, Any]] = []
        if case.ledger_complete:
            nodes = await repo.list_nodes_for_case(case_uuid)
            edges = await repo.list_edges_for_case(case_uuid)
            nodes_payload = [n.model_dump(mode="json") for n in nodes]
            edges_payload = [e.model_dump(mode="json") for e in edges]
        return {
            "source": "db",
            "case": case.model_dump(mode="json"),
            "documents": [d.model_dump(mode="json") for d in documents],
            "has_ledger": case.ledger_complete,
            "nodes": nodes_payload,
            "edges": edges_payload,
        }

    # Demo case (legacy path)
    meta = next((c for c in _load_cases() if c["id"] == case_id), None)
    if not meta:
        return JSONResponse({"error": "unknown case"}, status_code=404)
    claim = json.loads((DATA / meta["file"]).read_text())
    return {"source": "demo", "meta": meta, "claim": claim}


@app.get("/api/run/{case_id}")
async def api_run(case_id: str):
    """Open the Argument Room — stream a debate over the case via SSE.

    Two paths depending on `case_id` shape:

    - **UUID (real Supabase case):** load the persisted ledger from `nodes`/
      `edges`, insert a `runs` row (status='running'), persist every
      `room.post()` to the `transcript` table as the debate unfolds, then on
      completion insert a `decisions` row and flip `runs.status='completed'`
      (or `'failed'` on exception). The `audit_hash` is computed over the
      PERSISTED transcript + decision rows so what's in the DB is the system
      of record.

    - **demo id ('clean'/'loser'):** load the bundled claim from
      `data/sample_claim_*.json`, run in-memory only (no DB writes). Demo
      cases don't have rows in `cases` so we can't satisfy the FK. The audit
      hash is computed over the in-memory postings as before.

    For the UUID path, frontend page reload can fetch
    `/api/runs/{run_id}/transcript` and replay the conversation without
    re-running the agents — the persisted rows are the source of truth.
    """
    # ---- branch on case id shape -------------------------------------------
    ledger = None
    run_id: Optional[Any] = None  # set on the UUID path
    run_repo: Optional[RunRepository] = None
    case_uuid: Optional[Any] = None

    if _is_uuid(case_id):
        from uuid import UUID as _UUID
        from backend.ingestion.repository import IngestionRepository
        from backend.ledger.service import load_run_inputs

        case_uuid = _UUID(case_id)
        try:
            ingest_repo = IngestionRepository()
            case = await ingest_repo.get_case(case_uuid)
            if case is None:
                return JSONResponse({"error": "unknown case"}, status_code=404)
            if not case.ledger_complete:
                return JSONResponse(
                    {"error": "ledger not ready",
                     "detail": "The evidence ledger has not been built for this case yet.",
                     "stage": _stage_of(case.model_dump(mode="json"))},
                    status_code=409,
                )
            claim, statutes, ledger = await load_run_inputs(case_uuid)
            if not ledger.facts:
                return JSONResponse(
                    {"error": "empty ledger",
                     "detail": "The persisted ledger has no facts to argue over."},
                    status_code=409,
                )
        except Exception as e:  # noqa: BLE001 — surface DB/load failures as a clean error
            return JSONResponse({"error": "run setup failed", "detail": f"{type(e).__name__}: {e}"}, status_code=500)

        # Insert the runs row up-front so transcript rows below can FK to it.
        from backend.schemas import RunCreate
        run_repo = RunRepository()
        try:
            run_row = await run_repo.insert_run(
                RunCreate(case_id=case_uuid, mode="mock" if is_mock() else "live")
            )
            run_id = run_row.id
        except Exception as e:  # noqa: BLE001
            return JSONResponse(
                {"error": "run setup failed", "detail": f"insert_run: {type(e).__name__}: {e}"},
                status_code=500,
            )
    else:
        # Demo case (no DB persistence — clean/loser don't have a cases row).
        meta = next((c for c in _load_cases() if c["id"] == case_id), None)
        if not meta:
            return JSONResponse({"error": "unknown case"}, status_code=404)
        claim = ClaimInput.model_validate(json.loads((DATA / meta["file"]).read_text()))
        statutes = [Statute.model_validate(s) for s in json.loads((DATA / "statutes.json").read_text())]

    # ---- SSE plumbing -------------------------------------------------------
    queue: asyncio.Queue = asyncio.Queue()
    loop = asyncio.get_running_loop()

    def on_post(p: Posting) -> None:
        loop.call_soon_threadsafe(queue.put_nowait, ("posting", p.to_dict()))

    # The persistence sink — only set on the UUID path. Writes one transcript
    # row per posting BEFORE the SSE callback fires (see Room.post()).
    persist: Optional[Any] = None
    if run_repo is not None and run_id is not None and case_uuid is not None:
        from backend.schemas import TranscriptCreate
        _run_repo = run_repo
        _run_id = run_id
        _case_uuid = case_uuid

        async def _persist(p: Posting) -> None:
            await _run_repo.insert_posting(
                TranscriptCreate(
                    case_id=_case_uuid,
                    run_id=_run_id,
                    seq=p.seq,
                    agent_name=p.agent,
                    color=p.color,
                    kind=p.kind,
                    content=p.content,
                )
            )
        persist = _persist

    room = make_room(claim.caseId, on_post, persist=persist)

    async def drive() -> None:
        from backend.schemas import RunUpdate
        started_at = datetime.now(timezone.utc)
        try:
            result = await run_lumen(claim, statutes, room, ledger=ledger)
            audit = hashlib.sha256(
                json.dumps({
                    "postings": [p.to_dict() for p in room.postings],
                    "decision": result.decision.model_dump(),
                    "letter": result.letter,
                }).encode()
            ).hexdigest()

            # Persist the decision + complete the run (UUID path only).
            if run_repo is not None and run_id is not None and case_uuid is not None:
                try:
                    await _persist_decision(run_repo, case_uuid, run_id, result, audit)
                except Exception as e:  # noqa: BLE001
                    # Decision persist failure → mark run failed but still emit
                    # the result to the client; the audit chain is broken but
                    # the user shouldn't lose the in-flight decision.
                    await run_repo.complete_run(
                        run_id, status="failed",
                        started_at=started_at,
                        error_message=f"insert_decision: {type(e).__name__}: {e}",
                    )
                else:
                    final_status = "escalated" if result.decision.escalate else "completed"
                    await run_repo.complete_run(
                        run_id, status=final_status, started_at=started_at,
                    )

            await queue.put(("result", {
                "intake": result.intake.model_dump(),
                "ledger": result.ledger.model_dump(),
                "decision": result.decision.model_dump(),
                "letter": result.letter,
                "auditHash": audit,
                "bandRoomId": getattr(room, "room_id", None),
                "runId": str(run_id) if run_id else None,
            }))
            await queue.put(("done", {}))
        except asyncio.CancelledError:
            # Client closed the SSE — StreamingResponse cancels the task.
            # CancelledError inherits BaseException (Python 3.8+), so without
            # this branch the run row stays at 'running' forever. We finalize
            # via asyncio.shield so the bookkeeping update completes even
            # while the task itself is being torn down.
            if run_repo is not None and run_id is not None:
                try:
                    await asyncio.shield(
                        run_repo.complete_run(
                            run_id, status="failed",
                            started_at=started_at,
                            error_message="cancelled (client disconnected)",
                        )
                    )
                except Exception:  # noqa: BLE001
                    pass
            raise
        except Exception as e:  # noqa: BLE001
            if run_repo is not None and run_id is not None:
                try:
                    await run_repo.complete_run(
                        run_id, status="failed",
                        started_at=started_at,
                        error_message=f"{type(e).__name__}: {e}",
                    )
                except Exception:  # noqa: BLE001 — bookkeeping shouldn't mask the real error
                    pass
            await queue.put(("error", {"message": str(e)}))
        finally:
            await queue.put(None)

    # Heartbeat keeps the SSE connection alive through intermediate proxies
    # (Next.js dev rewrite, nginx, etc.) during long-idle stretches — e.g.
    # while a single Claude/GPT agent call is in flight and nothing is being
    # posted to the room. SSE comment lines (": ...\n\n") are ignored by
    # EventSource on the client but count as traffic upstream. 15 s is well
    # under typical proxy idle timeouts (30–60 s).
    HEARTBEAT_INTERVAL = 15.0

    async def stream():
        yield _sse("start", {
            "caseId": claim.caseId,
            "mock": is_mock(),
            "runId": str(run_id) if run_id else None,
        })
        task = asyncio.create_task(drive())
        try:
            while True:
                try:
                    item = await asyncio.wait_for(queue.get(), timeout=HEARTBEAT_INTERVAL)
                except asyncio.TimeoutError:
                    yield ": heartbeat\n\n"
                    continue
                if item is None:
                    break
                event, data = item
                yield _sse(event, data)
        finally:
            if not task.done():
                task.cancel()

    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache, no-transform"})


async def _persist_decision(
    run_repo: RunRepository,
    case_uuid: Any,
    run_id: Any,
    result: Any,
    audit_hash: str,
) -> None:
    """Translate the pipeline's in-memory FinalDecision into a DecisionCreate row.

    Pulled out of api_run to keep the SSE driver readable. Maps pipeline-internal
    camelCase field names to the snake_case schema the `decisions` table uses.
    """
    from decimal import Decimal as _D
    from backend.schemas import DecisionCreate
    from backend.schemas.decision import FaultTableRow

    d = result.decision
    fault_table = [
        FaultTableRow(factId=ft.factId, favors=ft.favors, weight=float(ft.weight))
        for ft in (d.faultTable or [])
    ]
    secondary = d.secondary.model_dump() if d.secondary is not None else None
    await run_repo.insert_decision(
        DecisionCreate(
            case_id=case_uuid,
            run_id=run_id,
            other_driver_fault_pct=_D(str(d.otherDriverFaultPct)),
            confidence=_D(str(d.confidence)),
            recovery_usd=_D(str(d.recoveryUsd)),
            escalate=d.escalate,
            escalate_reasons=list(d.escalateReasons or []),
            near_fifty_fifty=d.nearFiftyFifty,
            consensus_type=d.consensus,
            consensus_delta=_D(str(d.consensusDelta)),
            fault_table=fault_table,
            reasoning=d.reasoning,
            secondary_decision=secondary,
            letter=result.letter,
            audit_hash=audit_hash,
        )
    )


@app.get("/api/cases/{case_id}/runs")
async def api_case_runs(case_id: str):
    """Run history for a real (Supabase) case — newest first.

    Each entry carries the run lifecycle (mode, status, started_at, duration)
    plus a thin summary of the persisted decision if one exists. Used by the
    case-detail page to show prior debate runs and to know which run to replay.
    """
    if not _is_uuid(case_id):
        return JSONResponse({"error": "demo cases have no run history"}, status_code=400)
    from uuid import UUID as _UUID
    case_uuid = _UUID(case_id)
    repo = RunRepository()
    runs = await repo.list_runs_for_case(case_uuid, limit=20)
    out: list[dict[str, Any]] = []
    for r in runs:
        dec = await repo.get_decision_for_run(r.id)
        out.append({
            "run": r.model_dump(mode="json"),
            "decision_summary": None if dec is None else {
                "other_driver_fault_pct": float(dec.other_driver_fault_pct),
                "recovery_usd": float(dec.recovery_usd),
                "confidence": float(dec.confidence),
                "escalate": dec.escalate,
                "consensus_type": dec.consensus_type,
                "audit_hash": dec.audit_hash,
            },
        })
    return {"runs": out}


@app.get("/api/runs/{run_id}/transcript")
async def api_run_transcript(run_id: str):
    """Replay one run — the full ordered transcript + the decision row + run meta.

    The frontend hits this on case-detail mount: instead of leaving the
    Argument Room empty after a reload, we re-hydrate it from the persisted
    postings so the conversation is durable across refreshes.
    """
    if not _is_uuid(run_id):
        return JSONResponse({"error": "invalid run id"}, status_code=400)
    from uuid import UUID as _UUID
    run_uuid = _UUID(run_id)
    repo = RunRepository()
    run = await repo.get_run(run_uuid)
    if run is None:
        return JSONResponse({"error": "unknown run"}, status_code=404)
    postings = await repo.list_transcript_for_run(run_uuid)
    decision = await repo.get_decision_for_run(run_uuid)
    return {
        "run": run.model_dump(mode="json"),
        "postings": [
            {
                "seq": p.seq,
                "agent": p.agent_name,
                "color": p.color,
                "kind": p.kind,
                "content": p.content,
                "posted_at": p.posted_at.isoformat(),
            }
            for p in postings
        ],
        "decision": decision.model_dump(mode="json") if decision else None,
    }


@app.post("/api/decision")
async def api_decision(request: Request):
    body = await request.json()
    print(f"[human-in-the-loop] case={body.get('caseId')} action={body.get('action')}")
    return {"ok": True, **body}


# Mount the ingestion lane's real router (/api/ingest/case, /sign-upload,
# /commit, /status/{id}, /finalize/{id}). This is what the frontend's upload
# flow calls. The router builds its IngestService on first request via
# lru_cache; missing credentials surface as a clear RuntimeError at that point.
app.include_router(ingestion_router)


# Serve the frontend (must be mounted last so /api/* routes win).
# In dev, the Next.js dev server on :3000 is the UI and this mount is skipped.
# In prod, a Next.js static export under frontend/out/ gets served from here.
_FRONTEND_BUILD = FRONTEND / "out"
if _FRONTEND_BUILD.is_dir() and (_FRONTEND_BUILD / "index.html").exists():
    app.mount("/", StaticFiles(directory=str(_FRONTEND_BUILD), html=True), name="static")
elif (FRONTEND / "index.html").exists():
    # Legacy static UI path (kept for the _legacy/ fallback).
    app.mount("/", StaticFiles(directory=str(FRONTEND), html=True), name="static")
