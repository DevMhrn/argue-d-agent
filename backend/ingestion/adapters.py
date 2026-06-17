"""Adapter between the ingestion store and the orchestration pipeline.

The orchestration pipeline (Sudharsan's lane) expects an in-memory `ClaimInput`
shape (defined in backend/app/types.py). Today it reads this from JSON files.
After Supabase, it reads via this adapter: given a case_id, fetch the case
row + documents + document_pages, reconstruct the `ClaimInput`.

Living in the ingestion lane (not orchestration) keeps the orchestration code
ignorant of Supabase. The orchestration just imports this function.
"""
from __future__ import annotations

from uuid import UUID

from backend.app.types import ClaimInput, Document as ClaimDocument

from .repository import IngestionRepository


async def load_case_from_db(
    case_id: UUID,
    repo: IngestionRepository | None = None,
) -> ClaimInput:
    """Read a case from Supabase and reconstruct the orchestration's ClaimInput.

    Each documents row + its document_pages collapse back into one
    ClaimInput.documents entry, with pages concatenated in page-number order.

    Raises LookupError if the case is not found or has no documents.
    """
    repo = repo or IngestionRepository()

    case = await repo.get_case(case_id)
    if case is None:
        raise LookupError(f"Case {case_id} not found")

    docs = await repo.list_documents_for_case(case_id)
    if not docs:
        raise LookupError(f"Case {case_id} has no documents")

    claim_documents: list[ClaimDocument] = []
    for doc in docs:
        pages = await repo.get_pages(doc.id)
        full_text = "\n\n".join(p.extracted_text for p in pages)
        claim_documents.append(
            ClaimDocument(
                name=doc.filename,
                kind=doc.document_kind or "document",
                text=full_text,
            )
        )

    return ClaimInput(
        caseId=case.case_id,
        insured=case.insured_name or "(unknown insured)",
        otherParty=case.other_party_name or "(unknown other party)",
        jurisdiction=case.jurisdiction,
        damagesUsd=float(case.damages_usd) if case.damages_usd is not None else 0.0,
        documents=claim_documents,
    )
