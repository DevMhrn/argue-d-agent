# Lumen — Backend

Production Python backend for Lumen. Owns the orchestration pipeline, the ingestion lane, the ledger lane (stub), the database schema, and the FastAPI server that ties them together.

## Layout

```
backend/
├── app/                          # The existing orchestration pipeline (FastAPI + Band SDK)
│   ├── server.py                #   FastAPI app + SSE routes (cases, run, decision, ingest)
│   ├── run_server.py            #   Entry point — python -m backend.app.run_server
│   ├── run_demo.py              #   CLI demo — python -m backend.app.run_demo
│   ├── pipeline.py              #   The structured debate + dual-adjudication + verifier
│   ├── agents.py / prompts.py   #   Agent definitions + system prompts
│   ├── gates.py                 #   Citation, Fact, Math gates (code-enforced)
│   ├── verifier.py              #   Source-Alignment Verifier helper
│   ├── room.py                  #   Band-room wrapper (LocalRoom + BandRoom)
│   ├── providers.py             #   Anthropic / Gemini / OpenAI OpenAI-compatible client + mock switch
│   ├── mock_responses.py        #   Deterministic offline outputs for the demo
│   ├── config.py                #   Models, providers, thresholds
│   ├── types.py                 #   Pipeline-internal Pydantic models (ClaimInput, FinalDecision, ...)
│   ├── ledger.py                #   Evidence-ledger rendering helpers
│   ├── band_config.example.yaml #   Band SDK config template
│   └── probe_band*.py           #   Incremental Band-SDK connection probes
│
├── schemas/                     # Application-level Pydantic models = mirror DB rows
│   ├── case.py
│   ├── document.py
│   ├── document_page.py
│   ├── statute.py
│   ├── node.py
│   ├── edge.py
│   ├── transcript.py
│   └── decision.py
│
├── ingestion/                   # File uploads, text extraction, source-anchored persistence
│   ├── routes.py                #   FastAPI router mounted at /api/ingest
│   ├── service.py               #   Top-level upload-then-extract orchestrator
│   ├── repository.py            #   Typed Supabase queries for ingestion tables
│   ├── storage.py               #   Backblaze B2 wrapper (pre-signed URLs, head, download)
│   ├── queue.py                 #   Async extraction queue (arq + Redis)
│   └── extractors/              #   Per-format text extractors
│       ├── base.py              #     Extractor protocol + ExtractedDocument / ExtractedPage
│       ├── pdf.py               #     pdfplumber (native PDFs only)
│       ├── docx.py              #     python-docx
│       ├── html.py              #     BeautifulSoup
│       ├── text.py              #     plain text
│       └── registry.py          #     MIME-type -> Extractor dispatch
│
├── ledger/                      # Graph builder (Gowtham's lane, stub)
│   └── README.md                #   Lane overview and incoming contracts
│
└── db/                          # SQL schema + seed data
    ├── README.md                #   Schema overview and stage handoff contracts
    └── migrations/
        ├── 001_initial.sql      #     Tables, triggers, indexes
        └── 002_seed_statutes.sql#     Public statute data
```

## Three lanes, three owners

| Lane | Owner | Writes | Reads | Triggered by |
|---|---|---|---|---|
| Ingestion | Aman | `documents`, `document_pages`, `cases.ingestion_complete` | uploaded files | new case POST |
| Ledger | Gowtham | `nodes`, `edges`, `cases.ledger_complete` | `documents`, `document_pages`, `statutes` | `cases.ingestion_complete = true` |
| Orchestration | Sudharsan | `transcript`, `decisions`, `cases.finalized` | `cases`, `nodes`, `edges`, `document_pages`, `statutes` | `cases.ledger_complete = true` |

Each lane writes only its own tables and reads only the upstream ones. The boolean flags on `cases` are the cross-stage handoff.

## Running locally

```bash
pip install -r requirements.txt
python -m backend.app.run_server      # FastAPI server on :3000
python -m backend.app.run_demo        # CLI demo (mock mode by default)
```

Live mode requires `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, and `OPENAI_API_KEY` in `.env` (agents run across all three model families). Real ingestion additionally requires `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `B2_KEY_ID`, `B2_APPLICATION_KEY`, `B2_BUCKET`, and `REDIS_URL`.

## Application schemas vs pipeline types

There are two parallel Pydantic model trees and they describe different things:

- **`backend/schemas/`** — storage layer. One file per table, with `*Row` (read) and `*Create` (write) models. Used by ingestion + ledger repositories and by route handlers.
- **`backend/app/types.py`** — pipeline layer. Describes agent I/O shapes (`Fact`, `EvidenceLedger`, `Decision`, etc.) used inside `pipeline.py`. Validates LLM output before downstream code touches it.

These overlap by design — a `Fact` in the pipeline becomes a `NodeRow` with `type='Fact'` in storage. The conversion is part of the ledger lane's responsibility.

## Why this structure

Three constraints shape the layout:

1. **Each lane owns one concern.** Ingestion is one folder. Ledger is one folder. Orchestration stays in `app/`. No file is owned by two people.
2. **The DB schema is the contract.** `schemas/` mirrors the migrations. Every read or write goes through a typed model, not raw SQL or untyped dicts.
3. **Mock mode must keep working.** `app/` is unchanged from `lumen_py/` — only path references were updated. `python -m backend.app.run_demo` runs offline with zero keys, same as before.
