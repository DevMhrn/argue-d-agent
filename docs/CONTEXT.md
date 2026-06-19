# Lumen — Master Context & Decision Log

> **Read this to absorb the whole project.** This is the raw, un-summarized context: the vision, every decision and *why* (including the roads we rejected and why), the research, the hypotheses, the learnings, the current state, and the future scope. It is meant to be loaded by a teammate (or their coding agent) to recover full context fast.
>
> Companion docs (more detail per area): [`architecture.md`](architecture.md) (system internals), [`project-plan.md`](project-plan.md) (the strategy/plan), [`product-context.md`](product-context.md) (the product story), [`ingestion-start-context.md`](ingestion-start-context.md) (ingestion lane deep-dive + earlier session history), [`backend/README.md`](../backend/README.md) (backend layout), [`backend/ledger/README.md`](../backend/ledger/README.md) (ledger lane).
>
> Last compiled: 2026-06-19. If you change a decision, append to §16 (Decision Log) with the date and reasoning — don't silently overwrite history.

---

## 0. TL;DR (then read the rest — the reasoning is the point)

**Lumen** is an AI **insurance-subrogation recovery** system for the **Band of Agents Hackathon** (lablab.ai). A *band* of specialist agents — spread across **two model families (Claude + GPT)** — investigates a claim, **argues both sides**, is **gated on cited evidence** by a **six-gate verification harness**, and produces a **recovery decision** (a dollar amount + a ready-to-send demand letter) — or correctly **declines to pursue** a weak case. The agents coordinate through a **real Band room**. We are aiming for **1st place**.

The single sentence that captures the moat: *"It's not adjudication (deciding whether to pay a claim) — it's subrogation **recovery** (clawing money back from the at-fault party after paying), with a verification harness rigorous enough that an insurer could trust it, and the honesty to say when a case isn't worth chasing."*

---

## 1. The mission / vision

- **Goal:** Win **1st prize** at the Band of Agents Hackathon. The user's words: "get the 1st prize at any cost."
- **Why this can win:** the hackathon's #1 judging criterion is *how well you use Band as the coordination layer*. We pair genuine Band coordination with (a) an untouched, high-value domain (subrogation recovery), (b) a verification harness deeper than any competitor's, (c) genuinely independent multi-model agents, and (d) a concrete, monetizable artifact (dollars recovered + a demand letter).
- **What "good" looks like for the demo:** a deployed web app where a judge watches the band of agents debate a real claim in a live Band room, sees the gates reject bad claims on screen, sees a recovery dollar amount, and — on a second case — sees the system *decline to pursue*. Backed by a ~3-min video + pitch deck.

---

## 2. Hackathon facts (the constraints we build to)

- **Event:** Band of Agents Hackathon, hosted by lablab.ai, powered by **Band** (and **Codeband**). Fully online, global, free.
- **Dates:** June 12 → **June 19, 2026**. Hard deadline **June 19 @ 8:30 PM IST**. Our internal target: submit a day early; never trust the deadline.
- **The hard rule:** the app must show **3+ unique, specialized agents actively communicating with each other** — must go beyond a chatbot, a single agent, or a straight A→B→C script. Judges reward agents that discover each other, divide work, **review outputs, disagree, and escalate**.
- **What "Band" is:** a coordination/communication layer for AI agents — a shared "chat room" where multiple agents (and humans) collaborate with **shared context, @mention routing, task handoffs, turn order, and a visibility model**. Each agent keeps its own model/tools/memory; Band is the meeting room + switchboard + system-of-record. (Think "Slack for AI agents," with governance.)
- **Judging criteria (in priority order):**
  1. **Band as the coordination layer** — real handoffs, shared context, role specialization, task state, coordination. *Biggest lever.*
  2. **Clarity** — a judge instantly gets the problem, the agent roles, what Band does, and the value.
  3. **Creative multi-agent collaboration** — beyond a simple chatbot.
- **Submission artifacts:** (1) a **deployed prototype people can use online**, (2) a **~3-minute demo video**, (3) a **pitch deck**. Code must be **original + MIT-licensed**.
- **Tracks (we're in the most crowded one):** "Regulated & High-Stakes Workflows" (≈29 submissions — **ours**), "Multi-Agent Software Development" (≈20), "Internal Enterprise Workflows" (≈17).
- **Prize:** $10,000+ pool. There WERE two partner prizes (Best Use of **AI/ML API**, Best Use of **Featherless AI**) — **we are no longer targeting those** (see §15: those APIs became unavailable to us). The main Band prize is unaffected.

---

## 3. Competitive landscape (research — what's real out there)

Scraped the live dashboard + submissions with Playwright (the lablab pages 403 plain fetch; a real browser gets through, then Cloudflare rate-limits).

**The dominant pattern in our track is adversarial / verified / human-gated multi-agent workflows.** This is the single most important competitive fact: "agents that argue, cite evidence, and escalate to a human" is *table stakes here, not a differentiator.* Notable rivals:

- **Recourse — "Adversarial Claims Adjudication"** (team Recourse; MIT, `github.com/kasbsquall/recourse`). **Our closest twin.** 5 agents put a disputed insurance claim "on trial" in one Band room → signed verdict; human officer has final word. Already polished: deployed app, 2 videos, real Band Agent API, SHA-256 audit trail. See the deep-dive in §13.
- **AEGIS** — 15 specialist agents investigate financial crime, evidence-grounded, adversarially verified, every verdict cited. (Our anti-hallucination story, but bigger/financial-crime.)
- **Council** — 5 personas debate, "Oracle" adjudicates, "Brier" audits every voice; published to npm, MIT. (Our adjudication + verifier story, polished.)
- **Contract Redline War Room** — 5 agents redline a contract, quantify exposure, human-gated approval packet, tamper-evident audit. (Our human-gated-packet story.)
- Others: PactWarden (adversarial contract cross-exam), MediChain (prior-auth), Band Decision Desk (Risk-veto trading), SafeHands (insurance fraud + CV), HireGuard (EEOC compliance), WarRoom/SOC War Room (security incident).

**Top techs used across the field:** AI/ML API, Featherless, Anthropic Claude, Claude Code, Antigravity, OpenAI, Vercel, LangChain. → Using the sponsor APIs is table stakes; community vote also matters (the dashboard ranks top submissions by vote).

**What this told us (the strategic read):** we cannot win on "adversarial multi-agent with citations + human gate" alone — everyone has it. Our moat must be **(1) the domain — subrogation *recovery*, which nobody else is doing; (2) harness depth — 6 gates + dual-family adjudication; (3) the "knows when NOT to pursue" honesty.** Recourse validates that adversarial-insurance-on-Band wins attention — but it's *adjudication*, which keeps our recovery niche open.

---

## 4. The idea, and why (idea evolution + roads not taken)

Idea evolved across three steps. Documenting the *rejected* options is the point.

1. **First framing — "The Disputes Desk" (adversarial claims adjudication / a "courtroom").** An AI review board that argues a disputed claim and a coordinator escalates to a human.
2. **The pivot question:** courtroom-on-insurance vs. a subrogation idea from an earlier strategy doc (`FINANCE_INSURANCE_LEGAL.md`, which had ranked **Lumen — AI Subrogation Recovery Officer** as the top pick).
3. **DECISION: Lumen — subrogation recovery. NOT adjudication.**
   - **Why subrogation, not adjudication:**
     - **Recourse already built adversarial claims adjudication** (the courtroom). Shipping the same thing = the "everyone builds the same idea" trap the user explicitly feared.
     - **Subrogation is genuinely untouched** — in this hackathon's submissions *and* in the broader vertical-AI startup landscape (Harvey/Hebbia chase legal/finance; insurance, esp. subrogation, is ignored).
     - **Concrete, monetizable artifact:** subrogation produces a **dollar amount to recover** + a **demand letter**. "Adjudication" produces a verdict; "recovery" produces money on screen — a stronger, more memorable judge moment.
     - **Real $ pain:** insurers leave an estimated **$15–20B/yr** uncollected because subrogation is manual; only ~50% of recoverable claims are pursued.
   - **What we KEPT from the courtroom idea (the good parts):** the **adversarial debate** (advocate vs. opposing) and the **human escalation** — but grounded in real documents producing a real recovery, **not a toy simulation**. A pure mock-trial sim was rejected as crowded + toy-ish ("who pays for this?").
- **Domain pick rationale (finance/insurance/legal):** the user has an edge here; insurance is the most defensible/under-served sector; subrogation has the cleanest multi-agent justification (privilege walls + multiple departments make multiple agents *required*, not decorative).

---

## 5. The product, in plain English

When someone runs a red light and hits your car, your insurer pays you right away — but it wasn't your fault, so your insurer should get that money back from the **other driver's** insurer. Chasing that money is **subrogation**. It's slow, manual, document-heavy work (police report, photos, repair bills, both policies, figure out fault %, write a demand letter, negotiate), so insurers **drop ~half** the cases worth chasing.

**Lumen** does the case-building in minutes. You hand it a claim; it returns a **recovery package**: fault analysis (who's at fault and by what %, every point backed by cited evidence), the **dollar amount to demand**, a **formal demand letter**, the strongest opposing argument + our rebuttal, and a **human Approve/Reject** step for big or uncertain cases. **Who we serve:** the recovery teams inside P&C insurers (State Farm, GEICO, Allstate, Progressive…) who have thousands of staff doing this by hand.

---

## 6. The agent team (8 agents, two model families: Claude + GPT)

Provider assignment is **deliberate cross-family** so the adversarial parts are genuinely independent — not one model arguing with itself. (We ran across three families until 2026-06-18, when we lost Gemini access and repointed the three Gemini slots onto Claude/GPT — see the decision log. Gemini stays a *supported* provider; reassign an agent to it once a key is available.)

| # | Agent | Current provider family | Job |
|---|-------|--------------------------|-----|
| 1 | Intake Parser | OpenAI | Extract parties/date/location/damages from the FNOL |
| 2 | Evidence Aggregator | OpenAI | Build the grounded Evidence Ledger |
| 3 | Liability Advocate | Anthropic | Argue our insured is owed recovery (zealous counsel) |
| 4 | Opposing-Carrier Red Team | OpenAI | Attack our case — *a red team, never a negotiator* |
| 5 | Adjudicator A | Anthropic | Neutrally set fault % + recovery, showing its math |
| 6 | Adjudicator B | OpenAI | Independent re-decision on a **different family** (GPT vs A's Claude) |
| 7 | Source-Alignment Verifier | Anthropic | Audit every cited claim *actually follows* from its fact |
| 8 | Demand Letter Drafter | Anthropic | Compose the formal demand letter |

- **Advocate (Claude) vs. Opposing (GPT)** = cross-family debate. **Adjudicator A (Claude) vs. B (GPT)** = cross-family consensus check. This is what makes "diverse models resist collusion" *real, not cosmetic* — now across **two** families. A clean 4 Claude / 4 GPT split.
- Model IDs are **env-overridable** (`MODEL_*`). Current defaults live in `backend/app/config.py`; confirm provider catalog IDs before live runs.
- **Live mode needs only `ANTHROPIC_API_KEY` + `OPENAI_API_KEY`** now (no Gemini). The ledger build (Evidence Aggregator) routes through whatever provider `AGENTS["evidence"]` is set to — currently OpenAI.

---

## 7. The verification harness (six gates — our technical moat)

Every gate is **CODE, not a prompt** — a hard guarantee an LLM cannot talk its way past. This depth is what separates us from "adversarial agents that cite stuff."

1. **Citation Gate** (`citationGate.ts` / `gates.py:check_points`) — every argued point must cite ≥1 real fact id (`F3`) or statute id (`CA-1431.2`). Uncited/invalid → message rejected, agent retried. *(Demo moment: the Advocate's uncited point gets rejected on attempt 1, fixed on attempt 2.)*
2. **Fact Gate** (`factGate.ts` / `gates.py:check_ledger_anchoring`) — every Fact's `verbatim_quote` must be a contiguous substring of its source document (whitespace/case-normalized). Anchors the ledger to real source text; without it the ledger is just an LLM summary.
3. **Math Gate** (`mathGate.ts` / `gates.py:check_adjudicator_math`) — independently recomputes the fault % implied by the adjudicator's own fault table; rejects if it disagrees by >10pp. LLMs are unreliable at arithmetic; this catches table/percentage inconsistency.
4. **Consensus Gate** (in `pipeline`) — **dual adjudicator** on different families decide independently; if they disagree by >10pp it **forces human review**; if one fails its math gate, use the other with reduced confidence; if both fail, hard-escalate.
5. **Source-Alignment Verifier** (`verifier.ts` / `verifier.py`) — for each (claim, fact) pair, an agent checks whether the claim actually *follows* from the fact: `supported` / `contradicted` / `overreach` / `neutral`. Catches **"cited but misrepresented"** — the biggest semantic hole the Citation Gate alone can't see. *(Demo moment: it flags the Advocate's "fully recoverable" as `overreach` under F6.)*
6. **Letter Reconciliation** (in `pipeline`) — the drafted demand letter must contain the decided fault % and recovery amount. Catches the worst case where the dashboard says one number and the letter says another.

Plus a **SHA-256 audit hash** of the full transcript + decision + letter (tamper-evident; matches/exceeds Recourse's "defensible by design").

---

## 8. Anti-hallucination & anti-collusion (the design principles + reasoning)

The user's explicit worry: "the agents don't hallucinate and don't end up convincing each other to negotiate rather than winning a case." These principles are the answer.

**Anti-hallucination:**
- One **Evidence Ledger** = single source of truth; everyone argues only over it.
- The **Citation Gate** (code) forbids uncited claims.
- **Quote, don't recite** for statutes/policy — agents must quote retrieved text, never recite law from memory.
- **"Not in evidence" is allowed and rewarded** → escalate to a human rather than invent.
- The **Source-Alignment Verifier** catches cited-but-misrepresented.

**Anti-collusion (keep the fight real):**
- The opponent is a **red team, not a negotiator** — its job is to *attack*, never to reach agreement. **No "settlement" turn.**
- **Separation of powers:** the agents who argue do **not** set the number. A neutral **Adjudicator** does. (If the advocate could also decide, it would soften.)
- **Structured rounds, no consensus round:** Advocate states → Opponent attacks → Advocate rebuts/concedes (concession only *with a citation*). Stop. No "find common ground."
- **Draft independently first**, then exchange (prevents anchoring).
- **Different model family per side** (two families resist sycophantic convergence). *This is literally true across Claude/GPT — the Advocate/Opposing and Adjudicator A/B pairs are always cross-family.*
- **Fault % is computed, not vibed** — from a fault table, math-gated; flags suspicious ~50/50 splits.

---

## 9. The "loser" case — knowing when NOT to pursue (credibility)

Two demo cases:
- **`clean` (CLM-2026-0427):** red-light T-bone, other driver clearly at fault → **85% fault, $35,700 recovery, escalates** (over the $25k human-review threshold).
- **`loser` (CLM-2026-0588):** **our insured rear-ended a stopped car** (cited for following too closely) → other driver only **11% at fault → $1,980 → outcome = DECLINE** ("recommend closing the file").

**Why this matters:** a system that "wins" every case is broken and a judge knows it. Being able to say *"it also tells you when not to pursue"* is a credibility win in Q&A. Implemented via viability thresholds (`PURSUE_MIN_USD=2500`, `PURSUE_MIN_FAULT_PCT=25`) and a `outcome` field (`pursue` / `escalate` / `decline`). The UI shows a red "✕ DO NOT PURSUE" banner for declines.

---

## 10. Architecture (the system, the lanes, the history)

### Three lanes, three owners (the team contract)
Per `backend/README.md` and the DB schema, the pipeline is a three-stage handoff; each lane owns its tables and reads only upstream ones; boolean flags on `cases` are the cross-stage trigger:

| Lane | Owner | Writes | Reads | Triggered by |
|---|---|---|---|---|
| **Ingestion** | Aman | `documents`, `document_pages`, `cases.ingestion_complete` | uploaded files | new case |
| **Ledger** | Gowtham *(the user)* | `nodes`, `edges`, `cases.ledger_complete` | `documents`, `document_pages`, `statutes` | `ingestion_complete=true` |
| **Orchestration** | Sudharsan | `runs`, `transcript`, `decisions` | `cases`, `nodes`, `edges`, `document_pages`, `statutes` | `ledger_complete=true` |

Human approval persistence and `cases.finalized` are future work, not part of the current orchestration write path.

Repo: `github.com/DevMhrn/argue-d-agent`. This machine's git identity is `gowtham-sai-yadav` (commits are authored as the machine identity, **no AI/Claude attribution** — an explicit user preference).

### Two backends — history & current truth
- **Node/TypeScript (`src/`, `server/`)** — the *original* build. Mock-first. Retained as the legacy offline fallback.
- **Python (`backend/`)** — the **canonical/production backend** (FastAPI). It's where the **real Band SDK** lives (band-sdk is Python-only) and what we **deploy**.
- **Active UI (`frontend/`)** — the Next.js console talks to the FastAPI API. The root TypeScript server is legacy-only unless a task explicitly targets it.

### Mock-first (a load-bearing strategy, not a shortcut)
The entire pipeline runs **offline with zero API keys** in MOCK mode (deterministic canned model outputs in `mockResponses.ts` / `mock_responses.py`, keyed by case). **Why:** the demo video can never break on API flakes, development needs no keys/credits, and the Band *transport* can be exercised with canned model *content*. `is_mock()` = true when no provider key is set; `LUMEN_MOCK=1/0` forces it.

### The frontend
An enterprise "recovery operations console" (`frontend/`): dark premium theme, 3 panels — **Evidence ledger** (left) | **live Band room transcript** (center, the hero) | **Recovery decision** (right: big $ amount, fault split, consensus badge, escalation + Approve/Reject, fault table, downloadable demand letter, audit hash, Band room id). A top **"assurance pipeline" rail** lights up the 6 gates as they fire. Streamed over SSE.

### File map (what lives where)
- `backend/app/` — orchestration: `pipeline.py` (the debate + gates + consensus + decline + letter), `agents.py`, `prompts.py`, `gates.py` (citation/fact/math), `verifier.py`, `room.py` (LocalRoom + **BandRoom**), `providers.py` (OpenAI-compat client + mock), `mock_responses.py`, `config.py`, `types.py`, `ledger.py`, `server.py` (FastAPI+SSE), `run_demo.py`/`run_server.py`, `band_config.example.yaml`, `probe_band*.py` (Band connection probes).
- `backend/ledger/` — **Gowtham's lane**: `graph.py` (typed nodes/edges + validation + render), `builder.py` (`build_ledger` + `graph_to_evidence_ledger`), `prompts.py`, `mock_graphs.py`, `service.py` (`build_and_persist_ledger` — the real-flow entry point), `db_repository.py` (`LedgerWriteRepository` — asyncpg nodes/edges writes + `ledger_complete` flip), `jobs.py` (`run_ledger_build` arq job), `repository.py` (pure row mappers + `dry_run`; legacy supabase-py `LedgerRepository` for `build_demo --persist` only), `build_demo.py`.
- `backend/ingestion/` — **Aman's lane**: extractors (pdf/docx/html/text + registry), `service.py`, `repository.py`, `storage.py` (B2), `queue.py`/`worker.py` (arq), `db.py`, `routes.py`, `adapters.py`.
- `backend/schemas/` — typed DB-row models (one per table).
- `backend/db/migrations/` — `001_initial.sql` (9 tables), `002_seed_statutes.sql`.
- `scripts/` — `apply_migrations.py`, `seed_synthetic.py`. `run.sh` — command runner.
- `src/`, `server/` — the Node backend (fallback). `frontend/` — the shared UI. `data/` — sample claims + statutes + case manifest.

---

## 11. Band integration — hard-won lessons (don't relearn these)

We integrated the **real Band SDK** (the #1 judging lever; competitors brag "real Band API, not a wrapper"). Findings (reverse-engineered from `band-sdk` v1.0.0, import name `band`; dep `thenvoi-client-rest` — Band was formerly "Thenvoi"):

- **Python-only SDK.** No official JS/TS SDK. → reason we ported the backend to Python.
- **URLs:** REST `https://app.band.ai/`, WS `wss://app.band.ai/api/v1/socket/websocket`. Each agent has an `agent_id` (UUID) + `api_key` (shown once at creation).
- **Sending:** `AgentTools(room_id, rest=AsyncRestClient(base_url, api_key)).send_message(content, mentions=[...])`; also `create_chatroom()`, `add_participant(identifier, role)`, `get_participants()`, `fetch_room_context(room_id, page, page_size)`, `send_event(...)`, memory tools.
- **🔑 Every message REQUIRES ≥1 @mention** of a participant (format `@username/agent-name`). Band is mention-routed.
- **🔑 THE BUG we hit:** mentions resolve against the **sending agent's OWN cached participant list**. If you don't hydrate it, sends fail with `Unknown participant ... Available handles: []`. Fix: call `get_participants()` on **every** agent's tools after adding participants. (Symptom before the fix: only the room *creator* could post — "I see only Adjudicator A's messages.")
- **🔑 `list_agent_messages` returns the per-agent INBOX** (messages mentioning that agent), **not** the full room. Use **`fetch_room_context`** for the full transcript.
- `add_participant` accepts the `agent_id` (UUID) as identifier; participant handles come back from `get_participants` (the pasted handles were column-truncated — fetch them).
- **Option B (chosen):** **only real agents post to Band** — gate/system narration stays in our UI. Rationale: the Band room reads as a clean agent-to-agent debate (best for the #1 criterion), and the gates are our value-add overlay, not Band noise. (Option A was "post everything," which made Adjudicator A look like it authored 11 of 20 messages.)
- Activate with `LUMEN_BAND=1` + `band_config.yaml` (per-agent creds; gitignored). `room.py:make_room()` returns `BandRoom` when on, else `LocalRoom`.
- **Verified:** the full 8-agent pipeline posts to a real Band room; `fetch_room_context` shows all agents' messages.

---

## 12. Model providers — the swap (and the partner-prize tradeoff)

- **Original plan:** AI/ML API (frontier) + Featherless (open-source) — chosen partly to win **both partner prizes** ("frontier where it matters, OSS where volume matters").
- **What changed (2026-06-18):** those APIs became **unavailable to us** ("already claimed"). We swapped to the team's **own keys: Claude (Anthropic) + Gemini (Google) + OpenAI**, all via their **OpenAI-compatible chat endpoints** (one `AsyncOpenAI`-style client, different base_url + key per provider).
- **Cost:** we **forfeit the two partner prizes** (only matters for those). The **main Band prize is unaffected.**
- **Upside at that point (turned the loss into a win):** multiple model families made the cross-family debate + dual-adjudicator consensus more independent than the old single-provider-per-tier setup. Current active assignment is Claude + GPT; Gemini remains configurable only if a key is available.
- **Deliberate non-decision:** we kept the **unified OpenAI-compatible client** (provider-neutral) rather than the native Anthropic SDK. Reason: the file is a multi-provider abstraction where Claude is one of three interchangeable providers — exactly the "leave provider-neutral code alone" case the Claude API reference itself describes. Native SDK would mean three client codepaths for no benefit on a mock-first system.
- **Demo stays MOCK by default** (most reliable); live is the backup path (needs the 3 keys + `LUMEN_MOCK=0`).

---

## 13. Reference-repo research — Recourse (`kasbsquall/recourse`)

The user asked us to study the reference repo and apply what's *correct* to our use case. Recourse is our closest competitor and is MIT/open.

**What Recourse is/does (verified from its README + lablab page):**
- 5 agents in one Band room adjudicate a **disputed (denied) claim** → a signed, reasoned resolution; human officer approves/overrides. "The debate becomes the legally-defensible audit trail."
- Agents: **Coordinator** (orchestrator, routes handoffs/turn order), **Blake** (Claims Evaluator, *for* the insured), **Morgan** (Policy Analyst, cites clauses via RAG), **Alex** (Devil's Advocate, argues denial), **Sam** (Resolution Notary, writes the resolution).
- **Grounding:** RAG — policy clauses embedded with `all-MiniLM-L6-v2` (384-d) in **pgvector**, cosine search retrieves exact governing sections; Morgan cites clause numbers (§7.3). **SHA-256** hash of the ordered transcript = tamper-evident. Deterministic payout math. Human approval gate.
- **Stack:** Next.js 14 + TS + Tailwind frontend; **FastAPI + async SQLAlchemy + SSE** backend; **PostgreSQL 16 + pgvector**; **GPT-4o** (Blake/Morgan/Sam) + **Featherless Hermes-2-Pro** (Alex, GPT-4o failover); long-lived worker (`agents.run_agents`) holds the Band connections; Docker Compose deploy.

**What we ADOPT (validated as correct):**
- Real **Band Agent API + @mention routing** with a coordinator-driven turn order. ✅ we do this.
- **SHA-256 tamper-evident transcript hash.** ✅ added.
- **Human approval/override gate.** ✅ we have it.
- **FastAPI + SSE + live room UI.** ✅ same shape.
- **Clause-level citation** (Morgan cites §7.3). ✅ our Citation Gate + statute store enforces this.

**What we deliberately do NOT copy (and why):**
- **Their domain (adjudication: pay vs. deny a denied claim).** We do **subrogation recovery** — that difference *is* our moat. Copying the domain would put us head-to-head with a polished, finished competitor. ❌ don't.
- **RAG / pgvector / embeddings as the grounding mechanism.** We deliberately skipped embeddings (see §17 edge cases). Our grounding is the **typed Evidence-Ledger graph + verbatim-quote Fact Gate** (+ Postgres full-text per the DB design), not vector similarity. *Caveat to revisit:* Recourse's RAG is for finding the right clause in a *large* policy; our ingestion design targets **50+ documents per case**, at which point retrieval (full-text or vector) becomes genuinely useful for the Evidence Aggregator. Flagged in §17/§20.

**Where we are STRONGER than Recourse (the differentiation to lean on):**
- **6-gate harness** vs. their (hash + RAG-citation + human). We add Fact/Math/Consensus/Source-Alignment/Letter gates.
- **Dual adjudicator on different model families** with a consensus check vs. their single Resolution Notary → stronger anti-non-determinism, real anti-collusion.
- **The "decline to pursue" loser case** — we show the system declining a weak case; they don't surface that.
- **A recovery dollar amount + demand letter** (money on screen) vs. a verdict.

**Research validity check ("what's correct and what's not"):**
- ✅ *Correct:* subrogation is untouched and high-value; Recourse proves the adversarial-insurance-on-Band pattern wins attention but is adjudication, so our niche holds; harness depth is a real edge; mock-first is the right demo strategy.
- ⚠️ *To validate / watch:* (a) at real subrogation scale (50+ docs), our no-RAG grounding may need a retrieval step in the Evidence Aggregator — Recourse's RAG is evidence it matters; (b) provider model IDs need console confirmation; (c) the Band room must *visibly* show real coordination (Option B handles this); (d) we must actually deploy + record a video (Recourse already did — that's our execution gap to close).

---

## 14. Data model / schema (current, post-merge)

Single Supabase/Postgres schema, **9 tables** (`backend/db/migrations/001_initial.sql`), mirrored by Pydantic models in `backend/schemas/`. The schema **is the cross-lane contract.**

- **`cases`** — one row per subrogation case; carries `case_id` (human id), jurisdiction, damages, and the three handoff flags `ingestion_complete` / `ledger_complete` / `finalized`. Unique on `(tenant_id, case_id)`; `tenant_id` defaults to a demo UUID.
- **`runs`** *(added in the merge)* — one row per pipeline execution: `mode` (mock/live), `status` (running/completed/failed/escalated), timings, error. `transcript` and `decisions` FK to it.
- **`documents`** / **`document_pages`** — uploaded files (content-addressed by SHA-256, raw bytes in B2) and their extracted text per page. A GIN full-text index on `extracted_text` gives Postgres-native keyword search (the "grep without embeddings").
- **`statutes`** — public legal text the Citation Gate validates statute citations against (e.g. `CA-1431.2`, `CVC-21453`, `CVC-21703`).
- **`nodes`** — the Evidence Ledger as a typed graph: `Fact`/`Party`/`Vehicle`/`Event`/`Location`/`Statute`/`Damage`/`Document`. Fact nodes carry `verbatim_quote` + `(source_document_id, source_page_number)` — the Fact-Gate anchor. `node_id` is the display id (`F1`, `P1`…), unique per case.
- **`edges`** — typed relationships: `mentioned_in`, `corroborates`, `contradicts`, `attributed_to`, `governed_by`, `caused`, `involves`, `occurred_at`, `drives`.
- **`transcript`** — room postings per run (`(run_id, seq)` ordering) plus structured courtroom metadata. **`decisions`** — the `FinalDecision` per run (`fault_table` as jsonb, `secondary_decision` for Adjudicator B).

**Conventions:** UUID PKs; CHECK constraints over enums (easier to migrate); cascade deletes parent→child except `nodes.source_document_id` (SET NULL — preserve historical facts). **Intentionally NOT in the schema:** embeddings/pgvector/`document_chunks` (the ledger fits in prompts at our scale; full-text covers keyword lookup), multi-tenant RLS, soft-deletes.

---

## 15. The orchestration pipeline (the "correct" flow + edge cases + workarounds)

This is the current, intended pipeline (`backend/app/pipeline.py:run_lumen`; the Node mirror is `src/pipeline.ts`). Documented so it can be rebuilt correctly.

**Happy path (per run):**
1. `set_mock_case(claim.caseId)` — selects this case's canned outputs in mock mode (no-op live).
2. **Intake** → parties/date/location/damages.
3. **Evidence** → the **Evidence Ledger**. When `LUMEN_USE_LEDGER=1` (default), this comes from the **ledger lane** (`build_ledger` → typed graph → `graph_to_evidence_ledger` projection); else the inline evidence agent. The room posts "Evidence-ledger graph built — N nodes, M edges → K facts".
4. **Fact Gate** — verbatim-quote anchoring check.
5. **Courtroom docket:** deterministic `courtroom.py` creates bounded issues from the locked ledger: primary liability, comparative fault, damages, and legal basis.
6. **Opening briefs:** Recovery counsel and defense counsel argue independently, still Citation-Gated.
7. **Issue hearing:** for bounded liability/comparative-fault issues, defense cross-examines and recovery counsel redirects from compact issue packets. `orchestration_tools.py` provides clerk-side, read-only ledger/statute lookup; agents do not get raw shell access or model-native tools yet.
8. **Dual Adjudicator** — A (Claude) and B (GPT) decide **in parallel**, blind to each other; each **Math-Gated**.
9. **Consensus Gate** — agreement (≤10pp) → average; disagreement → escalate; single (one passed math) → use it at 0.8× confidence; none → throw/hard-escalate.
10. **Source-Alignment Verifier** — audits every cited claim; `contradicted` count feeds escalation.
11. **Viability / decline** — `pursue = recovery ≥ PURSUE_MIN_USD and fault% ≥ PURSUE_MIN_FAULT_PCT`; sets `outcome` ∈ `pursue`/`escalate`/`decline`.
12. **Demand Letter** → **Letter Reconciliation Gate** (letter must contain the % and $).
13. **Escalation / disposition** — recovery ≥ `ESCALATE_USD` ($25k), low confidence, near-50/50, or a gate/consensus/letter failure → human Approve/Reject.
14. Posts are streamed over SSE and, for UUID cases, persisted to `transcript` with metadata: phase, actor key, issue key/title, turn type, citations, gate verdict, and tool summary.

**Edge cases & workarounds (think about ALL of these):**
- **Adjudicator returns non-JSON / unparseable** → `parseDecisionOrNull` → null → that adjudicator is dropped; consensus falls back to the other; if both null → hard error/escalate.
- **Adjudicator math gate fails** → that adjudicator excluded from consensus; escalate reason recorded.
- **Both debaters being agreeable (collusion risk)** → mitigated structurally (red-team framing, separation of powers, no-consensus-round, different families) — see §8.
- **Citation gate can't be satisfied in 2 tries** → post the points with an "unresolved gate violations" warning, continue the packet, and force human review in the final disposition.
- **Verifier unavailable / unparseable** → warn in room, skip alignment (never blocks the run).
- **Band send fails** → swallowed (with `LUMEN_BAND_DEBUG=1` it prints) so a transport hiccup never breaks the local run/UI.
- **Mock pacing** → `LUMEN_MOCK_DELAY_MS` (server sets ~650ms so the live room is watchable; CLI stays instant).
- **Concurrent runs** → mock case is a `ContextVar` (Python, task-isolated) / module var (Node, single-run-demo caveat noted).
- **Loser case** → fault < floor and/or recovery < threshold → `decline` (not escalate); UI shows "DO NOT PURSUE".

---

## 16. Decision log — dos / don'ts / yes / no (with reasoning)

| Decision | Verdict | Why |
|---|---|---|
| Domain = subrogation **recovery** | ✅ YES | Untouched niche; concrete $ artifact; Recourse already took adjudication. |
| Claims **adjudication** (courtroom) | ❌ NO | Recourse built it; crowded; "who pays for a sim?" |
| Pure mock-trial simulation | ❌ NO | Toy-ish, crowded, weak buyer story. |
| Keep adversarial debate + human escalation | ✅ YES | The good parts of the courtroom, grounded in real docs. |
| **Mock-first** architecture | ✅ YES | Demo never breaks on API flakes; dev needs no keys; load-bearing. |
| Gates as **CODE** not prompts | ✅ YES | Hard guarantees an LLM can't bypass; the technical moat. |
| Neutral adjudicator decides (separation of powers) | ✅ YES | Debaters deciding → collusion/softening. |
| Opponent = red team, not negotiator; no consensus round | ✅ YES | Keeps the fight real (anti-collusion). |
| **Different model family per side** | ✅ YES | Anti-collusion becomes real, not cosmetic. |
| **RAG / embeddings** | 🚫 NOT NOW | Single case fits in context; ledger graph + full-text covers it. *Revisit at 50-doc scale.* |
| Band = real coordination layer; **Option B** (only agents post) | ✅ YES | #1 judging lever; clean agent-only transcript. |
| **Python** backend (canonical) | ✅ YES | band-sdk is Python-only; needed for real Band. |
| Native Anthropic SDK for the provider client | ❌ NO | Provider-neutral multi-model client; one OpenAI-compat codepath. |
| **No Claude attribution** in commits; machine identity | ✅ YES | Explicit user preference. |
| Drop AI/ML API + Featherless → Claude/Gemini/OpenAI | ✅ YES (forced) | APIs unavailable; turned into the cross-family-independence win. |
| Drop Gemini too (no key) → repoint its 3 agents to Claude/GPT | ✅ YES (forced, 2026-06-18) | No Gemini key available. Evidence + Adjudicator B → OpenAI; Verifier → Claude. Adversarial pairs stay cross-family; pitch is now "two independent families." Gemini still a supported provider — reassign once a key exists. |
| 3-lane architecture; DB schema as contract | ✅ YES | Clean ownership (Aman/Gowtham/Sudharsan); parallel work. |
| Bounded courtroom protocol over free-form A2A loop | ✅ YES (2026-06-19) | More courtroom-like back-and-forth without unbounded token spend; metadata gives future A2A/UI replay hooks. |

---

## 17. Open questions / divergences to reconcile

- **DB access is split — RESOLVED for the real flow:** the real ingestion→ledger→room path is now all **asyncpg** (shared pool from `backend/ingestion/db.py`). The ledger writes live in `backend/ledger/db_repository.py` (`LedgerWriteRepository`). The sync **supabase** client (`backend/ledger/repository.py::LedgerRepository`) is retained *only* for the standalone `build_demo --persist` tool and must not be called from request/worker code (it blocks the event loop). `supabase` stays in `requirements.txt` for that one tool.
- **`.env` location:** `backend/app/config.py` loads both `backend/.env` and repo-root `.env`. Keep `.env.example` as the shared template; choose one canonical checked-out location per deployment.
- **Live infra is env-gated:** migrations, seed status, and live provider runs depend on credentials outside the repo. Reverify Supabase/B2/Redis/provider state in the target checkout before relying on live ingestion or live adjudication.
- **Provider model IDs are defaults:** values in `backend/app/config.py` are configuration defaults. Confirm provider catalog IDs before live runs.
- **Scale gap:** ingestion targets 50+ docs/case; the orchestration was demoed on compact sample evidence. At scale the Evidence Aggregator likely needs a retrieval step (full-text first, embeddings only if needed).
- **Ledger build handoff — NOW WIRED:** previously a real case ingested and then *stalled* (nothing read `document_pages`, built the graph, or flipped `ledger_complete`), so the Argument Room never opened. Fixed: when ingestion atomically flips `ingestion_complete`, the winning worker enqueues an arq job `run_ledger_build` (`backend/ledger/jobs.py`); the worker runs `build_and_persist_ledger` (`backend/ledger/service.py`) which reads case+pages+statutes via the ingestion repository, builds the graph (mock fixture with no keys / configured Evidence Aggregator live), writes `nodes`/`edges` via asyncpg, and atomically flips `ledger_complete=true`. Idempotent (replaces any prior graph) and race-safe (only one worker wins each flip). Enqueue is by job-name only, so the ingestion lane never imports ledger code — the worker is the composition root that registers both jobs. **Edge cases handled:** mock graphs are fixtures not anchored to the uploaded docs, so the strict Fact-anchor check is skipped under `is_mock()` (keeps the full upload→ingest→ledger→room flow demoable with zero keys); a Fact's `source_document` is matched to a document UUID by `startswith` (the extraction agent may append "(page 1 · kind)"); zero-document cases still write a (mock) graph rather than hanging.
- **Real-case orchestration handoff — NOW WIRED.** `GET /api/run/{case_id}` branches on the id shape: demo ids (`clean`/`loser`) build their ledger from the bundled claim as before; real UUIDs now run the courtroom hearing **over the already-persisted graph**. `backend/ledger/service.py::load_run_inputs(case_id)` reconstructs the `ClaimInput` from `documents`/`document_pages`, loads the jurisdiction's statutes, and projects the stored Fact `nodes` into the `EvidenceLedger` (resolving `source_document_id`→filename). `run_lumen(claim, statutes, room, ledger=...)` skips the rebuild when a ledger is passed. The server requires `ledger_complete=true` (409 otherwise) and refuses an empty ledger (409). On the real UUID path, orchestration inserts a `runs` row, persists every `room.post()` plus metadata to `transcript`, inserts `decisions`, marks the run `completed`/`escalated`/`failed`, rolls up outcome/last-run metadata to `cases`, returns `runId`, and exposes replay/history through `/api/cases/{case_id}/runs` plus `/api/runs/{run_id}/transcript`. **Not yet done:** human approval persistence and `cases.finalized`.

---

## 18. Current status (what's done vs. pending)

**Done + verified (mock/offline):** Python backend; 6-gate harness; bounded courtroom hearing; dual-family adjudication; loser/decline case; Next.js recovery-operations console with courtroom metadata display; legacy TypeScript demo retained only as a reference path; ledger lane with offline graph builder and Fact-anchor validation; **real ledger-build integration (ingestion→ledger handoff): arq `run_ledger_build` job + asyncpg `LedgerWriteRepository` that persists `nodes`/`edges` and flips `ledger_complete` - write-path transaction logic verified offline with a stub connection (node-UUID capture, edge resolution, idempotent replace, race-safe flip);** **real-case hearing (`GET /api/run/{uuid}` runs over the persisted ledger graph via `load_run_inputs` + `run_lumen(ledger=...)`) and persists run metadata/transcript/decision rows for replay;** ingestion lane with upload signing, B2 storage seam, async extraction worker, and per-format extractors; DB schema mirrored by Pydantic row models.

**Done + verified (local browser smoke, 2026-06-19):** case `SMOKE-039741` uploaded PDF + TXT evidence, extracted 2/2 documents, built a 31-node / 33-edge ledger, reached a terminal escalated room decision, and replayed after refresh with 39 transcript items plus the decision panel.

**Pending / env-gated:** provider-live run with `LUMEN_MOCK=0` explicitly confirmed against target provider accounts; human approval/finalization persistence (`cases.finalized`); deploy live; record final demo assets; confirm provider model IDs in live consoles.

---

## 19. Future scope (deferred, post-hackathon or v2)

- **Image/audio/OCR hardening** — credential checks, cost controls, dependency probes, and broader fixtures for model-backed extraction.
- **Cross-case memory** — "find similar past cases" (the one genuine embeddings use case; deferred).
- **Retrieval in the Evidence Aggregator** at 50+ doc scale (full-text first, embeddings if needed).
- **More claim types / jurisdictions** (more statutes, multi-state comparative-negligence).
- **Dynamic specialist recruiting** (agents that recruit a needed specialist model at runtime).
- **Standardize the DB layer**, multi-tenant RLS, a real `runs`-driven dashboard.

---

## 20. Learnings (meta — how to work on this)

- **Mock-first paid off every single time** — every cross-verification ran offline and never flaked. Keep the mock backend in lockstep with the live backend.
- **Ask before architectural/cross-lane changes; execute mechanical changes.** Provider mix, schema shape, deploy topology, idea pivots → confirm. Writing the migration/prompts/extractors → move fast.
- **The reference repo (Recourse) is a calibration tool, not a template** — copy what's correct (real Band, audit hash, human gate), reject what collapses our differentiation (their domain, their RAG-as-primary).
- **Verify against the running system, not memory** — re-run the demo and re-read the repo after every meaningful change; the gate outputs and the `$35,700` number are the ground truth.
- **Band's mention-routing + per-agent participant cache** is the easiest place to lose hours — see §11.

---

## 21. Glossary

- **Subrogation** — an insurer that paid its insured pursuing recovery from the at-fault third party. ("Subro.")
- **FNOL** — First Notice of Loss; the initial claim report.
- **Comparative negligence** — fault split by percentage (CA Civ. Code §1431.2); recovery scales with the other party's fault share.
- **Evidence Ledger** — the typed graph of facts/parties/events the agents argue over (built by the ledger lane).
- **The harness** — the six code gates (§7).
- **Band room** — the shared agent chat room (coordination layer).
- **Adjudicator A/B** — the two neutral deciders on different model families (consensus check).
- **`outcome`** — `pursue` (auto-clear) / `escalate` (human review) / `decline` (don't pursue).

---

## 22. How to run

```bash
# Python (canonical) - mock, no keys
python -m backend.app.run_demo                    # CLI, clean case
PORT=8000 python -m backend.app.run_server        # API for the Next.js frontend

# Ledger lane (offline graph)
python -m backend.ledger.build_demo clean         # or: loser

# Node (fallback) - mock
pnpm run demo            # CLI
pnpm run serve           # web

# Live (backup path): put ANTHROPIC_API_KEY + OPENAI_API_KEY in .env (Gemini not needed), then
LUMEN_MOCK=0 PORT=8000 python -m backend.app.run_server

# Real Band room: fill band_config.yaml (8 agents), then
LUMEN_BAND=1 python -m backend.app.run_demo
```

Demo cases: **`clean`** → escalate / $35,700; **`loser`** → decline / $1,980.
