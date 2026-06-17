"""Apply SQL migrations in backend/db/migrations/ to the Supabase Postgres
instance pointed at by DATABASE_URL. Idempotent — safe to re-run.

Run with:
    python -m scripts.apply_migrations
or:
    ./run.sh apply-migrations  (once added to run.sh)
"""
from __future__ import annotations

import asyncio
import os
from pathlib import Path

import asyncpg
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
MIGRATIONS_DIR = ROOT / "backend" / "db" / "migrations"
ENV_PATH = ROOT / "backend" / ".env"


async def apply_migrations() -> None:
    load_dotenv(ENV_PATH)
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        raise SystemExit("DATABASE_URL not set in backend/.env")

    files = sorted(MIGRATIONS_DIR.glob("*.sql"))
    if not files:
        raise SystemExit(f"No .sql migrations found in {MIGRATIONS_DIR}")

    print(f"Connecting to Postgres (host = {dsn.split('@')[1].split('/')[0]})")
    conn = await asyncpg.connect(dsn, statement_cache_size=0)
    try:
        for path in files:
            sql = path.read_text()
            print(f"\n→ Applying {path.name} ({len(sql):,} bytes)")
            await conn.execute(sql)
            print(f"  ✓ {path.name} applied")

        # ---- sanity checks -------------------------------------------------
        print("\n=== Sanity check 1: tables ===")
        rows = await conn.fetch(
            """
            select table_name from information_schema.tables
            where table_schema = 'public' and table_type = 'BASE TABLE'
            order by table_name
            """
        )
        table_names = [r["table_name"] for r in rows]
        print(f"  {len(table_names)} tables: {table_names}")

        print("\n=== Sanity check 2: statutes seeded ===")
        statutes = await conn.fetch(
            "select statute_id, title from statutes order by statute_id"
        )
        for s in statutes:
            print(f"  {s['statute_id']}: {s['title']}")

        print("\n=== Sanity check 3: timestamp coverage ===")
        ts_rows = await conn.fetch(
            """
            select table_name, count(*) as ts_cols
            from information_schema.columns
            where table_schema = 'public'
              and column_name in ('created_at', 'updated_at')
            group by table_name
            order by table_name
            """
        )
        for r in ts_rows:
            mark = "✓" if r["ts_cols"] == 2 else "⚠"
            print(f"  {mark} {r['table_name']}: {r['ts_cols']} timestamp columns")

        print("\n✓ migrations applied successfully")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(apply_migrations())
