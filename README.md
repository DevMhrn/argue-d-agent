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

The real-case detail page already shows uploaded documents and typed ledger nodes/edges. The Argument Room opens when the ledger lane flips `cases.ledger_complete=true`.

## PDF ingestion smoke test

Use a native text PDF for v1 ingestion testing. The supplied NHTSA South Carolina TR-310 manual is a good stress fixture because it is large and text-extractable:

```text
https://www.nhtsa.gov/sites/nhtsa.gov/files/documents/sc_tr310_manual_rev8_2012.pdf
```

If command-line download is blocked by the host, save it through a browser and upload it from `/cases/new`, or run `PROBE_UPLOAD_PATH=/path/to/sc_tr310_manual_rev8_2012.pdf python -m scripts.probe_upload` while the backend and worker are running. The v1 extractor supports native PDFs, DOCX, HTML, and plain text; scanned PDFs need OCR and are intentionally out of scope.

## Go live (when keys arrive)

```bash
cp .env.example .env      # add ANTHROPIC_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY
LUMEN_MOCK=0 python -m backend.app.run_demo
```

Provider and model defaults live in `backend/app/config.py`. Confirm exact provider catalog IDs before live runs, then override `MODEL_*` values in `.env` if needed. The current Anthropic OpenAI-compatible path is useful for smoke checks, but production JSON reliability should move to native Claude structured outputs before relying on live adjudication.

## How it's built

Each agent runs on one of **three different model families**, so the Advocate-vs-Opposing debate and the dual-adjudicator consensus are genuinely independent, not the same model arguing with itself.

| Agent | Model family | Job |
|---|---|---|
| Intake Parser | OpenAI (GPT) | Extract incident facts |
| Evidence Aggregator | Google (Gemini) | Build the grounded Evidence Ledger |
| Liability Advocate | Anthropic (Claude) | Argue our insured is owed recovery |
| Opposing-Carrier Red Team | OpenAI (GPT) | Attack our case, not negotiate |
| Adjudicator A | Anthropic (Claude) | Neutrally set fault % + recovery |
| Adjudicator B | Google (Gemini) | Independent check on a *different* family |
| Source-Alignment Verifier | Google (Gemini) | Audit every cited claim vs its source |
| Demand Letter Drafter | Anthropic (Claude) | Write the formal letter |

**Anti-hallucination:** one Evidence Ledger is the single source of truth; the **Citation Gate** (`backend/app/gates.py`) is code that rejects any point not citing a real fact/statute id.

**Anti-collusion:** the opponent is a red team with a fixed opposing objective; the debaters draft independently first; the structured rounds have **no consensus round**; and a **neutral Adjudicator, not the debaters, decides** the number from a fault table.

**Band seam:** `backend/app/room.py` selects `LocalRoom` or `BandRoom`. The pipeline posts through that shared interface, so the citation gate and turn protocol stay in one place.

### Layout

```
backend/           Production Python backend (FastAPI, Band SDK, ingestion, ledger lanes)
  app/             Orchestration pipeline (agents, gates, room, server, demo)
  schemas/         Pydantic models mirroring DB tables (cases, documents, nodes, edges, ...)
  ingestion/       File uploads, per-format extractors, B2 storage, async queue
  ledger/          Graph builder (Gowtham's lane)
  db/              SQL migrations + schema overview
frontend/          Next.js 16 + Tailwind v4 (App Router) - recovery-operations console
  app/             page.tsx routes (/, /cases/new, /cases/[id])
  components/      UploadZone, FileRow, GateRail, LedgerPanel, RoomPanel, DecisionPanel
  lib/             api.ts, sha256.ts, useRunStream.ts (typed client + EventSource hook)
  _legacy/         The original static HTML/JS/CSS, kept as a reference
src/               Legacy TypeScript demo (kept for offline `pnpm demo`)
server/            Legacy Express server
data/              Fixtures: sample_claim_clean.json, statutes.json, cases.json
docs/              Long-form documentation
```

The Python entry points:

```bash
python -m backend.app.run_demo      # offline mock demo
python -m backend.app.run_server    # FastAPI server with SSE streaming
```
