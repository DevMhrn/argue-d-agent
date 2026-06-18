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
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from .providers import is_mock
from .room import make_room, Posting
from .pipeline import run_lumen
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
    # Two sources run the same debate. Demo cases (clean/loser) build their ledger
    # from the bundled claim; real Supabase cases run over the graph the ledger lane
    # already persisted (ledger != None → run_lumen skips the rebuild).
    ledger = None
    if _is_uuid(case_id):
        from uuid import UUID as _UUID
        from backend.ingestion.repository import IngestionRepository
        from backend.ledger.service import load_run_inputs

        case_uuid = _UUID(case_id)
        try:
            repo = IngestionRepository()
            case = await repo.get_case(case_uuid)
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
    else:
        meta = next((c for c in _load_cases() if c["id"] == case_id), None)
        if not meta:
            return JSONResponse({"error": "unknown case"}, status_code=404)
        claim = ClaimInput.model_validate(json.loads((DATA / meta["file"]).read_text()))
        statutes = [Statute.model_validate(s) for s in json.loads((DATA / "statutes.json").read_text())]

    queue: asyncio.Queue = asyncio.Queue()
    loop = asyncio.get_running_loop()

    def on_post(p: Posting) -> None:
        loop.call_soon_threadsafe(queue.put_nowait, ("posting", p.to_dict()))

    room = make_room(claim.caseId, on_post)

    async def drive() -> None:
        try:
            result = await run_lumen(claim, statutes, room, ledger=ledger)
            audit = hashlib.sha256(
                json.dumps({
                    "postings": [p.to_dict() for p in room.postings],
                    "decision": result.decision.model_dump(),
                    "letter": result.letter,
                }).encode()
            ).hexdigest()
            await queue.put(("result", {
                "intake": result.intake.model_dump(),
                "ledger": result.ledger.model_dump(),
                "decision": result.decision.model_dump(),
                "letter": result.letter,
                "auditHash": audit,
                "bandRoomId": getattr(room, "room_id", None),
            }))
            await queue.put(("done", {}))
        except Exception as e:  # noqa: BLE001
            await queue.put(("error", {"message": str(e)}))
        finally:
            await queue.put(None)

    async def stream():
        yield _sse("start", {"caseId": claim.caseId, "mock": is_mock()})
        task = asyncio.create_task(drive())
        try:
            while True:
                item = await queue.get()
                if item is None:
                    break
                event, data = item
                yield _sse(event, data)
        finally:
            if not task.done():
                task.cancel()

    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache, no-transform"})


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
