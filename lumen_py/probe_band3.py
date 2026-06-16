"""End-to-end Band verification: run the full pipeline into a real room, then read
the room back and count distinct message senders. Run: .venv/bin/python -m lumen_py.probe_band3
"""
from __future__ import annotations
import asyncio
import json
import os
from collections import Counter
from pathlib import Path

os.environ["LUMEN_BAND"] = "1"
os.environ.setdefault("LUMEN_MOCK_DELAY_MS", "0")

from thenvoi_rest import AsyncRestClient  # noqa: E402
from .room import BandConfig, BandRoom  # noqa: E402
from .pipeline import run_lumen  # noqa: E402
from .types import ClaimInput, Statute  # noqa: E402

DATA = Path(__file__).resolve().parent.parent / "data"


async def main() -> None:
    claim = ClaimInput.model_validate(json.loads((DATA / "sample_claim_clean.json").read_text()))
    statutes = [Statute.model_validate(s) for s in json.loads((DATA / "statutes.json").read_text())]
    cfg = BandConfig()
    room = BandRoom(claim.caseId, cfg)
    print("Running full 8-agent pipeline into a real Band room…")
    await run_lumen(claim, statutes, room)
    print("Local postings:", len(room.postings))
    print("Band room id:", room.room_id)

    # Read the FULL room transcript via fetch_room_context (not the per-agent inbox).
    from band import AgentTools
    rest = AsyncRestClient(base_url=cfg.rest_url, api_key=cfg.agents["adjudicator"].api_key)
    tools = AgentTools(room_id=room.room_id, rest=rest)
    ctx = await tools.fetch_room_context(room_id=room.room_id, page=1, page_size=100)
    # ctx is a dict; find the messages list inside it.
    msgs = ctx.get("messages") if isinstance(ctx, dict) else None
    if msgs is None and isinstance(ctx, dict):
        print("   ctx keys:", list(ctx.keys()))
        for v in ctx.values():
            if isinstance(v, list) and v and isinstance(v[0], dict):
                msgs = v
                break
    msgs = msgs or []
    senders = Counter()
    for m in msgs:
        s = (m.get("sender_handle") or m.get("sender_name") or m.get("sender_id")
             or (m.get("sender") or {}).get("name") if isinstance(m, dict) else None)
        senders[str(s)] += 1
    print(f"\nFULL room transcript messages: {len(msgs)}")
    print("Distinct senders:")
    for s, n in senders.items():
        print(f"   {s}: {n}")


if __name__ == "__main__":
    asyncio.run(main())
