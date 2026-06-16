# Ledger Lane

Owner: **Gowtham**.

This module builds the Evidence Ledger — the typed graph of facts, parties, vehicles, events, etc. — from the extracted text written by the ingestion lane.

## Inputs

When `cases.ingestion_complete = true` flips for a case, this lane is woken up. It reads:

- `documents` and `document_pages` for that case (extracted text + page-level anchors)
- `statutes` (the public legal-text store)

## Outputs

Writes to:

- `nodes` (typed graph nodes — Fact, Party, Vehicle, etc.)
- `edges` (typed relationships — corroborates, contradicts, attributed_to, etc.)

Then flips `cases.ledger_complete = true` to wake the orchestration lane.

## Schema reference

The application-level Pydantic models for `nodes` and `edges` live in `backend/schemas/node.py` and `backend/schemas/edge.py`. Use those for typed reads and writes; the SQL table shapes are in `backend/db/migrations/001_initial.sql`.

## Constraints to preserve

1. **Every Fact node must carry a `verbatim_quote` plus `(source_document_id, source_page_number)`.** The Fact Gate downstream substring-checks that quote against `document_pages.extracted_text` — if the anchor is wrong, the case will not pass.
2. **`node_id` must be unique within a case.** Stick to the `F1, F2, …` and `P1, P2, …` conventions so the orchestration's Citation Gate works unchanged.
3. **Edge types must be from the enumerated set** in the schema. Adding new types means a follow-up SQL migration and a Pydantic literal update.

## Module layout (TBD)

This directory is the placeholder for the extraction agent + graph builder. Suggested layout when implementation lands:

```
backend/ledger/
├── __init__.py
├── builder.py      # Reads documents → produces nodes/edges via LLM extraction
├── prompts.py      # Extraction-agent system prompts
├── repository.py   # Typed Supabase writes (uses backend/schemas/node, edge)
└── README.md       # this file
```
