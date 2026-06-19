# Documentation Map

Use this directory for durable project context. Keep current contracts in one canonical place and link instead of repeating them.

## Core Docs

- [**Master Context & Decision Log**](./CONTEXT.md) - **start here.** The whole journey in raw form: vision, every decision and *why* (incl. roads rejected), competitive + reference-repo research, the harness, the schema, the pipeline + edge cases, learnings, current status, future scope. Built to recover full context fast.
- [**Ingestion Flow (end-to-end)**](./ingestion-flow.md) - plain-English + Mermaid diagrams of what happens to a file from upload through extraction, storage, and read-back. Covers current upload formats, where bytes vs. derived text live, the Fact Gate's source-anchoring rule, and every failure mode.
- [**Extractor Deep Dive**](./extractor-deep-dive.md) - byte-by-byte ASCII-diagram walkthrough of how images (Claude vision + two-block prompt), audio (Whisper + ffmpeg chunking), and scanned PDFs (pdfplumber + ocrmypdf fallback) are parsed, plus shorter sections for the deterministic formats. Includes sample `documents` + `document_pages` rows for each format showing what actually lands in the DB.
- [**Trace: Image/Audio Ingestion + Real Flow**](./trace-image-audio-ingestion.md) - raw, un-summarized record of the ingestion expansion, cross-format EVENTS extraction pattern, orchestration persistence, ingestion to ledger handoff verification, and full real-case argument flow. Companion to `CONTEXT.md`: that one is the verdicts, this one is the why.
- [Ingestion Start Context](./ingestion-start-context.md) - ingestion-lane deep-dive + earlier session history; live contracts are in Architecture and Database README.
- [Product Context](./product-context.md) - the plain-English subrogation story, Lumen's six-agent model, safety rules, and ownership boundary.
- [Architecture](./architecture.md) - current orchestration flow, room behavior, gates, and package assembly.
- [Project Plan](./project-plan.md) - hackathon strategy, milestones, and broader delivery plan.
- [Backend README](../backend/README.md) - production Python lane map, local commands, ingestion test notes.
- [Frontend README](../frontend/README.md) - Next.js console routes, API contracts, upload behavior.
- [Courtroom Orchestration Plan](./superpowers/plans/2026-06-19-courtroom-orchestration.md) - current implementation tracker for the bounded courtroom protocol.
- [**Session Context (2026-06-19)**](./session-context-2026-06-19.md) - **the full raw context of everything done in this session**: per-MIME-class upload limits, CSV extractor, audio-model decision, curated test files, the live-run failure marathon + six progressive fixes (Intake schema, schema audit + 8 coercers, seed-on-mount race, SSE heartbeat, math-gate retry + degradation, Drafter retry + template fallback), merge of the courtroom-orchestration PR, design-iteration work, hard rules, verified vs untested, rejected ideas with reasoning, verbatim user feedback, files touched, decision log. Built for full context recovery from this file alone.
- [Frontend Design Notes (local)](./design/) - design-iteration working notes (brief, critique, competitor research, enhancements). Local-only reference; not part of the deployed product.
- [Contributor Guide](../AGENTS.md) - repository conventions for coding agents and human contributors.
- [Fallow local gate](../AGENTS.md#fallow-local-gate) - repo health checks, audit gate, and legacy ignore scope.

## Suggested Structure

As this repository grows:

- `docs/design/` for feature designs and implementation specs.
- `docs/decisions/` for architecture decision records.
- `docs/integrations/` for provider, Band, ingestion, and ledger integration contracts.
- `docs/operations/` for deployment, environment, and runbook notes.

Prefer focused docs over expanding historical context files. When moving or renaming docs, update this map and grep for stale links before reporting completion.
