import type { CaseRow } from "@/lib/types";

type Tone = "info" | "warn" | "ok" | "bad";
type Stage = { label: string; tone: Tone };

const STAGES = {
  declined: { label: "Declined", tone: "bad" },
  finalized: { label: "Finalized", tone: "ok" },
  ready: { label: "Ready", tone: "info" },
  ledger: { label: "Ledger", tone: "warn" },
  ingesting: { label: "Ingesting", tone: "warn" },
} satisfies Record<string, Stage>;

const STAGE_RULES: Array<{ matches: (c: CaseRow) => boolean; stage: Stage }> = [
  {
    matches: (c) => (c.metadata as { outcome?: string })?.outcome === "decline",
    stage: STAGES.declined,
  },
  { matches: (c) => c.finalized, stage: STAGES.finalized },
  { matches: (c) => c.ledger_complete, stage: STAGES.ready },
  { matches: (c) => c.ingestion_complete, stage: STAGES.ledger },
];

/**
 * Maps the three boolean flags on `cases` (ingestion_complete, ledger_complete,
 * finalized) plus the loser-case `metadata.outcome` into a single visual stage:
 *
 *   Ingesting   — docs uploading / extracting
 *   Ledger      — ingestion done, graph being built
 *   Ready       — ledger done, ready to run the debate
 *   Finalized   — debate completed, decision recorded
 *   Declined    — loser case, do-not-pursue
 */
function stageOf(c: CaseRow): Stage {
  return STAGE_RULES.find((rule) => rule.matches(c))?.stage ?? STAGES.ingesting;
}

const toneClasses: Record<Tone, string> = {
  info: "border-accent/40 bg-accent/10 text-accent",
  warn: "border-warn/40 bg-warn/10 text-warn",
  ok: "border-ok/40 bg-ok/10 text-ok",
  bad: "border-bad/40 bg-bad/10 text-bad",
};

export function CaseStatusBadge({ case: c }: { case: CaseRow }) {
  const stage = stageOf(c);
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 font-medium text-[11px] uppercase tracking-wider ${toneClasses[stage.tone]}`}
    >
      {stage.label}
    </span>
  );
}
