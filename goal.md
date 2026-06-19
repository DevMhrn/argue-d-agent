You are researching and designing the next version of Lumen's agent orchestration layer. Work from the current repo state after the latest pull, especially `docs/`, `backend/`, `frontend/`, and `**/***.md`.

Also inspect this Notion benchmark page if useful: https://app.notion.com/p/34b1726e2c3e813ab3e7ebb5b401673c

Use it for context on prior architecture benchmarks, model-routing lessons, object storage, extraction caching, decomposed pipelines, and cost-to-quality tradeoffs. Treat model IDs, prices, and provider behavior from the Notion page as hypotheses until verified against current official docs.

## Current Situation

The repo now has real ingestion, ledger, run persistence, and frontend plumbing:

- `backend/ingestion/` handles case creation, direct object-storage uploads, extraction, and ingestion status.
- `backend/ledger/` builds and persists a graph ledger, writes `nodes`/`edges`, and flips `cases.ledger_complete`.
- `backend/app/` can run the current debate over a persisted ledger, stream room events, persist `runs`/`transcript`/`decisions`, and replay run history.
- `frontend/` has a Next.js recovery console with case intake, uploads, case detail, ledger panels, run history, and room transcript UI.

However, treat the current orchestration layer as a baseline stub, not the finished product. The current fixed pipeline, prompts, agent personalities, tool surface, model routing, context policy, and memory strategy need a rigorous redesign before implementation.

The orchestration redesign should preserve existing lane boundaries:

- Ingestion owns documents and extracted page text.
- Ledger owns graph construction and `nodes`/`edges`.
- Orchestration owns agent roles, agent runtime, debate protocol, context assembly, gates, run records, transcript, decisions, escalation, and the final demand package.

## About me

- I'm a mid-level frontend/fullstack engineer.
- Recent public work suggests comfort with TypeScript, Python, browser/data-ingestion tooling, fullstack app prototypes, systems-style utilities, and practical prototype shipping.
- Optimize recommendations for a small team and a frontend/fullstack implementer: clear backend contracts, pragmatic orchestration, strong UI affordances, typed interfaces, and limited infrastructure sprawl.

## Goal

Produce a rigorous recommendation and implementation direction for the improved orchestration layer.

Focus on:

1. Better agent role design and personalities.
2. Better model assignment per agent.
3. Better context window, memory, and compaction strategy.
4. Better tool design.
5. Better orchestration architecture and state model.
6. Better UI implications for how users see and control the agent workflow.
7. A practical implementation path in the current repo.

## Provider Scope

Only research OpenAI and Anthropic models for now.

Do not spend time on Gemini or other providers unless needed as historical context from the repo or Notion benchmark page. The production design should assume OpenAI + Anthropic only.

Verify every factual claim about model IDs, pricing, rate limits, API formats, SDK behavior, context limits, tool-use behavior, and current model capabilities against current official docs or current provider-facing sources. Do not rely on training data or old benchmark memory.

Model selection should be based on end-to-end cost-to-intelligence, not sticker price alone. The user's earlier GPT-5.5-style example is the decision principle: a newer/larger-looking model can still be cheaper overall if it needs fewer reasoning tokens, output tokens, retries, or verifier passes. Evaluate each model by task success, latency, total token cost, context behavior, tool reliability, JSON reliability, and reasoning quality.

## Recommended Research Method

Fan out subagents if it improves coverage. Let the research lead decide exact decomposition, but useful tracks are:

- **Repo state audit:** current ingestion, ledger, orchestration, persistence, frontend contracts, and what is stubbed.
- **Agent design:** role boundaries, personalities, debate protocol, specialist spawning, escalation behavior, and anti-collusion structure.
- **Model routing:** OpenAI vs Anthropic model choices per agent, accounting for cost-to-intelligence, modernness, output reliability, tool use, context handling, and latency.
- **Context architecture:** per-agent context assembly, memory, transcript compaction, source lookup, graph lookup, and token budgets.
- **Tool architecture:** safe, broadly useful tools such as ledger search, source-text lookup, graph traversal, web search, calculator, policy/statute lookup, and human-escalation tools.
- **UI/workflow:** what the recovery specialist should see, control, approve, inspect, and replay.
- **Implementation plan:** smallest shippable path in this repo, with clear files and tests.

Compare architectures instead of picking the first plausible one. Use web research, official docs, framework/protocol docs, repo inspection, and benchmark-style reasoning.

## Key Questions

1. What should the improved orchestration layer own, given ingestion and ledger now exist?
2. Which parts of the current `backend/app/` pipeline should be retained, wrapped, rewritten, or replaced?
3. Should orchestration remain a fixed state machine, become a planner-supervisor system, use a room-based handoff protocol, use a durable workflow engine, or use a hybrid?
4. How should each agent's personality be designed so it is useful, distinct, and resistant to collusion or vague consensus?
5. What exact agent roster should v1 use? Which agents are core, which are optional specialists, and when are specialists spawned?
6. How should agent context be assembled without using huge context windows as a crutch?
7. What should memory mean in this product: run transcript, durable case memory, per-agent scratchpad, compacted debate state, graph state, or source anchors?
8. What compaction strategy keeps agents accurate while limiting cost and hallucination risk?
9. What model should power each agent, using only OpenAI and Anthropic? How should we benchmark that choice locally?
10. Which agents need the strongest reasoning model, and which can use cheaper/faster models?
11. Which tools should agents get, and which tools should remain orchestrator-only?
12. Should agents get web search? If yes, how do we preserve citation integrity and prevent external unverified sources from entering decisions?
13. Do we need a bash/code-execution tool for agents, or should we expose safer structured tools instead?
14. What gates are missing beyond citation, fact anchoring, math, consensus, source alignment, and letter reconciliation?
15. How should the UI show agent state, context usage, gates, tool calls, source drilldown, escalation, and demand package review?
16. What is the first implementation milestone that improves orchestration materially without blocking on live provider uncertainty?

## Context Strategy Requirements

Do not recommend simply using very large context windows as the primary solution. Large contexts can be expensive, noisy, slower, and less reliable. Prefer a design where:

- Agents receive a compact, role-specific packet.
- The ledger graph remains the trusted source of facts.
- Full source text is fetched only when needed.
- Transcript history is compacted into structured state, not repeatedly replayed in full.
- Important claims remain tied to fact IDs, statute IDs, source page IDs, and run transcript IDs.
- Context budgets are explicit per agent and per phase.
- Compaction is auditable: the system should know what was omitted, summarized, or preserved verbatim.

Consider designs such as:

- Per-agent briefing packets.
- Shared canonical case state.
- Compacted debate state after each round.
- Source drilldown tools.
- Graph neighborhood tools.
- Retrieval from `document_pages` via full-text search.
- Separate scratchpad/private reasoning that is not treated as evidence.
- Durable run summaries for replay and follow-up chats.

## Tool Strategy Requirements

Think in terms of safe, wide tools rather than many tiny bespoke tools.

Evaluate at least:

- `search_ledger(query)`
- `get_node(node_id)`
- `get_neighbors(node_id, edge_type?)`
- `get_source_text(document_id, page_number)`
- `search_document_pages(query)`
- `lookup_statute(statute_id)`
- `calculate(expression or structured formula)`
- `web_search(query)` with ingestion/verification rules
- `request_human_review(reason, packet)`
- `spawn_specialist(role, task, allowed_context)`

Be skeptical of giving agents raw bash access. If recommending it, define the sandbox, command allowlist, filesystem scope, network scope, audit logging, timeout policy, and why structured tools are insufficient.

## Deliverable

Start with a concise recommendation.

Then provide:

- Current-state assessment of the repo.
- 2-4 viable orchestration architectures with pros and cons.
- Your recommended architecture and why.
- Proposed agent roster, personality briefs, responsibilities, inputs, outputs, and failure modes.
- OpenAI/Anthropic model-routing matrix by agent, with research-backed rationale and benchmark plan.
- Context/memory/compaction design with concrete token budgets and source-of-truth rules.
- Tool design and safety policy.
- UI/workflow implications.
- Implementation phases that can begin immediately in this repo.
- Verification plan, including mock-mode tests and live-model benchmark tasks.
- Risks, open questions, and decisions that need user confirmation.

Prefer practical, shippable design over generic multi-agent theory.
