"""arq job: build the Evidence Ledger for a case once ingestion completes.

Registered in `backend/ingestion/worker.py`'s WorkerSettings.functions and
enqueued by the ingestion service the moment `cases.ingestion_complete` flips
true. arq routes a job to a worker function by the function's name, so the
constant below must match `run_ledger_build.__name__` and the name the
ExtractionQueue enqueues.

Exceptions propagate so arq retries (same policy as extract_document); the
write is idempotent, so a retry simply rebuilds and replaces the graph.
"""
from __future__ import annotations

import logging
from typing import Any
from uuid import UUID

from .service import build_and_persist_ledger

log = logging.getLogger("lumen.ledger.job")

JOB_NAME = "run_ledger_build"


async def run_ledger_build(ctx: dict[str, Any], case_id_str: str) -> None:
    case_id = UUID(case_id_str)
    job_try = int(ctx.get("job_try", 1))
    log.info("run_ledger_build start: %s (try %d)", case_id, job_try)
    result = await build_and_persist_ledger(case_id)
    log.info(
        "run_ledger_build done: %s nodes=%d edges=%d flipped=%s valid=%s",
        case_id, result.node_count, result.edge_count, result.flipped, result.valid,
    )
