"""Async job queue for extraction work.

Uses arq (Redis-backed, async-native, FastAPI-friendly) so the commit endpoint
stays fast and extraction happens in the background. REDIS_URL must use the
`rediss://` scheme to enable TLS (Upstash requires TLS).

Two roles in this module:

    ExtractionQueue   — enqueue-side wrapper, used by the FastAPI process.
    WorkerSettings    — pulled from worker.py; defines the worker-side functions
                        and the Redis connection. Run with:
                          arq backend.ingestion.worker.WorkerSettings
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional
from uuid import UUID

from arq import create_pool
from arq.connections import ArqRedis, RedisSettings


@dataclass(frozen=True)
class QueueConfig:
    """Queue configuration sourced from environment variables."""

    redis_url: str

    @classmethod
    def from_env(cls) -> "QueueConfig":
        url = os.environ.get("REDIS_URL")
        if not url:
            raise RuntimeError(
                "REDIS_URL is not set. Add the Upstash rediss:// connection "
                "string to backend/.env (section 7)."
            )
        return cls(redis_url=url)


def redis_settings_from_env() -> RedisSettings:
    """Build arq's RedisSettings from REDIS_URL. Shared by ExtractionQueue and
    the WorkerSettings in worker.py."""
    return RedisSettings.from_dsn(QueueConfig.from_env().redis_url)


class ExtractionQueue:
    """Enqueue-side wrapper used by the FastAPI commit endpoint.

    The actual job function (`extract_document`) lives in worker.py; here we
    just enqueue by name. arq routes the job by name to whichever worker
    process is listening on this Redis queue.
    """

    JOB_NAME = "extract_document"
    # Hand-off job to the ledger lane. Must match run_ledger_build.__name__ in
    # backend/ledger/jobs.py — arq routes by function name. Enqueued by name only,
    # so this lane never imports ledger code (keeps the lane boundary clean).
    LEDGER_JOB_NAME = "run_ledger_build"

    def __init__(self, config: Optional[QueueConfig] = None) -> None:
        self._config = config or QueueConfig.from_env()
        self._pool: Optional[ArqRedis] = None

    async def _get_pool(self) -> ArqRedis:
        if self._pool is None:
            self._pool = await create_pool(
                RedisSettings.from_dsn(self._config.redis_url)
            )
        return self._pool

    async def enqueue_extract(self, document_id: UUID) -> str:
        """Queue an extraction job, return the arq job id."""
        pool = await self._get_pool()
        # Stringify UUID so it survives JSON serialization in arq.
        job = await pool.enqueue_job(self.JOB_NAME, str(document_id))
        if job is None:
            raise RuntimeError(
                f"Failed to enqueue {self.JOB_NAME}({document_id}) — arq returned None."
            )
        return job.job_id

    async def enqueue_build_ledger(self, case_id: UUID, *, job_id: str | None = None) -> str:
        """Queue a ledger-build job. Routed by name to the worker's run_ledger_build.

        Pass `job_id` to de-duplicate: arq drops a second enqueue while a job with
        the same id is queued/running, so the initial-build triggers (auto-finalize
        + the finalize endpoint) collapse into ONE build. Leave `job_id` unset for
        explicit rebuilds (add-a-doc, manual) so they always run."""
        pool = await self._get_pool()
        job = await pool.enqueue_job(self.LEDGER_JOB_NAME, str(case_id), _job_id=job_id)
        if job is None:
            if job_id is not None:
                # A build for this case is already queued/running — intended de-dup.
                return job_id
            raise RuntimeError(
                f"Failed to enqueue {self.LEDGER_JOB_NAME}({case_id}) — arq returned None."
            )
        return job.job_id

    async def close(self) -> None:
        if self._pool is not None:
            await self._pool.close()
            self._pool = None
