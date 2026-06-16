"""CLI demo (parity with src/runDemo.ts): python -m lumen_py.run_demo."""
from __future__ import annotations
import asyncio
import json
from pathlib import Path

from .providers import is_mock
from .room import LocalRoom, Posting
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
    print(f"\n  LUMEN — AI Subrogation Recovery Officer\n  Mode: {'MOCK' if is_mock() else 'LIVE'} | Case: {claim.caseId}")
    room = LocalRoom(claim.caseId, _print)
    result = await run_lumen(claim, statutes, room)
    d = result.decision
    print("\n" + "─" * 60 + " RECOVERY PACKET")
    print(f"\n  Other driver fault: {d.otherDriverFaultPct}%   Confidence: {d.confidence}")
    print(f"  Recovery demand:    ${d.recoveryUsd:,}  (of ${int(result.intake.damagesUsd):,} damages)")
    print(f"  Status:             {'NEEDS HUMAN APPROVAL — ' + '; '.join(d.escalateReasons) if d.escalate else 'AUTO-CLEARED'}")
    print("\n" + "─" * 60 + " DEMAND LETTER\n")
    print("\n".join("  " + ln for ln in result.letter.split("\n")))


if __name__ == "__main__":
    asyncio.run(main())
