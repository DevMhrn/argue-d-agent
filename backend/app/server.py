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

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from .providers import is_mock
from .room import make_room, Posting
from .pipeline import run_lumen
from .types import ClaimInput, Statute

# Pace the mock so the live web room is watchable.
os.environ.setdefault("LUMEN_MOCK_DELAY_MS", "650")

# File is now at backend/app/server.py; project root is three parents up.
ROOT = Path(__file__).resolve().parent.parent.parent
DATA = ROOT / "data"
FRONTEND = ROOT / "frontend"

app = FastAPI(title="Lumen — Subrogation Recovery Intelligence")


def _load_cases() -> list[dict]:
    return json.loads((DATA / "cases.json").read_text())


def _sse(event: str, data) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


@app.get("/api/cases")
def api_cases():
    return {"mock": is_mock(), "cases": _load_cases()}


@app.get("/api/case/{case_id}")
def api_case(case_id: str):
    meta = next((c for c in _load_cases() if c["id"] == case_id), None)
    if not meta:
        return JSONResponse({"error": "unknown case"}, status_code=404)
    claim = json.loads((DATA / meta["file"]).read_text())
    return {"meta": meta, "claim": claim}


@app.get("/api/run/{case_id}")
async def api_run(case_id: str):
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
            result = await run_lumen(claim, statutes, room)
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


@app.post("/api/ingest")
async def api_ingest():
    # SEAM for the teammate's ingestion pipeline (image OCR / audio ASR / large-doc chunking).
    return {
        "ok": True,
        "status": "pending_pipeline",
        "message": "Evidence ingestion (OCR / ASR / large-doc chunking) is handled by the ingestion service. Wire it in here.",
    }


# Serve the frontend (must be mounted last so /api/* routes win).
app.mount("/", StaticFiles(directory=str(FRONTEND), html=True), name="static")
