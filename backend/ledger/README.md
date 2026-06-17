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

## Module layout (implemented, offline-first)

```
backend/ledger/
├── graph.py        # LedgerNode/LedgerEdge/LedgerGraph + validate_graph() + render_graph()
├── builder.py      # build_ledger(claim, statutes) → graph; + graph_to_evidence_ledger()
├── prompts.py      # EXTRACTION_PROMPT for the live extraction agent
├── mock_graphs.py  # deterministic graphs for the sample cases (offline, no keys)
├── repository.py   # Supabase write seam: to_node_creates/to_edge_creates, dry_run(), LedgerRepository
├── build_demo.py   # CLI: build + validate + inspect a graph offline
└── README.md       # this file
```

### Run it offline (no keys, no DB)

```bash
python -m backend.ledger.build_demo          # clean case
python -m backend.ledger.build_demo loser    # loser case
```

Prints the typed graph, runs the Fact-anchor/integrity check (same substring rule as
the downstream Fact Gate), shows the row counts it would persist, and the
`EvidenceLedger` projection the debate lane consumes.

### How it works

- **Offline/mock** (`is_mock()` — no provider keys): `build_ledger` returns a
  hand-verified graph from `mock_graphs.py` whose Fact quotes are exact substrings of
  the sample documents. Runs today with zero infra.
- **Live**: `build_ledger` runs the extraction agent (Featherless) over the document
  text, parses the typed graph, and **prunes any Fact whose verbatim_quote doesn't
  anchor** — so the graph leaving this lane always passes the Fact Gate.
- **Persist**: `LedgerRepository.from_env()` writes to Supabase (nodes first to obtain
  UUIDs, then edges; then `mark_ledger_complete`). `dry_run(graph)` builds the exact
  `NodeCreate`/`EdgeCreate` rows with placeholder UUIDs for inspection without a DB.
- **Handoff**: `graph_to_evidence_ledger(graph)` projects Fact nodes into the
  `EvidenceLedger` shape the orchestration consumes — the seam to run the debate on a
  real graph instead of the mock evidence step.
