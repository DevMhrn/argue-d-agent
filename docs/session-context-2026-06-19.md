# Lumen — Full Session Context (2026-06-19)

> **Read this to recover the full context of everything done in this
> session.** This is the raw, un-summarized record: every decision and
> *why*, every rejected path and *why not*, every learning, hypothesis,
> brainstorm, bug-hunt, and reasoning step. Built so a teammate (or any
> coding agent) reading this file alone can pick up where this session
> left off.
>
> Companion to: [`CONTEXT.md`](./CONTEXT.md) (the broader project
> verdicts), [`trace-image-audio-ingestion.md`](./trace-image-audio-ingestion.md)
> (the prior session's full trace), [`ingestion-flow.md`](./ingestion-flow.md)
> + [`extractor-deep-dive.md`](./extractor-deep-dive.md) (ingestion
> reference).
>
> Last compiled: 2026-06-19, hackathon deadline day.
> If you change a decision after this, append to §17 (Decision log)
> with the date and reasoning — don't silently overwrite history.

---

## 0. How to read this doc

Organized roughly chronologically by what happened in the session, but
cross-linked by topic. If you want a specific topic, jump to:

- §1 — The mission (Lumen, hackathon, deadline)
- §2 — Where this session started (post-/compact state)
- §3 — Architecture overview
- §4 — The 8 agents (cross-family Claude + GPT)
- §5 — The 6 gates of the verification harness
- §6 — The schema (10 tables)
- §7 — The storage split (B2 bytes + Postgres structure)
- §8 — Session work, block by block:
  - §8.1 — Per-MIME-class upload limits
  - §8.2 — CSV extractor end-to-end
  - §8.3 — Audio model decision (whisper-1 vs gpt-4o-transcribe)
  - §8.4 — Curated public-domain test files (21 URLs)
  - §8.5 — The live-run failure marathon + fixes:
    - §8.5.1 — Intake `damagesUsd: "not in evidence"` Pydantic crash
    - §8.5.2 — Schema audit + 8 coercers
    - §8.5.3 — Frontend seed-on-mount race
    - §8.5.4 — SSE heartbeat for long Claude/GPT awaits
    - §8.5.5 — Math-gate retry + graceful degradation
    - §8.5.6 — Drafter retry + template fallback
  - §8.6 — Merge of PR #2 (courtroom orchestration)
  - §8.7 — Design iteration work
- §9 — Hard rules / dos / don'ts (preserved from prior sessions +
  added this session)
- §10 — What's verified vs untested
- §11 — Known performance issues
- §12 — Future scope (post-hackathon)
- §13 — For the next person picking this up
- §14 — Rejected ideas with reasoning
- §15 — Verbatim user feedback (the load-bearing quotes)
- §16 — Files touched this session
- §17 — Decision log

If something in code disagrees with this doc, the code is canonical for
*behavior*; this doc is canonical for *reasoning*. Apply judgment, then
update one of them.

---

## 1. The mission

**Lumen** is an AI **insurance subrogation recovery** system. Subrogation
is when an insurer that paid its insured chases reimbursement from the
at-fault third party's insurer after a covered loss. Insurers leave an
estimated **$15–20 billion per year uncollected** because the work is
manual, document-heavy, and time-sensitive — only about 50% of
recoverable cases get pursued.

We're building Lumen for the **Band of Agents Hackathon** (lablab.ai,
powered by Band).

**Hackathon facts** (load-bearing constraints):
- Event: Band of Agents Hackathon, hosted by lablab.ai
- Dates: 2026-06-12 → **2026-06-19, 8:30 PM IST** (today)
- Hard rule: app must show **3+ unique, specialized agents actively
  communicating**. Must go beyond a chatbot, a single agent, or a
  straight A→B→C script.
- Judging criteria, in priority order:
  1. **Band as the coordination layer** — real handoffs, shared
     context, role specialization. *Biggest lever.*
  2. **Clarity** — a judge instantly gets the problem, the agent
     roles, what Band does, and the value.
  3. **Creative multi-agent collaboration** — beyond a simple
     chatbot.
- Submission artifacts: deployed prototype + ~3-min demo video +
  pitch deck. Code must be original + MIT-licensed.
- Prize pool: $10,000+. Partner prizes (AI/ML API, Featherless AI)
  no longer in scope for us.
- Our internal target: get the **1st prize at any cost** (user's
  exact words).

**The single sentence that captures the moat:** *It's not adjudication
(deciding whether to pay a claim) — it's subrogation recovery (clawing
money back from the at-fault party after paying), with a verification
harness rigorous enough that an insurer could trust it, and the honesty
to say when a case isn't worth chasing.*

**Two demo cases**:
- `CLM-2026-0427` (clean / "Rivera v. Blake"): red-light T-bone,
  other driver clearly at fault → 85% fault, $35,700 recovery,
  escalates to human review.
- `CLM-2026-0588` (loser / "Carter v. Lee" / "Mercer v. Hale"): our
  insured rear-ended a stopped car → 11% other-driver fault →
  $1,980 → outcome = **DECLINE** ("recommend closing the file").

The loser case is load-bearing. **A system that "wins" every case is
broken and a judge knows it.** Being able to say "it also tells you
when NOT to pursue" is a credibility win in Q&A.

---

## 2. Where this session started

The previous session ran out of context and was /compact-ed. The
session summary I inherited carried these load-bearing facts:

**What was working at session start:**
- Three-lane architecture in mock mode: ingestion (Aman), ledger
  (Gowtham/the user), orchestration (Sudharsan)
- Production Python backend at `backend/` with FastAPI + arq worker
  + asyncpg + Supabase Postgres + Backblaze B2 + Upstash Redis. All
  credentials in `backend/.env`.
- Original four-format extraction working: PDF (pdfplumber), DOCX
  (python-docx), HTML (BeautifulSoup), plain text
- 6-gate harness firing inside an 8-agent debate
- Three model families wired (Claude, Gemini, GPT) but Gemini's
  three slots had been repointed onto Claude/GPT due to no Gemini
  API key being available — so live runs use only Anthropic +
  OpenAI keys today
- Mock-first as the default — `LUMEN_MOCK=1` (or empty LLM keys)
  gives deterministic offline output
- Static frontend that served `clean`/`loser` demo cases but had no
  upload UI for real cases
- Persistence wired: `RunRepository` writes `runs`/`transcript`/
  `decisions` tables; `Room.post()` gains optional async persist
  sink that fires *before* the SSE callback (so reload reanimates
  exactly the live order); `asyncio.CancelledError` handler with
  `asyncio.shield` for cleanup on client disconnect; self-healing
  sweep marks `running` runs older than 180s as `failed (stale)`
- Five new extractors landed in prior session: markdown, Excel
  (python-calamine), audio (Whisper + ffmpeg chunking + Claude
  EVENTS pass), image (Claude vision three-block prompt with
  OBSERVED / NOT_VISIBLE / EVENTS), scanned-PDF OCR fallback
  (pdfplumber detects + ocrmypdf bakes text layer)
- Cross-format EVENTS pattern: every non-text source produces typed
  `[type]` event bullets in the substring-anchorable page text
- ingestion→ledger handoff wired: when ingestion atomically flips
  `ingestion_complete` via WHERE-guarded UPDATE, the winning worker
  enqueues `run_ledger_build` by job-name only (so ingestion never
  imports ledger code; the arq worker is the composition root)
- Real-case `/api/run/{uuid}` reconstructs ClaimInput + Statutes +
  EvidenceLedger from persisted rows via `load_run_inputs` and
  passes `ledger=` to `run_lumen`, which skips its own build step

**What was NOT yet working at session start:**
- One end-to-end DB-case debate had never been observed completing
  with all persistence writes
- The five new extractors had not been smoke-tested against real
  files
- The OCR fallback had not been invoked against a real scanned PDF
- No file size limits enforced per category — only a global 50 MB
  envelope
- No CSV support (CSV files would be rejected as "unsupported
  mime type")
- The Bus Tragedy case `bd7bba9e-…` was stuck at
  `ingestion_complete=true, ledger_complete=false` because it
  ingested before the handoff was wired
- No real curated test files on disk — only the canonical
  Rivera/Blake demo
- No live test against real Supabase from this build machine

**The user's recovery question at session start:** *"what do you
remember till now"* — basically asking me to verify the carry-over
was intact before we started touching anything. I re-read CONTEXT.md
+ ingestion-flow.md + the prior session-trace + product-context to
confirm the picture matched.

---

## 3. Architecture overview

### 3.1 Three lanes, three owners

Per `backend/README.md` and the DB schema, the pipeline is a
three-stage handoff. Each lane owns its tables and reads only
upstream ones. Boolean flags on `cases` are the cross-stage trigger.

| Lane | Owner | Writes | Reads | Triggered by |
|---|---|---|---|---|
| **Ingestion** | Aman | `documents`, `document_pages`, `cases.ingestion_complete` | uploaded files | new case |
| **Ledger** | Gowtham (the user) | `nodes`, `edges`, `cases.ledger_complete` | `documents`, `document_pages`, `statutes` | `ingestion_complete=true` |
| **Orchestration** | Sudharsan | `transcript`, `decisions`, `runs`, `cases.finalized` | `cases`, `nodes`, `edges`, `document_pages`, `statutes` | `ledger_complete=true` |

Lane boundary is enforced by code structure: ingestion never imports
ledger code. The arq worker is the composition root for both lanes
(it registers `extract_document` and `run_ledger_build` jobs).

### 3.2 The courtroom protocol (from PR #2)

Inside the orchestration lane, the run is structured as a **bounded
courtroom protocol** rather than a flat debate:

```
Docket → Opening briefs → Issue-level hearing
  (cross-exam + redirect per issue) → Adjudication →
    Math Gate → Consensus Gate → Source-Alignment Verifier →
      Drafting → Letter Reconciliation → Disposition
```

Each turn gets a **compact issue packet**, not the full transcript.
`backend/app/courtroom.py` defines `CourtIssue`, `CourtTurn`, and
`CourtroomPlan` Pydantic models, and `build_courtroom_plan(ledger,
statutes)` deterministically builds 2–4 issues from available facts:
primary_liability, comparative_fault, damages, legal_basis.

`backend/app/orchestration_tools.py` exposes `LedgerLookupTool` — a
read-only `search_ledger(query)` / `get_node(node_id)` /
`lookup_statute(id)` over the in-memory run state. Tokenized scoring
with synonyms (red/light/signal). No bash, no code-exec — deliberately
bounded.

Every posting carries **structured metadata**:

```python
metadata = {
    "phase": "opening_briefs" | "cross_examination" | "redirect" | ...,
    "actor_key": "advocate" | "opposing" | "adjudicator" | ...,
    "turn_type": "opening_brief" | "cross" | "redirect" | "handoff" | ...,
    "issue_key": "primary_liability" | "comparative_fault" | ...,
    "issue_title": "Primary liability",
    "target_actor_key": "advocate" | ...,
    "citations": ["F3", "CVC-21453"],
    "gate": {"name": "Citation Gate", "verdict": "passed" | "rejected" | "warning",
             "attempt": 1, "violations": [...]},
    "tool": {"name": "search_ledger", "query": "...", "result_ids": [...]},
}
```

The frontend reads this metadata to render phase chips, issue chips,
gate verdicts, tool-use rendering, etc.

### 3.3 Persistence flow per run

1. `api_run` POST → inserts a `runs` row with mode (`mock`/`live`)
   and status `running`
2. `make_room(case_id, on_post, persist=<async sink>)` — the room
   gains a persistence callback
3. Every `room.post()` writes a `transcript` row **before** the SSE
   `on_post` fires → frontend reload sees the same sequence as the
   live SSE
4. `run_lumen` returns → server computes the SHA-256 audit hash over
   the full transcript + decision + letter
5. `_persist_decision` writes one `decisions` row with fault_table
   as JSONB, secondary_decision as optional JSONB
6. `complete_run(run_id, status=…)` updates the `runs` row — status
   becomes `completed` / `escalated` / `failed`

If the client disconnects mid-run, `asyncio.CancelledError` is
caught and the run is marked `failed` via `asyncio.shield` so the
bookkeeping survives the task tear-down. A separate sweep in
`list_runs_for_case` flips any `running` row older than 180 seconds
to `failed (stale)` — covers process kills.

---

## 4. The 8 agents

Deliberate cross-family pairing for anti-collusion. The Advocate vs
Opposing pair and Adjudicator A vs B pair are **always cross-family**
(Claude vs GPT).

| # | Agent | Provider · model | Job |
|---|---|---|---|
| 1 | Intake Parser | OpenAI · `gpt-4o-mini` | Extract parties/date/location/damages from FNOL |
| 2 | Evidence Aggregator | OpenAI · `gpt-4o-mini` | Build the typed Evidence Ledger (JSON extraction, json_object mode) |
| 3 | Liability Advocate | Anthropic · `claude-opus-4-8` | Argue our insured is owed recovery (zealous counsel) |
| 4 | Opposing-Carrier Red Team | OpenAI · `gpt-4o` | Attack our case — a red team, never a negotiator |
| 5 | Adjudicator A | Anthropic · `claude-opus-4-8` | Neutrally set fault % + recovery, with the math |
| 6 | Adjudicator B | OpenAI · `gpt-4o` | Independent re-decision on a **different family** |
| 7 | Source-Alignment Verifier | Anthropic · `claude-sonnet-4-6` | Audit every cited claim actually follows from its fact |
| 8 | Demand Letter Drafter | Anthropic · `claude-sonnet-4-6` | Compose the formal subrogation demand letter |

4 Claude / 4 GPT. Model IDs are env-overridable (`MODEL_*`). The
Evidence Aggregator's provider/model also drives the ledger build
(see `backend/ledger/builder.py:64` — it routes through
`AGENTS["evidence"].provider/model`).

Live mode needs only `ANTHROPIC_API_KEY` + `OPENAI_API_KEY` today
(no Gemini). Demo stays mock by default.

---

## 5. The 6 gates of the verification harness

Every gate is **CODE, not a prompt** — a hard guarantee an LLM
cannot talk past. This depth is what separates Lumen from "adversarial
agents that cite stuff" (everyone has that; we have layered code
verification on top).

1. **Citation Gate** (`gates.py:check_points`) — every argued point
   must cite ≥1 real fact id (`F3`) or statute id (`CVC-21453`).
   Uncited/invalid → message rejected, agent retried once.
2. **Fact Gate** (`gates.py:check_ledger_anchoring`) — every Fact's
   `verbatim_quote` must be a contiguous substring of its source
   document text (whitespace/case-normalized). Anchors the ledger
   to real source text; without it the ledger is just an LLM summary.
   **This is the load-bearing invariant. Every new file format must
   produce a substring-anchorable text block.**
3. **Math Gate** (`gates.py:check_adjudicator_math`) — independently
   recomputes the fault % implied by the adjudicator's own fault
   table; rejects if it disagrees by >10pp. LLMs are unreliable at
   arithmetic; this catches table/percentage inconsistency.
4. **Consensus Gate** (in `pipeline.py:_compute_consensus`) — **dual
   adjudicator** on different families decide independently; if they
   disagree by >10pp it **forces human review**; if one fails its
   math gate, use the other at 0.8× confidence; if both fail, use
   the smaller-delta one at 0.5× confidence and force escalation
   (this last branch was added this session — see §8.5.5).
5. **Source-Alignment Verifier** (`verifier.py`) — for each (claim,
   fact) pair, an agent checks whether the claim actually *follows*
   from the fact: `supported` / `contradicted` / `overreach` /
   `neutral`. Catches "cited but misrepresented" — the biggest
   semantic hole the Citation Gate can't see.
6. **Letter Reconciliation** (in `pipeline.py:_reconcile_letter`) —
   the drafted demand letter must contain the decided fault % and
   recovery amount. Catches the worst case where the dashboard says
   one number and the letter says another.

Plus a **SHA-256 audit hash** of the full transcript + decision +
letter (tamper-evident; matches/exceeds Recourse's "defensible by
design" claim).

---

## 6. The schema (10 tables)

Single Supabase/Postgres schema, `backend/db/migrations/001_initial.sql`,
mirrored by Pydantic models in `backend/schemas/`. **The schema is the
cross-lane contract.**

- **`cases`** — one row per case; `case_id` (human id like
  `CLM-2026-0427`), jurisdiction, damages, the three handoff flags
  `ingestion_complete` / `ledger_complete` / `finalized`. Unique on
  `(tenant_id, case_id)`; `tenant_id` defaults to a demo UUID.
- **`runs`** — one row per pipeline execution: `mode` (mock/live),
  `status` (running/completed/failed/escalated), timings, error.
  `transcript` and `decisions` FK to it.
- **`documents`** / **`document_pages`** — uploaded files
  (content-addressed by SHA-256, raw bytes in B2) and their
  extracted text per page. A GIN full-text index on `extracted_text`
  gives Postgres-native keyword search (the "grep without
  embeddings").
- **`statutes`** — public legal text the Citation Gate validates
  statute citations against (e.g., `CA-1431.2`, `CVC-21453`,
  `CVC-21703`).
- **`nodes`** — the Evidence Ledger as a typed graph:
  `Fact`/`Party`/`Vehicle`/`Event`/`Location`/`Statute`/`Damage`/
  `Document`. Fact nodes carry `verbatim_quote` +
  `(source_document_id, source_page_number)` — the Fact-Gate anchor.
  `node_id` is the display id (`F1`, `P1`…), unique per case.
- **`edges`** — typed relationships: `mentioned_in`, `corroborates`,
  `contradicts`, `attributed_to`, `governed_by`, `caused`,
  `involves`, `occurred_at`, `drives`.
- **`transcript`** — Band-room postings per run (`(run_id, seq)`
  ordering, carries the structured `metadata` from §3.2).
- **`decisions`** — the FinalDecision per run (`fault_table` as
  jsonb, `secondary_decision` for Adjudicator B).

**Conventions:** UUID PKs; CHECK constraints over enums; cascade
deletes parent→child except `nodes.source_document_id` (SET NULL —
preserve historical facts).

**Intentionally NOT in the schema:** embeddings/pgvector,
`document_chunks`, multi-tenant RLS, soft-deletes.

---

## 7. Storage split (B2 + Postgres)

Raw bytes in **Backblaze B2** at `cases/<case_id>/<sha256>-<filename>`.
All derived structure in Supabase Postgres.

**Key naming convention** (`cases/<case_id>/<sha256>-<filename>`)
gives us:
- Files of the same case live in the same folder
- SHA-256 prefix makes uploads idempotent (same file twice = same
  key, no duplicate storage)
- Original filename preserved (a human downloading later sees
  `police_report.pdf`, not `a7f3e9c2.pdf`)

**Upload flow** (deliberate two-phase):
1. Browser computes SHA-256 of bytes (`crypto.subtle.digest`)
2. POST `/api/ingest/sign-upload` → backend creates `documents` row
   (status=`pending`), returns a **pre-signed PUT URL** (NOT POST
   policy — B2 returns 501 NotImplemented for POST policies; that
   bug bit us in the prior session and is permanently fixed)
3. Browser PUT bytes directly to B2 — **backend is out of the
   upload path** (avoids chewing through bandwidth/memory for nothing)
4. POST `/api/ingest/commit` → backend HEAD-checks the object, flips
   status to `uploaded`, enqueues `extract_document` arq job
5. arq worker picks up the job → routes by MIME → extractor produces
   `document_pages` rows → status flips to `extracted`
6. `maybe_finalize_ingestion` race-safely flips
   `cases.ingestion_complete=true` IFF every doc is `extracted` —
   only the winning worker gets `True` and enqueues `run_ledger_build`

**B2 CORS** is set for localhost via `scripts/setup_b2_bucket.py`
(idempotent: creates bucket if missing + sets CORS). Required because
browser PUT to a different-origin host triggers a CORS preflight.

---

## 8. Session work, block by block

This is the chronological log of everything done this session.

### 8.1 — Per-MIME-class upload limits

**The user's concern:** "the documents for subrogation, will the all
files exceed 10 MB?" — wanted to confirm what realistic file sizes
are before committing to a cap.

**Research finding** (one-agent web research, lablab + industry
sources):
- **Arbitration Forums** (the dominant inter-carrier subrogation
  arbitrator) raised its per-file evidence cap from 20 MB to
  **40 MB in May 2025**. Industry-set floor.
- Federal courts (CACD, WAWD) run 35–100 MB per document via CM/ECF.
- **Medical records** are the real edge case — full charts run
  50–200 MB+ (1,500–2,000 pages of scanned-image PDF).
- Everything else (police reports, demand letters, repair estimates,
  Excel ledgers, witness statements, EDR readouts) is well under
  10 MB.

**The user picked, after deliberation**:
- **Documents** (PDF, DOCX, XLSX, CSV, HTML, MD, TXT): **10 MB
  each, max 50 files/case** — combined bucket, NOT per-format
- **Images** (JPEG, PNG, WebP, GIF): **10 MB each, max 15/case**
- **Audio** (MP3, MP4, M4A, WAV, WebM): **50 MB each, max 10/case**

Worst-case per case: 500 MB docs + 150 MB images + 500 MB audio =
**1.15 GB across 75 files**.

The user explicitly confirmed: "for documents the total should be 50
that's it not for individual count, that will cause a huge dump". So
the count is **combined across all 7 document MIMEs**, not 50 per
format. (Verified the implementation matched this with a smoke test
that constructed a case with 20 PDFs + 15 XLSX + 10 CSV + 6 MD = 51
documents → 51st rejected.)

**Implementation** (single source of truth):
- `backend/ingestion/limits.py` (new file) — dataclass per category
  (`DOCUMENT`, `IMAGE`, `AUDIO`), each with `max_bytes` and
  `max_files_per_case`. `classify(mime_type)` returns the
  `CategoryLimits` singleton or None. `MAX_SIZE_BYTES = 50 MB` is
  the outer envelope (= the audio cap, the largest).
- `backend/ingestion/routes.py` — `PrepareUploadRequest.size` uses
  `le=MAX_SIZE_BYTES` instead of the hard-coded 50 MB literal
- `backend/ingestion/service.py` — `prepare_upload` runs
  `classify()`, rejects oversized files with a specific message
  (e.g., "Document files are capped at 10 MB (this one is 17.3 MB)"),
  counts existing same-class documents (ignoring duplicates by SHA
  so re-uploads stay idempotent), rejects if cap hit
- `frontend/lib/fileSupport.ts` — mirror of the Python limits:
  `LIMITS` constant + `classify()` + widened `partitionSupportedFiles`
  that returns structured `FileRejection` items with `reason: "mime"
  | "size" | "count"` and per-file friendly messages
- `frontend/lib/useCaseUpload.ts` — pre-validates before SHA-hashing,
  tracks in-session counts, accepts `existingCountsByCategory` from
  caller so server-side docs count toward the budget
- `frontend/components/DocumentsPanel.tsx` — passes
  `existingCountsByCategory` derived from server document list, so
  the "add more evidence" zone on an already-populated case enforces
  remaining headroom
- `frontend/components/UploadZone.tsx` — help text reads limits
  dynamically: "Documents up to 10 MB · max 50/case · Images up to
  10 MB · max 15/case · Audio up to 50 MB · max 10/case"

**Defense in depth:** Frontend pre-validates for instant feedback;
backend re-validates as the authoritative truth (a malformed request
bypassing the frontend still gets a clear 400).

**Re-uploads idempotent:** same SHA-256 doesn't double-count toward
the cap. If the user retries an upload, no slot burned.

### 8.2 — CSV extractor end-to-end

**The user's request:** "also add support for the csv's also, and
handle all the cases correctly and efficiently, from end to end".

**Why dedicated extractor, not routed through TextExtractor:**
- CSVs with unquoted commas in cell values create ambiguous row
  boundaries when an LLM reads the raw text
- Windows-CP1252 / UTF-16 / BOM-encoded files would have crashed
  plain-text decode

**Implementation** (`backend/ingestion/extractors/csv.py`, new file,
stdlib-only — no new dependency):
- Encoding fallback chain: `utf-8-sig` → `utf-8` → `utf-16` →
  `cp1252` → `latin-1` (last one never errors)
- Delimiter sniffing across `,;\t|` (comma, semicolon for EU
  locales, tab, pipe for legal/insurance exports)
- Header detection via `csv.Sniffer.has_header()`
- TSV rendering with head+tail truncation at 600 rows (matches
  Excel extractor's contract so the downstream ledger sees identical
  shape for a CSV and a single-sheet workbook)
- Cell cleaning: tabs/newlines → space (preserves TSV row boundary)
- One CSV → one `ExtractedPage` with `source_location: "csv:<filename>"`,
  `extraction_method: "csv"`, plus encoding/delimiter/has_header/
  row_count/truncated metadata

**Registered everywhere**:
- `backend/ingestion/extractors/registry.py` — `CsvExtractor()`
  added to `_REGISTRY`
- `backend/ingestion/limits.py` — `text/csv`, `application/csv`
  added to `DOCUMENT_MIME_TYPES`
- `frontend/lib/fileSupport.ts` — mirrored in `DOCUMENT_MIME`; `csv`
  and `tsv` added to the `mimeOf()` extension map (browsers sometimes
  leave `File.type` blank on `.csv`)
- `frontend/components/UploadZone.tsx` — `.csv,.tsv,text/csv` added
  to the `accept` attribute

**Verified against 12 messy real-world cases** (smoke test in
session):
1. UTF-8 comma with quoted dollar amounts ✓
2. EU locale semicolon-delimited ✓
3. UTF-8 BOM ✓ (encoding `utf-8-sig`)
4. Windows-1252 with smart quotes ✓
5. Empty file ✓ (returns one page with `(empty file)` marker)
6. Embedded newline inside quoted field ✓ (stripped to space)
7. Tab inside quoted cell ✓ (stripped to space)
8. Single-column file with no delimiter to sniff ✓ (falls back to
   comma)
9. 1,000-row file ✓ (truncated: head 500 + tail 100 + "400 rows
   omitted" marker)
10. Registry dispatch ✓
11. Classify as document ✓
12. Pipe-delimited (legal/insurance exports) ✓

**What I deliberately did NOT do:**
- No `application/vnd.ms-excel` MIME registration on the CSV
  extractor — that MIME also resolves to `.xls` binary files
  (which we don't support), and accepting it would silently
  mis-route binary `.xls` uploads through the CSV path and produce
  garbage. Users save Excel files as `.csv` (which sets `text/csv`)
  to trigger this path.

### 8.3 — Audio model decision (whisper-1 kept)

**The user's question:** "for the audio extractor and all, we will
be using this model — gpt-4o-transcribe what do you think?"

**The trade-off I surfaced:**
- `whisper-1`: classic, has segment timestamps via `verbose_json`,
  $0.006/min
- `gpt-4o-transcribe`: ~10–15% better word-error-rate but **no
  segment timestamps**, $0.006/min

**Why segments matter** (load-bearing):
1. `metadata.segments` keys "click to play this clip" UI on Fact
   cards. Without segments you can't resolve a quote to
   `(start_sec, end_sec)` of the original recording.
2. The EVENTS block format `[00:00:12] [admission] Vehicle 2 driver
   admits running the red` requires segment start markers. Without
   them, EVENTS bullets become time-less.
3. `source_location` degrades from `"00:00–00:36 in dispatch.mp3"`
   to a generic `"audio:dispatch.mp3"` — same shape as any other
   file pointer; the audio-specific time window vanishes.
4. The most visceral demo moment — "the agent cited a 6-second
   window of a 45-minute call" — disappears.

**My recommendation:** keep whisper-1 as the default. The transcript
text isn't the agent's input — the *EVENTS bullets* are. The
Sonnet-4.6 events-extraction pass already smooths the somewhat
garbled raw transcript into typed citation-friendly bullets.

**The user accepted.** The `LUMEN_AUDIO_MODEL` env override is in
place if you want to A/B post-hackathon
(`LUMEN_AUDIO_MODEL=gpt-4o-transcribe` flips the default,
accepting loss of segments).

### 8.4 — Curated public-domain test files

**The user's request:** "we need to test the system, find me real
downloadable subrogation evidence files".

Research found **21 verified, directly-downloadable files** across
seven formats, all under the per-class caps:

**Audio (5 × MP3, all Archive.org public-records collections):**
- Kathy White 911 call (566 KB)
- I-40 school-bus chase 911 (268 KB)
- Citizen-app collision report (158 KB)
- Stockton PD pursuit 2009 (5.1 MB)
- San Joaquin SO pursuit 2011 (651 KB)

**Images (6 × JPEG, Wikimedia Commons):**
- Tesla Model X rear-end damage (774 KB, CC BY 4.0)
- Moscow rear-end intersection (2.7 MB, CC0)
- Rock Quarry Road two-car (6.4 MB, CC BY 2.0)
- Kent Police scene (2.4 MB, CC BY 2.0)
- Italian rollover (1.2 MB, CC BY-SA 3.0)
- Generic car accident (913 KB, CC BY 3.0)

**Excel (3 × XLSX, FHWA Highway Statistics 2022, US gov public domain):**
- State vehicle registrations (31 KB, 1 sheet)
- Driver licenses by gender (66 KB, **3 sheets** — exercises
  multi-sheet)
- Driver-vehicles cross-tab (46 KB, 2 sheets)

**CSV (2):**
- NY DFS auto-insurance complaints (~177 KB — contains NAIC IDs,
  premium volumes, complaint counts per carrier; genuinely useful
  subrogation reference data)
- Oregon workers-comp cycle times (~5 KB)

**PDF (3):**
- NTSB Highway Accident Report HAR-21-02 (3.85 MB, real federal
  investigation)
- California SR-1 accident report form (446 KB)
- New York MV-104 accident report form (278 KB)

**DOCX (1):**
- California Courts sample stop-payment demand letter (16 KB) —
  structurally identical to a subrogation demand letter

**HTML (1):**
- Cornell Law School Wex entry on subrogation doctrine (26 KB) —
  useful as a citation-gate source

**Markdown (1, hand-authored):**
- `data/test-files/md/01-case-notes-example.md` — realistic
  adjuster's case-notes stub for Rivera v. Blake

**Total:** 22 files, ~25 MB on disk, all sub-10 MB except one (6.4
MB image, still inside cap). Fits inside a single case (5 audio /
6 images / 11 documents — well inside per-case caps of 10/15/50).

Fetch script: `scripts/fetch_test_files.sh` (idempotent — skips
files that already exist). Provenance + license table:
`data/test-files/README.md`.

**Gaps the research surfaced:**
1. **Texas CR-3 not publicly downloadable** — TxDOT restricts to
   law enforcement. Substituted with NY MV-104.
2. **Real CCC/Mitchell repair estimate XLSX** — none are public.
   The FHWA files exercise multi-sheet extraction but aren't shaped
   like a repair estimate.
3. **NTSB cockpit/dispatch audio** — NTSB policy is no public
   release. Archive.org police-scanner files substituted (closer
   to what a real subrogation desk receives anyway).

### 8.5 — The live-run failure marathon + fixes

The user uploaded all 21 files to a fresh case and clicked "Open the
room". This kicked off a sequence of progressive failures, each
revealing a different real bug. Six fixes in sequence — every fix
correct at the time, every next failure a different layer.

#### 8.5.1 — Intake `damagesUsd: "not in evidence"` Pydantic crash

**First run (`d3fa7aa3`, 9.8s):**
```
ValidationError: 1 validation error for Intake
damagesUsd
  Input should be a valid number, unable to parse string as a
  number [input_value='not in evidence']
```

**Root cause:** The Intake Parser (gpt-4o-mini) was asked to extract
`damagesUsd` from the 21 uploaded files. None of them contain any
dollar amount — they're FHWA driver-license statistics, an NTSB
highway-safety report, a Wikimedia crash-scene photo, a 911 dispatch
call. So the agent **correctly refused to hallucinate** and returned
the literal string `"not in evidence"`. The Pydantic schema required
a `float`, the string failed validation, the run died.

**The agent was doing the right thing.** Our schema was punishing
correct refusal-to-hallucinate behavior. That's a bug in the schema,
not the agent.

**Fix:**
1. `backend/app/types.py` — `Intake.damagesUsd: Optional[float] =
   None` with a `@field_validator(mode="before")` that coerces
   `"not in evidence" / "unknown" / "n/a" / "null" / ""`
   (case-insensitive) to `None`. Garbage strings like `"forty
   thousand"` still correctly error.
2. `backend/app/prompts.py` — Intake prompt updated:
   `"damagesUsd": number | null` — return `null` if not in
   documents, not a string.
3. `backend/app/pipeline.py` — when the agent returns `None`,
   display falls back to `claim.damagesUsd` (the authoritative
   case-level figure stored in `cases.damages_usd`).

Smoke-tested 8 cases including the failing one + the canonical
mock paths — all green.

#### 8.5.2 — Schema audit (8 coercers)

After the Intake fix, the user pushed: "now check for others like
these, if it is an issue, cause everytime your said it is ookay and
okay and okay". A real audit was needed — same shape of bug could
be lurking on other LLM-output Pydantic fields.

**The general pattern:** Schema is strict; LLM is fuzzy; one
defensible-but-strict-violating response kills the run.

**Found and fixed (8 coercers in `types.py`):**

| Field | Before | After |
|---|---|---|
| `Fact.confidence` | strict 0–1 float | coerces `85` (0-100 scale) → `0.85`; `"high"` → `0.9`; `"medium"` → `0.6` |
| `Decision.confidence` | same | same coercion |
| `Decision.otherDriverFaultPct` | strict 0–100 float | coerces `"85%"` (with `%`); `0.85` (fraction → 85.0); `"approximately 85"` (qualifier stripped) |
| `FaultRow.favors` | `Literal["us","them","neutral"]` | maps `"ours"` → `us`; `"theirs"` / `"tortfeasor"` / `"at-fault"` → `them`; `"neither"` / `"tie"` → `neutral`; **unknown defaults to `neutral`** (math-neutral) |
| `FaultRow.weight` | strict float | semantic words (`"moderate"` → 0.6); 0-100 scale fixed |
| `RebuttalItem.stance` | `Literal["rebut","concede"]` | maps `"Rebutted"` / `"REJECT"` → `rebut`; `"I agree"` / `"accept the point"` → `concede`; **unknown defaults to `rebut`** (Advocate's primary job) |
| `AlignmentResult.alignment` | `Literal["supported","contradicted","overreach","neutral"]` | maps synonyms (`"contradicts"` / `"exaggerates"` / `"silent on this"`); **unknown defaults to `neutral`** (informational only, doesn't shift escalation) |
| `Intake.parties.insured`/`date`/`location` | strict str | `None` / empty / `"null"` → `"not in evidence"` sentinel |
| `Point.citations` | required list | `default_factory=list` so missing field doesn't crash |

**Beyond schema — runtime paths:**
- `_produce_points` / `_produce_rebuttal` / Intake call now wrap
  parse in try/except: parse failure → retry with explicit
  "your response wasn't JSON" reminder; final fallback returns
  empty points / empty Rebuttal / minimal Intake from `ClaimInput`
- `_safe_json` itself unchanged (used in 6+ places; widening its
  semantics would have unsafe blast radius)

**The Math Gate is NOT relaxed.** It still rejects internally
inconsistent fault tables. Relaxing it would break the harness's
central technical moat. The schema fix only stops a *valid* output
from being rejected because of trivial format variation.

**Honest-audit reasoning for each coercer's fallback choice:**
- `neutral` for favors and alignment → contributes 0 to either side
  of the math computation, safest unknown bucket
- `rebut` for stance → Advocate's primary job is to defend, so
  misclassified row is safest as a rebuttal that the Verifier can
  audit downstream
- Confidence/weight fallback to `0.5` → hedged "I don't know"
  signal that the escalation path picks up (`confidence < 0.6 →
  escalate`)

**Regression check:** replayed every mock case through every new
schema → all parse cleanly. Math gate w/ a coerced "banana"→"neutral"
row still computes correctly. Pipeline imports clean. End-to-end
mock pipeline produces canonical `85% / $35,700 / escalate` for
clean case and `11% / $1,980 / decline` for loser case — byte-identical
to pre-audit.

#### 8.5.3 — Frontend seed-on-mount race

**Second run (`6f617d29`, 8.5s):**
```
status: failed
error_message: cancelled (client disconnected)
```

Only seq=1 ("Claim opened…") persisted. Run never got past Intake.

**Diagnosis:** The case `1ef35b9d` had a prior failed run (`d3fa7aa3`
from the §8.5.1 crash). On page mount, the second useEffect in
`frontend/app/cases/[id]/page.tsx` fires `listRunsForCase` +
`getRunReplay` to **replay the prior failed run**. Those two HTTP
calls take ~2–8s combined (the runs list endpoint runs the
stale-run sweep + Supabase round-trip from laptop is slow). When
they finally complete, `seed()` is called — which **unconditionally
closes `sourceRef.current`**. If the user clicked "Open the room"
while those calls were still in flight, the seed completes AFTER
the SSE opened and shuts down the live stream.

The 8.5s timing matches exactly:
- t=0: click "Open the room" → SSE opens, seq=1 posts (~100ms)
- t=0–8.5s: pipeline awaits OpenAI Intake call
- t=~8s: second useEffect's API chain finally finishes → `seed()`
  fires → `sourceRef.current?.close()` → backend sees client
  disconnect → `asyncio.CancelledError` → run marked failed

**The pattern:** every case with a prior failed run would have this
race on the next click.

**Fix:** `frontend/lib/useRunStream.ts` — make `seed()` a no-op if
an SSE is already active.

```typescript
const seed = (input: {...}) => {
  if (sourceRef.current) return;  // ← the fix
  dispatch({ type: "seed", ... });
};
```

If the user clicks "Open the room" first, the SSE opens →
`sourceRef.current` is set → seed's async work eventually finishes
→ seed sees the active SSE and silently skips → SSE keeps streaming.

#### 8.5.4 — SSE heartbeat for long Claude/GPT awaits

**Third run (`4e4007ea`, 83s):**
```
status: failed
error_message: cancelled (client disconnected)
```

But this time the transcript had **15 rows persisted** — the run got
all the way past the Consensus Gate (seq 15 = "Only Adjudicator B
passed math gate; using 42.86% with reduced confidence"). The decision
was never persisted because `run_lumen` was cancelled mid-await on
the Source-Alignment Verifier's Claude call.

**Diagnosis:**
```python
async def stream():
    yield _sse("start", {...})
    task = asyncio.create_task(drive())
    try:
        while True:
            item = await queue.get()        # ← idle here during agent calls
            ...
    finally:
        if not task.done():
            task.cancel()                    # ← fires CancelledError on drive()
```

Between every two postings, the pipeline awaits one LLM call.
During that await, **zero bytes flow through the SSE**. Intermediate
proxies (the Next.js dev rewrite proxy, nginx, cloudflare, etc.)
treat idle SSE upstream sockets as dead connections and close them.
The Verifier call has a particularly large prompt (full evidence
context + ~14 verifier tasks), so its idle gap is the longest —
that's why this was the first run that made it deep enough to hit
the issue.

**Side observation worth keeping:** transcript seq 12 shows
"Adjudicator A REJECTED — Math gate: fault table implies 95% but
Adjudicator stated 42.0% (delta 53.0pp)". The harness was working
**as designed** — Adjudicator A (Claude Opus) produced an internally
inconsistent decision, the Math Gate caught it, Consensus fell back
to B alone with reduced confidence. This is the "the gates aren't
decoration" demo moment, captured live. Worth pointing at during
the pitch.

**Fix:** `backend/app/server.py` — wrap `queue.get()` in
`asyncio.wait_for(..., timeout=15.0)`. On timeout, yield the SSE
comment `: heartbeat\n\n` and loop.

```python
HEARTBEAT_INTERVAL = 15.0

async def stream():
    yield _sse("start", {...})
    task = asyncio.create_task(drive())
    try:
        while True:
            try:
                item = await asyncio.wait_for(queue.get(), timeout=HEARTBEAT_INTERVAL)
            except asyncio.TimeoutError:
                yield ": heartbeat\n\n"
                continue
            if item is None: break
            event, data = item
            yield _sse(event, data)
    finally:
        if not task.done(): task.cancel()
```

EventSource ignores comment lines client-side, but the bytes count as
traffic for any intermediate proxy. 15s is well under typical proxy
idle timeouts (30–60s). During a 30–60s Claude call, the connection
sees a heartbeat every 15s and stays alive.

**The fix is the standard, decades-old way to keep SSE alive through
proxies.** Doesn't touch the pipeline, doesn't change the API contract,
existing happy-path mock pipeline still produces `85% / $35,700 /
escalate` (verified in session).

#### 8.5.5 — Math-gate retry + graceful degradation

**Fourth run (07:09, 52s):**
```
status: failed
error_message: RuntimeError: Both adjudicators failed; cannot
proceed without a decision.
```

**Diagnosis:** Both Claude Opus (Adjudicator A) AND GPT-4o
(Adjudicator B) produced fault tables whose row weights don't sum
to their stated percentages. Math Gate correctly rejected both. With
no usable adjudicator, `_compute_consensus` returned `None`, and the
pipeline's `raise RuntimeError("Both adjudicators failed; cannot
proceed")` killed the run.

**Why this is a real LLM problem, not Lumen-specific:** Computing
`sum(weights favoring us) / total × 100` is *arithmetic*. LLMs are
unreliable at arithmetic without scratch space. The prompt asks for
both the table AND the percentage in one shot, so the model:
1. Lists facts with intuitive importance weights (system 1 — fast,
   qualitative)
2. States an overall percentage based on a gut read of liability
   (system 1 — fast, holistic)
3. **Never actually does the arithmetic** to check the two agree

Same reason GPT-4 used to confidently say `27 × 41 = 1117` (correct
answer is 1107). The Math Gate is **the code that catches the math
the LLM didn't bother to do**.

**The harness was working too hard — catching real LLM errors but
then refusing to proceed at all.** For a hackathon demo, that's the
worst outcome: agents debated, gates fired, run died with no output.
Product behavior should be **"both math gates failed → escalate to
human with best-effort estimate"**, not crash.

**Two fixes in `backend/app/pipeline.py`:**

1. **Math-gate retry per failing adjudicator, in parallel.** Pattern
   from the Citation Gate retry: explicit delta feedback in the retry
   prompt:
   ```python
   def _retry_prompt(math_result: MathGateResult) -> str:
       return (
           f"{adj_prompt}\n\nYour previous response failed the math gate:"
           f" your fault table weights imply {math_result.computed_pct}%"
           f" but you stated {math_result.stated_pct}% — a"
           f" {math_result.delta}pp disagreement (tolerance"
           f" {CONSENSUS_TOLERANCE_PP}pp). Reconcile them: EITHER adjust"
           f" the row weights so the implied % matches your stated %, OR"
           f" change your stated % to match the table. Return the same JSON"
           f" shape, no prose."
       )
   ```
   Parallel `asyncio.gather` so it costs at most one extra round-trip.

2. **Graceful degradation when both still fail math after retry.**
   New `both_math_failed` branch in the Consensus stage:
   ```python
   if consensus is None and both_math_failed:
       candidates = [(math_a.delta, dec_a, "A", math_a),
                     (math_b.delta, dec_b, "B", math_b)]
       candidates.sort(key=lambda x: x[0])
       best_delta, best_dec, best_slot, best_math = candidates[0]
       canonical = best_dec.model_copy(update={
           "confidence": best_dec.confidence * 0.5,
           "reasoning": (
               f"[BOTH ADJUDICATORS FAILED MATH GATE after retry —"
               f" using Adjudicator {best_slot} at half confidence]"
               f" {best_dec.reasoning}"
           ),
       })
       consensus = ConsensusResult(canonical, None, "single", 0)
       # Force-escalate post fires; run completes with outcome=escalate
   elif consensus is None:
       # Both unparseable (not math fail) — still raise, but only here
       raise RuntimeError(
           "Both adjudicators failed to return a parseable decision;"
           " cannot proceed."
       )
   ```

**Verified in session** by forcing both math-fail end-to-end with
patched `_ask`: run completes with `outcome=escalate`, `confidence=
0.425`, all five reasons surfaced in `escalateReasons`. The
"BOTH adjudicators failed math gate after retry... Using Adjudicator
B (smaller delta 27.0pp) at HALF confidence" gate post fires.

#### 8.5.6 — Drafter retry + template fallback

**The honest audit ("are there others like this?"):** I audited
every LLM call site in `pipeline.py` for SPOF.

| Site | Protection | Risk |
|---|---|---|
| Intake | retry + fallback | ✅ Fixed §8.5.1 |
| Evidence Aggregator inline (USE_LEDGER_LANE=0) | none | Low — not default |
| Advocate / Opposing / Rebuttal | retry + empty fallback | ✅ Fixed §8.5.2 |
| Adjudicator A / B | parse-fail→None, math retry, degrade | ✅ Fixed §8.5.5 |
| Verifier | retry + None fallback | ✅ Already there |
| **Drafter (step 8/8)** | **none — single Claude call, no retry, no fallback** | ❌ **last SPOF** |
| Build_ledger Evidence | arq retries 3× | ✅ Adequate |

**The Drafter was the last unprotected call.** After 60+ seconds of
successful pipeline work, one Claude API hiccup on step 8/8 could
kill the whole run.

**Fix:**

```python
# 8) Demand letter — retry + deterministic template fallback
drafter_user = f"{context}\n\nDecision: ..."
letter: str | None = None
for attempt in (1, 2):
    try:
        letter = _parse_letter(await _ask(AGENTS["drafter"],
                                           drafter_user,
                                           f"drafter#{attempt}" if attempt > 1 else "drafter"))
        if letter and letter.strip(): break
        letter = None
    except Exception as e:
        if attempt == 2:
            await room.post(LETTER_GATE, 214, "gate",
                            f"Drafter call failed ({type(e).__name__});"
                            f" using template fallback so the packet is"
                            f" still produced.")
if not letter:
    letter = _fallback_letter(claim, canonical, recovery_usd, ledger)
```

Plus `_fallback_letter()` — a deterministic minimal demand-letter
template embedding the canonical fault % and recovery $ verbatim so
**Letter Reconciliation passes by construction**:

```
[TEMPLATE FALLBACK — automated Drafter call failed; a human reviewer
should rewrite this before sending.]

RE: Subrogation Demand — Case CLM-2026-0427
From: Alex Rivera (our insured)
To: Carrier for Jordan Blake
Jurisdiction: CA

Our investigation finds your insured 85% at fault for the loss
documented in case CLM-2026-0427. On the basis of the cited evidence
below and the comparative-negligence framework of CA, we demand
recovery in the amount of $35,700 (reflecting 85% of documented
damages of $42,000).

Key cited evidence:
  - [F1] Driver B entered the intersection against a steady red
    light. (source: police_report.pdf)
  - [F4] Police cited Driver B for running a red light (CVC 21453).
    (source: police_report.pdf)
  ...
```

**Verified end-to-end** with a patched `_ask` that throws on every
`drafter*` mock key. Run completes, fallback fires, letter reconciles
because the template embeds the right numbers, gate posts "Drafter
call failed; using template fallback".

### 8.6 — Merge of PR #2 (courtroom orchestration)

While I was in the middle of the audit, PR #2 from the
`codex/courtroom-orchestration` branch was merged into main. Pulling
it created two real conflicts (and several non-conflict surface
changes).

**Conflict 1: `backend/app/pipeline.py` (Intake section).** Main
landed a clean `_parse_intake(raw, claim)` helper and enriched the
prompt with CASE METADATA. HEAD had my retry-on-parse-failure with
fallback Intake.

**Resolution:** kept main's enriched prompt + helper AND my retry +
None-safe display variable. Best of both. Verified by replaying
both mock cases — `85% / $35,700 / escalate` and `11% / $1,980 /
decline` byte-identical.

**Conflict 2: `docs/README.md`.** HEAD's doc list was a strict
superset of main's. Took HEAD verbatim.

**What main brought in (non-conflict, complementary):**
- `backend/app/courtroom.py` (171 lines, new) — `CourtIssue`,
  `CourtTurn`, `CourtroomPlan`, `build_courtroom_plan`,
  `render_docket`, `render_issue_context`
- `backend/app/orchestration_tools.py` (100 lines, new) —
  `LedgerLookupTool` with `search_ledger` / `get_node` /
  `lookup_statute`. Tokenized scoring with synonyms.
- `backend/app/test_courtroom.py`, `test_orchestration_tools.py`,
  `test_pipeline_safety.py`, `test_room.py` — **first real test
  suite** in the backend; 10 tests pass
- `pipeline.py` restructured into a courtroom flow (docket →
  opening briefs → issue-level hearing with cross + redirect →
  adjudication → … → drafter → letter gate → disposition)
- Every posting now carries **structured metadata**
  (`phase`/`actor_key`/`turn_type`/`issue_key`/`citations`/`gate`/
  `tool`) — see §3.2
- `room.py` — `Posting.metadata` field added; `Room.post()` accepts
  optional metadata param; metadata is persisted **before** the SSE
  callback (test asserts this)
- `frontend/lib/types.ts` + `RoomTranscript.tsx` — frontend already
  consumes the new metadata: `PostingMetadata` type with
  `phase/actor_key/turn_type/issue_key/issue_title/citations/gate/tool`;
  RoomTranscript renders chip-style labels per posting

**Independent convergence:** the AI on the codex branch and I (in
this session) both shipped the same three fixes — math-gate retry,
drafter retry+fallback, Intake retry. Different sessions converging
on the same correct answer is validating.

**Plus from main, complementary fixes:**
- `useRunStream.ts` — `receivedResult` flag closes the stale-closure
  onerror bug I flagged in my audit but didn't fix. Now `src.onerror`
  only dispatches "Stream interrupted" if no result event was
  received.
- `fix(ledger): serialize concurrent builds per case (advisory
  lock)` — prevents two simultaneous ledger builds racing on the
  same case
- `feat(run): Band commands default to LIVE content (mock is
  opt-in)` — demo/dev commands default to live agents

**Verified post-merge:**
- All 10 tests pass (`test_courtroom.py:2`, `test_orchestration_tools.py:3`,
  `test_pipeline_safety.py:3`, `test_room.py:1`,
  `test_run_repository.py:1`)
- Mock canonical: `clean → 85% / $35,700 / escalate / 731ch letter /
  28 postings`, `loser → 11% / $1,980 / decline / 729ch letter / 26
  postings`. Compared to pre-merge (21 / 20 postings), the run now
  emits ~7 extra structured postings — the docket, the issue calls,
  the tool-use events. That's the courtroom visibility.
- 17 distinct phases observed in a single run: `docket, intake,
  evidence, fact_gate, ledger_lock, opening_briefs, issue_hearing,
  tool_use, cross_examination, redirect, adjudication, math_gate,
  consensus_gate, source_alignment, drafting, letter_gate,
  disposition`
- Frontend tsc clean (only harmless npm config warnings)

### 8.7 — Design iteration work

The frontend visual quality was the next gap. We have a working
chassis (Next.js 16, React 19, Tailwind v4 with `@theme` tokens,
biome, fallow, lefthook, courtroom-metadata-aware components) but
the visual treatment was generic.

We did **three rounds of design iteration** through an external
design tool (used locally; not part of the deployed product). The
inputs and reviews are in:

- `docs/design/claude-design-prompt.md` — the opening brief
  (audience, surfaces, courtroom-posting metadata as TS interface,
  demo moments, don'ts, references, open questions)
- `docs/design/claude-design-answers.md` — committed picks for 8
  scope-check questions (hybrid interactive build, warm charcoal
  palette, chronological room organization, full-width decision
  panel, real fonts Geist/Source Serif Pro, list+graph ledger
  toggle, etc.)
- `docs/design/claude-design-critique.md` — first-pass teardown
  (3 CRITICAL, 6 HIGH, 4 MEDIUM, 2 POLISH, 8 STRETCH items + 7
  VERIFY asks + 5 SEND deliverables)
- `docs/design/claude-design-iteration-3.md` — iteration 2 verdict
  (all CRITICAL + HIGH + MEDIUM closed; 5/8 STRETCH closed) +
  iteration 3 ask
- `docs/design/competitor-ui-research.md` — browser-driven scan of
  the lablab Band of Agents Hackathon submissions; identified
  Cordane (★★★★★, closest analog) and AgentFlow (★★★☆☆, pattern-rich
  but wrong tone) as the only deployed-demo references; surfaced
  10 patterns to steal + 13 non-tech-adjuster UX rewrites + SVG/icon
  rendering standards
- `docs/design/claude-design-final-ask.md` — earlier last-ask focused
  on the handoff/deliverables route (superseded)
- `docs/design/claude-design-final.md` — the consolidated final
  brief (Part 1 = competitor research verbatim; Part 2 = six
  post-iteration-3 design enhancements ranked by demo-day impact)

**The six design enhancements from the final brief** (all pure
markup/CSS/SVG, no architecture):

1. **Citation pills inline verbatim-quote preview** (★★★★★) —
   `[F3]` expands to `[F3 "Vehicle 2 entered the intersection
   against…"]`. Biggest UX win for non-tech adjusters.
2. **Speaking-agent indicator** (★★★★★) — pulsing waveform glyph
   below the active bench cell, slides to next speaker on handoff.
   Makes the #1 hackathon judging criterion (Band as coordination
   layer) visually unavoidable.
3. **Live progress narration caption** (★★★★☆) — `▸ The system is
   checking Adjudicator A's math…` at the bottom of the Argument
   Room. Real-time plain English. Translates technical state for
   non-tech adjusters.
4. **Demand letter paper-curl on hover** (★★★★☆) — top-right corner
   curls 8–12° revealing the warm-charcoal page behind. The
   screenshot moment for the pitch deck.
5. **Court-reporter margin rule on the transcript** (★★★☆☆) — 1px
   hairline rule down the left margin with tick marks every 80px.
   Lawyers recognize the line-numbered-margin pattern from 150
   years of court reporters.
6. **Recovery amount hover-detail showing math** (★★★☆☆) — hover
   `$35,700` → popover shows `85% × $42,000 = $35,700`, each
   component itself hoverable for fault table / source documents.

**Brand decisions committed to:**
- **Warm charcoal / near-black ink** background (courtroom docket,
  paper-adjacent), NOT cool Linear blue
- **Money color**: pale gold/cream `#e7d3a8` (embossed paper currency,
  not stoplight yellow)
- **Accent (interactive)**: desaturated electric blue `#5b8def` to
  `#7aa8ff`
- **Gate state colors**: passed sage green `#6ea98a`, warning amber
  `#d4a44a`, rejected brick red `#c66a5a` (all desaturated — reads
  "verified / review / violated", not "go / caution / danger")
- **Agent family tints**: Claude warm gold/sand, GPT cool steel/teal
  — anti-collusion story made visually subtle but visible
- **Typography**: Geist Sans (UI), Geist Mono (mono — fact IDs,
  hashes, dollar amounts, with tabular figures), Source Serif Pro
  or Charter (demand letter ONLY — the serif is the visual cue that
  "this is the formal artifact, not the UI")
- **No light mode for v1.**
- **No mobile-first.** Judges on desktop. 1280–1440px first.

**Hard don'ts**:
- No floating chatbot bubble anywhere
- No "magical AI" sparkles / nebula gradients / "AI thinking…" orbs
- No generic dashboard cards
- No emoji decoration outside the source-format pictograms in the
  ledger
- No gradients on data surfaces (reserve gradients for the recovery
  amount block + page H1s)
- Don't bury the harness (GateRail + per-posting gate treatment are
  not optional)
- No icon fonts (Font Awesome etc.) — they render fuzzy and don't
  inherit currentColor cleanly
- No mixed icon libraries — pick lucide-react and commit
- Every glyph must be a vector SVG (no unicode emoji falling back to
  OS-default rendering which differs Mac/Win/Linux/Android)

**The current implementation status:** the visual system is captured
in the design files. Whether to port any of the iteration-3 visual
work into our Next.js codebase is a decision for after the hackathon
deadline — we have ~hours, not days. **For the live demo, the
existing chassis is sufficient**; we ship the courtroom flow + the
working harness over the existing component layout.

---

## 9. Hard rules / dos / don'ts

These are preserved from prior sessions + added this session. Read
this list every time before making an architectural call.

**Preserved from prior sessions:**

1. **Plain prose in chat; markdown only in `.md` files.** Don't
   dress conversational answers in heavy formatting.
2. **Be brutally honest. Step back before architectural changes.
   Reason carefully. Don't just react.** (The user said this
   multiple times this session.)
3. **Never break the harness.** Every Fact the agents cite must
   contain a `verbatim_quote` that's a contiguous substring of
   some page's deterministically-extracted text. Every new file
   format must respect this.
4. **Mock-first is load-bearing.** Every extractor has a canned
   path; the whole demo runs without API spend.
5. **No Claude/AI attribution in commits.** Machine identity only.
6. **Real keys are in `backend/.env`** (rotate post-hackathon;
   never expose `SUPABASE_SERVICE_KEY` to the frontend).
7. **Don't revert `DATABASE_URL` to legacy `db.<ref>.supabase.co`**
   — Supabase retired it.
8. **Don't revert `PORT` to 3000 in `backend/.env`** — collides
   with Next.js dev.
9. **Lane boundary**: ingestion never imports ledger code; the arq
   worker is the composition root.
10. **No `--no-verify` on git, no `--no-edit` on git rebase, no
    `-i` interactive git, no force-push to main.**

**Added this session:**

11. **Every LLM-output Pydantic schema must accept the LLM's
    defensible-but-fuzzy responses.** Schema rejection of
    "not in evidence" / "high" / "85%" / "ours" was punishing
    correct refusal-to-hallucinate behavior. Coerce sentinels +
    synonyms before raising.
12. **Every LLM call site must have a retry + a fallback.** Drafter
    fallback (deterministic template letter), Intake fallback
    (minimal Intake from ClaimInput), points/rebuttal fallback
    (empty list), Math-Gate retry → degrade to best-effort
    single-adjudicator at half-confidence.
13. **The Math Gate is NOT relaxed even when LLMs are bad at math.**
    Math inconsistency triggers a *retry*, then a *graceful degrade*,
    never a silent pass-through. Relaxing the gate would break the
    central technical moat.
14. **SSE must have a heartbeat** during long agent awaits. 15s
    `: heartbeat\n\n` keeps proxies from idle-timing-out the
    upstream socket.
15. **The frontend `seed()` must be a no-op if an SSE is already
    active.** Otherwise a slow replay-on-mount API chain can clobber
    a fresh user-initiated SSE.
16. **Per-MIME-class upload limits are CATEGORY-based, not
    PER-FORMAT.** Document bucket = all 7 doc MIMEs share one
    50-file ceiling. Same SHA-256 doesn't double-count.
17. **The CSV extractor is dedicated (stdlib `csv`), not routed
    through TextExtractor.** Required for encoding fallback +
    delimiter sniffing + safe TSV rendering.
18. **Whisper-1, NOT gpt-4o-transcribe**, until segments become
    optional. Segments key the time-anchored citation feature.
19. **Restart the backend process every time `types.py` or
    extractor registry changes.** Python doesn't hot-reload imports;
    the running process caches the OLD module.
20. **Every new format must produce a substring-anchorable text
    block** (the EVENTS pattern for non-text formats).
21. **No `--reload` on uvicorn** for the production server — the
    BandRoom / WebSocket / arq composition root reload semantics
    are fiddly. Manual restart is the contract.
22. **The arq worker can become stale silently.** Killing
    long-running workers is part of the deploy contract; a stale
    worker greedily consumes new-shape jobs and fails them.

---

## 10. What's verified vs untested

This is the honest audit. Don't assume verified just because the
code path exists.

### Verified

- **Probe upload ALL GREEN** (`scripts/probe_upload.py`): case
  create → sign-upload → PUT bytes to B2 → commit → poll status →
  pages exist in Supabase. End-to-end.
- **Probe ledger ALL GREEN** (`scripts/probe_ledger.py`): in-process
  ledger build, validates the typed-graph extraction logic.
- **Seeded Alex/Jordan case** at `574d61f9-…` has 20 nodes + 20
  edges persisted from a real live ledger build.
- **Bus Tragedy case** at `bd7bba9e-…` is stuck at
  `ingestion_complete=true, ledger_complete=false` because it
  ingested before Gowtham's handoff code shipped. Fix is manual
  enqueue (see §13).
- **Mock-mode 8-agent debate** runs the full harness end-to-end.
  Both canonical cases produce byte-identical numbers (`85% /
  $35,700 / escalate`, `11% / $1,980 / decline`) before and after
  every change this session.
- **The 10-test backend test suite passes** (courtroom (2),
  orchestration_tools (3), pipeline_safety (3), room (1),
  run_repository (1)). 0.009s total.
- **Frontend tsc clean** after all changes.
- **CSV extractor verified against 12 messy cases** (smoke test).
- **Schema coercer audit verified** by replaying every mock case
  through every new schema validator.
- **Math-gate retry + degradation verified** by patched
  `_ask` that forces both adjudicators to math-fail end-to-end —
  run completes with `outcome=escalate, confidence=0.425`.
- **Drafter fallback verified** by patched `_ask` that throws on
  every drafter call — run completes, fallback letter renders,
  Letter Reconciliation passes by construction.
- **SSE heartbeat fix verified** by replaying the mock pipeline
  after the change — canonical numbers unchanged.
- **Seed-on-mount race fix verified** by re-reading useRunStream's
  source post-fix.
- **The merge of PR #2 (courtroom protocol)** integrates with my
  fixes correctly. Mock canonical preserved.
- **Per-MIME-class limits enforced both client and server-side.**
  Smoke-tested across 12 cases (mixed format combinations).

### Not yet verified

- **One end-to-end live DB-case debate completing with all
  persistence writes** observed cleanly from start to finish.
  Multiple runs of the `1ef35b9d` case hit each of the six bugs
  in sequence — every bug is now fixed but the user's last live
  run report (after the math-gate fix) was that it worked.
  The Drafter fallback path hasn't been triggered in a real live
  run yet.
- **Live runs against the 5 new file types** (CSV, scanned PDF
  OCR, Excel multi-sheet, audio Whisper+EVENTS, image vision
  three-block). Only the smoke tests / mock paths are confirmed.
- **The Bus Tragedy ledger backfill.**
- **A 100+ document case.** The Evidence Aggregator's prompt
  overflows gpt-4o-mini's 128k context at ~20 documents; CONTEXT.md
  §17 flags this as the unsolved "scale gap".
- **Deployment** (Render/Railway for backend, Vercel for frontend).
- **The 3-minute demo video + pitch deck.**

---

## 11. Known performance issues

These are real but not fix-blocking for the hackathon.

1. **Ledger writes per node** — `LedgerWriteRepository.write_graph`
   does one `INSERT … RETURNING id` per node (to capture the
   generated UUID for edge wiring) plus one per edge. ~40
   round-trips at ~400–500ms each (Supabase ap-northeast-2 from
   laptop) = ~19s for 20 nodes. Fix is batch insert via
   `unnest($1::uuid[], $2::int[], …)`, same pattern as
   `document_pages`. Not fixed this session — flagged.

2. **Evidence Aggregator context overflow at ~20 docs.** gpt-4o-mini
   has 128k context; full doc text concatenated overflows past
   ~20 documents. Needs a retrieval step (full-text first,
   embeddings only if needed). CONTEXT.md §17 has been flagging
   this for sessions.

3. **Drafter retry doubles tail latency.** On the rare drafter
   failure path, the second attempt + then the template-fallback
   takes ~10–15s extra. Acceptable trade for "the run completes
   no matter what".

4. **Mock-mode silent semantic miss for unknown case IDs.** In
   mock mode, `MOCK_GRAPHS.get(claim.caseId, MOCK_GRAPHS[CLEAN])`
   writes the Alex/Jordan graph onto ANY new case. Fine for wiring
   tests, semantically wrong for a real demo upload. Fix is to
   flip to live mode (which is the current default with empty
   `LUMEN_MOCK` + keys present).

---

## 12. Future scope

Things deferred to post-hackathon or v2.

- **Image and audio ingestion at scale** (already in for prototype;
  needs retrieval step at production scale)
- **Cross-case memory** ("find similar past cases" — the one genuine
  embeddings use case)
- **Retrieval in the Evidence Aggregator** at 50+ doc scale
- **More claim types / jurisdictions** (more statutes,
  multi-state comparative-negligence)
- **Dynamic specialist recruiting** (agents that recruit a needed
  specialist model at runtime — Verdict Room from the lablab
  competitor scan does this)
- **Multi-tenant RLS, soft-deletes, a real `runs`-driven dashboard**
- **Batch insert for ledger writes** (the §11.1 performance fix)
- **Live Whisper / Claude vision A/B against real customer audio
  + images.** The events-extraction pass is the smoothing layer
  doing the citation-friendly heavy lifting today; would be
  interesting to A/B the underlying ASR model.
- **Camera/mic/OCR pictogram on Fact cards** backed by
  image/audio/OCR pages
- **Refusal-regex post-check for image pages** (catch "I cannot
  identify people in this image" leakage)
- **A retrieval step in `build_ledger`** for cases that have more
  than ~15–20 docs
- **Cordane-style live snippet feed** in the Argument Room header
  (3 most recent postings, mono-prefix-styled, even on idle)
- **Court-reporter margin rule** on the transcript (CSS-only,
  ~10 min to ship)
- **Demand letter paper-curl hover** (CSS `rotate3d`, ~15 min to
  ship — the demo-day screenshot moment)
- **The full decline chrome-shift** (border undertones brick-red,
  gates desaturate, "CASE FILE CLOSED" overstamp — currently just
  the DECLINE pill renders)

---

## 13. For the next person picking this up

If you're a teammate or coding agent inheriting this work, here's
how to get to a working state.

**First, restart everything if you haven't recently:**

```bash
# Kill old processes if they're running:
ps aux | grep -E "run_server|arq backend|next-server|next dev" | grep -v grep
# Then kill the PIDs you see.

# Start fresh (from repo root):
./run.sh dev
# OR manually:
# Terminal 1: source .venv/bin/activate && PORT=8000 python -m backend.app.run_server
# Terminal 2: source .venv/bin/activate && python -m arq backend.ingestion.worker.WorkerSettings
# Terminal 3: pnpm --dir frontend dev
```

**Things to check are working:**

```bash
# Backend imports clean (catches schema drift):
source .venv/bin/activate && python -c "from backend.app.server import app; from backend.app.pipeline import run_lumen; print('ok')"

# Tests pass:
python -m unittest backend.app.test_courtroom backend.app.test_orchestration_tools \
                   backend.app.test_pipeline_safety backend.app.test_room \
                   backend.app.test_run_repository -v

# Mock canonical produces $35,700 / 85% / escalate:
LUMEN_MOCK=1 LUMEN_MOCK_DELAY_MS=0 python -m backend.app.run_demo
```

**The canonical demo run is `/cases/clean`** in the browser. Click
"Open the room", watch the courtroom flow stream, see the canonical
recovery numbers settle.

**For a real-case upload demo**, run `bash scripts/fetch_test_files.sh`
first to pull the 22 curated public-domain test files, then drag them
into `/cases/new`.

**Known stuck-cases to unstick if asked**:
- Bus Tragedy `bd7bba9e-…` — needs `enqueue_build_ledger`. There's
  a new endpoint `POST /api/ingest/rebuild-ledger/{case_id}` from
  Gowtham's recent work that does this.

**The most likely real-run failure modes** (in order of likelihood):
1. Stale arq worker from a prior dev session greedily consuming
   `run_ledger_build` jobs and failing them with "function not
   found". Solution: kill the stale worker, restart the new one
   that registers both `extract_document` and `run_ledger_build`.
2. Backend process started before the latest `types.py` /
   extractor changes — caches the old schema. Solution: restart.
3. Anthropic / OpenAI API hiccup mid-run — but the
   retry-then-fallback paths from §8.5 cover every LLM call site
   now, so the run will complete in some shape (pursue / escalate
   / decline). It can't crash with a 500.

**What absolutely must not change without thinking:**
- The `Fact.verbatim_quote` must remain a contiguous substring of
  `document_pages.extracted_text` (the Fact Gate's invariant).
  Adding a new file format without producing substring-anchorable
  text would break the harness.
- The math gate's `tolerance=10` (pp). Loosening this lets bad
  math through. Tightening it would invalidate the demo run that
  shows the gate catching a real Claude Opus error.
- The agent-family pairing in `agents.py`. Advocate must be a
  different family from Opposing; Adjudicator A from Adjudicator
  B. Breaking this collapses the "cross-family anti-collusion"
  pitch claim from real to cosmetic.

---

## 14. Rejected ideas with reasoning

A running list of paths considered + rejected during this session.

| Idea | Verdict | Reason |
|---|---|---|
| **Use `gpt-4o-transcribe` instead of `whisper-1`** | ❌ NO | No segment timestamps. Loses time-anchored citations + EVENTS prefix. Kept whisper-1 + the EVENTS-extraction smoothing layer on top. Env override exists for power users. |
| **Route CSVs through `TextExtractor`** | ❌ NO | Encoding fallback + delimiter sniffing + TSV rendering aren't reasonable in a plain-text extractor. Dedicated `CsvExtractor` (stdlib `csv`) does it right. |
| **Register `application/vnd.ms-excel` MIME on the CSV extractor** | ❌ NO | That MIME also resolves to `.xls` binary files. Accepting it would silently mis-route binary `.xls` uploads through CSV and produce garbage page text. Users save Excel as `.csv` (which sets `text/csv`). |
| **Raise per-file upload cap above 10 MB for documents** | ⚠️ deferred | AF's industry floor is 40 MB. 10 MB rejects ~5–10% of real medical-records / scanned-policy files. Acceptable for hackathon demo (curated cases). Raise to 40 MB post-hackathon to match AF. |
| **Per-file cap calculated per format (50 PDF + 50 DOCX + 50 XLSX = 150 docs)** | ❌ NO | User explicitly: "the total should be 50 not for individual count, that will cause a huge dump". Combined bucket across all 7 doc MIMEs. |
| **Force document-grouping panel** (Source / Damages / Audio-visual) | ⚠️ deferred | Reads like a real exhibit binder but the implementation cost wasn't justified for hackathon timeline. Documents currently render as a flat list with format pictograms. |
| **Pass adjudicator math-fail as a hard error (`RuntimeError`)** | ❌ NO | This was the v1 behavior; iter found it. Graceful degradation to best-effort single-adjudicator at half-confidence is better product behavior. |
| **Relax Math Gate tolerance** | ❌ NO | Would let bad math through. The retry-then-degrade pattern keeps the gate strict but the *run* resilient. |
| **Native Anthropic SDK for the provider client** | ❌ NO | The file is a multi-provider abstraction where Claude is one of three interchangeable providers. Native SDK would mean three client codepaths for no benefit on a mock-first system. |
| **Embeddings / pgvector / RAG over policy clauses** | 🚫 NOT NOW | Single case fits in context; ledger graph + verbatim-quote Fact Gate + Postgres full-text covers it. Revisit at 50-doc scale. |
| **Use AI/ML API + Featherless instead of Anthropic + OpenAI** | ❌ FORCED | APIs became unavailable. Forfeited the two partner prizes (only matters for those). Main Band prize is unaffected. Upside: turned the loss into "two independent model families" anti-collusion pitch. |
| **Spawning multiple research agents for the competitor scan** | ❌ NO | User explicit: "now don't spawn multiple agents". Single browsermcp-driven scan with descriptive review for the field. Stayed in budget. |
| **Putting the design tool's name in the README** | ❌ NO | User explicit: "no place you have mention about claude design and all, it will be just for local purpose". The design `.md` files exist locally for context recovery; the README references them by purpose, not by source tool. |
| **Light-mode toggle** | ❌ NO | Brief said no. Wasted design cycles. |
| **Mobile-first layout** | ❌ NO | Judges on desktop. 1280–1440px first. |
| **Floating chatbot bubble** | ❌ NO | Lumen is a workbench, not a chatbot. The chat metaphor only applies inside `/cases/new` during evidence intake. |
| **Emoji icons on agent cards** | ❌ NO | Cute for a coding playground, catastrophic for a serious insurance product. Monogram + family tint only. |
| **Robot mascot or "AI thinking" sparkle gradients** | ❌ NO | Universal signal of "this is a demo, not a tool". |
| **Recourse-style RAG/pgvector grounding as primary** | ❌ NO | Our typed Evidence-Ledger graph + verbatim-quote Fact Gate is the moat. Recourse's RAG is for finding the right clause in a large policy; we anchor everything to verbatim source substrings. (See §13 of CONTEXT.md.) |
| **Move RunHistoryStrip to a left sidebar instead of bottom strip** | ⚠️ deferred | Worth testing on wide viewports; current bottom strip is demo-safe. |
| **Single hero visualization (orb / bench-as-SVG / harness-as-SVG)** | ⚠️ deferred | Cordane's "orb" is the equivalent. Worth adding post-hackathon. |

---

## 15. Verbatim user feedback (the load-bearing quotes)

Preserving these in case the meaning gets lost in paraphrase.

> "be brutally honest"

> "step back, think about the whole scenario and then take the
> required action to solve these"

> "do not miss anything"

> "only use markdown while using makeing an md file only" — plain
> prose in chat

> "for documents the total should be 50 that's it not for
> individual count, that will cause a huge dump"

> "again check the , html again for some improvement along witht
> eh competitor-ui-research.md, do this correctly we have very less
> time, mostlly this has to be the last one"

> "okay there is one thing i wanted to confirm everythign will work
> and all, right now let's say i upload all the cases file and the
> will the automatically ledger will it be formed and all? check
> that"

> "but why this error at the first place, it shouldn't be right,
> and we are not of the complex harness to build why it is failing
> and all?"

> "Okay, so I've been getting this the same error again and again.
> I don't know why. … look into this why it is happening. … this
> has happend multiple time earlier"

> "okay so this worked, now check for others like these, if it is
> an issue, cause everytime your said it is ookay and okay and okay"

> "are you sure all these things will not break anything, look for
> the codebase for better contexxt aagin correctly so that you are
> doing anything worong"

> "no, single agent" (on the competitor research)

> "rememeber that we have to make this an elite designs and all,
> with premium looks, like something presented from harvard laws
> and all"

> "and also make sure that, we will be using the svgs and all and
> icons correctly render them correctly, add the instruction uon
> next completion of the review"

> "not is there anything enhancement we hacve to do, but with the
> compietitor ui reseach nhting about the reasdmem and all, just
> make the design of the product"

> "in the readme and all, no place you have mention about claude
> design and all, it will be just for local purpose"

These quotes are why specific design and product choices read the
way they do. When in doubt, re-read them.

---

## 16. Files touched this session

For grep-ability.

**Backend (Python):**
- `backend/ingestion/limits.py` (new) — per-MIME-class caps
- `backend/ingestion/routes.py` — `MAX_SIZE_BYTES` import
- `backend/ingestion/service.py` — `classify()` + size + count
  validation in `prepare_upload`
- `backend/ingestion/extractors/csv.py` (new) — `CsvExtractor`
- `backend/ingestion/extractors/registry.py` — register
  `CsvExtractor`
- `backend/app/types.py` — 8 coercers + `Optional[float]` damagesUsd
  + `field_validator(mode="before")` on Fact.confidence,
  Decision.confidence, Decision.otherDriverFaultPct, FaultRow.favors,
  FaultRow.weight, RebuttalItem.stance, AlignmentResult.alignment,
  Intake string fields
- `backend/app/prompts.py` — Intake prompt updated for `damagesUsd:
  number | null`
- `backend/app/pipeline.py` — Intake retry + fallback, points/rebuttal
  retry + fallback, math-gate retry + graceful degradation, Drafter
  retry + `_fallback_letter`, merged with main's `_parse_intake`
  helper + enriched intake prompt
- `backend/app/server.py` — SSE 15s heartbeat
- `backend/app/run_demo.py` — `intake.damagesUsd` None-safe fallback
  for the CLI display
- `backend/app/courtroom.py` (from main) — courtroom protocol
- `backend/app/orchestration_tools.py` (from main) — LedgerLookupTool
- `backend/app/test_courtroom.py` / `test_orchestration_tools.py` /
  `test_pipeline_safety.py` / `test_room.py` (from main) — first
  backend test suite

**Frontend (TypeScript / React):**
- `frontend/lib/fileSupport.ts` — `LIMITS` constant, `classify()`,
  widened `partitionSupportedFiles`, structured `FileRejection`,
  `countLocalFilesByCategory` helper, `csv`/`tsv` in `mimeOf()`
- `frontend/lib/useCaseUpload.ts` — pre-validate with
  `existingCountsByCategory`, widened `onRejected` signature
- `frontend/lib/useRunStream.ts` — `if (sourceRef.current) return;`
  guard in `seed()`; `receivedResult` flag (from main) for onerror
- `frontend/components/DocumentsPanel.tsx` —
  `existingCountsByCategory` passed to hook, widened `onRejected`,
  `onDocumentsChanged` callback, `applyServerDocuments` helper
- `frontend/components/UploadZone.tsx` — dynamic limits text, CSV in
  `accept`
- `frontend/app/cases/new/page.tsx` — widened rejected handler,
  countLocalFilesByCategory usage

**Scripts:**
- `scripts/fetch_test_files.sh` (new) — pull 21 curated public-domain
  test files
- `scripts/setup_b2_bucket.py` — already existed; documented its role
- `scripts/probe_upload.py` / `probe_ledger.py` — already existed;
  documented their role

**Data:**
- `data/test-files/md/01-case-notes-example.md` (new) — hand-authored
  case-notes stub for Rivera/Blake
- `data/test-files/README.md` (new) — provenance + license table

**Docs (created this session):**
- `docs/design/claude-design-prompt.md` — design brief
- `docs/design/claude-design-answers.md` — scope-check picks
- `docs/design/claude-design-critique.md` — iter-1 critique
- `docs/design/claude-design-iteration-3.md` — iter-2 verdict +
  iter-3 ask
- `docs/design/competitor-ui-research.md` — lablab competitor scan
- `docs/design/claude-design-final-ask.md` — superseded handoff ask
- `docs/design/claude-design-final.md` — consolidated final brief
- `docs/session-context-2026-06-19.md` (this file)

**Docs (updated):**
- `docs/README.md` — added pointers to the new docs; cleaned up
  references to use neutral descriptions ("Design brief" /
  "Design enhancements") instead of naming the external tool

**Resolved conflicts during merge:**
- `backend/app/pipeline.py` — combined main's `_parse_intake` +
  enriched intake prompt with my retry + fallback
- `docs/README.md` — took HEAD verbatim (it was a strict superset
  of main's version)

---

## 17. Decision log

If you change a decision below, append a new row with the date and
reasoning — don't silently overwrite.

| Date | Decision | Verdict |
|---|---|---|
| 2026-06-19 | Per-MIME-class limits: 10 MB / 50 docs, 10 MB / 15 images, 50 MB / 10 audio | ✅ user-confirmed |
| 2026-06-19 | Document cap is COMBINED across 7 doc MIMEs (50 total), not per-format | ✅ user-explicit |
| 2026-06-19 | Add CSV extractor (stdlib `csv`, dedicated, not via TextExtractor) | ✅ user-confirmed |
| 2026-06-19 | Keep `whisper-1` (not `gpt-4o-transcribe`) — segments are load-bearing | ✅ user-accepted |
| 2026-06-19 | `Intake.damagesUsd: Optional[float]` with sentinel coercion | ✅ shipped |
| 2026-06-19 | 8 schema coercers across `types.py` for LLM-output fields | ✅ shipped, regression-tested |
| 2026-06-19 | Frontend `seed()` no-op if SSE active | ✅ shipped |
| 2026-06-19 | SSE 15s heartbeat in server.py | ✅ shipped |
| 2026-06-19 | Math-gate retry per failing adjudicator + graceful degrade to half-confidence single | ✅ shipped |
| 2026-06-19 | Drafter retry + deterministic `_fallback_letter` template | ✅ shipped |
| 2026-06-19 | Merge PR #2 (courtroom orchestration) into our branch — kept best of both for the Intake conflict | ✅ shipped, all tests pass |
| 2026-06-19 | Warm-charcoal palette / Source Serif Pro display / Geist Mono money — committed brand direction | ✅ committed |
| 2026-06-19 | Design tool is LOCAL ONLY — never named in README or product docs | ✅ user-explicit |

---

*End of session context. If you change anything load-bearing, append
to §17 (Decision log) and update §16 (Files touched) so the next
person reading this file knows exactly what state the system is in.*
