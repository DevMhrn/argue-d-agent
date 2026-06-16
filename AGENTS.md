# Repository Guidelines

## Project Structure & Module Organization

Lumen is an AI-assisted insurance subrogation recovery workflow. Read `docs/product-context.md` before changing product behavior, and use `docs/README.md` as the documentation map. Long-form docs live in `docs/`, including `docs/architecture.md` and `docs/project-plan.md`. The primary TypeScript ESM source lives in `src/`, with the CLI entry point at `src/runDemo.ts`, orchestration in `src/pipeline.ts`, provider/config wiring in `src/providers.ts` and `src/config.ts`, and validation gates in `src/factGate.ts`, `src/citationGate.ts`, and `src/mathGate.ts`. The Express server lives in `server/`, the static UI in `web/`, sample claims and statute fixtures in `data/`, and Python mirror/probe code in `lumen_py/`.

## Build, Test, and Development Commands

- `pnpm install` installs dependencies from `pnpm-lock.yaml`.
- `pnpm demo` runs the deterministic mock pipeline with no API keys.
- `pnpm demo:live` runs live provider calls with `LUMEN_MOCK=0`; configure `.env` first.
- `pnpm serve` starts the local Express server in mock mode.
- `pnpm serve:live` starts the server with live provider calls.
- `pnpm typecheck` runs `tsc --noEmit` against the TypeScript project.

Keep mock mode working before changing live-provider behavior.

## Coding Style & Naming Conventions

Use TypeScript with strict types for new repository code unless the change clearly belongs in `lumen_py/`. Follow the existing style: two-space indentation, single quotes, semicolons, named exports, and concise interfaces. Avoid `any`. Prefer pure helpers for gate logic and keep prompts in `src/prompts.ts`, agent definitions in `src/agents.ts`, and environment-derived settings in `src/config.ts`. Name files by responsibility, such as `ledger.ts`, `room.ts`, or `<domain>Gate.ts`.

## Testing Guidelines

No dedicated test framework is currently present. Before reporting changes as complete, run `pnpm typecheck` and `pnpm demo`. When adding tests, start with focused TypeScript tests for pure modules, especially schema parsing and gate behavior. Use behavior-focused names, for example `citationGate rejects unknown ids`.

## Commit & Pull Request Guidelines

Recent history uses concise Conventional Commit-style subjects such as `feat: ...`, `fix: ...`, and `test: ...`. Keep one logical change per commit. Pull requests should include a short description, commands run, changed environment variables, and sample CLI or UI output when pipeline behavior changes.

## Security & Configuration Tips

Do not commit `.env` or API keys. Start from `.env.example`, keep mock mode as the safe default, and confirm live model and provider settings before using `LUMEN_MOCK=0`. After renaming config keys, agents, providers, or models, search the whole repository for stale references.

## Agent-Specific Instructions

Preserve the central safety rules: downstream agents must cite existing fact IDs or statute IDs, and high-value, low-confidence, close-liability, or gate-failed cases should escalate to a human with the full packet for review.
