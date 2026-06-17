"""Build + inspect the Evidence Ledger graph offline (no keys, no DB).

  python -m backend.ledger.build_demo            # clean case
  python -m backend.ledger.build_demo loser      # loser case
"""
from __future__ import annotations
import asyncio
import json
import sys
from pathlib import Path

from backend.app.types import ClaimInput, Statute

from .builder import build_ledger, graph_to_evidence_ledger
from .graph import validate_graph, render_graph
from .repository import dry_run

DATA = Path(__file__).resolve().parent.parent.parent / "data"


def _claim_file(case_arg: str) -> str:
    cases = json.loads((DATA / "cases.json").read_text())
    meta = next((c for c in cases if c["id"] == case_arg), None)
    return meta["file"] if meta else "sample_claim_clean.json"


async def main() -> None:
    case_arg = sys.argv[1] if len(sys.argv) > 1 else "clean"
    claim = ClaimInput.model_validate(json.loads((DATA / _claim_file(case_arg)).read_text()))
    statutes = [Statute.model_validate(s) for s in json.loads((DATA / "statutes.json").read_text())]

    graph = await build_ledger(claim, statutes)

    print(render_graph(graph))

    # Pre-flight the graph the way the downstream gates will.
    documents = {d.name: d.text for d in claim.documents}
    v = validate_graph(graph, documents)
    print("\n  Fact-anchor / integrity check:", "PASS ✓" if v.ok else "FAIL ✗")
    for issue in v.violations:
        print("    -", issue)

    # Show what would be persisted, and the projection the orchestration consumes.
    nodes, edges = dry_run(graph)
    print(f"\n  Would persist: {len(nodes)} node rows, {len(edges)} edge rows to Supabase.")
    ledger = graph_to_evidence_ledger(graph)
    print(f"  Projects to EvidenceLedger with {len(ledger.facts)} Fact(s) for the debate lane.")


if __name__ == "__main__":
    asyncio.run(main())
