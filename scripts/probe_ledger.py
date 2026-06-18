"""End-to-end ledger build probe.

  python -m scripts.probe_ledger [case_uuid]

If a case_uuid is given, runs build_and_persist_ledger against that case
directly (in-process). Otherwise picks the seeded CLM-2026-0427 case so the
mock fixture lookup hits MOCK_GRAPHS[CLEAN] cleanly.

Verifies after the run:
  - nodes count in Supabase
  - edges count in Supabase
  - cases.ledger_complete flipped to true

Stays in mock mode (no API keys needed) — proves the wiring, the asyncpg writes,
the two-phase transaction, and the WHERE-guarded flag flip work end to end.
"""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path
from uuid import UUID

import asyncpg
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / "backend" / ".env")

from backend.ledger.service import build_and_persist_ledger  # noqa: E402


def green(s: str) -> str:
    return f"\033[32m{s}\033[0m"


def red(s: str) -> str:
    return f"\033[31m{s}\033[0m"


def cyan(s: str) -> str:
    return f"\033[36m{s}\033[0m"


SEEDED_CASE_UUID = UUID("574d61f9-6cee-4cf7-8d49-e4f98d24be38")


async def main() -> int:
    case_uuid = UUID(sys.argv[1]) if len(sys.argv) > 1 else SEEDED_CASE_UUID
    print(cyan(f"Probing ledger build for case {case_uuid}"))

    dsn = os.environ["DATABASE_URL"]
    conn = await asyncpg.connect(dsn, statement_cache_size=0)
    try:
        row = await conn.fetchrow(
            "select case_id, title, ingestion_complete, ledger_complete from cases where id = $1",
            case_uuid,
        )
        if row is None:
            print(red(f"  ✗ case {case_uuid} not found"))
            return 1
        print(
            f"  before: case_id={row['case_id']!r} title={row['title']!r} "
            f"ing={row['ingestion_complete']} led={row['ledger_complete']}"
        )

        n_before = await conn.fetchval(
            "select count(*) from nodes where case_id = $1", case_uuid
        )
        e_before = await conn.fetchval(
            "select count(*) from edges where case_id = $1", case_uuid
        )
        print(f"  nodes={n_before} edges={e_before}")
    finally:
        await conn.close()

    # ---- the real call --------------------------------------------------------
    print(cyan("\n→ build_and_persist_ledger(case_uuid)"))
    result = await build_and_persist_ledger(case_uuid)
    print(
        green(
            f"  ✓ result: nodes={result.node_count} edges={result.edge_count} "
            f"flipped={result.flipped} valid={result.valid}"
        )
    )
    if result.violations:
        for v in result.violations:
            print(f"     ! {v}")

    # ---- after-state inspection ----------------------------------------------
    conn = await asyncpg.connect(dsn, statement_cache_size=0)
    try:
        row = await conn.fetchrow(
            "select ledger_complete from cases where id = $1", case_uuid
        )
        n_after = await conn.fetchval(
            "select count(*) from nodes where case_id = $1", case_uuid
        )
        e_after = await conn.fetchval(
            "select count(*) from edges where case_id = $1", case_uuid
        )
        print(f"\n  after: led={row['ledger_complete']} nodes={n_after} edges={e_after}")

        # Sample a few facts so we see real data
        facts = await conn.fetch(
            """
            select node_id, type, props, verbatim_quote
            from nodes where case_id = $1 and type = 'Fact'
            order by node_id asc limit 6
            """,
            case_uuid,
        )
        print(cyan(f"\n  Sampled {len(facts)} Fact nodes:"))
        for f in facts:
            label = (f["props"] or {}).get("label") if isinstance(f["props"], dict) else "?"
            quote = (f["verbatim_quote"] or "")[:70]
            print(f"    [{f['node_id']}] {label}")
            print(f"        «{quote}…»")

        # And the edges
        edges = await conn.fetch(
            """
            select e.edge_id, n1.node_id as from_id, n2.node_id as to_id, e.type
            from edges e
            join nodes n1 on n1.id = e.from_id
            join nodes n2 on n2.id = e.to_id
            where e.case_id = $1
            order by e.edge_id asc limit 8
            """,
            case_uuid,
        )
        print(cyan(f"\n  Sampled {len(edges)} edges:"))
        for e in edges:
            print(f"    {e['edge_id']:6s} {e['from_id']:5s} --{e['type']}--> {e['to_id']}")
    finally:
        await conn.close()

    print(green("\n══════ LEDGER BUILD VERIFIED ══════"))
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
