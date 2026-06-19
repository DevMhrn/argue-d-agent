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

The current v1 upload validation accepts:

- PDF
- DOCX
- HTML
- plain text / Markdown

Images, audio, scanned PDFs, old `.doc`, spreadsheets, and video are roadmap items. Keep `frontend/lib/useCaseUpload.ts`, `/cases/new/page.tsx`, and `backend/ingestion/extractors/registry.py` in sync when supported MIME types change.

## Checks

```bash
pnpm exec tsc --noEmit
pnpm build
```

Run these inside `frontend/`. The current `pnpm lint` script is mutating because it runs `biome check --write --unsafe .`; use it only when you intend to apply formatting fixes. If pnpm v11 blocks a very recent transitive lockfile entry during local verification, rerun the command with `PNPM_CONFIG_MINIMUM_RELEASE_AGE=0` after checking the blocked package/version in the error output. The repo root `pnpm typecheck` covers only the legacy TypeScript demo.

Repo-level Fallow and React Compiler checks are listed in [`../AGENTS.md`](../AGENTS.md#fallow-local-gate).
