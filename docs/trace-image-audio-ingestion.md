# Lumen — Session Trace (Persistence, Ingestion Extractors, Real-Case Flow)

> **Last compiled**: 2026-06-19, hackathon deadline day.
>
> This file is the raw, un-summarized record of every decision, rejected idea,
> bug, workaround, hypothesis, and reasoning step that went into the session
> that built (a) the orchestration-debate persistence layer, (b) the ingestion
> ↔ ledger auto-handoff, (c) the new file-format extractors (Excel, audio,
> image, scanned-PDF OCR, markdown), (d) the structured EVENTS extraction
> pattern that bridges non-text sources to the Fact Gate, and (e) all the UI
> work to make a real DB-backed case argueable end to end.
>
> **Read this if you're picking up where I left off and want to recover the
> reasoning, not just the verdicts.** The verdicts are in
> [`CONTEXT.md`](./CONTEXT.md). This file is the *why*, including the roads we
> rejected and exactly why. If something in code disagrees with this doc, the
> code is canonical for *behavior*; this doc is canonical for *reasoning*.

---

## 0. How to read this doc

Organized roughly chronologically by conversation phase, but cross-linked by
topic. If you want a specific topic, jump to:

- §1 Where we started this session
- §2 The frontend rebuild (static → Next.js 16, two-phase upload)
- §3 The B2 storage saga (POST policy → PUT URL → CORS)
- §4 The Argument Room persistence problem (the user's "open court room"
  insight) and the full run-lifecycle solution
- §5 The ingestion → ledger auto-handoff (Gowtham's work + the stale-worker
  bug)
- §6 Real-case flow: load_case_from_db + load_run_inputs + cases-list
  unification
- §7 The new extractors (markdown, Excel, audio, image, scanned PDF)
- §8 The EVENTS extraction pattern (vision and audio)
- §9 Whisper model decision (whisper-1 vs gpt-4o-transcribe)
- §10 UI polish (scrollable panels, balanced columns)
- §11 The honest end-to-end audit (what's verified vs not)
- §12 Hard rules / non-negotiables (preserved from prior sessions)
- §13 Conversation arc — chronological
- §14 Rejected ideas with reasoning
- §15 For the next person picking this up

The user repeatedly emphasized two things across this session that I want to
preserve at the top:

1. **Plain prose in chat; markdown only in `.md` files.** Don't dress
   conversational answers in heavy formatting.
2. **Be brutally honest. Step back before architectural changes. Reason
   carefully. Don't just react.**

Both rules are load-bearing. The third — preserved from prior sessions —
is **never break the harness**: every Fact the agents cite later must
contain a `verbatim_quote` that's a contiguous substring of some page's
deterministically-extracted text. Every architectural decision in this
session was filtered through that rule.

---

## 1. Where we started this session

State of the world at session start:

- Three-lane architecture working in mock mode: ingestion (Aman), ledger
  (Gowtham), orchestration (Sudharsan).
- Production Python backend at `backend/` with FastAPI + arq worker +
  asyncpg + Supabase Postgres + Backblaze B2 + Upstash Redis. All
  credentials in `backend/.env`.
- Original four-format extraction working: PDF (pdfplumber), DOCX
  (python-docx), HTML (BeautifulSoup), plain text.
- 6-gate harness (Citation / Fact / Math / Consensus / Source-Alignment /
  Letter Reconciliation) firing inside the 8-agent debate.
- Three model families wired: Anthropic (Claude), Google (Gemini), OpenAI
  (GPT). All via OpenAI-compatible chat endpoints.
- Mock-first as the default — `LUMEN_MOCK=1` (or empty LLM keys) gives
  deterministic offline output. The whole demo runs without API spend.
- A *static* frontend (`frontend/index.html` + `app.js` + `styles.css`)
  that served the existing `clean` / `loser` demo cases but had no
  upload UI for real cases.

Known critical paths NOT yet working at session start:

- Real cases uploaded via the new ingestion lane couldn't actually be
  *debated* — `/api/run/{id}` only handled the demo JSON cases.
- Debates never persisted — `transcript`, `runs`, `decisions` tables
  existed in the schema but no code ever wrote to them.
- The Bus Tragedy case (a real 123-page PDF uploaded earlier) was stuck
  at `ingestion_complete=true, ledger_complete=false` because the
  ingestion → ledger handoff trigger hadn't yet been wired when it
  uploaded.
- The dev environment used `PORT=3000` for FastAPI, which collides with
  Next.js's default.

Where we got to by end of session:

- Modern Next.js 16 frontend with chat-style intake, three-panel case
  detail, replay-on-mount, run history strip.
- Real-case-aware `/api/run/{case_uuid}` with full run lifecycle
  (insert runs row → persist each posting → insert decision → mark
  complete) including `asyncio.CancelledError` handling so client
  disconnects don't leave zombie runs.
- Stale-run self-healing sweep that marks `running` runs older than 3
  minutes as `failed` on the next read.
- Five new extractors landed in registry: markdown (route to text),
  Excel (python-calamine), audio (Whisper + Claude events), image
  (Claude vision three-block), scanned PDF (ocrmypdf fallback).
- Cross-format EVENTS extraction pattern — every non-text source now
  produces structured `[type]` event bullets alongside the raw text.
- Two comprehensive docs landed: `docs/ingestion-flow.md` (Mermaid
  diagrams, end-to-end) and `docs/extractor-deep-dive.md` (ASCII
  diagrams, per-format byte-by-byte).
- DB host fixed back to Supavisor pooler (legacy `db.<ref>.supabase.co`
  retired by Supabase for new projects).
- Backblaze CORS set for `localhost:3000` so browser-direct PUT actually
  works.

---

## 2. The frontend rebuild

### 2.1 Why we rebuilt at all

The user opened the session asking how to run the dev environment. I
walked them through `./run.sh dev` etc. The next exchange was the
realization that the static `frontend/*.html` had no upload UI for real
cases — the `/api/ingest/*` endpoints were wired backend-side, nothing on
the client hit them. So the user said:

> "build the first draft rather then statics files and all, think in the
> whole picture how we wanted it to be done here"

The decision: real modern frontend. No half-measures.

### 2.2 Stack decision — Vite vs Next.js

I presented two options:

- **Vite + React + TypeScript + Tailwind** — lightest, fastest scaffold,
  SPA, deploys as a static bundle, EventSource (SSE) trivial. ~1 day to
  first draft.
- **Next.js 15 App Router + TS + Tailwind** — heavier setup, more
  ceremony, matches Recourse's polish ceiling (Recourse is the closest
  competitor in the hackathon). Vercel deploy native.

I recommended Vite for time. User chose **Next.js**.

In hindsight Next.js was the right call:
- The user wanted the demo to look as polished as Recourse, the closest
  competitor.
- Vercel deploy is a known quantity.
- We didn't actually need SSR — but the App Router gave us clean route
  organization (`/`, `/cases/new`, `/cases/[id]`).
- A subtle benefit: Next 16 turned out to ship with breaking changes
  vs my training data. Reading
  `frontend/node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/rewrites.md`
  was essential before writing the dev-proxy rewrite.

### 2.3 What got built

Routes:

- `/` — cases list page (server component). Shows two sections: "Your
  cases" (Supabase rows) and "Demo cases" (legacy from `data/cases.json`).
  Hits `/api/cases` which returns both.
- `/cases/new` — chat-style intake. Lumen "greets" the user with a
  metadata-form-inside-a-bubble; user fills it, clicks Create case; then
  drag-drop files into the conversation. Each file appears as an
  attachment chip in a user message and walks through Hashing → Signing
  → Uploading (with progress bar) → Committing → Extracting →
  Extracted ✓ stages, with Lumen replying in real time.
- `/cases/[id]` — case detail. Branches on `data.source`:
  - `"demo"` → legacy three-panel mock orchestration.
  - `"db"` → new staged Argument Room layout: header + case meta +
    `StageStepper` (Ingested → Ledger built → Room ready → Decision),
    then two-column body (left: `DocumentsPanel` + `LedgerGraphPanel`;
    right: `ArgumentRoom`), then `DecisionPanel`, then `RunHistoryStrip`.

Components (in `frontend/components/`):

- `UploadZone` — drag-drop + click-to-pick, with `accept` attribute
  filtering. Doesn't catch drag-drop bypass — that's the parent's job
  via `useCaseUpload` hook.
- `FileRow` — per-file status card with badge + progress bar +
  error display. Refactored heavily by Sudharsan into smaller named
  functions (FileInfo / FileActions / RemoveButton / ProgressBar /
  FileError).
- `CaseStatusBadge` — maps `(ingestion_complete, ledger_complete,
  finalized, metadata.outcome)` to one of 5 visual stages
  (Ingesting / Ledger / Ready / Finalized / Declined).
- `StageStepper` — top-of-page progress strip with 4 steps.
- `GateRail` — 6 gates lighting up green as the debate runs.
- `LedgerPanel` — legacy panel used by demo cases.
- `LedgerGraphPanel` — DB-case panel showing typed nodes + edges +
  verbatim quotes. Scrollable internally (added later).
- `DocumentsPanel` — combined doc-list + drop-zone (added later for
  "add more evidence to existing case" flow).
- `ArgumentRoom` — replaces RoomPanel for DB cases. Locked / Ready /
  In-session / Adjourned states. Uses `RoomTranscript` for postings.
- `RoomPanel` — legacy demo-case room.
- `RoomTranscript` — shared posting list with `tone="argument" | "room"`.
  Extracted later for code reuse.
- `DecisionPanel` — recovery $, fault %, consensus badge, escalation,
  Approve/Reject, demand letter, audit hash. Refactored later into
  many small named components.
- `ChatComposer` — pinned bottom composer (📎 attach + textarea + send).
- `ChatMessage` — bubble with avatar, role label, inline form, attachments,
  action button, pending dots.

Libs (`frontend/lib/`):

- `api.ts` — typed fetch wrappers for every backend endpoint.
- `sha256.ts` — `crypto.subtle.digest("SHA-256")` browser-side.
- `types.ts` — full type surface: `LegacyCase`, `LegacyClaim`,
  `DbCase`, `DbCaseResponse`, `DemoCaseResponse`, `CaseDetailResponse`,
  `RunRow`, `RunStatus`, `RunMode`, `DecisionSummary`,
  `RunHistoryEntry`, `PersistedPosting`, `RunReplay`, `NodeRow`,
  `EdgeRow`, `RoomKind`, `RoomPosting`, `DecisionResult`.
- `useRunStream.ts` — reducer-driven SSE wrapper for `/api/run/:id`.
  Adds: `seed()` action (for replay on mount), `decisionFromPersisted()`
  helper (snake_case → camelCase converter).
- `fileSupport.ts` — MIME helpers, `partitionSupportedFiles`,
  `queueFiles`, `mimeOf` (extension → MIME mapping). Extracted by
  Sudharsan from useCaseUpload.
- `useCaseUpload.ts` — shared per-file upload pipeline hook. Used by
  both `/cases/new` and the DocumentsPanel "add evidence" flow.

### 2.4 Port collision and the dev proxy

Next.js dev defaults to `:3000`. FastAPI was on `:3000` too. We moved
FastAPI to `:8000` and added a Next.js rewrite in `next.config.ts`:

```typescript
async rewrites() {
  return [
    {
      source: "/api/:path*",
      destination: `${API_BASE}/api/:path*`,
    },
  ];
}
```

`LUMEN_API_BASE_URL` env var lets prod point at a deployed backend.

Subtle bug found later: the rewrite only applies to **browser** requests.
Server components (Next.js running in Node) calling `fetch("/api/...")`
have no origin to resolve against and the fetch silently fails. Fix:
`apiUrl()` helper in `lib/api.ts` that uses `LUMEN_API_BASE_URL` server-side
and relative paths client-side:

```typescript
function apiUrl(path: string): string {
  if (typeof globalThis.window !== "undefined") return path;
  return `${process.env.LUMEN_API_BASE_URL ?? "http://127.0.0.1:8000"}${path}`;
}
```

That fixed the "Backend offline" banner the user kept seeing on the home
page after refresh.

### 2.5 Layout / scroll polish (in chronological order of fixes)

The user iterated several times on the case-detail layout:

1. **First report**: Argument Room not scrollable; transcript stacks
   off-screen. Added `max-h-[calc(100vh-18rem)]` to bound the room.
2. **Second report**: room doesn't extend to the ledger's bottom
   (visually unbalanced). Removed the cap, added just `h-full`. Now the
   room grew with content but lost internal scroll.
3. **Third report**: room scrolling is broken. Re-added `max-h-[85vh]`.
   Worked, but caused imbalance with the left column again.
4. **Fourth report** (the user-flagged screenshot): "they are not
   balanced". The cause: left column wrapper had no height instruction,
   so it hugged its children, leaving dead space when the room dominated
   the grid row.

The final fix that stuck — **both columns get the same bounds**:

```jsx
// page.tsx — DbCaseBody
<div className="flex h-full min-h-0 max-h-[85vh] flex-col gap-4 overflow-hidden">
  <DocumentsPanel … />
  <LedgerGraphPanel … />   // changed to flex-1 min-h-[280px]
</div>
<ArgumentRoom … />          // h-full min-h-[480px] max-h-[85vh] overflow-hidden
```

`h-full` claims the grid cell; `max-h-[85vh]` is the matching ceiling;
`min-h-0` lets flex children be capped properly; `flex-1` on the Ledger
panel lets it claim leftover column space after Documents. Now both
columns end at the same y-coordinate, both scroll internally.

The general rule that came out of this: **`overflow-auto` only works if
the parent has a bounded height**. `h-full` alone doesn't bound — it
inherits from the grid cell, which is the natural size of the tallest
child. To get internal scroll you need an explicit `max-h-*` somewhere
upstream.

### 2.6 The Type drift fix

`RoomKind` in `frontend/lib/types.ts` was `agent | gate | system | decision
| letter | verdict` — which never matched what the server actually sent.
The backend's `PostingKind` is `message | handoff | gate | decision |
system`. Two formats had been drifting for sessions. Aligned the frontend
to the backend's set during the persistence work because the seed action
needed type compatibility.

---

## 3. The B2 storage saga

The probe upload was supposed to be a smoke test. It turned into three
sequential bug hunts. Worth recording because each is a real production
gotcha.

### 3.1 Bug 1: POST policy returns 501

First probe run output:

```
[3] POST multipart/form-data → B2 (browser-direct upload)
  ✗ B2 rejected: HTTP 501
     body: <Error><Code>NotImplemented</Code></Error>
```

The original signed-URL code used `boto3.generate_presigned_post(...)` — a
POST policy that lets the browser upload via multipart/form-data with
size + content-type conditions embedded in the signed policy. This is
the AWS S3 idiom. Backblaze B2's S3-compatible API **does NOT implement
POST policies** — only `PUT` pre-signed URLs.

Fix: switched to `generate_presigned_url("put_object", ...)` with
`HttpMethod="PUT"`. The browser now sends a single PUT with the bytes as
the body and `Content-Type` as a header. Universally supported across
S3-compatible stores (B2, AWS, R2, MinIO).

Trade-off: PUT URLs can't carry policy conditions (no
`content-length-range`). We enforce the 50 MB cap at the
`PrepareUploadRequest` validation layer instead — before we even sign
the URL.

### 3.2 Bug 2: Bucket doesn't exist

Next probe run:

```
[3] PUT bytes → B2 (browser-direct upload)
  ✗ B2 rejected: HTTP 404
     body: <Error><Code>NoSuchBucket</Code>
            <Message>The specified bucket does not exist: lumen-case-files</Message></Error>
```

The `B2_BUCKET=lumen-case-files` env var pointed at a bucket that hadn't
been created in the B2 console.

Fix: `boto3.create_bucket(Bucket=bucket)` programmatically. The
application key had write+create permissions so this worked. Wrote
`scripts/setup_b2_bucket.py` as an idempotent one-shot for future
deployments — creates bucket if missing AND sets CORS.

### 3.3 Bug 3: CORS not configured

This one only surfaced when the user tried uploading a PDF *from the
browser*. The probe (Python httpx) didn't hit it because it's
server-to-server (no CORS preflight). But browser PUT to a
different-origin host (`s3.us-east-005.backblazeb2.com` ≠
`localhost:3000`) triggers a CORS preflight, which B2 was rejecting
because no CORS rules were configured on the bucket.

The user saw: "Network error during upload" and a failed file chip — no
specific reason in the UI because XHR's `onerror` doesn't expose CORS
detail.

Fix: applied CORS rules via boto3:

```python
{
  "AllowedOrigins": ["http://localhost:3000", "http://127.0.0.1:3000"],
  "AllowedMethods": ["PUT", "GET", "HEAD"],
  "AllowedHeaders": ["*"],
  "ExposeHeaders": ["ETag"],
  "MaxAgeSeconds": 3600,
}
```

Baked into `scripts/setup_b2_bucket.py` so anyone deploying Lumen runs
the script once and the upload pipeline just works.

### 3.4 Why these bugs were inevitable

S3-compatible APIs are not fully S3. Every vendor has gaps. The right
sequence to debug is: server-side smoke test (Python script) → identify
auth/method/bucket bugs without browser noise; then browser smoke test
→ identify CORS / network bugs.

The probe-then-CORS sequence is now codified in `scripts/probe_upload.py`
+ `scripts/setup_b2_bucket.py`. Future deployments don't replay this.

### 3.5 The verified end-to-end probe output

After all three fixes:

```
[1] POST /api/ingest/case             ✓ case.id = d001ca1b-…
[2] POST /api/ingest/sign-upload      ✓ document.id = 8d6cbda9-…
[3] PUT bytes → B2                    ✓ HTTP 200, etag = "be941782…"
[4] POST /api/ingest/commit           ✓ status = uploaded
[5] Poll status                       ✓ extracted in 3661 ms
[6] SELECT FROM document_pages        ✓ page 1: char_count=267
══════ ALL GREEN — bytes in B2, rows in Supabase, worker extracted ══════
```

This is the load-bearing proof. Everything downstream builds on this.

---

## 4. The Argument Room persistence problem

### 4.1 The user's "open court room" insight

Verbatim from the user message:

> "in the Argument Room when ever the aggents are arguing something the
> it is not persistant, like see the arguments are meant to done by the
> agent like in open court room as the person say infrom of everyone,
> all the person presnet in that court room are sound with what is
> happening, and know what the person is say, now as now another person
> has to say something , it will say something basis on the, what the
> other agent have said, now the agent have to decide and all but all
> these things are not persistance, like the aguments are not present in
> the db as an logs, so i am thiking of adding the jsonl, in the case
> table"

Translating: agents need to "hear" each other (in-memory works), but the
transcript isn't persisted to the DB. Two-part insight:

1. **Agents-hearing-each-other**: already implemented in-process via the
   orchestrator hand-assembling `transcript = "Advocate opening: …\n\nOpposing
   attacks: …"` strings and feeding them to each subsequent agent.
   Verified by reading `pipeline.py:260-275`.
2. **Persistence to the DB**: completely missing. `Room.post()` only
   appended to `self.postings: list[Posting]` (in-memory) and fired the
   SSE callback. No DB write. On refresh, gone.

User's proposed fix: add a JSONL column to the `cases` table.

### 4.2 Why JSONL-on-cases was wrong, and what we picked instead

I pushed back on JSONL after thinking through it. The reasoning chain:

**Pros of JSONL on cases**:
- One fetch returns everything
- No JOIN
- Easy mental model

**Cons (the deciders)**:
- **Hot-row writes**: every `room.post()` → `UPDATE cases SET metadata =
  metadata || $1::jsonb`. Postgres rewrites the TOASTed JSONB on every
  mutation. 40 postings × O(transcript_size) per write = O(n²) total
  work. Compared to one INSERT per posting on a separate table, which
  is O(1) per write.
- **Multi-run support breaks**: re-running a case overwrites the JSONL
  or nests by run_id, at which point you've reinvented the transcript
  table inside JSONB anyway.
- **Concurrent runs corrupt each other**.
- **No indexing** on individual postings.
- **Schema evolution pain**: adding a `band_message_id` field later
  requires rewriting every existing JSONL blob.
- **The transcript table already existed**, with `(run_id, seq)` uniqueness
  + index on `(case_id, run_id, seq)` — designed for exactly this purpose.
  Re-implementing it in JSONB would have been pure churn.
- **Audit story**: a separate append-only table with `created_at`
  timestamps and FK chain reads as "system of record". JSONL on a
  mutating case row reads as "we couldn't be bothered to model this
  properly."

The user's concern was: "if we make a different table, we will have to
explicitly tell the agent regarding this cases". I defused that:
**agents are passive — they never query a table.** They receive a prompt
string. Whether the orchestrator builds that string from
`room.postings`, `cases.metadata['transcript']`, or
`SELECT * FROM transcript WHERE run_id=$1`, the agent's prompt is
identical. Storage layout is a backend choice, invisible to agents.

User chose: **wire the existing transcript + runs tables**. Locked in.

### 4.3 Three coordinated changes shipped

**1. `backend/app/run_repository.py`** — new file, 245 lines. Class
`RunRepository` with asyncpg-based methods:

- `insert_run(payload: RunCreate) → RunRow` — at run start
- `update_run(run_id, payload: RunUpdate) → RunRow` — generic partial update
- `complete_run(run_id, status, started_at, error_message?)` — convenience
  wrapper computing `ended_at` and `duration_ms` from `started_at`
- `insert_posting(payload: TranscriptCreate) → TranscriptRow` — one per
  `room.post()`
- `insert_decision(payload: DecisionCreate) → DecisionRow` — one per run
- `get_run`, `list_runs_for_case`, `list_transcript_for_run`,
  `get_decision_for_run` — read methods

Uses the shared `backend.ingestion.db.get_pool()` — same asyncpg pool the
ingestion + ledger lanes use. One DATABASE_URL, one pool per process.

Row mappers handle JSONB defensively (asyncpg returns JSONB as str by
default unless a codec is registered).

**2. `backend/app/room.py`** — Room.post() gains an optional async
`persist` callback (`PostingSink`):

```python
async def post(self, agent, color, kind, content):
    self._seq += 1
    p = Posting(self._seq, agent, color, kind, content)
    self.postings.append(p)
    if self._persist is not None:
        await self._persist(p)             # write to DB FIRST
    if self._on_post:
        self._on_post(p)                    # then fire SSE callback
    await self._deliver(p)                  # then BandRoom send if enabled
    return p
```

Ordering matters: DB write before SSE means a frontend reloading the
page reads exactly the same sequence the live SSE saw. Consistency.

LocalRoom and BandRoom both inherit support. `make_room()` accepts an
optional persist arg.

**3. `backend/app/server.py:api_run`** — full run lifecycle on the UUID path:

```python
# Branch on case_id shape — demo IDs are strings like "clean", real cases are UUIDs.
if _is_uuid(case_id):
    case = await ingest_repo.get_case(case_uuid)
    if not case.ledger_complete:
        return 409 "ledger not ready"
    claim, statutes, ledger = await load_run_inputs(case_uuid)

    run_row = await run_repo.insert_run(RunCreate(case_id=case_uuid,
                                                  mode="mock" if is_mock() else "live"))
    run_id = run_row.id

    persist = async def(p): await run_repo.insert_posting(TranscriptCreate(...))
    room = make_room(claim.caseId, on_post, persist=persist)

# drive() does the SSE work + lifecycle bookkeeping
async def drive():
    started_at = now()
    try:
        result = await run_lumen(claim, statutes, room, ledger=ledger)
        audit = sha256(postings + decision + letter)
        if run_repo:
            await _persist_decision(run_repo, case_uuid, run_id, result, audit)
            await run_repo.complete_run(run_id,
                                         status="escalated" if result.decision.escalate else "completed",
                                         started_at=started_at)
        await queue.put(("result", {...}))
    except asyncio.CancelledError:
        # Client disconnect — see §4.4
        if run_repo and run_id:
            try:
                await asyncio.shield(run_repo.complete_run(
                    run_id, status="failed", started_at=started_at,
                    error_message="cancelled (client disconnected)"))
            except: pass
        raise
    except Exception as e:
        if run_repo and run_id:
            await run_repo.complete_run(run_id, status="failed", started_at=started_at,
                                         error_message=str(e))
        await queue.put(("error", {"message": str(e)}))
    finally:
        await queue.put(None)
```

`_persist_decision()` is a helper that maps the in-memory FinalDecision
(camelCase + Pydantic models) to the snake_case `DecisionCreate` schema
the table expects. Includes `fault_table` → JSONB, `secondary_decision`
→ optional JSONB.

### 4.4 The stuck-run bug (asyncio.CancelledError discovery)

After the persistence layer shipped, the user reported a case stuck at
`status='running'` for 10+ minutes in the UI. Investigation:

- DB inspection showed case `571b4969-…` had ONE run `b1faa5ac` started
  10 minutes ago, status `running`, 15 transcript rows persisted but 0
  decision rows.
- No error_message. No exception caught.
- The user "no logs" — meaning the server didn't log anything weird.

Root cause: **`asyncio.CancelledError` inherits `BaseException`, not
`Exception`, since Python 3.8.** My `except Exception as e` block in
`drive()` doesn't catch it. When the user closes the browser tab:

1. FastAPI's `StreamingResponse` cancels the SSE generator
2. The generator's finally block runs `task.cancel()` on `drive()`
3. `CancelledError` raised at the next `await` point inside `drive()`
4. The `except Exception` clause doesn't match — silently skipped
5. `finally` block runs (puts `None` on queue) but the run row stays at
   `status='running'` forever

Fix: explicit `except asyncio.CancelledError` branch that finalizes the
run before re-raising. Wrapped the cleanup in `asyncio.shield(...)`
because awaiting another coroutine while the task is being torn down
would also get cancelled — shield prevents propagation of the outer
cancellation to the inner cleanup coroutine.

```python
except asyncio.CancelledError:
    if run_repo and run_id:
        try:
            await asyncio.shield(run_repo.complete_run(
                run_id, status="failed", started_at=started_at,
                error_message="cancelled (client disconnected)"))
        except Exception:
            pass
    raise
```

### 4.5 The self-healing sweep

Even with the CancelledError handler, a process kill (Ctrl-C, OOM,
deploy) leaves no chance to run cleanup. So I added a defensive sweep to
`RunRepository.list_runs_for_case`:

```sql
UPDATE runs
   SET status = 'failed', ended_at = now(),
       error_message = coalesce(error_message,
                                'stale (no heartbeat for > ' || $2::text || 's)')
 WHERE case_id = $1
   AND status = 'running'
   AND started_at < now() - make_interval(secs => $2)
```

Default `stale_after_seconds=180`. Any `running` row older than 3 minutes
gets auto-marked failed on the next read. Self-healing without polling.

### 4.6 Read endpoints

Two new GETs:

- `GET /api/cases/{case_uuid}/runs` — newest-first list with
  `{run, decision_summary}` per entry. The decision_summary surfaces
  fault %, recovery $, confidence, consensus, audit_hash without
  forcing a JOIN.
- `GET /api/runs/{run_id}/transcript` — `{run, postings, decision}` —
  full replay payload. Used by the frontend on mount to seed the
  Argument Room.

### 4.7 Frontend replay

`useRunStream` gains a `seed()` action:

```typescript
seed({ caseId, postings, decision, letter?, status? }) → void
```

`decisionFromPersisted(raw)` is a snake_case → camelCase mapper that
converts a `DecisionRow` JSON blob (from the API) to a `DecisionResult`
the panels consume.

On `/cases/[id]` mount for DB cases:

```typescript
const { runs } = await listRunsForCase(case.id);
setRunHistory(runs);
const latest = runs[0]?.run;
if (latest && latest.status !== "running") {
    const replay = await getRunReplay(latest.id);
    seed({
        caseId: case.case_id,
        postings: replay.postings.map(toRoomPosting),
        decision: decisionFromPersisted(replay.decision),
        status: "complete",
    });
}
```

Page refresh now reanimates the prior debate without re-running the
agents. Implementation guard: skip seeding for `status='running'` runs
to avoid colliding with a fresh SSE the user might trigger.

`RunHistoryStrip` component shows past runs at the bottom of the case
detail page — mode, status, duration, decision summary per row.

---

## 5. The ingestion → ledger handoff (Gowtham's work + the stale-worker bug)

While I was working on persistence, Gowtham landed three commits:
`e714102` (asyncpg ledger persistence), `b9aacf3` (ingestion-side trigger),
`5b1b671` (docs).

### 5.1 What Gowtham shipped

**`backend/ledger/jobs.py`** — `run_ledger_build(ctx, case_id_str)` arq
job. Calls `build_and_persist_ledger`.

**`backend/ledger/service.py`** — `build_and_persist_ledger(case_id)`:

1. `_load_claim()` — reads case + documents + pages from Supabase,
   reconstructs a `ClaimInput`
2. `_load_statutes()` — by jurisdiction with fallback
3. `build_ledger(claim, statutes)` — mock graph in `is_mock()` mode,
   Gemini extraction in live mode
4. In live mode, `validate_graph()` against `docmap` (anchors verbatim
   quotes); in mock mode the check is skipped because fixtures aren't
   anchored to uploaded docs
5. `LedgerWriteRepository.write_graph(case_id, graph)` — asyncpg
   two-phase write in one transaction
6. `mark_ledger_complete(case_id)` — race-safe UPDATE

Also exposes `load_run_inputs(case_id)` — what `api_run` calls to
reconstruct claim + statutes + ledger from the persisted graph for a
real DB case run.

**`backend/ledger/db_repository.py`** — `LedgerWriteRepository`:

- `document_ids(case_id) → {filename: uuid}` — for the Fact node's
  `source_document_id` resolution
- `_resolve_sources(graph, doc_ids)` — startswith match because the
  extraction prompt may append " (page 1 · police_report)" to filenames
- `write_graph(case_id, graph)` — two-phase write in **one transaction**:
  delete prior nodes/edges (idempotent replace), insert nodes capturing
  generated UUIDs by display node_id, then insert edges with
  `from_id`/`to_id` resolved to those UUIDs
- `mark_ledger_complete(case_id)` — WHERE-guarded UPDATE pattern

**`backend/ingestion/queue.py`** — `ExtractionQueue.enqueue_build_ledger`
method, enqueues by name (`"run_ledger_build"`); arq routes by function
name so the ingestion lane **never imports ledger code**. Lane boundary
preserved.

**`backend/ingestion/service.py`** — *the* critical change:

```python
# Before
await self._repo.maybe_finalize_ingestion(doc.case_id)

# After
if await self._repo.maybe_finalize_ingestion(doc.case_id):
    await self._queue.enqueue_build_ledger(doc.case_id)
```

`maybe_finalize_ingestion` returns `True` only for the **single worker**
whose WHERE-guarded UPDATE actually flipped the `ingestion_complete`
flag. Other workers (if there's a race) see it already flipped and
return False. Exactly one `run_ledger_build` job per case completion.

**`backend/ingestion/worker.py`** — registers `run_ledger_build`
alongside `extract_document`. The worker is now the composition root for
both lanes — the only place that imports from both.

### 5.2 The stale-worker bug

End-to-end verification failed at first: a fresh probe upload completed
extraction, the ingestion service correctly enqueued
`run_ledger_build`, but **no log line ever appeared** for the ledger job
firing. The DB stayed at `ledger_complete=false`.

Forensic trail:

1. Verified the wiring is in service.py (`grep` showed the
   enqueue_build_ledger call is there).
2. Verified the worker registers both functions
   (`Starting worker for 2 functions: extract_document,
   run_ledger_build`).
3. Verified the job WAS enqueued — manually enqueued one for the failed
   probe case, watched it return `job_id=4cca…`.
4. Inspected Redis directly via `arq:result:*` keys with pickled
   payloads. Found the error:

   ```
   arq.worker.JobExecutionFailed: function 'run_ledger_build' not found
   ```

5. **A stale arq worker** from an earlier conversation, started before
   `run_ledger_build` was registered, was greedily consuming the jobs
   and failing them.

```
ps aux | grep "arq backend"
devmhrn  50221  ...  9:35PM  /opt/homebrew/Cellar/.../python -m arq backend.ingestion.worker.WorkerSettings
```

Killed it. Re-ran the probe. Got:

```
22:13:27   extract_document done             7.0s
22:13:27   run_ledger_build start            (AUTO-TRIGGERED)
22:13:29   ledger build done (mock fixture)   2.4s — 20 nodes, 20 edges
22:13:30   wait...
22:14:46   ledger persisted: 20 nodes, 20 edges, flipped=True   ~76s (40+ round-trips to Supabase ap-northeast-2)
```

End-to-end ALL GREEN.

### 5.3 The performance issue

The ledger writes are slow: 20 nodes + 20 edges takes 19 seconds because
`LedgerWriteRepository.write_graph` does one `INSERT … RETURNING id` per
node (so we can capture the generated UUID for edge wiring) plus one per
edge. ~40 round-trips at ~400-500ms each (Supabase ap-northeast-2 from
laptop).

For a real case with 100+ nodes this would be ~50+ seconds. The
ingestion lane solved the equivalent problem on `document_pages` with
`unnest($1::uuid[], $2::int[], …)` batch inserts.

**Not fixed in this session** — flagged as a follow-up. The mitigation
is: for the demo, use the seeded Alex/Jordan case (which already has its
ledger persisted, so no re-extraction needed).

### 5.4 The mock-content semantic problem

For non-demo uploaded cases (Bus Tragedy, PROBE-X), `claim.caseId`
isn't in `MOCK_GRAPHS` (which only has `CLM-2026-0427` and
`CLM-2026-0588`). Per `builder.py:57`:

```python
if is_mock():
    return MOCK_GRAPHS.get(claim.caseId, MOCK_GRAPHS[CLEAN])
```

So **mock-mode ledger build for any new uploaded case silently writes
the Alex/Jordan graph onto it**. The Bus Tragedy case, if you triggered
its ledger build in mock mode, would end up with Facts about red-light
running and CVC 21453 — semantically wrong for a bus document.

This is acceptable for *wiring* tests (the user explicitly asked us to
keep going with it during the audio + image rebuild work) but not for
demo content. **The fix is to flip to LIVE mode with a `GEMINI_API_KEY`**
so `build_ledger` actually runs the Gemini extraction agent against the
real document text.

No Gemini key is in `backend/.env` today.

### 5.5 The Bus Tragedy stuck case

The Bus Tragedy case has `ingestion_complete=true, ledger_complete=false`
because it was uploaded BEFORE Gowtham's handoff code shipped. The
handoff only fires on the *transition* false→true. Since the flag was
already true when the trigger code landed, no `run_ledger_build` was
ever enqueued for it.

The one-line fix: backfill script that enqueues `run_ledger_build` for
every case where `ingestion_complete=true AND NOT ledger_complete`.
Wasn't shipped this session — flagged as a follow-up.

---

## 6. Real-case flow

### 6.1 The cases list page returned only demo cases

`/api/cases` was originally just:

```python
@app.get("/api/cases")
def api_cases():
    return {"mock": is_mock(), "cases": _load_cases()}
```

Loading from `data/cases.json`. Real Supabase-backed cases were invisible.

Fix: extended `/api/cases` to be `async`, query
`IngestionRepository.list_cases()`, return both:

```python
return {
    "mock": is_mock(),
    "cases": demo_cases,        # backward-compat alias
    "demo_cases": demo_cases,
    "db_cases": db_cases,       # NEW
    "db_error": db_error,       # NEW — Supabase failure surfaces here, doesn't break the endpoint
}
```

`IngestionRepository.list_cases()` added — newest-first by
`coalesce(last_run_at, updated_at)`.

`_serialize_case()` helper maps `CaseRow` → frontend-friendly dict with
`stage` derived from the boolean flags.

### 6.2 The case detail endpoint needed UUID branching

`/api/case/{case_id}` was originally just legacy demo case lookup. For
real cases, the frontend wanted the case row + documents + ledger graph
nodes in one shot.

Fix: branched on `_is_uuid(case_id)`:

- UUID → `IngestionRepository` reads, return
  `{source: "db", case, documents, has_ledger, nodes, edges}`. Nodes +
  edges only populated when `ledger_complete=true`.
- Else → legacy `{source: "demo", meta, claim}`.

Frontend disambiguates on `data.source` and renders either `DemoCaseView`
or `DbCaseView`.

### 6.3 `load_run_inputs` (Sudharsan's contribution)

For real cases to actually *run* the debate, the orchestration needed to
reconstruct `(ClaimInput, list[Statute], EvidenceLedger)` from persisted
Supabase rows. Sudharsan landed this in `backend/ledger/service.py`:

```python
async def load_run_inputs(case_id: UUID) -> tuple[ClaimInput, list[Statute], EvidenceLedger]:
    repo = IngestionRepository()
    case = await repo.get_case(case_id)
    docs = await _read_documents(repo, case_id)
    claim = _reconstruct_claim(case, docs)
    statutes = await _load_statutes(repo, claim.jurisdiction)
    doc_names = {d.id: d.filename for d, _ in docs}
    nodes = await repo.list_nodes_for_case(case_id)
    ledger = _rows_to_evidence_ledger(case.case_id, nodes, doc_names)
    return claim, statutes, ledger
```

The ledger is *not rebuilt* at run time — it's read from persisted
`nodes` rows and projected into an `EvidenceLedger` shape via
`_rows_to_evidence_ledger`. This is what `run_lumen(...)` accepts as the
optional `ledger` parameter — when present, `run_lumen` skips its own
build step and uses the persisted one.

The `run_lumen` modification (`pipeline.py:232-245`):

```python
if ledger is not None:
    await room.post(AGENTS["evidence"].name, ...,
                    f"Evidence ledger loaded from the persisted graph — {len(ledger.facts)} facts:\n" +
                    "\n".join(f"   [{f.id}] {f.statement}  ({f.source})" for f in ledger.facts))
elif USE_LEDGER_LANE:
    graph = await build_ledger(claim, statutes)
    ledger = graph_to_evidence_ledger(graph)
    ...
```

For DB cases the room posts "Evidence ledger loaded from the persisted
graph" — visible signal that we're running on persisted data.

### 6.4 The SSR fetch bug (mentioned in §2.4)

Bears repeating because it affected this lane specifically: the cases
list page is a server component, calls `getCases()`, which calls
`fetch("/api/cases")` — relative URL — which fails server-side because
there's no origin to resolve against. The user saw "Backend offline" on
every page reload.

Fix: `apiUrl()` helper. Server-side → prepend `LUMEN_API_BASE_URL`.
Client-side → relative path (uses the rewrite).

Applied to all 8 API client functions: `getCases`, `getCase`,
`createCase`, `signUpload`, `commitUpload`, `getCaseStatus`,
`finalizeCase`, `postDecision`.

---

## 7. The new extractors

### 7.1 Scope decision

The user listed: markdown, Excel, audio, images, scanned PDFs. I asked
"all five or a subset" — they chose all five. Locked in.

### 7.2 Research method

Initial impulse: launch the heavyweight `deep-research` workflow. User
pushed back: "it is not a deep research problem, you just have to find
the correct information, just use one agent". Killed the workflow,
spawned a focused single agent with WebSearch + WebFetch on ~5-10
sources max. ~5 minutes turnaround.

Lesson: not every research question needs the harness. A single
well-scoped agent with web access is sometimes the right tool.

### 7.3 The research output (verbatim summary)

| Format | Recommendation | Source |
|---|---|---|
| Markdown | Route to existing `TextExtractor`; markdown is plain text to LLMs | github.com/executablebooks/markdown-it-py |
| Excel | `python-calamine` — Rust-backed, 5-10× faster than openpyxl, returns cached values by default | hakibenita.com/fast-excel-python |
| Audio | `whisper-1` + `verbose_json` + `timestamp_granularities=[segment]` — only OpenAI model with segments | developers.openai.com/api/docs/guides/speech-to-text |
| Image | Claude Sonnet 4.6 with a forced two-block prompt (OBSERVED / NOT_VISIBLE) | platform.claude.com/docs/en/docs/build-with-claude/vision |
| Scanned PDF | Detect with PyMuPDF empty-text heuristic; `ocrmypdf` for the fix | github.com/ocrmypdf/OCRmyPDF |

Plus the **source-anchoring research conclusion** that validated the
overall pattern: Harvey, Casetext CARA, Hebbia, Microsoft GraphRAG all
use "the model's deterministic text rendering of the source IS the
canonical page text; citations substring-anchor against that text". Our
Fact Gate is the right primitive.

### 7.4 What got built

**`backend/ingestion/extractors/excel.py`** (new) — `ExcelExtractor`
using python-calamine. One page per worksheet, TSV body with
`# Sheet: <name>` header, head+tail truncation if > 600 rows. Hidden
sheets surfaced (insurance templates often hide working tabs that contain
the real numbers) but tagged in metadata.

**`backend/ingestion/extractors/audio.py`** (new) — `AudioExtractor`
with Whisper API + ffmpeg chunking. Original version was Whisper-only.
Extended later (§8) to two-call pipeline.

**`backend/ingestion/extractors/image.py`** (new) — `ImageExtractor`
with Claude vision + two-block prompt. Extended later (§8) to three
blocks.

**`backend/ingestion/extractors/pdf.py`** (extended) — added OCR
fallback. Detection: `total_chars < 100` OR `> 50% of pages individually
empty`. If yes AND `ocrmypdf + tesseract + gs` are on PATH, runs
ocrmypdf subprocess to produce an OCR'd PDF, then re-pdfplumbers it.
Per-page merge: prefer native text where it exists, fall back to OCR
text. `extraction_method` in metadata: `native | ocr | hybrid`.

**`backend/ingestion/extractors/text.py`** — registered
`text/markdown` on `TextExtractor.mime_types`. Done.

**`backend/ingestion/extractors/registry.py`** — added the new extractors
to `_REGISTRY`. The registry maps MIME → extractor.

**`requirements.txt`** — added `python-calamine`, `ocrmypdf`, `httpx`,
`Pillow`.

**`frontend/lib/fileSupport.ts`** — `SUPPORTED_MIME_TYPES` extended from
9 → 14 types. `mimeOf()` extension map handles `.md, .xlsx, .mp3, .m4a,
.mp4, .wav, .jpg, .jpeg, .png, .webp`.

**`frontend/components/UploadZone.tsx`** — `accept` attribute extended,
help text updated to "PDF · DOCX · Excel · HTML · Markdown · text ·
images · audio".

### 7.5 Mock mode for all five

Every extractor has a mock path that returns canned, substring-quotable
text:

- Text/markdown — works without mock (deterministic decoding)
- Excel — works without mock (python-calamine deterministic)
- Audio — returns canned dispatch-call transcript with 6 fake segments
- Image — returns canned OBSERVED block with 5 crash-scene bullets
- Scanned PDF — works without mock (ocrmypdf deterministic, runs locally)

This preserves the mock-first principle. The whole pipeline can be
exercised without spending on API calls.

---

## 8. The EVENTS extraction pattern

### 8.1 The user's ask, distilled

> "ask the individual models capture the audio events extraction for
> each audio provided"
>
> "same goes for the visual models as well, ask the model to also get
> the events from the images apart form the transcribing the image"
>
> "and use good model for whisper, so that we can extract good model
> from it"

Translating:
1. Audio extraction should produce *structured events* (admissions,
   dispatch instructions, citations) in addition to raw transcript.
2. Image extraction should produce *structured events* (impact event,
   signal state, damage event) in addition to raw description.
3. Use a "good model" for Whisper.

### 8.2 The architectural reasoning

I started incrementally patching. The user then said:

> "you just don't have to complete the step back, think about the whole
> scenario and then take the required action to solve these"

Stepped back. The whole-scenario thinking:

**The Fact Gate problem.** Every Fact's `verbatim_quote` must be a
contiguous substring of `document_pages.extracted_text`. So if we want
agents to cite "the driver admitted running the red light" as a Fact,
that exact phrase needs to appear in some page's text.

**The simple-extract problem.** A raw Whisper transcript or raw image
description doesn't always say things in citation-friendly form. The
transcript says "yeah, I, I think I did kinda... go through it"; the
agent later wants to cite "Vehicle 2 driver admitted running the red".
Same idea, different wording. Substring check fails.

**The events-as-bridge insight.** If the extractor *also* produces a
structured `EVENTS:` block — typed factual bullets derived from the raw
text — then agents can cite *those* bullets directly. The events are
substring-quotable because we wrote them down.

**The constraint that makes it harness-safe.** Events must be derived
*only* from the raw text (transcript / OBSERVED block) — never new
content, never speculation. The prompt enforces this. If an event
contains a claim that's not actually supported by the transcript /
description, the model is breaking the prompt rules and we accept that's
a risk — but the *gate* still anchors against literal substring, so a
made-up event would still need a corresponding substring in the page
text, which it wouldn't have.

**Cross-format consistency.** Same EVENTS shape for audio and image, so
the ledger lane sees one consistent vocabulary regardless of input type.

### 8.3 The image change — three-block prompt

`SYSTEM_PROMPT` extended:

```
OBSERVED:
- <factual bullets from the image>

NOT_VISIBLE:
- <what cannot be determined>

EVENTS:
- [type] <one event bullet per discrete observable, derived from OBSERVED>
```

Allowed event types: `[impact]`, `[position]`, `[damage]`, `[signal]`,
`[signage]`, `[road]`, `[weather]`, `[debris]`, `[time]`, `[identifier]`,
`[persons]`.

`extracted_text = "OBSERVED:\n...\n\nEVENTS:\n..."` — both blocks. Both
substring-anchorable. `NOT_VISIBLE` lives in `metadata.not_visible` only —
deliberately omitted from the page text so any Fact citing inside
NOT_VISIBLE is a regex-detectable harness violation.

`max_tokens` bumped 1024 → 1536.

`LUMEN_VISION_MODEL` env override (default `claude-sonnet-4-6`, can
promote to `claude-opus-4-8` for high-stakes cases).

`_split_three_blocks(text) → (observed, not_visible, events)` — replaces
the old `_split_two_blocks`. Order-tolerant, missing-block tolerant.

### 8.4 The audio change — two-call pipeline

**Call 1**: Whisper-1 (kept — only model with segments) →
`{text, segments[]}`.

**Call 2**: Claude Sonnet 4.6 reads the segmented transcript and emits
an EVENTS block.

```
TRANSCRIPT (segments with [HH:MM:SS] start markers):

[00:00:00] Dispatch, this is unit 12. We have a collision at...
[00:00:06] Officer Rivera on scene...
[00:00:12] Vehicle 2 driver admits running the red.
[00:00:18] No injuries reported on scene.
...

(call returns)

EVENTS:
- [00:00:12] [admission] Vehicle 2 driver admits running the red.
- [00:00:18] [statement] No injuries reported on scene.
- [00:00:23] [request] Officer Rivera requests tow truck for Vehicle 1.
- [00:00:30] [citation] Vehicle 2 driver cited under CVC 21453.
```

Allowed audio event types: `[admission]`, `[statement]`, `[request]`,
`[citation]`, `[dispatch]`, `[observation]`, `[identifier]`.

`extracted_text = "TRANSCRIPT:\n...\n\nEVENTS:\n..."` — both blocks.
`metadata.segments` preserved (segment-level timestamps for fine-grained
audio anchoring). `metadata.events` also stored structured.

Graceful degradation: if the Claude events call fails (network blip,
missing key), the transcript still persists. The page just lacks
the typed events block. `metadata.events_model = None` flags that.

### 8.5 Whisper model decision — `whisper-1` it is

Researched the trade-off:

- **`whisper-1`**: classic, has segment timestamps via `verbose_json`,
  $0.006/min
- **`gpt-4o-transcribe`**: more accurate text but **no segment
  timestamps**, $0.006/min
- **`gpt-4o-mini-transcribe`**: cheaper at $0.003/min, no segments

The user wanted "good model". I picked: stay on `whisper-1` because
**segments are what make audio citations resolve back to (start_sec,
end_sec) windows in the original recording**. The "good" upgrade comes
from three places instead:

1. Substantially stronger Whisper `prompt` parameter with full insurance
   vocabulary seeding (subrogation, FNOL, EDR, CVC, CHP, ten-codes,
   claim ID format, vehicle identifiers, license plates). Biases the
   model's beam search toward correct proper nouns and statute codes.
2. The Claude events extraction layer adds structured, typed,
   timestamped ledger items.
3. `LUMEN_AUDIO_MODEL` env override defaults to `whisper-1` but can be
   flipped to `gpt-4o-transcribe` (accepting loss of segments) for
   power users.

### 8.6 Verified shapes (mock smoke test)

```
-- IMAGE --
  page_text length: 885 chars
  starts with: 'OBSERVED:\n- Silver four-d'...
  contains OBSERVED: True
  contains EVENTS:   True
  contains NOT_VISIBLE in page: False  (correctly metadata-only)
  metadata.not_visible present: True
  metadata.events present: True

-- AUDIO --
  page_text length: 958 chars
  starts with: 'TRANSCRIPT:\nDispatch, this is '...
  contains TRANSCRIPT: True
  contains EVENTS:     True
  metadata.segments count: 6
  metadata.events present: True
  source_location: 00:00-00:36 in dispatch.mp3
```

---

## 9. The honest end-to-end audit

After the EVENTS work the user asked: "everything will work correctly
right, like everythign and all? end to end, think about it."

I gave the honest answer — split into three buckets:

**Verified working** (watched it happen):
- Upload → B2 → commit → worker → document_pages for original four formats (probe_upload.py output)
- Mock-mode demo cases run the full 8-agent debate (in-memory)
- Ledger lane auto-triggers after ingestion completes (watched it fire in worker logs after killing the stale worker)
- Backend imports + frontend builds clean after every change
- New extractors in mock mode (smoke test)

**Wired but never run live**:
- Whisper API call (no real audio file run through)
- Claude vision API call (no real image run through)
- Audio two-call pipeline
- OCR fallback against a real scanned PDF (ocrmypdf installed but never invoked end-to-end)
- DB-case debate with full persistence (the runs/transcript/decisions inserts have never been observed completing)
- Frontend replay-on-mount (wrote code, never verified visually)

**Broken or semantically wrong**:
- Mock-mode for non-demo uploaded cases writes Alex/Jordan graph onto them
- No `GEMINI_API_KEY` in `.env` (so live ledger lane is non-functional)
- Bus Tragedy case stuck at `ledger_complete=false` (handoff didn't fire for it)

The audit was an exercise in honesty — the user wanted to know, not be
reassured. The shortest verification plan to convert "should work" to
"verified working":

1. Run a debate against the seeded Alex/Jordan case (`574d61f9-…`)
   which already has `ledger_complete=true` — exercises the whole new
   persistence stack in 30s
2. Refresh `/cases/[id]` — verify the run replays
3. Upload a real PDF, watch it extract
4. Backfill Bus Tragedy's ledger build, click "Open the room"
5. Upload a small mp3 + a JPEG to exercise the LIVE Whisper + vision paths
6. Upload a scanned PDF to verify OCR fallback

---

## 10. Hard rules / non-negotiables (preserved from prior sessions)

These are bright lines that survived every conversation iteration and
must keep holding:

1. **Mock-first.** The CLI demo (`python -m backend.app.run_demo`) runs
   offline with zero keys. Every change preserves this.
2. **Gates are CODE, not prompts.** Citation Gate, Fact Gate, Math Gate,
   Letter Reconciliation are pure functions. Consensus Gate is in
   pipeline. Source-Alignment Verifier is the one agentic gate but its
   judgment is structured (supported / contradicted / overreach / neutral).
3. **The opponent is a red team, not a negotiator.** No "settlement"
   turn. No "find common ground" round. The prompt explicitly forbids it.
4. **Separation of powers.** Debaters don't decide. A neutral
   Adjudicator (in fact two — A and B on different model families) does.
5. **Different model family per side.** Advocate (Claude) vs Opposing
   (GPT). Adjudicator A (Claude) vs Adjudicator B (Gemini). Real
   independence, not cosmetic.
6. **Fault is computed from a table, not vibed.** Math Gate verifies.
7. **"Not in evidence" is acceptable.** Agents escalate rather than invent.
8. **No web search for agents.** Breaks Citation Gate universality.
   Deferred to v2.
9. **No shell / bash / filesystem tools for agents.** Security +
   abstraction concerns. Use structured DB queries instead.
10. **No agent writes into another lane's tables.** Ingestion owns
    `documents` + `document_pages`. Ledger owns `nodes` + `edges`.
    Orchestration owns `runs` + `transcript` + `decisions`.
11. **`verbatim_quote` substring rule.** Every Fact's `verbatim_quote`
    must be a contiguous substring of some `document_pages.extracted_text`.
    The Fact Gate enforces this. **Every new format we add must respect
    this.** No exceptions, no "but the model said". Code-enforced.
12. **No Claude / AI attribution in commits.** Machine identity only.
    Explicit user preference.
13. **Every new non-text format must produce a substring-anchorable text
    block.** Added in this session for audio and images. The pattern is:
    raw bytes → deterministic OR model-produced text → that text is what
    the Fact Gate substring-anchors against. Bytes never reach the
    debate agents directly. For images, the OBSERVED block + EVENTS
    block (concatenated) are the page text; NOT_VISIBLE stays in
    metadata only so any Fact citing inside it is a regex-detectable
    gate violation. For audio, the TRANSCRIPT block + EVENTS block are
    the page text; segments stay in metadata for fine-grained time-window
    anchoring.

---

## 11. The lane / table contract (preserved)

| Lane | Owner | Writes | Reads | Triggered by |
|---|---|---|---|---|
| Ingestion | Aman | `documents`, `document_pages`, `cases.ingestion_complete` | uploaded files | new case |
| Ledger | Gowtham | `nodes`, `edges`, `cases.ledger_complete` | `documents`, `document_pages`, `statutes` | `ingestion_complete=true` |
| Orchestration | Sudharsan | `runs`, `transcript`, `decisions`, `cases.finalized`, `cases.last_run_at` | `cases`, `nodes`, `edges`, `document_pages`, `statutes`, `documents` | `ledger_complete=true` |

The `cases.ingestion_complete` and `cases.ledger_complete` boolean flags
are the only cross-lane synchronization primitives. Lanes never call into
each other directly. The ingestion lane enqueues the ledger build by name
via arq (no import of ledger code).

---

## 12. The schema (current, post-all-this-work)

**`cases`** — one row per subrogation case.
- `id` (UUID PK), `case_id` (human ID), `title`, `summary`, `jurisdiction`,
  `damages_usd`, `insured_name`, `other_party_name`
- Three boolean flags: `ingestion_complete`, `ledger_complete`, `finalized`
- `last_run_at`, `metadata` (JSONB escape hatch)
- Tenant ID, timestamps, trigger-managed `updated_at`

**`documents`** — one row per uploaded file.
- Content-addressed via `sha256`. `(case_id, sha256)` unique → idempotent
- `storage_provider` / `storage_bucket` / `storage_key` for B2 lookup
- `status` enum: `pending → uploaded → extracting → extracted | failed`
- `extraction_error`, `extraction_duration_ms`, `retry_count`,
  `last_retry_at` for ops visibility

**`document_pages`** — one row per logical page of extracted text.
- `extracted_text` (TEXT, TOAST handles large values)
- `extraction_metadata` (JSONB — per-format escape hatch, holds segments,
  events, sheet names, OCR confidence, image dimensions, etc.)
- GIN FTS index on `to_tsvector('english', extracted_text)`

**`statutes`** — public legal text. `CA-1431.2`, `CVC-21453`, `CVC-21703`
seeded.

**`nodes`** — Gowtham's typed graph. `node_id` is display ID (F1, P1, V1,
EV1, L1, D1, S1, DOC1). `type` ∈ {Fact, Party, Vehicle, Event, Location,
Statute, Damage, Document}. Fact nodes carry `verbatim_quote +
source_document_id + source_page_number` — the Fact Gate's anchor.

**`edges`** — typed graph relationships. Types: `mentioned_in`,
`corroborates`, `contradicts`, `attributed_to`, `governed_by`, `caused`,
`involves`, `occurred_at`, `drives`.

**`runs`** — one row per pipeline execution.
- `mode` ∈ {mock, live}, `status` ∈ {running, completed, failed, escalated}
- `started_at`, `ended_at`, `duration_ms`, `error_message`

**`transcript`** — per-run room posting. `(run_id, seq)` unique.
- `agent_name`, `color`, `kind` ∈ {message, handoff, gate, decision, system}
- `content`, `posted_at`

**`decisions`** — one row per run.
- `other_driver_fault_pct`, `confidence`, `recovery_usd`
- `escalate`, `escalate_reasons` (JSONB), `near_fifty_fifty`
- `consensus_type`, `consensus_delta`, `fault_table` (JSONB)
- `reasoning`, `secondary_decision` (JSONB, Adjudicator B's full output)
- `letter` (full demand letter text)
- `audit_hash` — SHA-256 of `(transcript + decision)` rows

Cascade deletes from `cases` down. Exception:
`nodes.source_document_id` is `SET NULL` not `CASCADE` — preserves Facts
even if their source document is removed (audit trail value).

---

## 13. Conversation arc — chronological

This section captures the *flow* of conversation, in rough order. The
goal is to make it easy for someone reading this doc to reconstruct
"what was happening when X was decided".

### Phase A — Context revival + dev environment

User started with `/compact` essentially. I rebuilt context by reading
`docs/CONTEXT.md`, `docs/architecture.md`, `docs/project-plan.md`,
`docs/product-context.md`, then `docs/ingestion-start-context.md` (1650
lines). Confirmed I had the full mental model.

User then asked how to run dev. I explained `./run.sh dev` etc.

### Phase B — The frontend rebuild

User: "make the modern frontend correctly". Picked Next.js 16 + Tailwind
v4 + biome. Built `/`, `/cases/new`, `/cases/[id]` with all the
components. Discovered Next 16 has breaking changes (read the bundled
docs).

User wanted chat-style intake. Built `ChatComposer` + `ChatMessage` +
the conversation flow.

### Phase C — Backend port + ingestion mounting

Moved FastAPI from `:3000` to `:8000` to dodge Next's default. Added
CORS middleware. Discovered `/api/ingest` router was built but never
mounted in `server.py` — fixed.

### Phase D — The B2 saga (§3)

POST policy → PUT URL → bucket create → CORS rules. Three sequential
bugs. Wrote `scripts/setup_b2_bucket.py` to codify the fix.

### Phase E — Cases-list unification

`/api/cases` extended to return both demo + DB cases. New
`Repository.list_cases()`. Cases list page on `/` got "Your cases"
section showing real Supabase rows.

### Phase F — Case detail UUID branch + Argument Room

`/api/case/{id}` branched to handle UUIDs. New `DbCaseView` with
`StageStepper` + `DocumentsPanel` + `LedgerGraphPanel` + `ArgumentRoom`.
The Argument Room locked / ready / in-session states.

### Phase G — The persistence problem (§4)

User flagged the "open court room" missing persistence. Pushed back on
their JSONL proposal. Built `RunRepository` + `Room.post()` persist +
`api_run` lifecycle + read endpoints + frontend replay.

### Phase H — The stale-worker bug + ingestion handoff verification

Gowtham's handoff worked but a stale arq worker (started before
`run_ledger_build` was registered) was greedily consuming jobs. Killed
it; verified end-to-end.

### Phase I — The stuck-run bug (§4.4)

User reported a 10-min-old `running` row in the UI. Found
`asyncio.CancelledError` not caught by `except Exception`. Added
explicit branch with `asyncio.shield`. Added stale-run sweeper.

### Phase J — Layout / scroll iterations (§2.5)

Argument Room scrollability went through ~4 iterations. Final fix:
`h-full min-h-[480px] max-h-[85vh] overflow-hidden` on both columns.

### Phase K — New extractors research + ship (§7)

Killed deep-research workflow, spawned single focused agent. Got
research back. Built ExcelExtractor, AudioExtractor, ImageExtractor,
PdfExtractor OCR fallback. Updated frontend MIME types. Smoke-tested in
mock mode.

### Phase L — EVENTS extraction (§8)

User asked for structured event extraction on audio + image, plus a
"good model" for Whisper. Stepped back, designed the cross-format
EVENTS pattern. Image: three-block prompt. Audio: two-call pipeline.
Smoke-tested.

### Phase M — Honest audit + docs (§9, §11)

User asked "will it all work end to end?". Gave the honest answer with
the verified/unverified split. Then user asked for full documentation —
wrote `docs/ingestion-flow.md` (Mermaid) and `docs/extractor-deep-dive.md`
(ASCII). Fixed a Mermaid parse error in the sequence diagram (HTML
entities `&lt;` `&gt;` inside `Note over` confused the parser; replaced
with `{case_id}` curly braces and removed `<br/>`).

### Phase N — This doc

You're reading it. Captures everything above for future-me.

---

## 14. Rejected ideas with reasoning

A list of things we explicitly *didn't* do, with why. So future-us
doesn't re-litigate.

| Idea | Verdict | Why |
|---|---|---|
| JSONL transcript on `cases.metadata` | NO | O(n²) hot-row writes; multi-run impossible; concurrent corruption; reinventing the transcript table inside JSONB. The transcript table already existed in the schema designed for exactly this. |
| Use heavyweight `deep-research` workflow for the extractor research | NO | Overkill; user pushed back; single focused agent with WebSearch was 10× cheaper and produced the same usable output |
| Send PDF directly to Claude/Gemini vision (lawyer-timeline-mvp's pattern) | NO | Breaks source-anchoring; no canonical page text for the Fact Gate to substring against. We do pdfplumber-first + OCR fallback, producing real text. |
| OCR-everything-always | NO | Wasted compute; merges produce worse text on born-digital PDFs. Hybrid detection (run pdfplumber first; OCR only if empty) is much better. |
| Skip Whisper, use gpt-4o-transcribe for higher accuracy | NO | gpt-4o-transcribe doesn't emit segment timestamps. Without segments, audio Facts can't resolve back to (start_sec, end_sec) in the original recording. Stay on whisper-1 for now; env-overridable if priorities change. |
| Cross-check images with two vision models (Claude + Gemini) | NO (deferred) | Doubles per-image cost. The single-model + two-block forced prompt + regex post-check catches speculation by syntax. Cross-check is the v2 hardening. |
| Skip the `runs` table; use bare UUIDs | NO | We wanted to track mode, status, duration, error_message per execution. The `runs` table provides this cleanly. |
| Pipeline calls `build_ledger` ephemerally during the debate AND persists | YES (current state) | Wasteful — the graph gets built twice (once by `run_ledger_build` from the worker, once by `run_lumen` from the SSE driver if `ledger=None` is passed). The fix is to make `api_run` pass the persisted ledger via `load_run_inputs`. Sudharsan implemented this; now `run_lumen` uses persisted ledger and skips rebuild. |
| Mock-mode falls back to MOCK_GRAPHS[CLEAN] for any non-demo caseId | YES (accepted with caveat) | Functionally correct for wiring tests; semantically wrong content for arbitrary uploaded cases. The fix is LIVE mode with Gemini key, not today. |
| Use Anthropic native SDK instead of httpx | NO | httpx is already in the project; the Anthropic API is straightforward; one HTTP call is easier to debug than an SDK abstraction. |
| ML pre-processing on images before vision (rotation correction, denoising) | NO | The vision model handles it. Pillow resize to ≤2000px on the longer side is the only pre-processing. |
| Use gpt-4o-transcribe instead of whisper-1 (newer, more accurate) | NO | Doesn't emit segment-level timestamps. Audio anchoring would degrade from "cite a (start_sec, end_sec) window" to "cite the whole page". Stay on whisper-1; env-overridable for power users via `LUMEN_AUDIO_MODEL`. |
| Audio events extraction inline in the Whisper response | NO | Whisper doesn't structure-extract; it transcribes. Two-call pipeline (Whisper for transcript+segments, Claude for events) keeps each model doing what it's good at. |
| Premium-mode vs balanced-mode vs speed-mode presets (lawyer-timeline-mvp's pattern) | NO | Adds config complexity. Env overrides per concern (`LUMEN_AUDIO_MODEL`, `LUMEN_VISION_MODEL`, etc.) are cleaner. |
| Skip the OCR detection heuristic, always run OCR | NO | Wasted compute on born-digital PDFs, AND the merge step gets worse text on text-extractable pages. Detect first; OCR only when needed. |
| Single block image prompt ("describe the image factually") | NO | The model can silently slip speculation into the description. Two-block (later three-block) prompt makes speculation regex-detectable. |
| Use a vision LLM as PDF OCR (instead of Tesseract) | NO (deferred) | ~10× cost vs Tesseract for printed text. Right for handwriting, wrong for typical insurance scans. v2: detect handwriting density per page and route. |
| Use openpyxl for Excel | NO | python-calamine is 5-10× faster, 50× less memory, always returns cached formula values. Same install path (`pip`). |
| Use the Anthropic native SDK (rather than raw httpx) | NO | One HTTP call is easier to debug than an SDK abstraction; we already use httpx for Whisper. Consistency. |
| Mock-mode for non-demo uploaded cases falls back to MOCK_GRAPHS[CLEAN] (writes Alex/Jordan content to e.g. Bus Tragedy) | ACCEPTED with caveat | Functionally tests the wiring; semantically wrong content. The fix is LIVE mode with a Gemini key, not today. Flagged loudly in §5.4. |
| Speaker diarization for audio (pyannote.audio) | NO (deferred) | Adds a dependency, model download, GPU concern. The Claude events extraction can infer "Speaker A says X" from context. Diarization is v2. |
| Web search tool for agents | NO | Breaks Citation Gate universality. Deferred to v2 with explicit acknowledgment. |
| Embeddings / pgvector / RAG | NO (deferred) | Whole ledger fits in any agent's prompt (~20-30 nodes ≈ 2K tokens). The Citation Gate's universality depends on every agent seeing every fact id. RAG breaks that guarantee. Cross-case memory is the one genuine embeddings use case — v2. |
| MongoDB for raw text | NO | Postgres TOAST handles 15 MB per case in 3% of the free tier. Postgres clutter is not a real concern at our scale. Adding MongoDB = another service, more env, more failure modes, zero new capability. |

---

## 15. For the next person picking this up

Quick orientation if you're inheriting:

**Where to start**:

1. Read `docs/CONTEXT.md` for the project's whole journey (393 lines)
2. Read `docs/ingestion-flow.md` for the data-flow diagrams (~450 lines, Mermaid)
3. Read `docs/extractor-deep-dive.md` for per-format byte-by-byte (~700 lines, ASCII)
4. Read this file (`docs/trace-image-audio-ingestion.md`) for the why
5. Run `./run.sh dev`, open `http://localhost:3000`, click around

**To smoke-test the system right now**:

```bash
# Verify DB connects (the host had to be moved to the Supavisor pooler — see §3)
.venv/bin/python -c "
import asyncio, os
from pathlib import Path
from dotenv import load_dotenv
load_dotenv(Path('backend/.env'))
import asyncpg
async def m():
    c = await asyncpg.connect(os.environ['DATABASE_URL'], statement_cache_size=0)
    v = await c.fetchval('select version()')
    print(v)
    await c.close()
asyncio.run(m())
"

# Run the end-to-end upload probe (writes to B2 + Supabase)
.venv/bin/python -m scripts.probe_upload

# Run the end-to-end ledger probe against the seeded Alex/Jordan case
.venv/bin/python -m scripts.probe_ledger
```

**To exercise the new extractors live** (needs the OpenAI + Anthropic
keys in `backend/.env`):

```bash
LUMEN_MOCK=0 ./run.sh dev
# Then drag a .xlsx, .mp3, .jpg, or scanned .pdf onto /cases/new
```

**Critical files to know**:

- `backend/app/pipeline.py` — the 8-agent debate orchestration (`run_lumen`)
- `backend/app/server.py` — FastAPI app, `/api/run`, `/api/cases`, `/api/case/{id}`, `/api/runs/{id}/transcript`, `/api/cases/{id}/runs`
- `backend/app/room.py` — `Room.post()` is the chokepoint for transcript persistence
- `backend/app/run_repository.py` — runs / transcript / decisions writes
- `backend/ingestion/extractors/` — five working extractors
- `backend/ledger/service.py` — `build_and_persist_ledger`, `load_run_inputs`
- `backend/ingestion/service.py:280-281` — the ingestion → ledger handoff
- `backend/ingestion/worker.py` — arq composition root (registers both
  `extract_document` and `run_ledger_build`)
- `frontend/app/cases/[id]/page.tsx` — case detail page, branches on
  demo vs DB source

**Things to verify before the demo**:

1. Live debate against the seeded `CLM-2026-0427` case (UUID
   `574d61f9-...`) — exercises the whole persistence stack. 30 seconds.
2. Page reload on `/cases/[id]` after a successful run — verify
   `RunHistoryStrip` shows the run and the transcript replays from DB.
3. Backfill ledger for Bus Tragedy case (one-line script — run
   `enqueue_build_ledger` for `case_id='Bus Tragedy'`). Then click
   "Open the room" to exercise full chain.
4. Upload a small PDF — verify the original four-format path still works.
5. Upload a small mp3 — exercise the LIVE Whisper + Claude events path.
6. Upload a JPG — exercise the LIVE Claude vision three-block prompt.
7. Upload a scanned PDF — exercise the OCR fallback.

**Known footguns**:

- **Restart `./run.sh worker` after any change to `WorkerSettings.functions`**.
  Old workers don't see new functions and silently fail jobs with
  "function not found".
- **Don't revert DATABASE_URL to `db.<ref>.supabase.co`**. That host was
  retired by Supabase for new projects. Use the Supavisor pooler:
  `aws-1-ap-northeast-2.pooler.supabase.com`. Username must include the
  dot suffix: `postgres.<project-ref>`.
- **Don't revert PORT to 3000**. That conflicts with Next.js dev.
  FastAPI is on `8000`; Next is on `3000`; Next's rewrite proxies
  `/api/*` to `:8000`.
- **Mock-mode silently writes Alex/Jordan content to non-demo cases**.
  See §5.4. Either accept it for wiring tests or run in LIVE mode (with
  a Gemini key) for real content.
- **The Argument Room's `max-h-[85vh]` is load-bearing for internal
  scroll**. If you remove the max-h, the room grows with content and
  the inner `overflow-auto` becomes a no-op.

**Open follow-ups** (not done in this session):

- [ ] Batch insert for ledger writes (currently 19s for 20 nodes/edges
      due to per-row round-trips)
- [ ] Backfill ledger for already-`ingestion_complete` cases (Bus Tragedy
      et al.)
- [ ] Add `GEMINI_API_KEY` to `.env` so live ledger extraction works
- [ ] Camera/microphone/OCR pictogram on Fact cards backed by
      image/audio/OCR pages
- [ ] Refusal-regex post-check for image pages (flag Facts citing inside
      `metadata.not_visible`)
- [ ] Live smoke tests against the 5 new file types
- [ ] Deployment (Render/Railway for backend, Vercel for frontend)
- [ ] 3-minute demo video
- [ ] Pitch deck
- [ ] Push to GitHub

---

## 16. The ten-thousand-foot mental model

If you read nothing else here, internalize this:

```
   user uploads file
          |
          v
   raw bytes -> Backblaze B2 (immutable, content-addressed by SHA-256)
          |
          v
   extractor (one of 8, MIME-routed) produces ExtractedDocument
          |
          v
   document_pages.extracted_text (the SUBSTRATE for everything downstream)
          |
          v
   ledger lane: LLM reads page text, emits Fact nodes
          |              |
          |              v
          |    verbatim_quote MUST be a substring of page text
          |    (Fact Gate, code-enforced)
          v
   nodes + edges (the locked Evidence Ledger graph)
          |
          v
   orchestration: 8 agents debate over the graph
          | (Citation Gate: every cited ID must be in the ledger)
          | (Math Gate: percentage must follow from fault table)
          | (Consensus Gate: A and B must agree within 10pp)
          | (Source-Alignment Verifier: every citation actually follows)
          | (Letter Recon: letter contains the decided % and $)
          v
   runs + transcript + decisions (the persistent audit chain)
          |
          v
   recovery packet: fault %, $ amount, demand letter, audit hash
```

That's the whole system. Everything in the codebase exists to serve
that pipeline, and every architectural decision was checked against the
Fact Gate's substring-anchoring rule. Every new format we add must
produce DETERMINISTIC TEXT first. Every Fact must trace back to a
contiguous substring of that text. Every cited fact must resolve to a
real node. The audit chain — Fact → quote → page → document → B2 object
— never breaks.

This is the load-bearing property of Lumen. If something in the future
threatens it, push back hard.

---

---

## 17. Appendix A — Verbatim user quotes (the load-bearing moments)

These are the user messages that locked in major decisions or
constraints. Preserved verbatim so future-us doesn't paraphrase the
intent away. Slight typos included — the user types fast and the
content is what matters.

### A.1 The "open court room" insight (§4)

> "in the Argument Room when ever the aggents are arguing something the
> it is not persistant, like see the arguments are meant to done by the
> agent like in open court room as the person say infrom of everyone,
> all the person presnet in that court room are sound with what is
> happening, and know what the person is say, now as now another person
> has to say something , it will say something basis on the, what the
> other agent have said, now the agent have to decide and all but all
> these things are not persistance, like the aguments are not present in
> the db as an logs, so i am thiking of adding the jsonl, in the case
> table"

Decoded:
1. Agents need to "hear" each other → already works in-memory
2. Persistence to DB → missing, must add
3. Proposed implementation: JSONL on cases.metadata
4. We rejected JSONL, chose the existing transcript table — same outcome,
   right shape.

### A.2 The "step back before acting" rule (§8)

> "okay so you can do the things, and also integrate but, the thing is
> we have to research about it, how can we do about it, cuase i beleive
> if we have good and proper reseach tthen we can do these this very
> quickly, cuaese remeber you also said about a diffent type of pdf
> which requires the ocr and all, so yes  let;s do that corrrectly"

And again later when I was incrementally patching:

> "you just don't have to complete the step back, think about the whole
> scenario and then take the required action to solve these"

Decoded: do research before architectural changes; step back and design
holistically before implementing.

### A.3 The "single agent, not deep research" pushback (§7)

> "not you don;t have to run a deep reseasrch it is not a deep reseach
> problem you just have to make sure that, you find the correct
> information, just use one agent and find out, surf the internet, think
> for all the cases correctly, and additionally think about how we can,
> store all those and all"

Decoded: don't reach for the heavyweight research harness for every
information-gathering task. Single agent with web access is often
right-sized.

### A.4 The "make it scrollable" iterations (§2.5)

First attempt:

> "okay now also make the agruments room scrollabe so that we have good
> idea about this, and we can scroll down"

After my partial fix:

> "but i still think that is is not scrollabe like, the height should be
> more but it should be scrollabe after that"

After fixing scroll but breaking balance:

> "but can see thye are not balanced right, fix that correctly, don;t
> just act, just to solve the task, take a step back, get the whole
> picture and then take the action"

Decoded: visual iteration with the user — don't ship the first fix that
seems plausible. Get the whole picture before each change.

### A.5 The "make events extraction" ask (§8)

> "okay few things, to make sure that they are working correctly and add
> in the transcipt of audio and also in the image, is hat,
>
> - ask the individual models capture the audio events extraction for
>   each audio provided
> - same goes for the visual models as well, ask the model to also get
>   the events from the images apart form the transcribing the image
> - and use good model for wishper, so that we can extract good model
>   from it,
>
> do all these correctly"

Decoded:
1. Audio: add structured event extraction on top of the transcript
2. Image: add structured event extraction on top of the description
3. Whisper: use a "good model" → researched; whisper-1 stays because
   only it has segments; "good" delivered via stronger prompt + Claude
   events pass + env override

### A.6 The "everything end to end?" honest audit ask (§9)

> "now tell me one thing that, everything will work correctly right,
> like everythign and all? end to end, think about it"

Decoded: stop reassuring me, audit the actual state honestly. I split
into verified / wired-but-untested / broken-or-semantically-wrong.

### A.7 The "no Claude attribution in commits" preference (preserved
from prior session, reinforced this session by absence of pushback)

Machine identity only. Don't dress commits in "Co-Authored-By: Claude".

### A.8 The "Mermaid + plain English + then ASCII" docs ask (§13, Phase M)

> "tell me how the things are getting parsed and how they are going to
> store and where they are going to be stored and all, from end to end,
> i would suggest make .md file with mermaid diagrams, and explain using
> simple english the flow and process and all"

Then later, after seeing the Mermaid version:

> "okay, i got the visual idea, but now i want to read, in details how
> the things are getting parsed for paritucularly, for the images,
> audios, scanned_pdfs etc, and how they are getting stored, and at the
> end also show about the rest how thye ate getting done, speciaalu the
> parser, in here, without mermaid, using asscii diagrams so that i can
> undestand those"

Decoded: pair of docs. `ingestion-flow.md` is the visual/Mermaid version;
`extractor-deep-dive.md` is the byte-by-byte ASCII version focused on
the hard formats.

---

## 18. Appendix B — The 8 agents

Provider assignment is **deliberate cross-family** so the adversarial
parts are genuinely independent — not one model arguing with itself.

| # | Agent | Provider · Model (default) | Job | Where to override |
|---|---|---|---|---|
| 1 | Intake Parser | OpenAI · `gpt-4o-mini` | Extract parties/date/location/damages from FNOL | `MODEL_INTAKE` |
| 2 | Evidence Aggregator | Google · `gemini-2.5-flash` | Build the grounded Evidence Ledger (ledger lane's live mode) | `MODEL_EVIDENCE` |
| 3 | Liability Advocate | Anthropic · `claude-opus-4-8` | Argue our insured is owed recovery (zealous counsel) | `MODEL_ADVOCATE` |
| 4 | Opposing-Carrier Red Team | OpenAI · `gpt-4o` | Attack our case — a red team, never a negotiator | `MODEL_OPPOSING` |
| 5 | Adjudicator A | Anthropic · `claude-opus-4-8` | Neutrally set fault % + recovery, showing its math | `MODEL_ADJUDICATOR` |
| 6 | Adjudicator B | Google · `gemini-2.5-pro` | Independent re-decision on a different model family | `MODEL_ADJUDICATOR_B` |
| 7 | Source-Alignment Verifier | Google · `gemini-2.5-flash` | Audit every cited claim actually follows from its fact | `MODEL_VERIFIER` |
| 8 | Demand Letter Drafter | Anthropic · `claude-sonnet-4-6` | Compose the formal demand letter | `MODEL_DRAFTER` |

Three families, eight agents. **The Advocate (Claude) debates the
Opposing red team (GPT)**, and **Adjudicator A (Claude) is checked
against Adjudicator B (Gemini)** — both pairs across two different
families. That's what makes "diverse models resist collusion" *real*,
not cosmetic.

This session added the **vision extractor (Claude Sonnet 4.6)** and the
**audio extractor (Whisper for transcription, Claude Sonnet 4.6 for
event extraction)** to the extraction lane. Those don't count as
debate agents — they're per-format extractors. But they're part of the
provider mix.

---

## 19. Appendix C — Current database state (what actually exists)

Snapshot as of late session, 2026-06-19. Useful when reconnecting to
the live Supabase — you'll see these cases.

### C.1 Seeded demo case (load-bearing — used for every backend test)

```
case_id  = 'CLM-2026-0427'  (Alex Rivera vs Jordan Blake)
id       = 574d61f9-6cee-4cf7-8d49-e4f98d24be38
ingestion_complete = true
ledger_complete    = true   (after probe_ledger ran)
docs               = 5      (police_report.pdf, witness_statements.pdf,
                             edr_readout.pdf, repair_invoice.pdf, fnol.txt)
nodes              = 20     (after `python -m scripts.probe_ledger`)
edges              = 20
```

This is the case you point smoke tests at. It has every piece (case row,
documents, document_pages, nodes, edges) populated end-to-end.

### C.2 Real user-uploaded case (stuck — needs ledger backfill)

```
case_id  = 'Bus Tragedy'
id       = bd7bba9e-4944-4653-8431-79fecf305ff9
title    = 'Untitled case'    (user didn't fill in the title field)
jurisdiction = 'CA'
docs     = 1                  (SC TR310 Manual Rev 8 2012.pdf — 123 pages, 1.3 MB)
ingestion_complete = true
ledger_complete    = false    (handoff didn't fire — pre-Gowtham-commit upload)
```

To unstuck: enqueue `run_ledger_build` for `bd7bba9e-...` manually.

### C.3 Probe upload cases (smoke-test artifacts)

A handful of `PROBE-{epoch}` cases from `scripts/probe_upload.py` runs.
All have `ingestion_complete=true`, `ledger_complete=false`. Safe to
ignore or delete.

```
PROBE-1781800994 → 62b73080-…  (smoke test 2026-06-18 22:09)
PROBE-1781800731 → aa1dfa0f-…  (smoke test 2026-06-18 22:08)
PROBE-1781770544 → 7f6b8ecf-…
PROBE-1781770419 → b105b047-…
PROBE-1781728442 → d001ca1b-…
PROBE-1781728404 → 6672cc98-…  (ingestion_complete=false — early B2 failure)
PROBE-1781728334 → cf7170ab-…  (same)
```

### C.4 Run / transcript / decisions state

```
runs       = 1 stuck-run that got swept to 'failed' (see §4.4)
transcript = 15 rows belonging to that swept run
decisions  = 0 rows  ← NO real-case debate has ever completed end-to-end
```

This is the BIG verification gap: real-case persistence has never been
observed completing.

---

## 20. Appendix D — Whisper insurance vocabulary prompt (verbatim)

The `prompt` parameter is max 224 tokens. It biases Whisper's beam search
toward proper nouns and statute references typical of subrogation audio.
Defined in `backend/ingestion/extractors/audio.py:WHISPER_PROMPT`:

```
Insurance subrogation case audio. Vocabulary likely to appear:
subrogation, recovery, demand, fault, comparative negligence,
FNOL, EDR, CVC, CHP, citation, intersection, signal, red light,
rear-end, T-bone, totaled, deductible, claimant, insured,
adjuster, arbitration, ten-codes (10-4, 10-20), case numbers in
the form CLM-YYYY-NNNN, vehicle identifiers, license plates.
```

This is what gets Whisper to correctly produce `CVC 21453` instead of
`see vee see twenty-one four fifty-three`, and `claim CLM-2026-0427`
instead of `claim number C-L-M-...-0-4-2-7`.

If you ship internationally or want non-California statutes, this needs
extending.

---

## 21. Appendix E — The lawyer-timeline-mvp audit (verbatim from research)

The research agent found and audited this repo since it kept coming up
as a reference. Findings, recorded verbatim because the user is likely
to ask "what did that repo do?" again.

### E.1 Identity

```
URL:    https://github.com/Bug-Finderr/lawyer-timeline-mvp
Stack:  TypeScript / Bun / Next.js
State:  Last updated 2026-05-02, 258 KB
Lane:   Close design overlap with Lumen — extracts timeline events from
        legal documents.
```

### E.2 Extractors they ship (`src/processors/`)

- **`pdf.ts`** — sends PDFs directly as `file` content parts to
  Claude/Gemini via the Vercel `ai` SDK. Chunks PDFs > 5 MB via a
  `chunker.ts` module. Runs 15 chunks in parallel. **No OCR pass —
  relies on native PDF vision.**
- **`audio.ts`** — OpenAI `whisper-1` with `response_format:
  "verbose_json"`, `timestamp_granularities: ["segment"]`. Then a
  separate Claude/Gemini call converts segments → timeline events with
  `MM:SS` timestamps, batch size 60. **Exactly the audio-anchoring
  pattern we adopted in §8.4.**
- **`image.ts`** — Claude/Gemini vision with a Zod schema that splits
  `description`, `people_visible`, `date_clues`, `significant`. MIME
  map for jpg/jpeg/png/gif/webp.
- **`video.ts`** — ffmpeg keyframe extraction → image processor.
  Present, we don't ship video.
- **`email.ts`, `text.ts`** — also present.

### E.3 Their verbatim prompts (research agent extracted these)

PDF processor:
> "You are a legal analyst extracting timestamped events from a legal
> document (PDF). For each discrete event, decision, filing, allegation,
> or significant fact, extract: the exact date (ISO 8601), a clear
> one-sentence description, the page number (`p. 14`) as
> source_location, confidence (high/medium/low), names of people
> involved."

Audio processor:
> "Transcribe this audio recording with speaker identification. For each
> speaker turn: speaker name when identifiable... what they said,
> transcribed verbatim... timestamp (MM:SS) when they started speaking."

Image processor:
> "You are analyzing a photograph submitted as evidence in a legal case.
> Describe what is visually depicted... legally significant elements:
> use of force, weapons, injuries, evidence, restraints, crime scene
> details. Be precise and factual. Describe only what you can see."

### E.4 What we lifted, what we explicitly didn't

**Lifted:**
- The `source_location` string format (e.g. `"p. 14"`, `"00:32 in
  audio.mp3"`, `"sheet:Line Items"`). Single typed field on every page
  that resolves uniformly across formats.
- The **two-call audio pipeline** (Whisper for segments → LLM for
  events). Now mirrored in our `backend/ingestion/extractors/audio.py`.
- Image prompt structure inspiration (description / context / facts)
  → expanded into OBSERVED / NOT_VISIBLE / EVENTS.

**Explicitly didn't lift:**
- Their PDF-directly-to-vision approach. **Breaks our source-anchoring
  rule** — no canonical page text for the Fact Gate to substring
  against. We do pdfplumber-first + OCR fallback.
- Their lack of any verbatim-quote verification. They trust LLM
  citations; we don't.
- Their three operational presets (speed / balanced / quality). Adds
  config complexity; we prefer per-concern env overrides.
- FFmpeg dependency for everything. We only use ffmpeg for audio > 25 MB
  chunking; otherwise the upload bypasses it.

### E.5 Where Lumen is architecturally ahead

- **Source-anchored persistence.** Every Fact's `verbatim_quote` is
  substring-checked against `document_pages.extracted_text`. They don't
  verify, they trust.
- **Multi-table audit chain.** Their data shape is JSONL-on-disk;
  ours is normalized Postgres with `runs` + `transcript` + `decisions`
  + the `nodes`/`edges` graph.
- **Code-enforced harness.** 6 gates (Citation / Fact / Math /
  Consensus / Source-Alignment / Letter Reconciliation). They don't
  have an equivalent.
- **Dual adjudicator on different model families.** They use one
  adjudication LLM.

---

## 22. Appendix F — Next.js 16 + Tailwind v4 specific gotchas

### F.1 The "This is NOT the Next.js you know" warning

`frontend/AGENTS.md` carries an explicit warning baked in by
`create-next-app`:

```
This version has breaking changes — APIs, conventions, and file
structure may all differ from your training data. Read the relevant
guide in `node_modules/next/dist/docs/` before writing any code. Heed
deprecation notices.
```

I hit this real-time. Things that bit me:

### F.2 `params` is now a Promise in client components

```typescript
// OLD (training-data Next.js)
export default function CaseDetailPage({ params }: { params: { id: string } }) {
    const { id } = params;
    ...
}

// NEW (Next 16)
import { use } from "react";
export default function CaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    ...
}
```

Used in `app/cases/[id]/page.tsx`. If you forget `use()`, you get
TypeScript errors about Promise vs value.

### F.3 Rewrites docs live in `node_modules/next/dist/docs/`

The `rewrites()` config in `next.config.ts` works the same as before,
but the documentation site has moved. To find current syntax, read
`frontend/node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/rewrites.md`.

### F.4 Turbopack root warning

If both `frontend/pnpm-workspace.yaml` and root `pnpm-workspace.yaml`
exist, Next infers the wrong workspace root. Silenced by setting
`turbopack.root: __dirname` in `next.config.ts`.

### F.5 SSR fetch needs absolute URLs

Server components calling `fetch("/api/...")` with a relative URL fail
because there's no origin. Documented in §2.4. Helper: `apiUrl()` in
`frontend/lib/api.ts`.

### F.6 Tailwind v4 `@theme` is the new config

The classic `tailwind.config.ts` is gone. Design tokens are now in CSS:

```css
/* frontend/app/globals.css */
@theme {
  --color-bg: #080b14;
  --color-panel: #0e1422;
  --color-accent: #5b8cff;
  --color-agent-advocate: #5b9bff;
  ...
}
```

Utility classes are generated from the tokens automatically:
`bg-panel`, `text-accent`, `border-agent-advocate`, etc.

### F.7 Tailwind v4 arbitrary values still work

`rounded-[14px]` works. But Sudharsan's biome formatter prefers
token-based shorthands when available: `rounded-card`, `rounded-pill`,
`max-w-350`. Both forms are equivalent; the token form is just nicer.

### F.8 Biome replaced ESLint

`frontend/biome.json` is the new linter+formatter config. It auto-
formats and lints frontend code. Sudharsan switched the project to it
this session via `d72a946` "cleanup after latest pull". `eslint.config.mjs`
was deleted in that commit.

---

## 23. Appendix G — Probe outputs verbatim (the ALL GREEN milestones)

### G.1 Upload pipeline probe (after the B2 saga was fixed)

`.venv/bin/python -m scripts.probe_upload` output, 2026-06-18:

```
[1] POST /api/ingest/case
  ✓ case.id = d001ca1b-df1d-4c60-88fe-ef73ecddd035  case_id = PROBE-1781728442

[2] POST /api/ingest/sign-upload
  ✓ document.id = 8d6cbda9-76a1-4a03-b709-76a1da01db10
     storage_key   = cases/d001ca1b-…/db6874e6…-probe-upload.txt
     PUT https://s3.us-east-005.backblazeb2.com/lumen-case-files/cases/d001ca1b-…
     headers       = {'Content-Type': 'text/plain'}

[3] PUT bytes → B2 (browser-direct upload)
  ✓ B2 accepted: HTTP 200
     etag = "be941782b58af7cde3509c6f232ff5ef"

[4] POST /api/ingest/commit
  ✓ commit status = uploaded

[5] Poll GET /api/ingest/status/{case_id} until terminal
     02:04:10  status=uploaded  pages=None  retries=0  error=-
     02:04:13  status=extracting  pages=None  retries=0  error=-
     02:04:15  status=extracting  pages=None  retries=0  error=-
     02:04:18  status=extracted  pages=1  retries=0  error=-
  ✓ extracted in 3661 ms
  ✓ ingestion_complete = True

[6] Direct SELECT FROM document_pages
  ✓ page 1: char_count=267 textlen=267

══════ ALL GREEN — bytes in B2, rows in Supabase, worker extracted ══════
```

### G.2 Ledger build probe (against seeded Alex/Jordan case)

`.venv/bin/python -m scripts.probe_ledger` output:

```
Probing ledger build for case 574d61f9-6cee-4cf7-8d49-e4f98d24be38
  before: case_id='CLM-2026-0427' title='Alex Rivera vs Jordan Blake (seeded)'
          ing=True led=False
  nodes=0 edges=0

→ build_and_persist_ledger(case_uuid)
  ✓ result: nodes=20 edges=20 flipped=True valid=True

  after: led=True nodes=20 edges=20

  Sampled 6 Fact nodes:
    [F1] «Vehicle 2 (Blake) entered the intersection against a steady red signal…»
    [F2] «The silver car blew through the red, going maybe 50.…»
    [F3] «Vehicle 1 (Rivera), which had entered on a green signal…»
    [F4] «Vehicle 2 driver cited under CVC 21453 for failing to stop at a red si…»
    [F5] «speed 40 mph in a posted 35 mph zone…»
    [F6] «Total documented damages: $42,000…»

  Sampled 8 edges:
    E1     F1    --mentioned_in--> DOC1
    E10    F5    --attributed_to--> P1
    E11    F4    --corroborates--> F1
    E12    F2    --corroborates--> F1
    E13    EV1   --governed_by--> S1
    E14    EV1   --governed_by--> S2
    E15    EV1   --caused--> D1
    E16    EV1   --involves--> P1

══════ LEDGER BUILD VERIFIED ══════
```

### G.3 End-to-end ingestion → ledger handoff verification

Worker log after a fresh probe upload, post-stale-worker-kill:

```
22:14:54   extract_document  start    (a4827c79 — fresh probe upload)
22:14:54   extract_document  start    a4827c79-6289-4918-b86f-b2bd847784b5  (try 1/3)
22:15:01   extract_document  done     a4827c79 -> status=extracted page_count=1 try=1
22:15:01   ← extract_document ●       7.53s
22:15:02   → run_ledger_build         AUTO-TRIGGERED by maybe_finalize_ingestion → True
22:15:02   run_ledger_build  start    e074a900-029b-4394-9935-ba2fde1009d5 (try 1)
22:15:04   ledger build (mock fixture, anchors not checked vs uploads):
           20 nodes, 20 edges for case e074a900
22:15:23   ledger persisted for e074a900: 20 nodes, 20 edges, ledger_complete flipped=True
22:15:23   run_ledger_build  done     nodes=20 edges=20 flipped=True valid=True
22:15:23   ← run_ledger_build ●       21.40s
```

The 21.4s for run_ledger_build is the documented performance issue (40+
sequential `INSERT … RETURNING id` round-trips to ap-northeast-2).

### G.4 Final DB state after the handoff verification

```
e074a900  PROBE-1781801089   ing=True   led=True   nodes=20   edges=20
```

That row is the proof. **Upload → extract → handoff → build → persist
→ unlock** works end-to-end.

---

## 24. Appendix H — Tooling additions this session

Some by me, some by Sudharsan in his commits.

### H.1 Python dependencies (added to `requirements.txt`)

```
python-calamine>=0.4   # Rust-backed Excel extraction (extractors/excel.py)
ocrmypdf>=16.0         # OCR fallback for scanned PDFs (extractors/pdf.py)
                       #   needs system tesseract + ghostscript
httpx>=0.27            # Whisper + Claude vision API calls
                       #   (extractors/audio.py, image.py)
Pillow>=10.0           # image resize before sending to vision API
                       #   (extractors/image.py)
```

System dependencies (must be on PATH on the deployment host):

```
ffmpeg       # audio chunking when files > 25 MB (extractors/audio.py)
tesseract    # OCR engine inside ocrmypdf (extractors/pdf.py)
ghostscript  # PDF repack inside ocrmypdf (extractors/pdf.py)
```

All three already on this Mac via Homebrew.

### H.2 Frontend tooling (mostly Sudharsan)

```
biome              # replaces ESLint + Prettier; faster, single tool
                  # config: frontend/biome.json
fallow             # local code-audit gate run before commits/PRs
                  # config: fallow.toml at repo root
                  # invocation: `pnpx fallow audit --format json --quiet
                  #              --explain --gate-marker agent`
lefthook           # git hooks runner; wires fallow into pre-commit
                  # config: lefthook.yml at repo root
```

The `fallow` task map in root `AGENTS.md` defines specific commands for
specific situations (delete unused export, find feature flags, surface
security candidates, etc.) — read that table before destructive edits.

### H.3 Scripts added this session

```
scripts/probe_upload.py      # end-to-end upload + extraction smoke test
scripts/probe_ledger.py      # in-process ledger build verification
scripts/setup_b2_bucket.py   # idempotent bucket create + CORS configure
```

All under `scripts/`, runnable via `python -m scripts.<name>`.

### H.4 Pre-existing scripts (reference)

```
scripts/apply_migrations.py  # SQL migrations into Supabase
scripts/seed_synthetic.py    # load Alex/Jordan into Supabase
```

---

## 25. Appendix I — FAQ for new teammates

**Q: I just cloned. What's the fastest path to "running"?**

```bash
./run.sh setup        # builds .venv, installs Python deps
./run.sh dev          # FastAPI :8000 + arq worker + Next.js :3000

# In another terminal:
.venv/bin/python -m scripts.probe_upload   # verifies upload pipeline
```

Open `http://localhost:3000`. The Alex/Jordan and Loser demo cases run
the full debate in mock mode without any API keys.

**Q: Where do I add a new file format?**

1. Create `backend/ingestion/extractors/<name>.py` implementing the
   `Extractor` protocol (`mime_types: tuple, extract(bytes, filename)
   → ExtractedDocument`).
2. Register in `backend/ingestion/extractors/registry.py`.
3. Add MIME type to `frontend/lib/fileSupport.ts:SUPPORTED_MIME_TYPES`
   and the `mimeOf()` ext→MIME map.
4. Add extension to `frontend/components/UploadZone.tsx` accept attribute.
5. If the format isn't natively text, follow the **EVENTS extraction
   pattern** from §8 — produce a substring-anchorable EVENTS block in
   `extracted_text`.

**Q: How do I trigger a ledger build for a specific case?**

```python
import asyncio
from uuid import UUID
from backend.ingestion.queue import ExtractionQueue

async def main():
    q = ExtractionQueue()
    job_id = await q.enqueue_build_ledger(UUID("<case-uuid>"))
    print(f"enqueued {job_id}")
    await q.close()

asyncio.run(main())
```

Make sure the arq worker is running (`./run.sh worker`).

**Q: How do I trigger a real-case debate?**

```bash
curl -N http://localhost:8000/api/run/<case-uuid>
# Or in the browser:  http://localhost:3000/cases/<case-uuid> → "Open the room"
```

Case must have `ledger_complete=true` (returns 409 otherwise).

**Q: The arq worker isn't picking up new jobs.**

Almost always a stale worker. Restart:

```bash
pkill -f "arq backend.ingestion.worker"
./run.sh worker
```

Especially after editing `WorkerSettings.functions` — old workers don't
see new function names and silently fail jobs with "function not found"
buried in the Redis result payload.

**Q: How do I switch from mock to live mode?**

```bash
# Ensure these are set in backend/.env:
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-proj-...
GEMINI_API_KEY=...    # currently empty — needed for live ledger lane
LUMEN_MOCK=0

./run.sh dev
```

Without `GEMINI_API_KEY` the ledger lane's `build_ledger` will fail in
live mode (Evidence Aggregator + Adjudicator B + Verifier all use Gemini).

**Q: How do I view what's in the database right now?**

```bash
.venv/bin/python -c "
import asyncio, os
from pathlib import Path
from dotenv import load_dotenv
load_dotenv(Path('backend/.env'))
import asyncpg
async def m():
    c = await asyncpg.connect(os.environ['DATABASE_URL'], statement_cache_size=0)
    rows = await c.fetch('''
        select case_id, title, ingestion_complete, ledger_complete,
               (select count(*) from documents where case_id = cases.id) as docs,
               (select count(*) from nodes     where case_id = cases.id) as nodes
        from cases order by updated_at desc limit 10
    ''')
    for r in rows: print(dict(r))
    await c.close()
asyncio.run(m())
"
```

Or open Supabase Studio at
`https://supabase.com/dashboard/project/hxgavkoaswjcfqfjjfas`.

**Q: How do I read the raw audit log of a specific run?**

```sql
-- via psql or Supabase SQL editor
SELECT r.id, r.status, r.duration_ms,
       d.other_driver_fault_pct, d.recovery_usd, d.audit_hash,
       (SELECT count(*) FROM transcript WHERE run_id = r.id) AS postings
FROM runs r
LEFT JOIN decisions d ON d.run_id = r.id
WHERE r.case_id = '<case-uuid>'
ORDER BY r.started_at DESC;
```

**Q: What's the deal with Whisper vs gpt-4o-transcribe?**

`whisper-1` is the only OpenAI transcription model that emits
segment-level timestamps. We need segments because audio citations
resolve to (start_sec, end_sec) windows in the original recording.
`gpt-4o-transcribe` is more accurate text but no segments → audio
anchoring degrades. Stay on `whisper-1`. Env-overridable via
`LUMEN_AUDIO_MODEL`.

**Q: Why does the image prompt have three blocks not two?**

OBSERVED catches what's literally visible. NOT_VISIBLE catches what
isn't (lives in metadata only, deliberately omitted from page text so
Facts citing inside it are a regex-detectable harness violation).
EVENTS catches structured `[type]` bullets derived from OBSERVED, making
the ledger lane's job easier and giving the Fact Gate clean substring
targets. See §8.3.

**Q: What's the "Bus Tragedy" case and why is it stuck?**

A real PDF (SC TR310 Manual, 123 pages, 1.3 MB) uploaded by the user
before Gowtham's ingestion→ledger handoff code shipped. The handoff
only fires on the *transition* `ingestion_complete: false→true`. Since
the flag was already true when the trigger code landed, no ledger build
was enqueued. Fix: manually enqueue `run_ledger_build` for case UUID
`bd7bba9e-...` (see "How do I trigger a ledger build for a specific
case" above).

**Q: Why is the dev port 8000 not 3000?**

Next.js dev defaults to 3000. To avoid conflict, FastAPI is on 8000.
Next's rewrite in `next.config.ts` proxies `/api/*` from `:3000` →
`:8000` so the browser sees same-origin. **Do not revert
`PORT=8000` to `PORT=3000` in `backend/.env`** — that breaks the
proxy.

**Q: I see references to a "Supavisor pooler" host. What's that?**

Supabase retired the legacy `db.<project-ref>.supabase.co` direct host
for new projects. Our DATABASE_URL must use the Supavisor pooler:
`aws-1-ap-northeast-2.pooler.supabase.com`. Username has a dot suffix:
`postgres.<project-ref>`. Don't revert this either.

**Q: How do I run a single extractor for debugging?**

```python
from backend.ingestion.extractors.image import ImageExtractor
import os
os.environ['LUMEN_MOCK'] = '1'   # or unset for live mode

result = ImageExtractor().extract(
    open('test-image.jpg', 'rb').read(),
    filename='test-image.jpg',
)
print(result.pages[0].text[:300])
print(result.pages[0].metadata)
```

Works for any extractor (`AudioExtractor`, `ExcelExtractor`,
`PdfExtractor`, etc.).

**Q: How do I rotate compromised API keys (post-hackathon)?**

The user shared real keys in chat (OpenAI, Anthropic, Supabase
service-role, B2 application key, Upstash Redis token). **Rotate
everything post-hackathon.** Each provider has a key-revocation flow in
its dashboard. Then update `backend/.env`.

**Q: I'm seeing a 19-second pause on every ledger build. Is that
normal?**

Yes — it's the known performance issue. `LedgerWriteRepository.write_graph`
does one `INSERT … RETURNING id` per node in a sequential loop, ~40
round-trips to ap-northeast-2 at ~400-500ms each. Fix is batch insert
via `unnest($1::uuid[], ...)` — pattern is already used in
`IngestionRepository.insert_pages`. Open follow-up.

**Q: What does the user mean by "the harness"?**

The set of 6 code-enforced gates that protect the multi-agent debate
from hallucination and collusion:

1. **Citation Gate** — every argued point must cite ≥1 real fact ID or
   statute ID
2. **Fact Gate** — every Fact's verbatim_quote must substring-match its
   source document
3. **Math Gate** — adjudicator's stated % must follow from its own
   fault table (±10pp)
4. **Consensus Gate** — Adjudicator A and B must agree within 10pp
5. **Source-Alignment Verifier** — every cited claim must actually
   follow from its cited fact (the one agentic gate)
6. **Letter Reconciliation** — drafted letter must contain the decided
   % and $ amount

Five are pure code (Set.has, String.includes, arithmetic). One uses an
LLM (the Verifier) but its enforcement is mechanical (structured JSON
output drives escalation). **The harness is the most important
architectural decision in the project.** Don't soften it.

---

*End of trace. Next compile: when something significant changes that
isn't captured above. If you're updating, append to an appendix rather
than rewriting an earlier section — preserves the chronological audit.*
