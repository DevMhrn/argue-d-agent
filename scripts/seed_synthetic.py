"""Seed the synthetic Alex/Jordan case into Supabase.

This bypasses the real upload-then-extract flow and writes directly to the
cases, documents, and document_pages tables. It is for development convenience
so we have a baseline case in the DB without needing actual file uploads
during initial wiring.

Each document in data/sample_claim_clean.json becomes:
  - one `documents` row (status='extracted', mime_type derived from .ext, sha256 of the text)
  - one `document_pages` row (page_number=1, the existing text)
and the case is flipped to ingestion_complete=true.

Run with:
    python -m scripts.seed_synthetic
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import mimetypes
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID

from backend.ingestion.db import close_pool
from backend.ingestion.repository import IngestionRepository
from backend.schemas import (
    CaseCreate,
    CaseStatusUpdate,
    DocumentCreate,
    DocumentPageCreate,
    DocumentStatusUpdate,
)

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
SAMPLE = DATA / "sample_claim_clean.json"

log = logging.getLogger("seed")


# Map filename extensions to mime types we actually support. Falls back to
# the stdlib mimetypes module for anything else.
EXT_OVERRIDES: dict[str, str] = {
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".html": "text/html",
}


def guess_mime(filename: str) -> str:
    for ext, mime in EXT_OVERRIDES.items():
        if filename.lower().endswith(ext):
            return mime
    guess, _ = mimetypes.guess_type(filename)
    return guess or "application/octet-stream"


async def seed(claim_path: Path) -> UUID:
    payload = json.loads(claim_path.read_text())
    repo = IngestionRepository()

    log.info("creating case %s", payload["caseId"])
    case = await repo.create_case(
        CaseCreate(
            case_id=payload["caseId"],
            title=f"{payload['insured']} vs {payload['otherParty']} (seeded)",
            summary=f"Synthetic case loaded from {claim_path.name} for development testing.",
            jurisdiction=payload["jurisdiction"],
            damages_usd=payload.get("damagesUsd"),
            insured_name=payload["insured"],
            other_party_name=payload["otherParty"],
        )
    )
    log.info("case row created — id=%s", case.id)

    for doc in payload["documents"]:
        text: str = doc["text"]
        text_bytes = text.encode("utf-8")
        sha256 = hashlib.sha256(text_bytes).hexdigest()
        mime = guess_mime(doc["name"])

        log.info("inserting document %s (%s, %d bytes)", doc["name"], mime, len(text_bytes))
        document = await repo.create_document(
            DocumentCreate(
                case_id=case.id,
                filename=doc["name"],
                document_kind=doc.get("kind"),
                mime_type=mime,
                sha256=sha256,
                file_size_bytes=len(text_bytes),
                storage_provider="backblaze",
                storage_bucket="seed-synthetic",  # no real upload — placeholder
                storage_key=f"cases/{case.id}/{sha256}-{doc['name']}",
            )
        )

        await repo.insert_pages([
            DocumentPageCreate(
                document_id=document.id,
                page_number=1,
                extracted_text=text,
                char_count=len(text),
                extraction_metadata={"source": "seed_synthetic.py", "synthetic": True},
            )
        ])

        await repo.update_document_status(
            document.id,
            DocumentStatusUpdate(
                status="extracted",
                page_count=1,
                ingested_at=datetime.now(timezone.utc),
                extraction_duration_ms=0,
            ),
        )

    # Flip the case to ingestion_complete so the ledger lane can pick it up.
    finalized = await repo.update_case_status(
        case.id, CaseStatusUpdate(ingestion_complete=True)
    )
    log.info(
        "case finalized — id=%s case_id=%s ingestion_complete=%s",
        finalized.id,
        finalized.case_id,
        finalized.ingestion_complete,
    )
    return case.id


async def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s  %(levelname)-7s  %(name)s  %(message)s",
    )
    if not SAMPLE.exists():
        raise SystemExit(f"sample file not found: {SAMPLE}")
    try:
        case_id = await seed(SAMPLE)
        print(f"\n✓ seeded case: {case_id}")
        print(f"  next: query SELECT * FROM cases WHERE id = '{case_id}';")
    finally:
        await close_pool()


if __name__ == "__main__":
    asyncio.run(main())
