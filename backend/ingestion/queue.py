"""Async job queue for extraction work.

Uses `arq` (Redis-backed, FastAPI-friendly) so the upload endpoint stays fast
and extraction happens in the background. The queue is stubbed here; the real
worker is added once the Upstash/Redis URL is available.

Job shape:
    extract_document(document_id: UUID) -> None
        Reads documents row, fetches the file from object storage, runs the
        right extractor, writes pages, updates documents.status.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional
from uuid import UUID


@dataclass(frozen=True)
class QueueConfig:
    """Queue configuration sourced from environment variables."""

    redis_url: str

    @classmethod
    def from_env(cls) -> "QueueConfig":
        return cls(redis_url=os.environ["REDIS_URL"])


class ExtractionQueue:
    """Thin enqueue surface used by the ingest service.

    Stubbed in this commit; real arq pool wiring lands once REDIS_URL exists.
    """

    def __init__(self, config: Optional[QueueConfig] = None) -> None:
        self._config = config or QueueConfig.from_env()

    async def enqueue_extract(self, document_id: UUID) -> str:
        """Queue an extraction job, return the job id.

        TODO: implement with arq ArqRedis.enqueue_job('extract_document', ...).
        """
        raise NotImplementedError("Queue not yet wired — pending REDIS_URL.")
