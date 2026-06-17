import type { CaseRow } from "@/lib/types";

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
function stageOf(c: CaseRow): {
  label: string;
  tone: "info" | "warn" | "ok" | "bad";
} {
  const outcome = (c.metadata as { outcome?: string })?.outcome;
  if (outcome === "decline") return { label: "Declined", tone: "bad" };
  if (c.finalized) return { label: "Finalized", tone: "ok" };
  if (c.ledger_complete) return { label: "Ready", tone: "info" };
  if (c.ingestion_complete) return { label: "Ledger", tone: "warn" };
  return { label: "Ingesting", tone: "warn" };
}

const toneClasses: Record<"info" | "warn" | "ok" | "bad", string> = {
  info: "border-accent/40 bg-accent/10 text-accent",
  warn: "border-warn/40 bg-warn/10 text-warn",
  ok: "border-ok/40 bg-ok/10 text-ok",
  bad: "border-bad/40 bg-bad/10 text-bad",
};

export function CaseStatusBadge({ case: c }: { case: CaseRow }) {
  const stage = stageOf(c);
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wider ${toneClasses[stage.tone]}`}
    >
      {stage.label}
    </span>
  );
}
