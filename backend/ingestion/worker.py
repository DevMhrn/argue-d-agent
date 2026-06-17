"""arq worker entry point.

Run with:  arq backend.ingestion.worker.WorkerSettings

This process listens on the Redis queue for extraction jobs and runs them.
It is separate from the FastAPI web server so heavy extraction work does not
block the API. Both processes share the same DATABASE_URL and REDIS_URL.

The on_startup hook builds the IngestService once per worker process and
stashes it on the arq context dict; each job reuses it.
"""
from __future__ import annotations

import logging
from typing import Any
from uuid import UUID

from .db import close_pool
from .queue import ExtractionQueue, redis_settings_from_env
from .repository import IngestionRepository
from .service import IngestService
from .storage import ObjectStorage

log = logging.getLogger("lumen.ingestion.worker")


async def extract_document(ctx: dict[str, Any], document_id_str: str) -> None:
    """Job: run extraction for one document.

    arq passes the context dict as the first argument. The service was built
    in on_startup and stashed at ctx["service"].

    ctx['job_try'] is arq's 1-indexed try counter. We pass it to the service
    along with the configured max_tries so the service can decide whether to
    raise (allowing arq to retry) or mark failed.
    """
    document_id = UUID(document_id_str)
    service: IngestService = ctx["service"]
    job_try = int(ctx.get("job_try", 1))
    log.info("extract_document start: %s  (try %d/%d)", document_id, job_try, WorkerSettings.max_tries)
    try:
        result = await service.extract_document(
            document_id,
            job_try=job_try,
            max_tries=WorkerSettings.max_tries,
        )
        log.info(
            "extract_document done: %s -> status=%s page_count=%s try=%d",
            document_id,
            result.status,
            result.page_count,
            job_try,
        )
    except Exception:
        log.warning(
            "extract_document transient failure: %s (try %d/%d) — arq will retry",
            document_id, job_try, WorkerSettings.max_tries,
        )
        raise


async def on_startup(ctx: dict[str, Any]) -> None:
    """Build the IngestService once per worker process."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s  %(levelname)-7s  %(name)s  %(message)s",
    )
    repo = IngestionRepository()
    storage = ObjectStorage()
    queue = ExtractionQueue()
    ctx["service"] = IngestService(repo=repo, storage=storage, queue=queue)
    ctx["queue"] = queue
    log.info("ingestion worker ready — REDIS connected, services initialized")


async def on_shutdown(ctx: dict[str, Any]) -> None:
    """Clean up shared resources before the worker exits."""
    queue: ExtractionQueue = ctx.get("queue")  # type: ignore[assignment]
    if queue is not None:
        await queue.close()
    await close_pool()
    log.info("ingestion worker shutting down — pools closed")


class WorkerSettings:
    """arq's WorkerSettings — discovered by `arq backend.ingestion.worker.WorkerSettings`."""

    functions = [extract_document]
    on_startup = on_startup
    on_shutdown = on_shutdown
    redis_settings = redis_settings_from_env()
    # How many extractions can run in parallel per worker process. Tune by env later.
    max_jobs = 4
    # Hard cap per job. PDF extraction of a 200-page doc takes ~30s; 5 min is generous.
    job_timeout = 300
    # Max attempts per job. The service classifies the last exception and decides
    # whether to mark 'failed' (permanent or final-try) or re-raise (transient,
    # has retries left). arq applies default exponential backoff between tries.
    max_tries = 3
    # On startup, scan for jobs whose worker died mid-job and retry them.
    health_check_interval = 60
