# Lumen Frontend

Next.js 16 + React 19 + Tailwind v4 console for Lumen recovery operations.

## What it renders

The app has three primary routes:

| Route | Purpose |
|---|---|
| `/` | Cases list. Shows real Supabase cases and deterministic demo cases side by side. |
| `/cases/new` | Chat-style intake. Creates a case shell, accepts evidence files, uploads to object storage, polls extraction status, and finalizes ingestion. |
| `/cases/[id]` | Case detail. Demo IDs open the retained demo debate. Supabase UUIDs open the staged real-case view with documents, detail-page evidence uploads, ledger graph, run history/replay, and locked Argument Room. |

The frontend talks only to the FastAPI API. Browser requests are relative `/api/*` calls; `next.config.ts` rewrites them to the backend during local development.

## Local development

From the repo root, the easiest path is:

```bash
./run.sh dev
```

That starts:

- FastAPI backend on port `8000`
- arq extraction worker
- Next.js dev server on port `3000`

From this folder alone:

```bash
pnpm install
pnpm dev
```

Set `LUMEN_API_BASE_URL` if the backend is not on `http://127.0.0.1:8000`.

## Case flows

### Demo cases

Demo cases come from `data/cases.json`. They are labeled with `source: "demo"` by `/api/cases` and run through `/api/run/{id}`. This path is deterministic mock orchestration and does not need Supabase, B2, Redis, or provider keys.

### Real cases

Real cases come from Supabase and are labeled with `source: "db"`. The staged flow is:

1. Create a case shell with `POST /api/ingest/case`.
2. Sign each upload with `POST /api/ingest/sign-upload`.
3. PUT raw bytes directly to object storage.
4. Commit each upload with `POST /api/ingest/commit`.
5. Poll `GET /api/ingest/status/{case_id}` until extraction is terminal.
6. Finalize ingestion with `POST /api/ingest/finalize/{case_id}` when needed.
7. Wait for the ledger lane to write nodes/edges and set `ledger_complete=true`.
8. Open the Argument Room once the ledger is locked.
9. Stream a courtroom run with `GET /api/run/{case_id}`; real UUID runs persist `runs`, structured `transcript` metadata, and `decisions`.
10. Replay prior terminal runs with `GET /api/runs/{run_id}/transcript`; the detail page fetches run history with `GET /api/cases/{case_id}/runs` on mount.

`frontend/lib/types.ts` mirrors backend Pydantic response shapes by hand. Update it whenever the FastAPI contract changes.

## Supported uploads

The current upload validation mirrors `backend/ingestion/limits.py` and accepts:

- Documents: PDF, DOCX, Excel `.xlsx`, CSV/TSV, HTML, plain text, Markdown
- Images: JPEG, PNG, WebP, GIF
- Audio: MP3, MP4/M4A, WAV, WebM

Caps: documents are 10 MB and 50 files per case; images are 10 MB and 15 files; audio is 50 MB and 10 files. The backend is authoritative. Keep `frontend/lib/fileSupport.ts`, `backend/ingestion/limits.py`, and `backend/ingestion/extractors/registry.py` in sync when formats or caps change.

Model-backed formats need their runtime prerequisites: image extraction uses Anthropic unless mock mode is active, audio transcription uses OpenAI and `ffmpeg` unless mock mode is active, and scanned-PDF OCR needs `ocrmypdf`, Tesseract, and Ghostscript. Old `.doc` and video are not v1 extractors.

## Checks

```bash
pnpm exec tsc --noEmit
pnpm exec biome check .
pnpm build
```

Run these inside `frontend/`. The current `pnpm lint` script is mutating because it runs `biome check --write --unsafe .`; use it only when you intend to apply formatting fixes. Active React handoff checks live in `frontend/AGENTS.md`. Repo-level Fallow is in `../AGENTS.md`.

## Browser smoke

With the dev stack and required `.env` values running, smoke the current real-case flow by creating a case in `/cases/new`, uploading representative PDF and text evidence, waiting for extraction and `ledger_complete`, opening the Argument Room, and refreshing the detail page after a terminal run. Replay should load transcript items plus a persisted decision from run history.
