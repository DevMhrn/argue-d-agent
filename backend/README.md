# Lumen Backend

Production Python backend for Lumen. Owns the orchestration pipeline, ingestion lane, ledger lane, database schema, and FastAPI server that ties them together.

## Layout

```
backend/
├── app/                          # Orchestration pipeline (FastAPI + Band SDK seam)
│   ├── server.py                #   FastAPI app + SSE routes (cases, run, decision, ingest)
│   ├── run_server.py            #   Entry point: python -m backend.app.run_server
│   ├── run_demo.py              #   CLI demo: python -m backend.app.run_demo
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
├── ledger/                      # Graph builder (Gowtham's lane, offline-first)
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
PORT=8000 python -m backend.app.run_server
LUMEN_MOCK=1 python -m backend.app.run_demo
```

The repo runner expects `backend/.env` and starts the FastAPI server on port `8000` when that file follows `.env.example`:

```bash
./run.sh server
./run.sh worker
./run.sh dev
```

Live model mode requires `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, and `OPENAI_API_KEY` in `.env` or `backend/.env`. Real ingestion additionally requires `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `B2_KEY_ID`, `B2_APPLICATION_KEY`, `B2_BUCKET`, and `REDIS_URL`.

Use a Supabase pooler `DATABASE_URL` for local ingestion if `db.<project-ref>.supabase.co` only resolves to IPv6 on your network. The FastAPI server still starts without a DB connection, but `POST /api/ingest/case` will fail until asyncpg can reach Postgres.

## Upload and extraction test

The full upload path needs the FastAPI server, arq worker, Supabase, Backblaze B2, and Redis. With those running, use the chat intake at `/cases/new` or the smoke probe in `scripts/probe_upload.py`. Set `PROBE_UPLOAD_PATH` to upload a local file instead of the default tiny text fixture.

For PDF-specific testing, use a native text PDF such as the supplied NHTSA South Carolina TR-310 manual. Command-line clients may receive a 403 from that host; if so, save the file through a browser and upload it from the frontend or run `PROBE_UPLOAD_PATH=/path/to/sc_tr310_manual_rev8_2012.pdf python -m scripts.probe_upload`. Native PDFs are handled by `backend/ingestion/extractors/pdf.py`; scanned PDFs require OCR and are out of scope for v1.

## Application schemas vs pipeline types

There are two parallel Pydantic model trees and they describe different things:

- **`backend/schemas/`** - storage layer. One file per table, with `*Row` (read) and `*Create` (write) models. Used by ingestion + ledger repositories and by route handlers.
- **`backend/app/types.py`** - pipeline layer. Describes agent I/O shapes (`Fact`, `EvidenceLedger`, `Decision`, etc.) used inside `pipeline.py`. Validates LLM output before downstream code touches it.

These overlap by design: a `Fact` in the pipeline becomes a `NodeRow` with `type='Fact'` in storage. The conversion is part of the ledger lane's responsibility.

## Why this structure

Three constraints shape the layout:

1. **Each lane owns one concern.** Ingestion is one folder. Ledger is one folder. Orchestration stays in `app/`. No file is owned by two people.
2. **The DB schema is the contract.** `schemas/` mirrors the migrations. Every read or write goes through a typed model, not raw SQL or untyped dicts.
3. **Mock mode must keep working.** `python -m backend.app.run_demo` runs offline with zero keys and is the canonical orchestration smoke test.
