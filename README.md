# argue-d-agent — Lumen

**AI Subrogation Recovery Officer** — built for the [Band of Agents Hackathon](https://lablab.ai/ai-hackathons/band-of-agents-hackathon).

Insurance companies leave an estimated **$15–20B/year** uncollected because chasing money owed to them (subrogation) is slow and manual. Lumen is a **team of AI agents** that investigates a claim, **argues both sides** to pressure-test it, and produces a ready-to-send recovery packet — with a hard rule that **no claim is allowed without citing real evidence.**

> Product context, architecture, and project planning docs live in [`docs/`](./docs/README.md).

## Run it now (no API keys needed)

The whole agent debate runs in **mock mode** — deterministic, offline, zero keys.

```bash
pnpm install
pnpm demo
```

You'll see the live Band-room transcript: facts get extracted, the Advocate and the Opposing red team **disagree**, the **Citation Gate rejects an uncited claim** and forces a fix, a neutral Adjudicator sets the fault % and recovery amount, and a large claim **escalates to a human**.

## Go live (when keys arrive)

```bash
cp .env.example .env      # add AIMLAPI_API_KEY and FEATHERLESS_API_KEY
pnpm demo:live
```

Both providers are OpenAI-compatible, so the only change is real network calls. Confirm the exact model ids in each provider's catalog and set the `MODEL_*` vars in `.env`.

## How it's built

| Agent | Provider | Job |
|---|---|---|
| Intake Parser | Featherless (OSS) | Extract incident facts |
| Evidence Aggregator | Featherless (OSS) | Build the grounded Evidence Ledger |
| Liability Advocate | AI/ML API (frontier) | Argue our insured is owed recovery |
| Opposing-Carrier Red Team | AI/ML API (frontier) | Attack our case — *not a negotiator* |
| Adjudicator | AI/ML API (frontier) | Neutrally set fault % + recovery |
| Demand Letter Drafter | AI/ML API (frontier) | Write the formal letter |

**Anti-hallucination:** one Evidence Ledger is the single source of truth; the **Citation Gate** (`src/citationGate.ts`) is code that rejects any point not citing a real fact/statute id.

**Anti-collusion:** the opponent is a red team with a fixed opposing objective (never told to agree); the debaters draft independently first; the structured rounds have **no consensus round**; and a **neutral Adjudicator — not the debaters — decides** the number from a fault table.

**Band seam:** `src/room.ts` is the stand-in for a BAND room. When the BAND SDK lands, `post()` becomes a BAND room message and the citation gate + turn protocol become BAND room rules. The rest of the pipeline is unchanged.

### Layout

```
src/
  config.ts        providers, models, thresholds
  types.ts         Evidence Ledger + schemas (zod)
  providers.ts     OpenAI-compatible client + mock switch
  mockResponses.ts canned outputs for offline runs
  ledger.ts        ledger / statute rendering + valid-id set
  citationGate.ts  the hard citation check (code, not a prompt)
  prompts.ts       agent system prompts (rules baked in)
  agents.ts        agent definitions (role, provider, model)
  room.ts          BAND-room stand-in
  pipeline.ts      the structured debate + adjudication + escalation
  runDemo.ts       CLI entry point
data/
  sample_claim_clean.json
  statutes.json
```
