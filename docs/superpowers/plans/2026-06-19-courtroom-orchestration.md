# Courtroom Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the one-pass debate feel with a bounded courtroom protocol that keeps ledger facts as the source of truth, streams visible issue rounds, and stays cheap enough for the hackathon demo.

**Architecture:** Keep ingestion and ledger untouched. Add a small orchestration protocol layer inside `backend/app/` that plans issues from the locked ledger, runs counsel/direct/cross/rebuttal turns by issue, emits structured room postings, and keeps existing gates and final decision persistence. Update the active frontend to display courtroom phases without requiring a WebSocket rewrite.

**Tech Stack:** Python 3.11 FastAPI backend, Pydantic v2, existing SSE room seam, Next.js 16/React 19 frontend, built-in `unittest` for focused backend tests.

---

### Task 1: Backend Courtroom Protocol

**Files:**
- Create: `backend/app/courtroom.py`
- Test: `backend/app/test_courtroom.py`

- [x] Define `CourtIssue`, `CourtTurn`, and `CourtroomPlan` Pydantic models.
- [x] Add deterministic `build_courtroom_plan(ledger, statutes)` that creates 2-4 issues from available facts: liability, comparative fault, damages, and legal basis.
- [x] Add `render_issue_context(...)` so each turn gets a compact issue packet, not the full transcript.
- [x] Verify with `python -m unittest backend.app.test_courtroom -v`.

### Task 2: Ledger Lookup Tool Surface

**Files:**
- Create: `backend/app/orchestration_tools.py`
- Test: `backend/app/test_orchestration_tools.py`

- [x] Implement `LedgerLookupTool` over `EvidenceLedger` and `Statute` objects.
- [x] Support `search_ledger(query)`, `get_node(node_id)`, and `lookup_statute(statute_id)` for the current in-memory run.
- [x] Keep this structured and read-only. No bash/code execution tool for agents.
- [x] Verify with `python -m unittest backend.app.test_orchestration_tools -v`.

### Task 3: Pipeline Courtroom Flow

**Files:**
- Modify: `backend/app/pipeline.py`
- Modify: `backend/app/mock_responses.py`

- [x] Replace the flat debate sequence with bounded issue-by-issue courtroom rounds: opening briefs, defense cross, advocate redirect, and closing handoff to adjudicators.
- [x] Preserve Citation Gate retry behavior, Math Gate, Consensus Gate, Source Alignment, Letter Reconciliation, and mock mode.
- [x] Post visible handoffs that make Band look like a courtroom, while avoiding unbounded agent chatter.
- [x] Verify with `./run.sh demo` and `./run.sh typecheck`.

### Task 4: Frontend Courtroom Visibility

**Files:**
- Modify: `frontend/lib/types.ts`
- Modify: `frontend/lib/useRunStream.ts`
- Modify: `frontend/components/RoomTranscript.tsx`
- Modify: `frontend/components/GateRail.tsx`
- Modify: `frontend/components/ArgumentRoom.tsx`

- [x] Include `runId` and optional posting metadata in the hook state.
- [x] Add courtroom stage labels and issue-aware transcript display.
- [x] Keep SSE as the delivery mechanism for now. Treat WebSocket migration as post-hackathon unless SSE blocks streaming.
- [x] Verify with `pnpm --dir frontend exec tsc --noEmit` and `pnpm --dir frontend build`.

### Task 5: Documentation And Handoff

**Files:**
- Modify: `docs/architecture.md`
- Modify: `docs/CONTEXT.md`
- Modify: `backend/README.md`
- Modify: `README.md` if run commands or headline flow change.

- [x] Document the courtroom protocol, Band's current role, and why agents do not get raw shell access.
- [x] Remove stale claims that orchestration is merely the old fixed one-pass debate.
- [x] Record remaining limits: full Band remote-agent A2A and WebSocket token streaming are not required for this hackathon slice.
- [x] Verify with `git diff --check`, `pnpx react-compiler-marker`, and `pnpx fallow audit --format json --quiet --explain --gate-marker agent`.
