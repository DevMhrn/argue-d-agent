"""asyncpg connection pool factory.

A single Pool instance per process, lazily created on first use. Shared by
the repository and any other DB consumers in the ingestion lane. The
connection string comes from DATABASE_URL — see backend/.env.

Why asyncpg and not supabase-py: supabase-py is sync-only in its current
Python form, which would block our async FastAPI event loop. asyncpg is
native async, faster, and we already have the direct Postgres connection
string from Supabase.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

import asyncpg
from dotenv import load_dotenv

# Load backend/.env once on first import so any caller (scripts, worker, server)
# sees DATABASE_URL + storage + queue credentials without having to call
# load_dotenv themselves. Resolves relative to this file: backend/ingestion/db.py
# → parent.parent is backend/.
_ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(dotenv_path=_ENV_PATH)

_pool: Optional[asyncpg.Pool] = None


async def get_pool() -> asyncpg.Pool:
    """Return the shared connection pool, creating it on first call.

    Pool size is intentionally small (min 1, max 10) — Supabase free tier has
    connection limits and we are not high-traffic. Adjust if we see contention.
    """
    global _pool
    if _pool is None:
        dsn = os.environ.get("DATABASE_URL")
        if not dsn:
            raise RuntimeError(
                "DATABASE_URL is not set. Add it to backend/.env (the Supabase "
                "Postgres connection string with URL-encoded password)."
            )
        _pool = await asyncpg.create_pool(
            dsn=dsn,
            min_size=1,
            max_size=10,
            command_timeout=30,
            statement_cache_size=0,  # pgBouncer-safe
        )
    return _pool


async def close_pool() -> None:
    """Tear down the pool. Call from FastAPI shutdown hook and arq on_shutdown."""
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None
