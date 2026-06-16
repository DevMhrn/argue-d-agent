"""CLI demo (parity with src/runDemo.ts): python -m lumen_py.run_demo."""
from __future__ import annotations
import asyncio
import json
from pathlib import Path

import os
import sys

from .providers import is_mock
from .room import LocalRoom, Posting, make_room
from .pipeline import run_lumen
from .types import ClaimInput, Statute

DATA = Path(__file__).resolve().parent.parent / "data"


def _print(p: Posting) -> None:
    if p.kind == "gate":
        fail = "REJECTED" in p.content or "FAILED" in p.content
        print(f"\n  {'⛔' if fail else '✓'} {p.agent}\n   {p.content}")
    elif p.kind == "decision":
        print(f"\n  ⚖  {p.agent}\n   {p.content}")
    elif p.kind in ("system", "handoff"):
        print(f"\n  — {p.content}")
    else:
        print(f"\n  {p.agent}\n   {p.content}")


async def main() -> None:
    claim = ClaimInput.model_validate(json.loads((DATA / "sample_claim_clean.json").read_text()))
    statutes = [Statute.model_validate(s) for s in json.loads((DATA / "statutes.json").read_text())]
    use_band = os.getenv("LUMEN_BAND") == "1" or "--band" in sys.argv
    if use_band:
        os.environ["LUMEN_BAND"] = "1"
    room = make_room(claim.caseId, _print) if use_band else LocalRoom(claim.caseId, _print)
    band_note = f" | Band: {getattr(room, 'room_id', None) or 'creating…'}" if use_band else ""
    print(f"\n  LUMEN — AI Subrogation Recovery Officer\n  Mode: {'MOCK' if is_mock() else 'LIVE'} | Case: {claim.caseId}{band_note}")
    result = await run_lumen(claim, statutes, room)
    if use_band and getattr(room, "room_id", None):
        print(f"\n  ↳ Posted to real Band room: {room.room_id}")
    d = result.decision
    print("\n" + "─" * 60 + " RECOVERY PACKET")
    print(f"\n  Other driver fault: {d.otherDriverFaultPct}%   Confidence: {d.confidence}")
    print(f"  Recovery demand:    ${d.recoveryUsd:,}  (of ${int(result.intake.damagesUsd):,} damages)")
    print(f"  Status:             {'NEEDS HUMAN APPROVAL — ' + '; '.join(d.escalateReasons) if d.escalate else 'AUTO-CLEARED'}")
    print("\n" + "─" * 60 + " DEMAND LETTER\n")
    print("\n".join("  " + ln for ln in result.letter.split("\n")))


if __name__ == "__main__":
    asyncio.run(main())
