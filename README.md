# argue-d-agent - Lumen

**AI Subrogation Recovery Officer** - built for the [Band of Agents Hackathon](https://lablab.ai/ai-hackathons/band-of-agents-hackathon).

Insurance companies leave an estimated **$15-20B/year** uncollected because chasing money owed to them (subrogation) is slow and manual. Lumen is a **team of AI agents** that investigates a claim, **argues both sides** to pressure-test it, and produces a ready-to-send recovery packet - with a hard rule that **no claim is allowed without citing real evidence.**

> Product context, architecture, and project planning docs live in [`docs/`](./docs/README.md).

## Run it now

The agent debate runs in **mock mode** by default - deterministic, offline, zero keys.

**Full dev environment (backend + worker + frontend in one terminal):**

```bash
./run.sh setup        # first time only - builds the Python venv
./run.sh dev          # FastAPI :8000 + arq worker + Next.js :3000
```

Open the frontend on port `3000`. The Next.js dev server proxies `/api/*` to the FastAPI backend on port `8000`, so the browser sees same-origin requests.

**Just the agent debate** (no ingestion, no frontend):

```bash
pnpm install
LUMEN_MOCK=1 pnpm demo                         # legacy Node demo, CLI only
LUMEN_MOCK=1 .venv/bin/python -m backend.app.run_demo
```

You will see the room transcript: facts get extracted, the Advocate and the Opposing red team disagree, the Citation Gate rejects unsupported claims, neutral adjudicators set fault and recovery, and uncertain or high-value outcomes escalate to a human.

## Current app flow

The home page renders two sources:

- **Demo cases** from `data/cases.json` (`clean`, `loser`). These run the deterministic mock debate through `/api/run/{id}`.
- **Real cases** from Supabase. These are created through `/cases/new`, upload evidence through `/api/ingest/*`, and show the staged flow: ingestion, ledger build, locked Argument Room, decision.

The current flow details live in [`docs/architecture.md`](./docs/architecture.md), [`backend/README.md`](./backend/README.md), and [`frontend/README.md`](./frontend/README.md).

## PDF ingestion smoke test

Use a native text PDF for v1 ingestion testing. The supplied NHTSA South Carolina TR-310 manual is a good stress fixture because it is large and text-extractable:

```text
https://www.nhtsa.gov/sites/nhtsa.gov/files/documents/sc_tr310_manual_rev8_2012.pdf
```

If command-line download is blocked by the host, save it through a browser and upload it from `/cases/new`, or run `PROBE_UPLOAD_PATH=/path/to/sc_tr310_manual_rev8_2012.pdf python -m scripts.probe_upload` while the backend and worker are running. The v1 extractor supports native PDFs, DOCX, HTML, and plain text; scanned PDFs need OCR and are intentionally out of scope.

## Live model demo

```bash
cp .env.example .env      # add ANTHROPIC_API_KEY and OPENAI_API_KEY
LUMEN_MOCK=0 python -m backend.app.run_demo
```

Provider defaults live in `backend/app/config.py`; confirm provider catalog IDs before live runs. Full real-case ingestion also needs Supabase, B2, and Redis settings; see [`backend/README.md`](./backend/README.md).

## Where details live

| Need | Doc |
|---|---|
| Product story and safety rules | [`docs/product-context.md`](./docs/product-context.md) |
| Current architecture, gates, flow | [`docs/architecture.md`](./docs/architecture.md) |
| Backend layout and commands | [`backend/README.md`](./backend/README.md) |
| Frontend routes and upload flow | [`frontend/README.md`](./frontend/README.md) |
| Database schema | [`backend/db/README.md`](./backend/db/README.md) |
