# Lumen — Full Working Context

> Last updated: **2026-06-17**
> Purpose: complete handoff context — every decision, every rejected idea, every hypothesis tested, every constraint, every "why." Read this if you're picking up the project mid-stream, joining the team, or are a coding agent that needs grounding before touching code.
>
> This is NOT a summary. This is the raw mental model that informs every choice in the repo. If you find a contradiction between this doc and the code, the code is canonical for *behavior* — but this doc is canonical for *reasoning*. Resolve mismatches by updating both.

---

## 0. How to Read This Document

This file is organized by concern, not chronologically. Each section answers "what is this, why does it exist, what did we explicitly reject, what's deferred." If you only have five minutes, read sections 1, 3, 4, 5, and 18.

If you're a coding agent picking up a specific lane, jump to:
- Ingestion (Aman) → §10
- Ledger (Gowtham) → §11
- Orchestration (Sudharsan) → §12

If you're trying to make an architectural change, read §6 first. We tested a lot of hypotheses and rejected most of them; this section documents WHY so you don't re-litigate.

---

## 1. The Hackathon

**Event**: Band of Agents Hackathon, hosted by lablab.ai, sponsored by Band, AI/ML API, and Featherless AI.

**Dates**: June 12 — June 19, 2026. **Submission deadline: Jun 19, 8:30 PM India Standard Time.** Treat as a hard deadline. Plan to submit **by end of June 18** (Thursday evening) so Friday is buffer only.

**Format**: Fully online. Global participation.

**Prize pool**: $10,000+ in main prizes, plus two separate sponsor prizes (Best Use of AI/ML API, Best Use of Featherless AI).

**Submission requirements**:
1. A working prototype people can use online (deployed, public URL).
2. A ~3-minute demo video.
3. A pitch deck.
4. Original code, MIT-licensed.

**Hard architectural rule from the hackathon**: the app must show **3+ unique specialized agents actively talking to each other**. Must go beyond a chatbot, a single agent, or a straight A→B→C script.

**Judging criteria** (in priority order, derived from the hackathon page):
1. **Application of Technology** — how well we use Band as the coordination layer. Real handoffs, shared context, role specialization, tracked task state, escalation. *This is the biggest lever.*
2. **Clarity** — a judge instantly gets the problem, the agent roles, what Band does, and the value.
3. **Business Value** — solves a real enterprise workflow problem.
4. **Originality** — creative multi-agent collaboration; agents discover each other, divide work, review outputs, disagree, escalate.

**Credits / access:**
- **Band Pro** — 100% off for 1 month with promo code `BANDHACK26`.
- ~~AI/ML API ($10/person) and Featherless ($25/participant)~~ — **no longer used** (dropped 2026-06-18; unavailable to us). Agents now run on our own Anthropic / Google / OpenAI keys.

---

## 2. The Problem We're Solving

### Plain-English statement

When someone runs a red light and causes a crash, the victim's insurance company pays them right away. But the victim wasn't at fault — so the victim's insurer should get that money back from the **at-fault driver's** insurer. That recovery process is called **subrogation** (insurance shorthand: "subro").

Subrogation is slow, manual, and document-heavy. A recovery team has to gather police reports, photos, witness statements, repair invoices, medical bills, EDR data, policies, write a formal demand letter, negotiate with the other carrier, and sometimes arbitrate or litigate. Because it's so labor-intensive, insurers **drop roughly half** of viable recovery cases. Industry-wide, this leaves an estimated **$15–20 billion per year** uncollected.

### Why this niche specifically

Of every Track 3 (Regulated & High-Stakes) submission space we considered, subrogation has the cleanest combination of:
- Multi-agent **legally required** by separation-of-duties (attorney work product, PII isolation, multi-team ownership).
- Untouched by current Band hackathon submissions (verified by reading the submitted projects list).
- Untouched by horizontal AI tools (Harvey/Hebbia/Glean focus on legal research, not insurance recovery operations).
- Tangible artifact (a demand letter with a specific dollar amount), which makes the demo visceral.
- Real $$ pain that anyone at a property/casualty insurer recognizes immediately.

### Target user

The **recovery teams inside property & casualty insurers** (State Farm, GEICO, Allstate, Progressive, etc.). These teams have thousands of staff doing this work by hand and can't keep up. Lumen is positioned as a **practical workbench for recovery specialists**, not a generic AI chatbot.

---

## 3. The Product (Lumen)

### One-liner pitch

*"Lumen is a team of AI specialists that does the slow, manual insurance subrogation work — investigating, arguing both sides, deciding, and producing a ready-to-send demand letter — so insurance companies can actually collect the billions they're owed instead of dropping the cases."*

### What it produces

A complete **Recovery Packet**:
- Liability/fault analysis — who was at fault and by what %, every point backed by real evidence.
- The dollar amount to demand.
- A formal demand letter, ready to send.
- The strongest opposing argument + our rebuttal (kept visible, not hidden).
- A human Approve / Reject step for big or uncertain cases.

What takes a recovery team about 2 weeks comes out in minutes. The human still signs off.

### The agent team (current state)

Eight agents wired into the pipeline today, across **three model families** (Anthropic / Google / OpenAI), all via OpenAI-compatible endpoints. (Note: AI/ML API + Featherless were dropped on 2026-06-18 — unavailable to us; the partner prizes are no longer targeted. Sections below that still mention them are historical.)

| # | Agent | Provider | Job |
|---|-------|----------|-----|
| 1 | Intake Parser | OpenAI (gpt-4o-mini) | Extract incident facts from the First Notice of Loss |
| 2 | Evidence Aggregator | Google (gemini-2.5-flash) | Build the structured Evidence Ledger from documents |
| 3 | Liability Advocate | Anthropic (claude-opus-4-8) | Build the strongest case the other driver was at fault |
| 4 | Opposing-Carrier Red Team | OpenAI (gpt-4o) | Attack our case the way the other insurer would |
| 5 | Adjudicator A | Anthropic (claude-opus-4-8) | Neutrally set fault % + recovery |
| 6 | Adjudicator B | Google (gemini-2.5-pro) | Independent adjudicator on a different family (consensus check) |
| 7 | Source-Alignment Verifier | Google (gemini-2.5-flash) | Audit every cited claim against its source fact |
| 8 | Demand Letter Drafter | Anthropic (claude-sonnet-4-6) | Compose the formal demand letter |

**The Advocate (Claude) debates the Opposing red team (GPT); Adjudicator A (Claude) is checked against Adjudicator B (Gemini)** — different families, so the debate and the consensus check are genuinely independent, not one model arguing with itself.

### Escalation rules

Lumen never finalizes autonomously. A case is **flagged for human approval** if any of:
- Recovery amount ≥ $25,000.
- Adjudicator confidence < 0.6.
- Fault split is near 50/50 (within 10pp of 50%).
- Either Math Gate failed (table-vs-percentage mismatch).
- Adjudicators disagreed by more than 10pp (Consensus Gate failed).
- Source-Alignment Verifier flagged any "contradicted" citations.

This is product feature, not a failure. *"Call a human"* is a deliberate design choice, the system is comfortable saying "not in evidence."

---

## 4. The Harness — The Central Architectural Decision

**This is the most important section of this document.** It's also the part that distinguishes Lumen from every other multi-agent hackathon submission.

### The two failure modes the harness defends against

1. **Hallucination.** LLMs make stuff up confidently. They cite cases that don't exist, statutes with wrong numbers, "facts" they inferred from training data. In a subrogation system, a hallucinated fact → wrong fault → wrong dollar → real legal/financial mistake.
2. **Collusion (the subtle killer).** When you set up "Advocate vs. Opposing," they tend to **drift toward agreement** — not because anyone wants them to, but because LLMs are trained to be agreeable, anchor on each other's prior turns, and produce polite "we both have valid points" outputs. Most multi-agent demos fall into this trap and produce a meaningless 60/40 outcome that's noise dressed as judgment.

### The six harness gates (current state)

**The architectural decision: most gates are CODE, not prompts.** An LLM can ignore a prompt. It cannot bypass `Set.has()`, `String.includes()`, or arithmetic. Five of the six gates are pure code; one (Source-Alignment Verifier) is an agentic gate that uses an LLM call to check semantic alignment between claims and their cited facts — that one's enforcement is mechanical (the result is a structured JSON that drives escalation), but its judgment is model-based.

| Gate | Kind | File | Catches |
|---|---|---|---|
| Citation Gate | **code** | `backend/app/gates.py:check_points` | LLM cites an ID that doesn't exist in the ledger or statute store |
| Fact Gate | **code** | `backend/app/gates.py:check_ledger_anchoring` | Evidence Aggregator mis-extracts a fact — the verbatim quote must be a contiguous substring of the source document text |
| Math Gate | **code** | `backend/app/gates.py:check_adjudicator_math` | Adjudicator's stated percentage doesn't follow from its own fault table (±10pp tolerance) |
| Consensus Gate | **code** | `backend/app/pipeline.py:compute_consensus` | Two Adjudicators disagree by more than 10pp → forces human review |
| Source-Alignment Verifier | **agentic** | `backend/app/verifier.py` + `pipeline.py:run_verifier` | A claim cites a real fact but misrepresents what the fact actually says (semantic, not just syntactic) |
| Letter Reconciliation | **code** | `backend/app/pipeline.py:reconcile_letter` | Drafted letter doesn't contain the decided fault % and dollar amount — catches drift between dashboard and mailbox |

The Verifier is intentionally agentic — semantic alignment ("does this claim follow from this fact?") is the kind of nuanced reading that LLMs handle well and code does not. Defense in depth: structural gates catch fabricated citations and math errors; the agentic gate catches subtle misrepresentations the structural gates miss.

### Anti-collusion mechanisms (structural, not single files)

- **The Opposing is a red team, not a negotiator.** Its prompt forbids negotiation or settlement-seeking. It is told to attack, not to find common ground.
- **Independent drafts before exchange.** Opposing produces its OWN theory before seeing Advocate's points (pipeline step 4 vs step 5). No anchoring.
- **Different model families per side.** Advocate on Claude family, Opposing on GPT family. Sycophancy patterns differ → resists convergence.
- **No consensus round.** The pipeline ends after rebuttal. There is intentionally no "find common ground" turn in the code.
- **Separation of powers.** The Adjudicator is a different agent, told nothing about being "fair to both sides" — only to weigh evidence. Debaters do not decide.
- **Fault is computed from a table, not vibed.** The Adjudicator emits `{factId, favors, weight}[]` and the percentage must follow from the table — checked by the Math Gate.
- **Dissent stays in the output.** Concessions are marked `stance: 'concede'` in the rebuttal, not erased. The strongest opposing argument survives into the final packet.
- **Dual adjudication.** Two Adjudicators on different model families catch single-model bias.

### Demo strategy for the harness

In the demo video, point at the harness explicitly. Sample lines:
- *"Four code-enforced gates, not prompts. The LLM cannot bypass `Set.has()`, `String.includes()`, or arithmetic."*
- *"The Citation Gate stops fabricated citations. The Fact Gate stops fabricated facts. The Math Gate stops invalid arithmetic. The Source-Alignment Verifier stops cited-but-misrepresented claims."*
- *"Two adjudicators on different model families converge or escalate to a human. The system is comfortable saying 'I don't know.'"*

---

## 5. Team & Lane Boundaries

**Three contributors, three lanes, three sets of tables.**

| Lane | Owner | Writes | Reads | Triggered by |
|---|---|---|---|---|
| Ingestion | **Aman** | `documents`, `document_pages`, `cases.ingestion_complete=true` | uploaded files | new case POST |
| Ledger | **Gowtham** | `nodes`, `edges`, `cases.ledger_complete=true` | `documents`, `document_pages`, `statutes` | `cases.ingestion_complete=true` |
| Orchestration | **Sudharsan** | `transcript`, `decisions`, `cases.finalized=true` | `cases`, `nodes`, `edges`, `document_pages`, `statutes` | `cases.ledger_complete=true` |

Each lane writes only its own tables and reads only upstream tables. The boolean flags on `cases` are the cross-stage handoff. Lanes can work in parallel as long as they respect these contracts.

**This separation is explicit and load-bearing.** It's in `docs/product-context.md` (which existed before this doc) and was reinforced through multiple discussions. Do not write into another lane's tables.

---

## 6. Architecture Decisions — Yes/No with Reasoning

This section documents every significant choice and explicitly states what we **rejected**. If you're considering re-opening any of these, read the reasoning before pitching it.

### 6.1 Cloud-only deployment — YES

**Decision**: All persistent storage in the cloud. No SQLite, no local files.

**Reasoning**: Three contributors, multiple machines, plus eventual deployment. Local files don't survive deployment and don't share across the team. Cloud-only is the only architecture that actually works for the team setup.

### 6.2 Backblaze B2 for raw files — YES

**Decision**: Raw uploaded files (PDFs, DOCX, etc.) go to Backblaze B2, content-addressed by SHA-256.

**Reasoning**:
- Backblaze B2 free tier: 10 GB storage, 1 GB egress/day.
- Supabase Storage free tier: 1 GB total.
- File size design target: 50 documents per case × up to 50 MB per file = 2.5 GB per case.
- Supabase Storage would blow up after one case; B2 holds 4–10 cases.
- B2 is S3-compatible (boto3 with custom `endpoint_url` works), so portability is preserved.
- One extra account is a small operational cost for a large safety margin.

**What we rejected here**: Using Supabase Storage as the sole raw-file store. Tested the math, free tier is too small.

### 6.3 Supabase Postgres for all structured data — YES

**Decision**: One Postgres database, hosted on Supabase, holds every structured table — `cases`, `documents`, `document_pages`, `statutes`, `nodes`, `edges`, `transcript`, `decisions`.

**Reasoning**:
- One vendor, one connection string, one SDK, one dashboard. Operational simplicity is critical for a 3-person team in a 2-day window.
- Postgres handles our scale trivially. 50 docs × 300KB extracted text = 15MB per case. Free tier (500MB) holds 30+ cases.
- Supabase additionally gives us: Realtime subscriptions (live UI updates), Row Level Security (when we add multi-tenant), Auth (if needed later), Storage (if we ever migrate raw files in).

### 6.4 MongoDB for raw text dumps — NO (rejected)

**Decision**: Do not add MongoDB. Postgres + TEXT columns is sufficient.

**Reasoning** (this was a serious discussion):
- The team initially proposed dumping extracted text into MongoDB to "keep Postgres clean."
- We did the math: extracted text per case is 15 MB. Postgres handles this in 3% of the free tier. The "Postgres clutter" concern is incorrect at our scale.
- Postgres TOAST automatically moves large TEXT values out of the main row, so metadata queries stay fast even with big text columns.
- Adding MongoDB means another service (another account, another connection string, another SDK), more env vars, cross-database consistency to manage, and no actual capability we don't already have.
- **Conclusion**: separation of concerns is the right instinct, but the implementation (MongoDB) is wrong. The right separation is "raw bytes → B2, structured data → Postgres" — both layers, single Postgres.

### 6.5 Embeddings / pgvector / chunking — NO (deferred, not blocked)

**Decision**: Do not add vector embeddings to the schema. Do not chunk extracted text. No pgvector dependency.

**Reasoning**:
- Embeddings buy semantic search ("find things by meaning"). Our system doesn't need this at hackathon scale.
- Each agent's context source: the Evidence Ledger (small — 100-300 nodes, fits in any prompt). Tools for deep dives: structured graph queries (`get_neighbors`, `get_source_text`) — exact lookups, no similarity needed.
- An important property of the current design: every agent sees the full ledger in its prompt, which means it can in principle consider any fact. If we switched to RAG (top-k chunks), each agent would only see retrieved facts — the Citation Gate would still catch fabricated IDs, but the agent might silently miss a relevant fact it didn't retrieve. The "every agent considered every fact" guarantee is weaker under RAG.
- Full-text search via Postgres `tsvector` (built-in, GIN index) covers any keyword-grep use case without embeddings.
- Adding embeddings = ~half a day of work for capability nothing in the pipeline actually calls. Bad ROI for a 2-day window.
- The schema additions are backward-compatible — we can add a `document_chunks` table with `embedding vector(1536)` in a future migration without touching the existing tables. **Deferred, not blocked.**

**What was tested and rejected**:
- "Embeddings for context management across agents." We walked through every current and planned agent (Intake, Evidence, Advocate, Opposing, Adjudicator A/B, Verifier, Drafter, plus future Specialist Recruiter, Cross-Case Memory, Policy Interpreter). For each, we asked "would semantic search add capability over structured graph queries?" Answer: only Cross-Case Memory genuinely needs embeddings. Cross-Case Memory is v2.

### 6.6 Page-level granularity (no chunking below the page) — YES

**Decision**: One `document_pages` row per logical page. No further chunking.

**Reasoning**:
- A typical page is 200–1000 tokens. Fits in any prompt.
- Without embeddings, we don't need chunks; chunking is an embeddings-driven concern.
- If a page is genuinely huge (50,000 tokens with no natural breaks — rare), we can split it then. Not before.
- Logical pages: PDF native pages, DOCX/HTML use Heading 1/2 boundaries, plain text is a single page.

### 6.7 Redis (Upstash) for async job queue — YES

**Decision**: Use Upstash Redis as the async queue backing the extraction pipeline. Worker library: `arq` (Redis-backed, async-first, FastAPI-friendly).

**Reasoning**:
- For 5–10 documents (demo scale), synchronous extraction is fine — takes seconds.
- For 50–100 documents (design target), async with status polling is required.
- Upstash gives REST + native Redis protocol, generous free tier, no local Redis to run.
- `arq` is the right library for FastAPI + async Python; mature, low ceremony.

### 6.8 Pre-signed URLs for direct browser → storage uploads — YES

**Decision**: The browser uploads files directly to Backblaze B2 using a pre-signed URL. The backend never streams file bytes.

**Current implementation note**: B2's S3-compatible endpoint rejected POST policy uploads in testing, so `backend/ingestion/storage.py` now signs PUT URLs and the browser sends raw bytes with the signed `Content-Type`.

**Reasoning**:
- Server-mediated uploads double the bandwidth (browser → backend → storage). For 50 × 50 MB files that's 2.5 GB through our server per case.
- Pre-signed URLs keep the backend stateless and fast.
- Modest extra frontend work (compute SHA-256 locally, POST to backend for signed URL, PUT file to B2). Worth it.

### 6.9 Python backend (not TypeScript) — YES

**Decision**: The production backend is Python, FastAPI, in `backend/`. The TypeScript stack (`src/`, `server/`) is kept as the offline `pnpm demo` showcase but is not the production path.

**Reasoning**:
- Python has better libraries for the ingestion lane (pdfplumber, python-docx, BeautifulSoup, Whisper, all mature).
- The team is already running Python with FastAPI.
- The Band SDK integration was implemented in Python (Sudharsan's commits).
- The TypeScript demo is valuable for offline mode (no API keys, deterministic outputs) — kept at the root for `pnpm demo`. Not deprecated, just not the production deployment.

### 6.10 No bash/grep/shell-access tools for agents — NO

**Decision**: Agents do not get shell or bash access. No `grep`, no filesystem read.

**Reasoning**:
- Security: shell injection from agent-generated arguments.
- Performance: file I/O is slower than indexed DB queries.
- Wrong abstraction: agents should query structured data, not parse strings.

**What we DO give them**: structured tool functions that achieve the same goals: `search_documents(query)` (Postgres FTS), `get_source_text(document_id, page_number)`, `get_neighbors(node_id, edge_type)`, `find_path(from, to)`, `query_facts_by_party(name)`. These are the semantic equivalent of grep, but safer, faster, indexed.

### 6.11 No web-search tool for agents — NO (deferred)

**Decision**: Agents cannot search the web. No fetching arbitrary URLs.

**Reasoning**:
- Web search **breaks the Citation Gate.** The gate validates citations against a known local store (ledger + statute table). If an agent can cite a Wikipedia URL or a random blog, the gate's universality guarantee collapses.
- Caching web results into our statute store with verbatim-quote anchoring is a significant architectural extension (we'd need URL → cache → verbatim-check infrastructure). Not 2-day-shippable cleanly.
- **Deferred to v2** with explicit acknowledgment in the README. If we want "agents extending themselves dynamically" for the demo without web search, the **Specialist Recruitment** pattern (Adjudicator spawns a Policy Interpreter at runtime) gives us that moment safely.

### 6.12 SHA-256 content addressing — YES

**Decision**: Document IDs in the DB are UUIDs, but the storage layer addresses files by SHA-256 of the content. `(case_id, sha256)` is unique → re-uploading the same file is idempotent.

**Reasoning**:
- Cheap idempotency: re-upload the same file, no double-extract.
- Cheap deduplication: same file across different cases doesn't double-store at the byte level (we still keep per-case `documents` rows since metadata may differ).
- Tamper-evident: any byte change → new SHA → new storage object.

### 6.13 Tenant ID column even for single-tenant demo — YES

**Decision**: Every "owned" table has a `tenant_id` column with a default demo-tenant UUID.

**Reasoning**:
- Costs nothing in the demo.
- Signals production thinking — "we know what multi-tenant looks like."
- Trivial to add Row Level Security policies later without schema changes.

### 6.14 CHECK constraints over Postgres ENUMs — YES

**Decision**: Type-like columns (`status`, `kind`, `consensus_type`, etc.) use `text` with `CHECK (col IN (...))` rather than Postgres ENUM types.

**Reasoning**:
- ENUMs require `ALTER TYPE` to extend, which locks the type and is awkward to migrate.
- CHECK constraints can be dropped and re-added cleanly in a follow-up migration when the team needs new values.
- Pydantic `Literal[...]` types in `backend/schemas/*.py` enforce the same set on the application side.

### 6.15 Cascade deletes from `cases` — YES (with one exception)

**Decision**: All child tables (`documents`, `document_pages`, `nodes`, `edges`, `transcript`, `decisions`) use `ON DELETE CASCADE` from `cases`. Deleting a case wipes everything it owns.

**Exception**: `nodes.source_document_id` uses `ON DELETE SET NULL`, not CASCADE. Reasoning: a historical fact should survive its source document being removed (audit-trail preservation). The fact is the fact; losing the source link is recoverable, losing the fact itself is not.

### 6.16 Backend folder reorg (lumen_py → backend/app, web → frontend) — YES

**Decision**: Reorganized the repo to put all Python production code under `backend/`, the static UI under `frontend/`, and the legacy TS demo at the root.

**Reasoning**:
- The previous flat `lumen_py/` didn't communicate "this is the production Python backend" vs. "this is one of several modules."
- Clear lane boundaries become visible at the folder level: `backend/ingestion/` (Aman), `backend/ledger/` (Gowtham), `backend/app/` (Sudharsan), `backend/schemas/` (shared contracts).
- The reorg was done as a single logical change (one PR-equivalent) with all imports preserved (rename, not split-by-concern).

### 6.17 Granular split of backend/app/ into agents/, gates/, pipeline/ — DEFERRED

**Decision**: Keep `backend/app/` flat for now. Do not split into `backend/agents/`, `backend/gates/`, `backend/pipeline/`.

**Reasoning**:
- Splitting requires updating 30+ relative imports. High churn for low immediate value.
- The flat structure inside `app/` is working and Sudharsan's lane.
- Doable in a future follow-up PR without time pressure.

### 6.18 Application schemas separate from pipeline types — YES

**Decision**: Two parallel Pydantic model trees:
- `backend/schemas/` — storage layer. One file per DB table. `*Row` for reads, `*Create` for inserts.
- `backend/app/types.py` — pipeline layer. Agent I/O shapes (`Fact`, `EvidenceLedger`, `Decision`, etc.) used inside `pipeline.py`.

**Reasoning**:
- The two layers describe **different things.** A `Fact` in the pipeline is the in-memory shape an agent emits. A `NodeRow` with `type='Fact'` in storage is the persisted record (with `verbatim_quote`, `source_document_id`, etc.).
- Mixing them causes "model bloat" — fields that matter for storage shouldn't pollute the agent prompt, and vice versa.
- The conversion is the ledger lane's responsibility (Gowtham).

---

## 7. Database Schema (table-by-table)

The schema is defined in `backend/db/migrations/001_initial.sql` and documented in `backend/db/README.md`. Application-level Pydantic mirrors live in `backend/schemas/`.

### Tables

1. **`cases`** — one row per subrogation case. `tenant_id` defaults to demo UUID. Three boolean flags drive the cross-stage handoff: `ingestion_complete`, `ledger_complete`, `finalized`. Unique on `(tenant_id, case_id)`.

2. **`documents`** — one row per uploaded file, content-addressed by `sha256`. `(case_id, sha256)` unique → re-uploading is idempotent. Storage metadata (`storage_provider`, `storage_bucket`, `storage_key`, optional `storage_url`) lets us regenerate signed URLs on demand. Status enum: `pending` → `uploaded` → `extracting` → `extracted` or `failed`. `document_kind` preserves the human-readable category ("police report", "FNOL", etc.) the pipeline's `ClaimInput.documents[].kind` expects.

3. **`document_pages`** — one row per logical page of extracted text. PDFs use native pages; DOCX/HTML use Heading 1/2 boundaries; plain text is one page. `extracted_text` is TEXT (TOAST handles large values). GIN full-text index on `to_tsvector('english', extracted_text)` for keyword search.

4. **`statutes`** — public legal text. `statute_id` globally unique (e.g. `CA-1431.2`, `CVC-21453`). Seeded by `002_seed_statutes.sql`.

5. **`nodes`** — Gowtham's ledger graph. `node_id` is the human-readable display ID (`F1`, `P1`, etc.), unique within a case. `type` is enumerated (Fact, Party, Vehicle, Event, Location, Statute, Damage, Document). For Fact nodes, `verbatim_quote + source_document_id + source_page_number` is the anchor the Fact Gate checks.

6. **`edges`** — typed graph relationships. Types: `mentioned_in`, `corroborates`, `contradicts`, `attributed_to`, `governed_by`, `caused`, `involves`, `occurred_at`, `drives`. Both directions indexed for graph traversal.

7. **`transcript`** — per-pipeline-run Band-room postings. `run_id` generated by the orchestrator at run start; `(run_id, seq)` is canonical ordering.

8. **`decisions`** — one row per pipeline run, holding the `FinalDecision` payload. `secondary_decision` (JSONB) carries Adjudicator B's full output. `fault_table` (JSONB array) is the Adjudicator's `{factId, favors, weight}[]`. `audit_hash` is SHA-256 of `(postings + decision + letter)` — tamper-evident.

### What's NOT in the schema (and why)

- **No embeddings, no pgvector, no document_chunks.** See §6.5.
- **No `runs` table.** `run_id` is a bare UUID. We can add a `runs` table later if we want to query run-level metadata.
- **No Row Level Security policies yet.** `tenant_id` columns exist; RLS adds friction without benefit for single-tenant demo. Add when we go multi-tenant.
- **No `CHECK` that Fact nodes have `verbatim_quote`.** Considered, rejected — Gowtham may want intermediate states where a Fact is being assembled and the anchor isn't filled yet. App-level validation handles it.

---

## 8. Codebase Layout (current, post-reorg)

```
Band-AI-Hack/
├── backend/                          # Production Python backend
│   ├── app/                          # The existing orchestration pipeline (FastAPI + Band SDK)
│   │   ├── server.py                 #   FastAPI app + SSE routes
│   │   ├── run_server.py             #   Entry: python -m backend.app.run_server
│   │   ├── run_demo.py               #   CLI: python -m backend.app.run_demo
│   │   ├── pipeline.py               #   The structured debate + dual-adjudication + verifier
│   │   ├── agents.py                 #   Agent definitions
│   │   ├── prompts.py                #   System prompts
│   │   ├── gates.py                  #   Citation, Fact, Math gates (code-enforced)
│   │   ├── verifier.py               #   Source-Alignment Verifier helper
│   │   ├── room.py                   #   Band-room wrapper (LocalRoom + BandRoom)
│   │   ├── providers.py              #   Anthropic / Gemini / OpenAI clients + mock switch
│   │   ├── mock_responses.py         #   Deterministic offline outputs
│   │   ├── config.py                 #   Models, providers, thresholds
│   │   ├── types.py                  #   Pipeline-internal Pydantic models
│   │   ├── ledger.py                 #   Evidence-ledger rendering helpers
│   │   ├── band_config.example.yaml  #   Band SDK config template
│   │   └── probe_band*.py            #   Incremental Band-SDK connection probes
│   │
│   ├── schemas/                      # Application-level Pydantic = mirror DB rows
│   │   ├── case.py
│   │   ├── document.py
│   │   ├── document_page.py
│   │   ├── statute.py
│   │   ├── node.py
│   │   ├── edge.py
│   │   ├── transcript.py
│   │   └── decision.py
│   │
│   ├── ingestion/                    # File uploads + text extraction (Aman's lane)
│   │   ├── routes.py                 #   /api/ingest router
│   │   ├── service.py                #   Top-level orchestrator
│   │   ├── repository.py             #   Typed Supabase queries
│   │   ├── storage.py                #   Backblaze B2 wrapper
│   │   ├── queue.py                  #   Async extraction queue (arq + Redis)
│   │   └── extractors/               #   Per-format text extractors
│   │       ├── base.py               #     Extractor protocol
│   │       ├── pdf.py                #     pdfplumber
│   │       ├── docx.py               #     python-docx
│   │       ├── html.py               #     BeautifulSoup
│   │       ├── text.py               #     plain text
│   │       └── registry.py           #     MIME-type dispatch
│   │
│   ├── ledger/                       # Graph builder (Gowtham's lane, stub)
│   │   └── README.md
│   │
│   └── db/
│       ├── README.md
│       └── migrations/
│           ├── 001_initial.sql
│           └── 002_seed_statutes.sql
│
├── frontend/                         # Static UI (HTML/JS/CSS)
│   ├── index.html
│   ├── app.js
│   └── styles.css
│
├── src/                              # Legacy TypeScript demo (offline `pnpm demo`)
│   └── ... (unchanged from before reorg)
│
├── server/                           # Legacy Express server (offline `pnpm serve`)
│
├── data/                             # Fixtures + sample claims
│   ├── sample_claim_clean.json
│   ├── statutes.json
│   ├── cases.json
│   └── case_files/                   # Future: ingested case payloads
│
├── docs/                             # Long-form documentation
│   ├── README.md                     # Doc map
│   ├── architecture.md               # Architecture overview
│   ├── product-context.md            # Product narrative
│   ├── project-plan.md               # Day-by-day plan
│   └── claude-context.md             # THIS FILE
│
├── scripts/                          # Cross-cutting scripts (empty for now)
├── README.md                         # Project README
├── AGENTS.md                         # Repo conventions
├── LICENSE                           # MIT
├── .env.example
├── .gitignore
├── package.json                      # TS deps (pnpm)
├── pnpm-workspace.yaml               # Workspaces (not yet split into packages)
├── pnpm-lock.yaml
├── requirements.txt                  # Python deps
└── tsconfig.json
```

---

## 9. The Two Pydantic Layers

Important conceptual distinction that's easy to miss when reading the code:

### Layer A — `backend/schemas/` (storage layer)

Models that mirror SQL table rows. One file per table. Used by:
- Repositories that read from / write to Supabase.
- FastAPI route handlers that accept request bodies and return response bodies.

Naming convention:
- `*Row` = the shape of a row read from the DB.
- `*Create` = the shape required to insert a new row (subset of `*Row`, excludes id and timestamps).
- `*Update` = partial update shape (optional fields).

### Layer B — `backend/app/types.py` (pipeline layer)

Models that describe **in-memory agent I/O**. Used by:
- The pipeline orchestrator.
- LLM response validation (zod-equivalent on the Python side).

Examples: `Fact`, `EvidenceLedger`, `ClaimInput`, `Decision`, `FinalDecision`, `Point`, `Rebuttal`, `AlignmentResult`.

### The relationship

A `Fact` from layer B is persisted as a `NodeRow` with `type='Fact'` in layer A. The conversion is the **ledger lane's responsibility** — Gowtham's code reads `EvidenceLedger.facts[]` from the pipeline and writes `NodeRow` records to storage. Same data, two views, kept clean by separating them.

---

## 10. Ingestion Lane (Aman's)

### Current status

**Schema**: complete and ready to apply (`backend/db/migrations/001_initial.sql`).
**Module structure**: complete (`backend/ingestion/` with all files).
**Extractors**: real implementations for PDF (pdfplumber), DOCX (python-docx), HTML (BeautifulSoup), plain text.
**Storage / Queue / Repository**: stubbed with full method signatures. Real implementations pending credentials.
**Routes**: complete, FastAPI router with 5 endpoints, but `get_service()` raises `NotImplementedError` until credentials land.

### Endpoint contract (`/api/ingest/*`)

| Method | Path | Body | Response | Purpose |
|---|---|---|---|---|
| POST | `/case` | `CaseCreate` | `CaseRow` | Create a new case shell |
| POST | `/sign-upload` | `{case_id, filename, mime_type, size, sha256}` | `{document_id, upload_url, upload_fields, storage_key}` | Reserve a documents row + return a pre-signed B2 upload URL |
| POST | `/commit` | `{document_id}` | `DocumentRow` | Confirm the file is in storage, enqueue extraction |
| GET | `/status/{case_id}` | — | `{case, documents[], ingestion_complete}` | Polling endpoint for the frontend |
| POST | `/finalize/{case_id}` | — | `CaseRow` | Flip `cases.ingestion_complete = true` |

### Required credentials (to wire it live)

- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` — Postgres + Storage (we use only Postgres).
- `B2_KEY_ID`, `B2_APPLICATION_KEY`, `B2_REGION`, `B2_BUCKET`, `B2_ENDPOINT_URL` — Backblaze.
- `REDIS_URL` — Upstash or other Redis for the extraction queue.

When credentials arrive, replace the `NotImplementedError` stubs in:
- `backend/ingestion/storage.py` (boto3 with custom endpoint)
- `backend/ingestion/repository.py` (supabase-py with service-role key)
- `backend/ingestion/queue.py` (arq pool)

### Supported file formats (current scope)

In scope: native PDF, DOCX, HTML, plain text.

Deferred (phase 2): JPG/PNG (vision via Gemini or Claude), audio (Whisper via OpenAI).

Explicitly excluded: scanned PDFs (OCR is a rabbit hole), old DOC (LibreOffice conversion), video, Excel.

### File-size design target

50 documents per case, up to 50 MB per file. Demo will pre-seed a smaller case so the video doesn't depend on live extraction latency.

### Test-data plan

The team will provide PDFs once the schema is provisioned. Aman runs a seed script that loads `data/sample_claim_clean.json` into the Supabase tables as the baseline test case, then real PDFs go through the full upload flow.

---

## 11. Ledger Lane (Gowtham's)

### Current status

**Schema**: complete (`nodes` + `edges` tables in `001_initial.sql`).
**Application schemas**: complete (`backend/schemas/node.py`, `backend/schemas/edge.py`) — `NodeRow`, `NodeCreate`, `EdgeRow`, `EdgeCreate`, plus `NodeType` and `EdgeType` literals.
**Implementation**: stub. `backend/ledger/` contains only a README laying out the lane's contracts.

### Contract from ingestion

When `cases.ingestion_complete = true` flips, Gowtham subscribes (either polls or Supabase Realtime) and starts extraction. He reads:
- `documents` and `document_pages` for that case (extracted text).
- `statutes` (the public statute store).

### Contract to orchestration

Gowtham writes:
- `nodes` rows (typed graph nodes with verbatim quotes for Fact nodes).
- `edges` rows (typed graph relationships).
- Flips `cases.ledger_complete = true` when done.

### Constraints to preserve (DO NOT BREAK)

1. **Every Fact node must carry a `verbatim_quote` plus `(source_document_id, source_page_number)`.** The Fact Gate downstream substring-checks the quote against `document_pages.extracted_text`. If the anchor is wrong, the case won't pass the gate.
2. **`node_id` must be unique within a case.** Stick to `F1, F2, …` and `P1, P2, …` conventions so the orchestration's Citation Gate works unchanged.
3. **Edge types must be from the enumerated set.** Adding new types means a follow-up SQL migration + Pydantic literal update.

### Suggested module layout (when implementation lands)

```
backend/ledger/
├── builder.py      # Reads documents → produces nodes/edges via LLM extraction
├── prompts.py      # Extraction-agent system prompts
├── repository.py   # Typed Supabase writes
└── README.md       # (already exists)
```

---

## 12. Orchestration Lane (Sudharsan's)

### Current status

This lane has the most production code today. The original Lumen TS engine, the Python port (`backend/app/`), the FastAPI server, the SSE streaming, the dual-adjudicator + verifier flow, the audit-hash computation, and the real Band SDK integration all live here.

### What's working

- Mock mode runs offline end-to-end (`python -m backend.app.run_demo`).
- The FastAPI server serves the frontend and streams runs over SSE (`python -m backend.app.run_server`).
- All five harness gates fire in the right places in the pipeline.
- Two adjudicators run in parallel; consensus check passes.
- The Source-Alignment Verifier audits the transcript.
- Letter Reconciliation closes the loop.

### What needs to change after the DB is wired

- `backend/app/server.py:api_cases` and `:api_case` currently read from `data/cases.json` + `data/sample_claim_clean.json`. After ingestion writes cases to Supabase, these need to read from the `cases` + `documents` + `document_pages` tables.
- The adapter that turns a Supabase-stored case into an in-memory `ClaimInput` is Aman's lane (`backend/ingestion/adapters.py`) — Sudharsan calls it.
- The transcript should be persisted to the `transcript` table (per `run_id`).
- The decision should be persisted to the `decisions` table (one row per run).

### What can be deferred to v2

- Specialist Recruitment (the Adjudicator dynamically spawning new agents at runtime).
- Cross-case memory (semantic similarity over past cases).

---

## 13. The Pipeline — Step-by-Step Walkthrough

Located in `backend/app/pipeline.py`. The sequence for a single case:

1. **Intake Parser** reads the documents and emits `Intake` (parties, date, location, damages).
2. **Evidence Aggregator** reads the documents and emits the `EvidenceLedger` (list of `Fact` with id, statement, source, verbatim_quote, confidence).
3. **Fact Gate** code-checks every fact's `verbatim_quote` is a contiguous substring of its source document. Pass → green. Fail → flag for human, proceed.
4. **Liability Advocate** writes opening points, each with citations. Citation Gate runs per point.
5. **Opposing Red Team** writes its **own independent theory** (blind — before seeing Advocate's points). Citation Gate again.
6. **Opposing Red Team** sees Advocate's points and writes attacks (Citation Gate).
7. **Liability Advocate** writes rebuttals or concessions (Citation Gate).
8. **Debate closes.** Intentionally no consensus round.
9. **Adjudicator A and Adjudicator B run in parallel** on different model families. Each produces a `Decision` with `faultTable + otherDriverFaultPct + confidence + reasoning`. Math Gate runs on each.
10. **Consensus Gate** compares the two percentages. ≤10pp → average. >10pp → escalate.
11. **Source-Alignment Verifier** walks every (claim, fact-citation) pair from the transcript and labels each as `supported / contradicted / overreach / neutral`. Contradicted → escalate.
12. **Final escalation logic** combines all escalation triggers (≥$25K, low confidence, near 50/50, math gate failure, consensus disagreement, contradicted verifier results) into a single decision.
13. **Demand Letter Drafter** writes the formal letter from the canonical decision.
14. **Letter Reconciliation** checks the letter contains the decided percentage and dollar amount.
15. **Audit hash** computed over `(transcript + decision + letter)` and returned with the result.

---

## 14. Hypothesis Testing & Brainstorming

This section documents ideas we tested, kept some, rejected most.

### Tested and kept

- **Code gates over prompt gates.** Prompts can be ignored; code cannot. The Citation Gate is the original example; we generalized this to four more gates.
- **Red-team prompt for Opposing (not "negotiator").** Explicit instruction to attack. Confirmed via testing — explicit adversarial framing prevents drift.
- **Independent drafts before exchange.** Opposing produces its own theory before seeing Advocate's. Kills anchoring.
- **Different model families per side.** Claude vs. GPT. Resists sycophantic convergence.
- **Separation of powers.** Debaters do not decide; a separate Adjudicator does.
- **Computed fault table.** Adjudicator must show its math.
- **Dual adjudication.** Two adjudicators on different model families. Caught a hypothetical disagreement case in design review.
- **Source-Alignment Verifier.** Closes the "cited but misrepresented" hole. Mock data includes one overreach to prove the verifier does nuanced work.

### Tested and rejected

- **MongoDB for raw text dumps.** Rejected — Postgres handles the scale, MongoDB adds operational cost without capability.
- **Embeddings / pgvector / chunking.** Rejected at hackathon scale. Deferred, not blocked.
- **Web search for agents.** Rejected — breaks Citation Gate's universality.
- **Shell/bash tools for agents.** Rejected — security, performance, wrong abstraction.
- **A separate `runs` table.** Deferred — `run_id` as a bare UUID is sufficient for now.
- **Row Level Security for the demo.** Deferred — `tenant_id` columns exist; policies come later.
- **Splitting `backend/app/` into agents/, gates/, pipeline/ subfolders.** Deferred — high import churn, low immediate value.
- **"3 documents per case" as the design target.** Rejected — wildly off for real subrogation (50–500). Updated target: 50 × 50 MB.
- **"Agents need fast retrieval at runtime."** Rejected — agents get the full ledger in their prompt; retrieval is for occasional deep dives via structured tools.
- **PCA-style compression analogy for the ledger.** Wrong mechanism. The ledger is **summarization-with-pointers** (atomic facts + verbatim source quotes), not dimensionality reduction.

### Alternative project ideas considered (rejected for Lumen)

Before committing to Lumen subrogation, we explored:
- **Sentinel** — ECCN/HTS Export Control Classification (Track 3). Strong defensibility (federal audit mandate) but smaller demoability.
- **Healthcare claims denial appeals.** $25.7B/yr pain. Rejected because Recourse (another submission) targets the same domain.
- **Catalyst** — Clinical Trial Protocol Amendments. Strong fit, deferred for domain depth concerns.
- **Forge** — OSS Maintainer Band (Track 2). Creative pick. Rejected because Track 3 with insurance was less crowded.
- **Argus** — Trade Finance LC Compliance. Strong fit, deferred.
- **Athena** — Patent Office Action Response. Strong fit, deferred.

**Lumen won the bake-off** for: cleanest multi-agent justification (privilege walls + multi-team ownership in P&C insurance), biggest dollar pain ($15–20B), completely untouched in the Band submissions, most visceral demo (dollar amount recovered, on screen), and naturally fits the multi-provider/multi-model architecture (both sponsor prizes).

---

## 15. Competitor Analysis (Recourse)

**Project URL**: https://lablab.ai/ai-hackathons/band-of-agents-hackathon/recourse/recourse-adversarial-claims-adjudication
**GitHub**: https://github.com/kasbsquall/recourse

### What Recourse does

Insurance claim **denial appeals** (not subrogation). Five agents: Coordinator (orchestrator), Blake (Claims Evaluator pro), Morgan (Policy Analyst with RAG), Alex (Devil's Advocate con), Sam (Resolution Notary). Built on Next.js + FastAPI + Postgres + pgvector. Uses AI/ML API (GPT-4o) + Featherless (Hermes-2-Pro). Anti-hallucination via RAG retrieval of policy clauses and SHA-256 hashing of the transcript. Output: a "signed, reasoned resolution."

### How Lumen differs (the differentiation strategy)

| Dimension | Recourse | Lumen |
|---|---|---|
| Workflow | Denial appeals (pre-payment, insurer vs policyholder) | Subrogation (post-payment, insurer vs another insurer) |
| Domain | Insurance claim adjudication | Insurance recovery operations |
| Actors | Insurer + policyholder | Insurer A + insurer B (intercompany) |
| Anti-hallucination | RAG retrieval + SHA-256 hash | **5 code-enforced gates** (Citation, Fact, Math, Verifier, Letter Recon) |
| Decision shape | Approve / deny | Fault percentage 0-100 + dollar amount + comparative-negligence math |
| Output artifact | "Reasoned resolution" | Mail-ready demand letter with $35,700 visible |
| Fault model | Policy clause interpretation | Tort law + comparative negligence statutes |

**Risk on differentiation**: a tired judge in the third hour of demos lumping the two together because both are "insurance + multi-agent + adversarial."

**Mitigation**: pitch must lead with subrogation specifically and contrast against denial-appeals explicitly. *"$15–20 billion in recoveries left on the table every year because subrogation is too manual."* Not "AI claims agents argue."

**Where Lumen is genuinely stronger**:
1. Harness depth. Recourse has 2 protections (RAG + hash). Lumen has 6 code gates plus the dual-adjudicator structure. That's the architectural moat.
2. Concrete artifact. A demand letter with a specific dollar amount is more demoable than a "reasoned resolution."
3. Fault math. Comparative-negligence percentage is more visceral than a binary approve/deny.

**Where Recourse may be stronger**:
1. UI polish. Next.js frontend is more sophisticated than our static HTML/JS/CSS. Closing the gap is a real concern — see §17 for the plan.

---

## 16. Open Questions / TODOs (in priority order)

### Blocking (need to land before submission)

1. **Provision Supabase and Backblaze B2 accounts**, share credentials. Aman owns. No code can run live without this.
2. **Apply migrations** to the fresh Supabase project. `backend/db/migrations/001_initial.sql` + `002_seed_statutes.sql`, paste into SQL editor.
3. **Wire `IngestionRepository`, `ObjectStorage`, `ExtractionQueue`** — replace `NotImplementedError` stubs with real implementations using `supabase-py`, `boto3`, `arq`.
4. **Add ingestion deps to `requirements.txt`** with pinned versions: pdfplumber, python-docx, beautifulsoup4, supabase, boto3, arq, upstash-redis.
5. **Sudharsan rewrites `backend/app/server.py`** to read cases from Supabase instead of `data/cases.json`. Adapter helper in `backend/ingestion/adapters.py` (Aman writes the adapter).
6. **Gowtham implements `backend/ledger/builder.py`** — the graph-extraction agent + repository writes.
7. **Two more test cases**: a "disputed" case (both drivers partly at fault) and a "loser" case (our insured was at fault). The loser case is the **credibility moat** in Q&A: *"the system also tells you when NOT to pursue."*
8. **Deployment**. Backend on Railway or Render (long-running container for the 30–90s pipeline runs). Frontend on Vercel. Public URL.
9. **3-minute demo video.** Follow the script in `docs/project-plan.md` §9.
10. **Pitch deck** (8 slides per `docs/project-plan.md` §10).

### Nice to have

11. **Specialist Recruitment** — Adjudicator can spawn a Policy Interpreter at runtime via a tool call. Big Band-narrative win if shipped.
12. **Granular split of `backend/app/`** into agents/, gates/, pipeline/ subfolders. Deferred refactor, no functional impact.
13. **Vercel/Cloudflare frontend polish** — drag-drop upload, real-time progress indicators, polished case list.

### Open decisions awaiting input

- **Pin specific versions in `requirements.txt`** — confirm team's Python version (3.11+ assumed) before pinning.
- **Use `supabase-py` (sync) vs raw `asyncpg` (async)** for the repository. supabase-py is simpler but blocks; asyncpg is faster but more setup.
- **Where the adapter `load_case_from_db()` lives** — Aman's lane (`backend/ingestion/adapters.py`) or orchestration's lane (`backend/app/`). Preference: Aman's, keeps orchestration ignorant of Supabase.

---

## 17. Future Scope (Phase 2+)

Explicitly deferred — note in pitch deck "next steps" slide, do not build:

- **OCR for scanned PDFs.** Real claim files have scanned police reports. Tesseract (free, decent) or AWS Textract / Google Document AI (paid, accurate). Out of scope for demo; mention as roadmap.
- **Image and audio ingestion.** Photos via a vision model (Gemini or Claude), audio via Whisper (OpenAI). Mentioned in earlier discussion but punted to phase 2.
- **Video ingestion.** Body-cam footage, dash-cam. Out of scope.
- **Old DOC format.** LibreOffice CLI conversion. Out of scope.
- **Excel ingestion.** Sheetjs/xlsx with structured table extraction. Punted.
- **Cross-case memory.** "Find similar past cases" — needs embeddings. Punted.
- **Specialist Recruitment.** Adjudicator dynamically requesting a Policy Interpreter, IRB-style specialist, etc. Strong demo moment if implemented, but currently in stretch goal status.
- **Web search.** Tool for agents to fetch current statutes from external sources. Breaks Citation Gate without significant infrastructure additions. Punted.
- **Multi-tenant Row Level Security** policies. Schema is ready (`tenant_id` columns); policies can be added later.
- **Guidewire / Duck Creek integration.** B2B insurance carriers use these claims platforms. Production integration story. Mention in pitch, don't build.
- **Soft-delete columns** (`deleted_at`) for recoverable removes. Phase 2.
- **A `runs` table** with pipeline-execution metadata. Phase 2.
- **`document_chunks` table + vector embeddings** for semantic retrieval. Phase 2.
- **A `cases_summary` view** that pre-joins document counts and statuses for the frontend's case list. Easy to add when needed.

---

## 18. Critical Constraints (DO NOT BREAK)

If you're modifying anything, treat these as bright lines:

1. **The harness is non-negotiable.** Every code-enforced gate (Citation, Fact, Math, Consensus, Source-Alignment, Letter Reconciliation) must keep firing. If a refactor breaks a gate, the refactor is wrong.
2. **No web search for agents.** Breaks Citation Gate's universality. Defer to v2.
3. **No shell/bash/filesystem tools for agents.** Security + abstraction concerns. Use structured DB queries instead.
4. **No consensus round in the debate.** Pipeline ends after rebuttal. No "find common ground" turn. Anti-collusion.
5. **Mock mode must keep working.** `python -m backend.app.run_demo` runs offline with zero keys. Required for demo video recording (no API flake risk).
6. **The Opposing red team is never told to be conciliatory.** Its prompt forbids negotiation. Don't soften.
7. **Debaters do not decide.** Separation of powers. The Adjudicator (a separate agent) is the only one that sets the percentage.
8. **Every Fact node must have a verbatim_quote that appears in its source document.** The Fact Gate enforces this. Do not skip the anchor.
9. **Statutes are quoted, not paraphrased.** Agents reference statute IDs (e.g., `CA-1431.2`); the statute text is injected from the database verbatim.
10. **"Not in evidence" is an acceptable answer.** Agents should escalate rather than invent. The system is comfortable saying "I don't know."
11. **No agent writes into another lane's tables.** Ingestion writes only its tables. Ledger only its tables. Orchestration only its tables.
12. **Don't commit secrets.** `.env` is git-ignored. Use `.env.example` as the template. Supabase service-role keys are backend-only — never exposed to the frontend.

---

## 19. Hackathon Submission Checklist (deadline Jun 19, 8:30 PM IST)

To submit Thursday June 18 evening (one day early), we need:

1. ☐ **Live URL** — backend on Railway/Render, frontend on Vercel. Tested from a phone, not just localhost.
2. ☐ **3-minute demo video** — script in `docs/project-plan.md` §9. Use mock mode (deterministic), no API flake risk.
3. ☐ **Pitch deck** — 8 slides per `docs/project-plan.md` §10.
4. ☐ **GitHub repo** — public, MIT-licensed, README explains how to run.
5. ☐ **At least 3 test cases** — clean win (Alex/Jordan), disputed, loser. The loser case is the credibility moat.
6. ☑ **Multi-family independence** — the debate and dual-adjudicator consensus span Claude / Gemini / GPT (genuinely independent models). (Partner prizes no longer targeted — AI/ML API + Featherless dropped.)

---

## 20. Glossary (so coding agents don't guess)

- **Subrogation** (insurance) — the process by which an insurer that has paid a loss to its insured pursues recovery from the at-fault third party. "Subro" for short.
- **FNOL** (insurance) — First Notice of Loss. The initial report of an insurance claim, usually from the insured to their carrier.
- **EDR** (automotive) — Event Data Recorder. The "black box" in modern cars that records speed, throttle, brake state in the seconds before impact.
- **Comparative negligence** (law) — a doctrine in most US states under which damages are allocated based on each party's share of fault. California Civil Code §1431.2 is the canonical citation we use.
- **CVC** — California Vehicle Code. CVC 21453 = the steady-red-signal statute.
- **The Harness** (Lumen) — the bundle of code-enforced gates plus anti-collusion structural mechanisms that keep the multi-agent debate honest. The single most important architectural decision in this repo.
- **Evidence Ledger** — the structured, atomic-fact representation of a claim file that downstream agents reason over. Built by the Evidence Aggregator. Has an ID (F1, F2, …), statement, source, verbatim quote, and confidence per fact.
- **Citation Gate** — code that rejects any agent message whose citations don't resolve to known fact IDs or statute IDs. Original gate; load-bearing.
- **Fact Gate** — code that verifies each ledger fact's `verbatim_quote` is a contiguous substring of its source document. Anchors the ledger to real text.
- **Math Gate** — code that verifies the Adjudicator's stated percentage is consistent (within ±10pp) with its own fault table. Catches LLM arithmetic drift.
- **Consensus Gate** — code that checks two adjudicators' percentages agree within 10pp. Escalates on disagreement.
- **Source-Alignment Verifier** — agent (Gemini) that audits whether every cited claim actually follows from its cited fact. Catches "cited but misrepresented" — the biggest semantic hole.
- **Letter Reconciliation** — code that verifies the drafted demand letter contains the decided fault % and dollar amount. Catches dashboard-vs-mailbox drift.
- **Recovery Packet** — the final artifact: fault analysis + recovery dollar amount + demand letter + transcript + audit hash.
- **Ledger lane** — Gowtham's responsibility. Builds the `nodes` + `edges` graph from extracted text.
- **Ingestion lane** — Aman's responsibility. File uploads → extracted text in `documents` + `document_pages`.
- **Orchestration lane** — Sudharsan's responsibility. Runs the 8-agent debate, writes `transcript` + `decisions`.

---

## 21. Iteration Log (where this doc lives over time)

If you're updating this document, leave a one-liner here so we can track when major mental-model changes happened.

- **2026-06-17 (initial)** — Claude wrote the first version after the codebase reorg into `backend/`, `frontend/`, `backend/schemas/`, `backend/ingestion/`. State: schemas + migrations + ingestion skeleton complete; storage + queue + repository stubbed pending credentials; ledger lane is README-only; orchestration unchanged from pre-reorg.

---

## 22. If You're a Coding Agent Reading This for the First Time

Quick orientation:
1. Read §3 (the product), §4 (the harness), §5 (the team lanes), and §18 (the bright lines).
2. Look at the lane you've been assigned to (§10, §11, or §12) for your contract.
3. Check §16 for what's blocked vs. ready.
4. **Before making any architectural change, read §6 to see if it's already been decided.** Most "obvious" ideas have been considered and rejected.
5. Ask for clarification rather than guess on contracts. The team has spent real time defining lane boundaries; respect them.

---

## 23. The Conversation Arc — Detailed Reasoning Chains

The sections above capture *what* we decided. This section captures *how we got there* — the actual dialog, the questions asked, the answers given, the workarounds considered, the things rejected. It's the raw context, organized chronologically by phase of the project.

If you only want the verdicts, §6 has them. If you want the why-we-think-this-is-right, read on.

### 23.1 Phase 1 — Reading the hackathon page

**The starting question**: "Read the lablab.ai hackathon HTML and gather context — what are we focusing on building."

The page was a 19,000-line saved HTML. I extracted the visible text and pulled out:
- Three official tracks: Internal Enterprise Workflows, Multi-Agent Software Development, Regulated & High-Stakes Workflows.
- The four judging criteria (Application of Technology, Presentation, Business Value, Originality).
- The minimum requirement: 3+ agents collaborating through Band.
- Partner credits: BANDHACK26 (Band Pro), AI/ML API $10/person, Featherless $25/person + promo BOA26.

The user then asked specifically: "explain the Challenges section so I understand the genres we have to focus on." I broke down each track with the example use-cases listed by the hackathon: HR/finance/procurement (Track 1), planner/engineer/tester (Track 2), healthcare/finance/legal/insurance/compliance (Track 3).

I noted from competitor submissions: Track 3 was the most crowded; Tracks 1 and 2 had fewer entries. We didn't commit at this point — the user wanted to think.

### 23.2 Phase 2 — The deep-research workflow

**The user's framing**: "I want 3-4 ideas that aren't crowded. Be creative. Don't recommend something already covered. Do deep research."

I ran the `deep-research` skill (a multi-agent harness that does fan-out web searches → fetch → adversarial verification → cited synthesis). It executed 5 parallel search angles, 26 sources fetched, 110 claims extracted, 25 claims verified, 15 confirmed.

Key findings from the research:
- **Healthcare claims denial & appeals** — $25.7B/yr provider pain, 70% overturn rate on appeals, 3 review cycles, natural payer/provider/coding/clinical handoffs. **Distinct from MediChain** (which does pre-service prior-auth, not post-service appeals).
- **Export Control Classification (ECCN/HTS)** — federal audit mandate, $364,992/violation fines, 5-10 year audit retention, 37% of BIS enforcement is misclassification.
- **Clinical Trial Protocol Amendments** — $500K-$800K per amendment, 6.5 months, mandatory sequential handoffs across 5 stakeholders (sponsor, sites, IRB, FDA).
- **Middle-market commercial loan underwriting** — flagged as weaker after adversarial review.
- **BSA/AML SAR committee decisions** — adjacent to AEGIS (an existing submission), so partially saturated.

Crucial side-finding (Microsoft Azure CAF, verified 3-0): "Distinct roles like planner/reviewer/executor do NOT automatically justify multi-agent architecture." Multi-agent is justified by: (1) security/compliance boundaries with strict data isolation, (2) multiple teams managing separate knowledge domains, (3) multi-domain scale. **This became our litmus test.**

I presented four picks ranked: Sentinel (ECCN, Track 3, strongest defensibility), Overturn (healthcare denials, Track 3, biggest $$$), Catalyst (clinical trials, Track 3, highest novelty), Forge (OSS maintainer, Track 2, creative pick).

### 23.3 Phase 3 — The pivot to finance/insurance/legal

**The user's redirect**: "I'm thinking about finance/insurance/legal sectors. Be creative. Also think about how we win the Best Use of AI/ML API and Best Use of Featherless prizes."

This pivot changed the framing in two important ways:
1. **Sector-first instead of track-first.** Insurance subrogation became viable when we framed it as Track 3 (Regulated) but the sector pull made it more concrete.
2. **Partner-prize-aware architecture.** The user wanted both partner prizes baked into the design, not bolted on. I proposed the multi-provider, multi-model architecture as the *story* of the project, not a tax.

I wrote `FINANCE_INSURANCE_LEGAL.md` with three sector picks:
- **Argus** (Finance, Track 3) — AI Trade Finance Compliance Officer for Letter of Credit document review. ~70% of LC submissions have discrepancies; banks have entire "doc check" teams.
- **Lumen** (Insurance, Track 1+3) — AI Subrogation Recovery Officer. $15–20B/yr left uncollected because subrogation is manual.
- **Athena** (Legal, Track 3) — AI Patent Office Action Responder. ~600K office actions/yr, $3–10K each, $3–6B market.

**Why Lumen won**: Cleanest multi-agent justification (attorney work-product privilege creates *legal* walls between claims data and legal work-product — one agent legally cannot hold all the context). Biggest dollar pain. Completely untouched in the Band submissions list. Most visceral demo (a recovered dollar amount on screen).

The user committed to Lumen.

### 23.4 Phase 4 — Reading the existing Lumen codebase

**The user's instruction**: "Read the current codebase and gather context."

I discovered the project was further along than I'd assumed. The user had already built:
- A TypeScript engine in `src/` with 6 agents, the Citation Gate (code, not prompt), an Evidence Ledger, an Adjudicator with fault table, a Demand Letter Drafter.
- A mock-mode pipeline that runs deterministic offline (`pnpm demo`).
- `plan.md` with the full 6-day plan and the demo strategy.
- One sample case (`data/sample_claim_clean.json`) — Alex Rivera vs Jordan Blake, red-light runner in CA, $42K damages.
- Two CA statutes loaded (`CA-1431.2`, `CVC-21453`).

The architecture decisions I read as already-correct: code-enforced Citation Gate (not prompt-based), Evidence Ledger as single source of truth, Opposing as red team (not negotiator), independent drafts before exchange, different model families per side, no consensus round, separation of powers (Adjudicator doesn't argue), fault computed from a table, escalation triggers.

I saved this state to memory and reported back to the user: "the hard architectural decisions are already correct; what remains is execution, frontend, more test cases, deployment."

### 23.5 Phase 5 — The harness explanation (a teaching turn)

**The user's request**: "Let's first understand the harness now — also make me understand."

I explained the harness from first principles, using a courtroom analogy:

| Courtroom | Lumen |
|---|---|
| Witnesses testify what they saw | Evidence Aggregator extracts atomic facts |
| Sworn oath — penalty for lying | Citation Gate — code rejects unsourced claims |
| Lawyers argue from testimony, not gossip | Advocate/Opposing argue only over the ledger |
| Opposing counsel cross-examines | Red Team attacks the Advocate's points |
| Judge doesn't testify | Adjudicator is a separate, neutral agent |
| Written verdict with reasoning | DecisionSchema with fault table + reasoning |

**Two failure modes** the harness defends against:
1. **Hallucination** — LLMs invent facts confidently.
2. **Collusion** — Advocate and Opposing drift toward agreement; the adjudicator averages → meaningless 50/50.

I walked through the existing mechanisms (Evidence Ledger, Citation Gate, "quote-don't-recite," red-team prompt, independent drafts, structured rounds with no consensus, separation of powers, computed fault table, escalation triggers).

I walked one fact (F3: "Blake entered against red signal") through every gate of the system to make the harness concrete.

### 23.6 Phase 6 — Critiquing the harness (the failure modes I found)

**The user's request**: "What is the current issue in the harness, and what can we do to improve? Be brutally honest."

I laid out five holes:

**Hole 1 — Cited but misrepresented (the biggest semantic gap).** The Citation Gate only checks that an ID exists. It doesn't check that the claim follows from what the fact says. An agent could write "F3 proves the light was green for Blake" when F3 actually says Blake ran the red. Gate passes ✓. Claim is the opposite of the cited fact. **Fix proposal**: Source-Alignment Verifier (a 9th agent on Featherless OSS) that audits every cited claim.

**Hole 2 — The Adjudicator's math is never checked.** The Adjudicator outputs both a fault table AND a percentage, but no code checks the percentage actually follows from the table. LLMs are bad at arithmetic; this is a real risk in live mode. **Fix proposal**: Math Gate (pure code) — independently compute the percentage from the table, reject if delta > 10pp.

**Hole 3 — The Evidence Ledger itself might be wrong.** Everything assumes the Evidence Aggregator extracted facts correctly. If it mis-extracted (e.g., swapped party names), the entire debate is poisoned from the foundation. **Fix proposal**: every fact must carry a `verbatim_quote` that's a contiguous substring of its source document. Fact Gate (pure code) does the substring check.

**Hole 4 — Single Adjudicator is a single point of failure.** LLMs are non-deterministic. Same case → different verdicts across runs. **Fix proposal**: Dual Adjudicator on different model families, consensus check with 10pp tolerance, escalate on disagreement.

**Hole 5 — The final demand letter is never verified.** Drafter writes the letter; nothing checks it matches the decision. Dashboard says $35,700, letter could say $40,000. **Fix proposal**: Letter Reconciliation (pure code) — check letter contains the decided %, $.

Plus five smaller issues (no conflict detection, equal source weighting, only 2 statutes, same model for adjudicator+drafter, non-deterministic live mode).

I prioritized by impact + effort: Math Gate and Letter Reconciliation as Tier-1 quick wins; Verbatim Quote on facts as Tier-1 foundation hardening; Source-Alignment Verifier and Dual Adjudicator as Tier-2 (harder but higher leverage).

### 23.7 Phase 7 — Shipping Tier-1 fixes (Math Gate, Fact Gate, Letter Reconciliation)

**The user's instruction**: "Fix the loopholes correctly. Cross-verify them after shipping."

I implemented the three Tier-1 fixes in one session:

1. **Math Gate** — new file `src/mathGate.ts` (later ported to Python in `backend/app/gates.py`). Computes percentage from fault table independently. Mock data was double-checked: us-weight 0.75, them-weight 0.15, implied 75/90 = 83%, stated 85%, delta 2pp ✓ within tolerance.

2. **Verbatim quote requirement** — added `verbatimQuote: string` to the `Fact` schema. Updated the Evidence Aggregator prompt to require it. Wrote `src/factGate.ts` (later Python) that checks the quote is a contiguous substring of the source document (normalized whitespace + case). Updated the mock data so all 6 facts have real verbatim quotes that exist in the source documents. Found and fixed two stale source attributions in the mock (`signal_timing_log.csv` and `medical_bills.pdf` that didn't actually exist).

3. **Letter Reconciliation** — added a 15-line `reconcileLetter()` check after the Drafter returns. Verifies the letter contains the decided percentage and dollar amount as strings.

I also fixed a small UI issue in `runDemo.ts`: the gate icon was hardcoded ⛔ for all gate postings. Updated it to show ✓ green for passes, ⛔ red for failures based on content sniffing.

Cross-verification: ran the demo end-to-end. All four gates fired correctly (Fact Gate ✓ "All 6 facts anchored," Citation Gate rejected the uncited Advocate point on attempt 1 then accepted attempt 2, Math Gate ✓ "table implies 83%, stated 85% (delta 2pp)", Letter Reconciliation ✓ "letter matches 85% / $35,700"). Typecheck clean.

### 23.8 Phase 8 — Architecture documentation

**The user's request**: "Make an architecture.md with Mermaid diagrams, not cluttered."

I wrote `docs/architecture.md` (then `ARCHITECTURE.md`) with three Mermaid diagrams (system overview, pipeline sequence, mock vs live mode), the harness tables, the agent + provider routing, the Evidence Ledger schema example, the code map, and the Band SDK swap point. ~300 lines, designed to be readable in 5 minutes.

### 23.9 Phase 9 — Re-explaining the Tier-1 fixes

**The user's question**: "Are those three (Math Gate, Verbatim Quote, Letter Reconciliation) already done?"

The user wasn't sure whether my explanation was a proposal or a post-ship recap. I confirmed all three were already shipped, walked through each with concrete examples using the Alex/Jordan case, and pointed them at the green ✓ lines in the demo output to verify.

### 23.10 Phase 10 — Shipping Source-Alignment Verifier and Dual Adjudicator

**The user's instruction**: "Ship both. Handle every edge case correctly. Think first."

I spent a deliberate planning phase before code. For the Source-Alignment Verifier:

- **Edge case: citation to a statute, not a fact.** Decision: skip statute citations in the verifier; the Citation Gate's existence check is sufficient. Implementation: regex filter `^F\d+/i` excludes non-fact IDs.
- **Edge case: multiple citations on one claim.** Decision: check each fact citation separately; aggregate to worst-case (any contradicted → flagged).
- **Edge case: the verifier itself fails to return valid JSON.** Decision: retry once with violations injected, then post a warning and proceed (never block the pipeline).
- **Edge case: empty input (all citation gates failed).** Decision: post "no fact citations to verify" and skip cleanly.
- **Edge case: long transcript.** Decision: one batch call per case (not per claim), keep the prompt list-form so the model returns one JSON with all results.
- **Order of operations**: AFTER both Adjudicators decide, BEFORE the Drafter. This makes it the 5th gate in the harness, doesn't complicate the input flow.

For the Dual Adjudicator:

- **Edge case: one adjudicator fails to parse.** Decision: fall back to single-adjudicator mode (the surviving one), apply a confidence haircut of 0.8x, mark `consensus = 'single'`.
- **Edge case: math gate fails for one of them.** Decision: only the math-passing one's decision is used; the failed one is exposed but not counted toward consensus.
- **Edge case: both math gates pass and they agree within 10pp.** Decision: average the percentages, take min confidence, mark `consensus = 'agreement'`.
- **Edge case: both pass but disagree >10pp.** Decision: use A as canonical (deterministic choice), expose B as secondary, mark `consensus = 'disagreement'`, force escalation.
- **Edge case: both fail.** Decision: throw — pipeline cannot proceed without a decision.
- **Provider mix concern.** Decision: Adjudicator B on Featherless OSS (Llama 3.1 70B) brings the mix to 4 Featherless + 4 AI/ML API — even split, strong sponsor-prize story.
- **Mock data concern.** Decision: keep both adjudicators at 85% (different fault-table weights, same final percentage) so the existing demo letter doesn't break Letter Reconciliation. Demonstrating actual disagreement is the value of the disputed/loser test cases (still to be built).

Shipped both. Cross-verified the demo run. All 5 harness gates fire green: Fact Gate ✓, Citation Gate REJECTED-then-accepted, Math Gate ✓ for A and B, Consensus Gate ✓ "A=85%, B=85% (delta 0pp ≤ 10pp). Using 85%", Source-Alignment Verifier "11/12 supported, 1 overreach, 0 contradicted" (the overreach is the Advocate's "fully recoverable" claim under F6 — F6 establishes damages but not recoverability share; the verifier correctly catches the advocacy overreach as informational, not blocking), Letter Reconciliation ✓.

### 23.11 Phase 11 — The Recourse competitor scare

**The user's worry**: "Check this submission, I think our project may have been compromised."

The user found `Recourse — Adversarial Claims Adjudication` (https://lablab.ai/ai-hackathons/band-of-agents-hackathon/recourse/recourse-adversarial-claims-adjudication, GitHub: https://github.com/kasbsquall/recourse).

I tried `WebFetch` on the lablab.ai URL — got HTTP 403 (their CDN blocks non-browser user agents). The GitHub URL worked. Extracted Recourse's full design:
- 5 agents: Coordinator, Blake (Claims Evaluator pro), Morgan (Policy Analyst, RAG), Alex (Devil's Advocate con), Sam (Resolution Notary).
- Tech: Next.js + FastAPI + Postgres + pgvector. RAG over policy clauses. SHA-256 hashed transcript.
- Output: "signed, reasoned resolution."
- Track 3, insurance claim denial appeals.

**My honest assessment**: NOT a duplicate, but adjacent enough that a tired judge could lump them together. Differences:
1. **Workflow**: Recourse = pre-payment denial appeals (insurer vs policyholder). Lumen = post-payment subrogation (insurer vs another insurer). Different stakeholders, different timing in the claim lifecycle.
2. **Output**: Recourse = qualitative resolution (approve/deny). Lumen = quantitative demand letter ($35,700 at 85% fault). More visceral.
3. **Harness depth**: Recourse = RAG + hash (2 protections). Lumen = 5 code gates + 1 agentic gate + structural anti-collusion (6+ protections). Architectural moat.
4. **Fault model**: Recourse = policy clause interpretation. Lumen = tort law + comparative negligence statutes. Lumen's reasoning is harder.

**Risk**: Recourse appears further along on UI polish (Next.js, FastAPI, SSE streaming). Our frontend is plainer HTML/JS.

**Strategy** (recommendation): sharpen the pitch to lead with "subrogation" explicitly and contrast against "denial appeals" so the first 20 seconds of the demo establish the difference. Show the 6 harness gates firing in the video as the architectural differentiator. Lean into our concrete dollar artifact.

### 23.12 Phase 12 — Real PDFs for testing

**The user's request**: "Give me a PDF I can actually use for testing — search the web."

I tried `WebFetch` on multiple court opinions and NHTSA forms — most were blocked by 403. The URLs themselves are real and accessible from a browser, just not from the fetcher.

Curated short list returned to the user:
- **Johnson v. State Farm Insurance** (Montana Supreme Court, 2025, https://law.justia.com/cases/montana/supreme-court/2025/da-24-0204.html) — real subrogation dispute where State Farm subrogated against GEICO. Exact scenario Lumen handles.
- **Arbitration Forums Reference Guide** (https://home.arbfile.org/getmedia/1ae0b5d0-d3f7-464f-ba98-a0d7d0154015/ReferenceGuide.pdf) — the industry rulebook. AF administers ~95% of US auto subrogation arbitrations.
- **NHTSA state crash report forms** (Virginia FR300P, Hawaii MVAR, South Carolina TR-310 with manual, Arizona) — real blank forms officers fill out. The SC manual is the most informative.
- **Bowens v. State Farm** (Maryland Court of Appeals, 2025, direct PDF on mdcourts.gov).
- **ClaimsPages.com subrogation letter templates** — real industry-standard demand letter format.

Suggested workflow: copy Johnson v. State Farm's "Background" / "Statement of Facts" into a new `data/sample_claim_montana.json` as a second test case.

### 23.13 Phase 13 — Productionization thinking begins

**The user shifted framing**: "We're targeting B2B markets. The company will seed documents — let's say up to 3 docs. Then agents do their work. The bottleneck is how we store data so agents find it quickly. Be brutally honest, correct me first."

I had to push back on several premises that were wrong, while validating the underlying instinct.

**Correction 1 — "3 documents per case" is wildly off.** A real subrogation claim file has 50–500 documents: FNOL, police report, body-cam video, 20–50 photos, witness statements (one per witness), recorded statement transcripts, repair invoice, parts invoice, total-loss valuation, rental invoice, medical bills (one per provider), medical records, both policies' declarations, EDR readout, traffic signal timing log, scene diagrams, expert reports, prior correspondence, arbitration filings. **Updated design target**: 50 documents per case, up to 50 MB per file. Tell an insurance judge "3 documents" and they mentally write you off in the first sentence.

**Correction 2 — "Agents find context quickly" is the wrong framing.** Lumen's agents don't search anything at runtime. The Evidence Aggregator pre-processes documents into the structured ledger; the entire ledger is then rendered into every downstream agent's prompt. This is a deliberate design choice — the Citation Gate's universality guarantee depends on every agent seeing every fact ID. If we switched to RAG (top-k chunks), each agent would only see retrieved facts; the gate would still catch fabricated IDs, but the agent might silently miss a relevant fact. **The real bottleneck**: ingestion-to-ledger (raw 50 docs → atomized, deduplicated ledger). Not retrieval at agent runtime.

**Correction 3 — "How do we store data so agents find it quickly" is the right concern at the wrong layer.** Reframing: ingestion (raw bytes → text) is one job. Ledger building (text → cited atomic facts) is a second job. Agent reasoning (debate over ledger) is a third. Each has different storage needs.

**What's actually missing for production B2B**: OCR for scanned PDFs (Tesseract/Textract/Document AI), vision for photos (damage classifiers), audio transcription, fact deduplication, conflict detection between facts, full chain-of-custody provenance, multi-tenant isolation, integration with claims systems (Guidewire/Duck Creek). The user accepted these as roadmap, not blockers.

### 23.14 Phase 14 — Three-stage architecture lock-in

The conversation crystallized into a three-stage model:

**Stage 1 — Ingestion** (raw inputs → clean text + metadata): OCR, parsing, transcription, vision. Output: per-document records with extracted text.

**Stage 2 — Ledger building** (text → structured atomic facts with source pointers): the Evidence Aggregator agent does this. Output: the typed graph (nodes + edges).

**Stage 3 — Agent reasoning** (debate, decide, draft): runs over the ledger. Output: decision + demand letter + audit trail.

The user proposed inspirational reference: a graph-structured ledger similar to "graphify" (the Anthropic skill for turning any input into a knowledge graph). I agreed — a flat list of facts loses relationships (F1 corroborates F4, F2 contradicts F5, etc.); a typed graph encodes these explicitly. Decided: stage 2 outputs `nodes` + `edges` tables (Postgres), node types enumerated, edge types enumerated.

### 23.15 Phase 15 — The MongoDB rejection (long discussion)

**The user proposed**: "Postgres might get cluttered with all this data. Let's use MongoDB for raw text dumps, Postgres for references, Backblaze B2 for raw files."

I worked through it honestly. The user's instinct (separation of concerns) was right; the implementation (MongoDB) was wrong at our scale.

**The math**: 50 documents × 20 MB raw bytes = 1 GB → goes to B2 (object storage). Extracted text per document = 100–500 KB → 50 × 300 KB = ~15 MB of text per case → goes to Postgres. Postgres handles 15 MB in 3% of the free tier. "Postgres clutter" is not a real concern at our scale.

**The technical alternative we considered**: Postgres TOAST. Postgres automatically moves large TEXT values out of the main row to a separate storage area, so metadata queries stay fast even with big text columns. This means we get the separation-of-concerns benefit (hot metadata, cold text) without operational complexity.

**The operational cost of MongoDB**: another account, another connection string, another SDK, another env var set, cross-database consistency to manage, more failure modes. For a 3-person team with 2 days, every extra service is a tax.

**The conclusion**: Backblaze B2 (raw files, 10 GB free) + Supabase Postgres (everything structured). Drop MongoDB. The user accepted.

The user pushed back on B2 vs Supabase Storage: "Supabase only gives 1 GB. We never know — sometimes it exceeds. And we might support 50 MB files." I conceded — at 50 × 50 MB = 2.5 GB per case, Supabase Storage's 1 GB blows up after one case; B2's 10 GB holds 4–10 cases. B2 wins on the safety margin.

### 23.16 Phase 16 — The embeddings rejection (the agent-by-agent walkthrough)

**The user's question**: "Do we actually need embeddings? Walk me through what each agent needs."

I went through every current and planned agent:

| Agent | Needs semantic search? | Why |
|---|---|---|
| Intake Parser | No | Reads claim text, emits structured fields |
| Evidence Aggregator | No | Reads documents, builds the ledger |
| Liability Advocate | No | Has the full ledger in prompt, structured graph queries cover deep dives |
| Opposing Red Team | No | Same as Advocate |
| Adjudicator A | No | Same — gets ledger + transcript |
| Adjudicator B | No | Same |
| Source-Alignment Verifier | No | Knows the exact citation (F3); structured lookup |
| Drafter | No | Writes from the decision |
| Specialist Recruiter (future) | No | Decision-making, not retrieval |
| Policy Interpreter (future) | No | Orchestrator hands it the relevant policies |
| Cross-Case Memory (future) | **YES** | Find past similar cases — genuine semantic search use case |

**The only genuine embedding use case is Cross-Case Memory**, which is deferred to v2.

**What we accepted as the substitute**: Postgres `tsvector` full-text search (built-in GIN index) for keyword queries. Free, no extra model calls, no chunking strategy debate, no pgvector setup.

**What we explicitly considered and rejected**: keeping embeddings "just in case." The cost of adding them now (~half a day of work, 2500 embedding calls per case, model-cost decisions, chunking strategy, top-k tuning) is significant for capability nothing in the pipeline actually calls. The schema additions are backward-compatible — we can add a `document_chunks` table with `embedding vector(1536)` in a future migration without touching the existing tables.

The user pushed: "What about context management across agents?" I distinguished context management (how each agent gets the right info — already solved by orchestrator pass-down) from semantic search (find by meaning — embeddings). Different problems, both can exist; ours needs the first, not the second.

### 23.17 Phase 17 — Agent tools (bash, web search, structured queries)

**The user's framing**: "Agents should have power to dive deep. Like a bash terminal with grep. Like web search. The agent should think and act."

I distinguished the *concept* (agents need search and retrieval capability) from the *implementation* (literally calling shell `grep` or fetching arbitrary URLs).

**Bash/grep — rejected (security, performance, abstraction):**
1. **Security**: shell injection from agent-generated strings is a real threat.
2. **Performance**: file I/O is slower than indexed DB queries.
3. **Abstraction**: agents should query structured data, not parse strings.

**What we DO give agents** — five structured tool functions:
- `search_documents(query)` → Postgres FTS query against `document_pages.extracted_text`. The semantic equivalent of grep, but indexed.
- `search_facts(query)` → keyword search against the ledger's fact statements.
- `get_source_text(document_id, page_number)` → exact page lookup, the "drill down to the source" tool.
- `get_neighbors(node_id, edge_type)` → graph traversal.
- `request_specialist(role, reason)` → future Specialist Recruitment pattern.

**Web search — rejected for v1 (breaks Citation Gate's universality):**

This was the longest discussion. If an agent can fetch a Wikipedia URL or random blog and cite it, the Citation Gate's "every cited ID resolves to a known fact or statute" guarantee collapses. To make web search safe, we'd need to:
1. Cache web results into our statute store with verbatim-quote anchoring.
2. Verify URLs are reachable and the quote actually exists at that URL.
3. Version-pin everything (web content changes).

That's a real architectural extension — not 2-day-shippable.

**The compromise**: skip web search for v1. The "agents extending themselves dynamically" demo moment comes from the **Specialist Recruitment** pattern (Adjudicator spawns a Policy Interpreter at runtime) — safer because the specialist is also bound by the same harness.

### 23.18 Phase 18 — The codebase reorg

**The user's directive**: "The codebase is unstructured. You need everything concisely in a backend folder with schemas, db, migrations, server, agents — everything. Think yourself as an Anthropic engineer."

I planned the reorg carefully before touching code:

**Discovery of what was already there:**
- Two parallel backends: TypeScript (`src/` + `server/`) was the original; Python (`lumen_py/`) was the newer port with real Band SDK integration (`probe_band*.py` scripts).
- A `web/` static frontend (HTML/JS/CSS).
- My SQL migrations from earlier in `db/`.
- `docs/product-context.md` explicitly carved out ingestion + ledger as separate-contributor lanes.
- The Python `lumen_py/server.py` had a stubbed `/api/ingest` endpoint with a clear seam comment.

**The decision tree on language choice**: Python won because (1) the active production backend was already Python, (2) Python has better libs for PDF/DOCX/OCR/vision/audio, (3) the team was running Python with FastAPI. The TS code stays at root as the offline `pnpm demo` showcase.

**Granularity decision**: I considered splitting `lumen_py/` into `backend/agents/`, `backend/gates/`, `backend/pipeline/` separately. Decided against it — that requires updating 30+ relative imports, high churn for low immediate value. Kept the flat structure inside `backend/app/` after a single directory rename. Future PRs can split it further without time pressure.

**The execution**:
1. `git mv lumen_py backend/app` — preserves git history as renames.
2. `git mv web frontend` — same.
3. `mv db backend/db` — uncommitted, so plain `mv`.
4. Updated path references in `backend/app/server.py` (ROOT now `parent.parent.parent` since the file is one level deeper) and `backend/app/run_demo.py`.
5. Updated the uvicorn module string in `backend/app/run_server.py` (`lumen_py.server` → `backend.app.server`).
6. Updated `server/server.ts` (the legacy TS server) to point at `frontend` instead of `web`.
7. Updated docstrings + AGENTS.md + root README + backend/db/README to remove stale `lumen_py` references (except one deliberate historical note in backend/README.md).

**Cross-verification**: ran AST parse on every Python file. All 47 parsed clean.

### 23.19 Phase 19 — Application schemas vs migrations

**The user's correction**: "You wrote the migrations, but you didn't write the schemas. They're different things."

This was an important clarification. **Migrations** = SQL files that create / alter tables. **Schemas** = application-level Pydantic models that mirror those tables and give the code a typed surface.

I wrote 8 schema files in `backend/schemas/` — one per table — each with:
- A `*Row` model that mirrors a DB row (frozen, for typed reads).
- A `*Create` model with only the fields needed for insert (subset of `*Row`, excludes id/timestamps).
- Where relevant, a `*StatusUpdate` model for partial updates.

`Literal[...]` types encode the CHECK-constrained enums so the type checker enforces them at write time (mirrors what the SQL CHECK does at runtime). The `__init__.py` re-exports everything so consumers can `from backend.schemas import CaseRow, NodeCreate, ...`.

This sits cleanly alongside the existing pipeline-internal types in `backend/app/types.py`. The two layers describe different things — storage view vs in-memory pipeline view — and the conversion is the ledger lane's responsibility.

### 23.20 Phase 20 — Three-person team and lane boundaries

**The user's reveal**: "Three members. I'm owning ingestion + context management. Gowtham owns ledger. Sudharsan owns agent reasoning and orchestration."

This clarified the contracts dramatically. I formalized:

- **Ingestion (Aman)** writes `documents`, `document_pages`, flips `cases.ingestion_complete`. Reads uploaded files.
- **Ledger (Gowtham)** writes `nodes`, `edges`, flips `cases.ledger_complete`. Reads documents + document_pages + statutes. Triggered by ingestion_complete.
- **Orchestration (Sudharsan)** writes `transcript`, `decisions`, flips `cases.finalized`. Reads everything upstream. Triggered by ledger_complete.

The user also stipulated **cloud-only** — no local builds, no SQLite. This forced a real cloud Postgres + cloud object storage architecture from the start.

### 23.21 Phase 21 — The endpoint shape conversation

**The user's preference**: "Pre-signed URLs so the ingestion doesn't bottleneck the backend. Async processing with Redis queues."

I designed the upload flow as four routes:
- `POST /api/ingest/case` — create a case shell.
- `POST /api/ingest/sign-upload` — body `{case_id, filename, mime_type, size, sha256}`; returns `{document_id, upload_url, upload_fields, storage_key}` (pre-signed B2 POST policy).
- `POST /api/ingest/commit` — body `{document_id}`; verifies the file is in storage, flips status, enqueues extraction.
- `GET /api/ingest/status/{case_id}` — polling endpoint.
- `POST /api/ingest/finalize/{case_id}` — flip `cases.ingestion_complete = true`.

**Engineering decisions baked in**:
- SHA-256 content addressing for idempotency.
- Hard cap of 50 MB per file at the request validation layer.
- Pre-signed URLs valid for 5 minutes (short window, force quick uploads).
- MIME-type sniffing via the `file-type` lib (don't trust the extension).
- Per-document status tracking (`pending` → `uploaded` → `extracting` → `extracted`/`failed`).
- Skip + flag + continue on per-document extraction failure — never fail the whole case because one weird PDF didn't parse.
- Async queue via `arq` (Redis-backed). Upstash Redis is the cloud target.

### 23.22 Phase 22 — The file format scope decision

**The user's confirmation**: "PDF, DOCX, HTML, plain text. Yes to images via vision, audio via Whisper, but later. Skip scanned PDFs, old DOC, video, Excel for now."

In-scope for v1:
- Native PDF (pdfplumber)
- DOCX (python-docx)
- HTML (BeautifulSoup)
- Plain text

Deferred to phase 2:
- JPG/PNG via a vision model (Gemini or Claude)
- Audio via Whisper (OpenAI)

Explicitly out of scope:
- Scanned PDFs (OCR is a rabbit hole — Tesseract is decent but slow; Textract/Document AI are paid and need credentials)
- Old DOC format (requires LibreOffice CLI conversion)
- Video (frame extraction + vision + audio transcription is a lot)
- Excel (sheetjs/xlsx with structured table extraction is its own problem)

### 23.23 Phase 23 — The full context dump (this document)

**The user's instruction**: "Gather all context. Everything we've discussed. Vision, future scope, current plan, every reasoning, why did we come to this conclusion, why didn't we come to that conclusion. Raw format, not summarized."

This document is the result. The first 22 sections capture *what* — decisions, schemas, layouts, contracts. This section 23 captures *why* — the actual conversation, the dialog, the workarounds discussed, the rejected ideas with their reasoning, the corrections and counter-corrections.

If you got here from §0, you now have everything — the verdicts and the reasoning chains. Future agents and team members reading this should be able to reconstruct any decision without re-litigating it.

### 23.24 Patterns worth carrying forward (beyond this hackathon)

A few meta-observations from the conversation arc that are worth remembering, in case the system survives past the hackathon:

**The harness pattern generalizes.** The idea of "code-enforced gates protecting against hallucination and collusion" applies to any multi-agent system handling structured decisions over evidence. Citation Gate, Fact Gate, Math Gate are domain-specific instantiations of a deeper pattern: *make the most important constraints non-bypassable by the model.*

**Lane separation pays compound interest.** Three contributors, three concerns, three sets of tables, three sets of code. Each lane can iterate without coordination overhead. The boolean flags on `cases` are the only synchronization primitive. This held up under all the architectural pressure we put on it.

**Reject ideas early, document why.** The volume of rejected proposals in §6 and §14 is the point — every rejected idea is one less debate the team has to re-have. The cost of writing this down is low; the cost of re-litigating is high.

**Mock mode is a load-bearing demo strategy.** The fact that the entire pipeline runs offline with zero API keys means the demo video can never break due to API flakes. The decision to keep the mock backend in lockstep with the live backend has paid off in every cross-verification turn.

**Ask before architectural changes; execute mechanical changes.** When the user said "stay back and ask before crucial decisions," it caught a few moments where I would have over-committed. Trade-offs across lanes (provider mix, schema shape, deployment topology) need confirmation. Within-lane mechanical work (writing the migration, writing the schemas, writing the extractor skeletons) can move fast.

---

## 24. Schema Evolution After Section 7

The initial draft (§7) listed 8 tables. We then realized the schema needed more uniformity and one missing table. Five edits to `001_initial.sql`:

### 24.1 Added the `runs` table

The original design had `transcript.run_id` and `decisions.run_id` as bare UUIDs with no row to point at. This worked but lost visibility: "show me all runs for this case" required `SELECT DISTINCT run_id FROM transcript` — hacky.

The `runs` table fixes it. One row per pipeline execution. Columns: `id`, `case_id` (FK), `mode` (mock/live), `status` (running/completed/failed/escalated), `triggered_by`, `started_at`, `ended_at`, `duration_ms`, `error_message`, `created_at`, `updated_at`. `transcript.run_id` and `decisions.run_id` are now real FKs to `runs(id) ON DELETE CASCADE`.

**Cost to Sudharsan's lane**: ~30 lines of new code — insert a row at run start (status='running', mode='mock' or 'live'), keep the returned run_id, use it for transcript+decisions writes, then update the row at run end with `ended_at`, `duration_ms`, final `status`.

**Why we deferred it initially**: I had said "skip the runs table, run_id as bare UUID is enough." User pushed back implicitly by asking for proper schema discipline. Added when the rest of the schema clean-up justified it.

**Cost columns deliberately skipped**: user explicitly said no — "don't try to calculate the cost, we can add the things later on. Current focus is building the infrastructure and harness for agents so that the subrogation is done correctly." So `runs` has `duration_ms` only, no `tokens_used` or `cost_usd`. Can be added in a follow-up migration.

### 24.2 Uniform `created_at` + `updated_at` on every table

Originally five tables (document_pages, statutes, edges, transcript, decisions) had only `created_at` because they were "append-only." User insisted on uniformity: every table gets both columns and the `set_updated_at` trigger.

Cost: 8 bytes × 2 columns × N rows. Negligible. Benefit: predictable schema, future-flexibility if any "append-only" table ever needs to support edits, easier to reason about row lifecycle.

Now 9 tables × 2 timestamps = 18 timestamp columns, all on the same trigger. Verified at migration apply time: every table reports 2 timestamp columns.

### 24.3 Retry tracking columns on `documents`

Two new columns: `retry_count INTEGER NOT NULL DEFAULT 0` and `last_retry_at TIMESTAMPTZ NULL`. Updated by the worker on each transient failure. Lets a human inspect "this document failed because we couldn't reach B2 for ~3 minutes; it took 2 retries before succeeding."

### 24.4 New columns on `cases`

- `last_run_at TIMESTAMPTZ NULL` — denormalized rollup of the most recent run's timestamp. Updated by the orchestrator. UI sorts cases by recency without joining to runs. Index `cases_last_run_at_idx (last_run_at DESC NULLS LAST)`.
- `metadata JSONB NOT NULL DEFAULT '{}'::jsonb` — free-form escape hatch for case-level fields the team adds later without schema migrations. UI hints, integration IDs, labels, etc.

### 24.5 New column on `documents`

`extraction_duration_ms INTEGER NULL`. Populated by the worker on extraction completion. Performance monitoring — tells us when extractions get slow enough to warrant chunked-parallel processing.

### 24.6 24 `COMMENT ON TABLE` / `COMMENT ON COLUMN` statements

Added at the bottom of `001_initial.sql`. Postgres exposes these in `pg_catalog`; Supabase dashboard surfaces them in the auto-generated docs. Self-documenting schema is a real quality signal for B2B.

---

## 25. Ingestion Pipeline Implementation

The §10 contract was clear; this section captures what got built. Ten new files plus updates.

### 25.1 `backend/ingestion/db.py` (new)

Lazy asyncpg pool factory. Single Pool per process, created on first `get_pool()` call. Pool size min=1, max=10. `command_timeout=30s`. `statement_cache_size=0` for pgBouncer / Supavisor compatibility (more on this in §28).

Self-loads `backend/.env` via `load_dotenv(dotenv_path=...)` with a path resolved from `__file__`. This was a workaround for the seed script not loading env on its own — making `db.py` self-load fixes the problem for every consumer in one place.

### 25.2 `backend/ingestion/storage.py` (rewritten from stub)

Real boto3 client against Backblaze B2's S3-compatible endpoint. Path-style addressing (required for B2). `signature_version='s3v4'`. 3 retries on standard mode.

Four operations: `sign_upload` (pre-signed PUT URL with 5-min TTL), `sign_download` (short-lived GET URL), `head` (returns None on 404), `download` (full bytes for worker).

**Decision: sync boto3, not aioboto3.** boto3 calls are fast (HEAD, presign) and the worker uses sync libraries anyway (pdfplumber, mammoth). Bridging sync into the async event loop via `asyncio.to_thread(...)` at the call site. aioboto3 has fewer maintainers and more bugs.

### 25.3 `backend/ingestion/queue.py` (rewritten from stub)

Two roles in one file. `ExtractionQueue` (enqueue-side, used by the FastAPI commit endpoint). `redis_settings_from_env()` helper used by both the API and the worker so both speak to the same Redis. Built from `REDIS_URL` via arq's `RedisSettings.from_dsn()`.

### 25.4 `backend/ingestion/repository.py` (rewritten from stub)

Eight typed methods backed by asyncpg. Every method takes/returns Pydantic models from `backend/schemas/`. Highlights: `create_document` is idempotent via UniqueViolation catch (returns existing row), `insert_pages` is bulk via `unnest(...)` in one transaction, `maybe_finalize_ingestion` is the race-safe WHERE-guarded UPDATE that flips `cases.ingestion_complete=true` IFF every document has `status='extracted'`.

Row mappers translate `asyncpg.Record` into typed Pydantic models. JSONB columns handled defensively (asyncpg may return them as `str` or `dict` depending on version).

### 25.5 `backend/ingestion/service.py` (rewritten)

Key behaviors: `commit_upload` is idempotent (returns current row without re-enqueueing if status past 'pending'). `extract_document` handles retry classification (see §26). `prepare_upload` validates MIME, creates document row, signs upload URL. `finalize_case` is the explicit override for the auto-finalize path.

### 25.6 `backend/ingestion/worker.py` (new)

arq's `WorkerSettings`. `on_startup(ctx)` builds the IngestService once per worker process and stashes it on `ctx['service']`. Each subsequent job reuses it. `extract_document(ctx, document_id_str)` reads `ctx['job_try']`, calls service with `job_try` + `max_tries=3`. Logs each attempt. Re-raises transient exceptions so arq retries.

WorkerSettings: `max_jobs=4`, `job_timeout=300`, `max_tries=3`, `health_check_interval=60`.

### 25.7 `backend/ingestion/routes.py` (factory replaced)

`get_service()` was a `NotImplementedError` stub. Now wrapped in `@lru_cache(maxsize=1)` so it builds the IngestService once per FastAPI process.

### 25.8 `backend/ingestion/adapters.py` (new)

One function: `load_case_from_db(case_id, repo=None) → ClaimInput`. Reads cases + documents + document_pages from Supabase, reconstructs the in-memory `ClaimInput` shape the orchestration pipeline expects. This is the seam between ingestion and orchestration — lives in ingestion lane so orchestration stays ignorant of Supabase.

### 25.9 `scripts/seed_synthetic.py` (new)

Loads `data/sample_claim_clean.json` directly into Supabase tables. Bypasses the upload-extract flow entirely — useful for development without requiring real file uploads. Creates one `cases` row, one `documents` row + one `document_pages` row per JSON document, then flips `ingestion_complete=true`.

### 25.10 The end-to-end flow walked through one document

1. Frontend computes SHA-256 in-browser via `crypto.subtle.digest`.
2. Frontend POSTs `/api/ingest/case` → `cases` row inserted, case_id returned.
3. Frontend POSTs `/api/ingest/sign-upload` → `documents` row inserted (status='pending'), pre-signed B2 URL returned.
4. Frontend POSTs `multipart/form-data` directly to B2. Backend not involved.
5. Frontend POSTs `/api/ingest/commit` → backend HEAD-checks B2, updates status='uploaded', enqueues arq job.
6. Worker picks up job. Updates status='extracting'. Downloads file. Dispatches to extractor. Bulk inserts pages. Updates status='extracted', page_count, extraction_duration_ms, ingested_at.
7. Worker calls `maybe_finalize_ingestion`. WHERE-guarded UPDATE flips `cases.ingestion_complete=true` atomically when all documents are extracted.
8. Gowtham's ledger lane subscribes (or polls) for `ingestion_complete=true` and starts extracting nodes + edges.

---

## 26. The Retry Mechanism (and the bug we caught)

### 26.1 The bug in the original implementation

The original `service.extract_document` had a bare catch-all that swallowed every exception, marked the document failed, and returned normally. **arq's retry machinery never fired** because we never let an exception propagate. If B2 hiccuped for 30 seconds, the document was permanently marked 'failed' on first try.

### 26.2 Transient vs permanent classification

Fixed by classifying via `_is_transient(exc)` helper:

**Transient** (retry-worthy): `TimeoutError`, `ConnectionError`, `OSError`, `botocore.ConnectionError`/`EndpointConnectionError`/`ReadTimeoutError`, `asyncpg.PostgresConnectionError`/`InterfaceError`, `ClientError` with 5xx codes (`InternalError`, `ServiceUnavailable`, `SlowDown`, `RequestTimeout`), `BotoCoreError`.

**Permanent** (don't retry): `ValueError` (unsupported MIME), `LookupError` (missing object), `ClientError` with 4xx, parser errors from pdfplumber/python-docx.

### 26.3 The fixed flow

On exception, classify. If transient AND not final attempt: record retry_count + last_retry_at, re-raise → arq retries with exponential backoff. If permanent OR final attempt: mark failed with `"Exhausted retries: "` prefix (for final-try transient), swallow.

### 26.4 arq's role

`max_tries = 3` and `job_timeout = 300` on WorkerSettings. arq's default exponential backoff (1s, 2s, 4s) handles spacing. Worker function reads `ctx['job_try']` and passes through.

### 26.5 Race-safe — what happens when the worker dies mid-job

`health_check_interval=60` — arq scans for "running" jobs whose worker died and re-enqueues them. Our service handles the duplicate gracefully because status='extracting' is idempotent and auto-finalize is WHERE-guarded.

### 26.6 What this is NOT

No dead-letter queue (DLQ). No custom backoff per error type. No circuit-breaker. All out of scope; arq defaults are fine.

---

## 27. Infrastructure Setup

### 27.1 Python 3.14 venv at `.venv/`

Created with `python3 -m venv .venv`. Already covered by `.gitignore` line 9. All ingestion dependencies installed successfully: asyncpg 0.31, boto3 1.43, botocore 1.43, arq 0.28, pdfplumber 0.11.10, python-docx 1.2, beautifulsoup4 4.15.

Pip cache warnings during install were harmless — Python 3.14 is recent enough that pip's old cache format doesn't match. Installs all succeeded.

### 27.2 `run.sh` — single entry point

Eight sub-commands: `setup` (idempotent venv build), `server` (FastAPI), `worker` (arq), `ingest` (BOTH server and worker in one terminal with shared signal handling, Ctrl-C kills both), `demo` (offline CLI mock), `seed` (load Alex/Jordan), `typecheck` (smoke import), `clean` (wipe .venv/).

Auto-creates the venv on first invocation. Colored output when stdout is a tty. Checks `backend/.env` exists for commands that need it.

### 27.3 gitignore coverage verified

`.venv/`, `.env`, `backend/.env`, `*.pyc`, `__pycache__/`, `band_config.yaml` all properly ignored.

---

## 28. The Supabase Pooler Discovery (the biggest workaround)

### 28.1 Symptom

`./run.sh seed` failed with `socket.gaierror: [Errno 8] nodename nor servname provided`. The hostname `db.hxgavkoaswjcfqfjjfas.supabase.co` did NOT resolve.

### 28.2 Diagnostic

```
nslookup hxgavkoaswjcfqfjjfas.supabase.co    → resolves ✓ (project URL)
nslookup db.hxgavkoaswjcfqfjjfas.supabase.co → No answer  ✗
nslookup aws-1-ap-northeast-2.pooler.supabase.com → resolves ✓
```

### 28.3 Root cause

**Supabase has retired the legacy direct DB hostname for new projects.** They've migrated to the Supavisor pooler (their open-source PgBouncer alternative). The dashboard still SHOWS the direct connection string as if it works, but the DNS record is absent.

### 28.4 The fix — two pooler flavors

**Session pool** (port 5432) — connections persist for the session. Supports prepared statements. Use for migrations and long-lived workers. ← OUR DEFAULT.

**Transaction pool** (port 6543) — connections cycle per transaction. No prepared statements (must set `statement_cache_size=0`). Use for serverless/FaaS.

DATABASE_URL set to session pool. DATABASE_URL_TRANSACTION reserved for future serverless deployment.

### 28.5 The asyncpg + Supavisor `statement_cache_size=0` requirement

Our `get_pool()` in `backend/ingestion/db.py` already had `statement_cache_size=0` defensively. Turned out necessary for Supavisor — without it, prepared-statement caching collides with connection cycling.

### 28.6 The new username format

Pooler username is `postgres.<project-ref>` (notice the dot). For us: `postgres.hxgavkoaswjcfqfjjfas`. This is Supavisor's tenant-id-in-username convention for multi-tenant pooling.

### 28.7 Documented in .env.example for future projects

The template now leads with explanatory comments about the retirement and the pooler distinction. Anyone joining the project later saves a debugging session.

---

## 29. End-to-End Verification (the 2026-06-18 apply)

### 29.1 Migration applied

`.venv/bin/python -m scripts.apply_migrations` succeeded:
- 9 tables created.
- 2 statutes seeded (CA-1431.2, CVC-21453).
- Every table reports 2 timestamp columns (uniform).

### 29.2 Synthetic case loaded

`./run.sh seed` ran successfully. Alex/Jordan lives in Supabase as UUID `574d61f9-6cee-4cf7-8d49-e4f98d24be38`. All 5 documents extracted, character counts match the JSON source, ingestion_complete=true.

### 29.3 Read-back integrity check

Manual SELECT queries via asyncpg confirmed: case row complete, all 5 documents present with correct kind labels, all document_pages rows present with matching char_count, retry_count=0 on every document.

### 29.4 What's NOT yet exercised against real infrastructure

- The upload flow with real files. Seed script wrote rows directly; the `/api/ingest/*` endpoints haven't been hit against B2 yet.
- The retry logic. Wired but no transient failure has occurred yet to prove it works.
- The arq worker against real Redis. TCP probe passed but no real job has run.

These get exercised on the first real upload test.

---

## 30. The Dedup Discussion (Settled — Skip Dedup)

### 30.1 The proposal from lawyer-timeline-mvp

That repo uses Jaccard similarity at threshold θ=0.6 to dedup events before final assembly. Cheap, deterministic, interpretable. Works for them because their output is a static timeline JSON — merging near-duplicates is benign.

### 30.2 Why naive Jaccard breaks for our domain

**Polarity blindness.** Example:
- "Blake ran the red light" → {blake, ran, the, red, light}
- "Blake stopped at the red light" → {blake, stopped, at, the, red, light}
- Jaccard = 4/7 = 0.57. Just below threshold 0.6.

If we lowered threshold to 0.55, Jaccard would merge OPPOSITE statements. Catastrophic for subrogation where the polarity IS the case.

### 30.3 The citation-stability problem

User caught a sharper concern: dedup AFTER ID assignment breaks Citation Gate. If agents cite F12 and dedup merges F12 into F4, the gate fails on F12 references. Post-hoc dedup is a non-starter for our architecture.

### 30.4 User's final position — raw facts matter

> "I think we can skip the de dup, cause giving the raw facts matter for a person rather than giving other persons some modified data, and it will build the trust."

The user values raw, unmodified data over post-processing convenience. Aligns with the harness philosophy.

### 30.5 The architectural answer

**Use `mentioned_in` graph edges to capture corroboration.** Gowtham's ledger extraction emits ONE Fact node per atomic observation, with `mentioned_in` edges pointing to each source document that asserts it. Captures evidence strength visibly, loses no information, no merging step exists to misbehave. Uses the graph schema we already designed.

Documented as a constraint in `backend/ledger/README.md`.

### 30.6 Trade-offs accepted without dedup

- Slightly more tokens per agent call.
- Fault table could weight duplicates as separate facts (mitigated by the "one Fact per observation" rule in the extractor).
- More verifier checks (negligible at scale).
- Denser UI ledger view (cosmetic).
- Conflicts harder to spot at scale (mitigated by the graph's explicit `contradicts` edges).

All small relative to the cost of accidentally merging contradictory facts.

---

## 31. Lawyer-Timeline-MVP Patterns — What We Adopted, What We Skipped

### 31.1 Adopted

- SHA-256 content addressing for storage keys.
- Worker process separate from API.
- Per-format extractor registry.
- Pre-signed PUT for browser-direct uploads.
- Conservative concurrency defaults (max_jobs=4 per worker).
- Status tracking per document.

### 31.2 Explicitly skipped

- Gemini-based "extract events directly from PDFs" (we separate text extraction from fact extraction — Citation Gate depends on this).
- Vercel AI SDK multi-provider abstraction (we have providers.py).
- JSON-only output to filesystem (we use Postgres).
- B2-synced extraction cache (our cache IS Postgres).
- Three operational presets (speed/balanced/quality).
- Aggressive compression (text-only Phase 1).
- FFmpeg dependency (no video Phase 1).

### 31.3 Deferred (might adopt later)

- Parallel chunked PDF extraction (25-page chunks × 15 parallel) — premature optimization for demo size.
- Anthropic prompt caching (90% input-token discount) — worth investigating for Adjudicator + Verifier large transcripts.
- Per-provider asyncio.Semaphore concurrency caps — defer until we see rate-limit errors.

---

## 32. Currently Pending — The Critical Path

After 2026-06-18 implementation completion, the ingestion lane is fully wired and verified. What's left:

### 32.1 Sudharsan's lane (orchestration)

- Rewrite `backend/app/server.py:api_run` to call `backend/ingestion/adapters.load_case_from_db()` instead of reading from `data/sample_claim_clean.json`.
- Add `runs` table inserts: INSERT a row at run start, keep run_id, use for transcript+decisions writes, UPDATE at run end.
- Update `cases.last_run_at = NOW()` after each run.
- All schemas (`backend/schemas/run.py`, etc.) ready.

### 32.2 Gowtham's lane (ledger)

- Implement `backend/ledger/builder.py` — the LLM-based extraction agent.
- Read documents + document_pages + statutes for `ingestion_complete=true` cases.
- Emit nodes + edges via `backend/ledger/repository.py`.
- Rule: ONE Fact node per atomic observation, with `mentioned_in` edges for each source.
- Flip `cases.ledger_complete=true` when done.

### 32.3 Frontend (owner TBD)

- Upload UI for the `/api/ingest/case` → `/sign-upload` → B2 → `/commit` → polling flow.
- Compute SHA-256 in-browser via `crypto.subtle.digest`.
- Display per-document status from the polling endpoint.

### 32.4 Three test cases

- Clean win (Alex/Jordan) — already seeded.
- Disputed (~50/50 split) — forces Consensus Gate to escalate.
- Loser (our insured was at fault) — credibility moat in Q&A.

### 32.5 Deployment

- Backend on Railway/Render (long-running container).
- Frontend on Vercel.
- All pointed at same Supabase + B2 + Upstash.
- Public URL for submission.

### 32.6 Demo video + pitch deck

- 3-minute video per `docs/project-plan.md` §9.
- 8-slide pitch deck per `docs/project-plan.md` §10.

### 32.7 B2 bucket verification

- Confirm `lumen-case-files` exists in B2 console.
- Verify region matches `us-east-005` (or update .env).
- Test first real upload with a small native PDF.

---

## 33. Patterns Reinforced Through This Implementation

**"Ask before architectural changes" caught the dedup polarity problem.** I had proposed Jaccard dedup as a Tier-2 enhancement. User asked clarifying questions. Walking through their concern surfaced the polarity blindness issue, which would have shipped silently if I'd just executed. **Verdict: the rule paid off again.**

**Stub-then-wire pattern paid off.** Schema first → application Pydantic models → typed repository methods → service orchestration → routes → worker → seed. Each layer was verified before the next was built. Bugs got caught early (the load_dotenv issue surfaced cleanly because each layer is small).

**The Supabase pooler workaround is documented for future projects.** The `.env.example` now leads with a paragraph explaining the retirement of `db.<project-ref>.supabase.co`. Saves future debugging.

**Asyncio bridging via `to_thread` keeps the codebase honest.** boto3 and pdfplumber are sync. asyncpg and arq are async. We bridge at the call site with `await asyncio.to_thread(sync_fn, ...)` rather than introducing async wrappers for everything. Simpler, more stable.

**The harness gates kept their universality through every change.** Citation Gate, Fact Gate, Math Gate, Source-Alignment Verifier, Letter Reconciliation — all unchanged. Schema additions, retry logic, pooler workaround, etc. all happened around the harness, not through it. Good architectural separation.

---

## 34. Iteration Log

**2026-06-17** — Initial draft. 23 sections + 24 conversation phases.

**2026-06-18** — Major implementation pass. Schema evolved (runs table, uniform timestamps, retry tracking, comments). Ingestion module fully wired (db, storage, queue, repository, service, worker, adapters, routes). Retry mechanism shipped (transient/permanent classification, exponential backoff, retry_count tracking). Infrastructure setup (Python 3.14 venv, requirements.txt pinned, run.sh with 8 sub-commands). Supabase Supavisor pooler discovered and adopted (db.<ref>.supabase.co was retired; using session pool at port 5432 for migrations + workers, transaction pool at 6543 reserved for future serverless). Migrations applied to live Supabase project. Synthetic Alex/Jordan case seeded (UUID 574d61f9-6cee-4cf7-8d49-e4f98d24be38). Dedup decision settled: skip dedup entirely, use `mentioned_in` graph edges for corroboration. Lawyer-timeline-mvp patterns audited — SHA-256 cache + worker-separation + extractor-registry adopted; Gemini-conflated extraction + JSON output + cache-sync + presets explicitly skipped.

---

*End of context dump. This document is canonical for reasoning, the code is canonical for behavior. If you find a contradiction, update both. The cost of a stale handoff doc is high; the cost of an out-of-date reasoning chain is higher.*
