"use client";

import type { DbCase } from "@/lib/types";

const STEPS = [
  { key: "ingest", label: "Ingested" },
  { key: "ledger", label: "Ledger built" },
  { key: "ready", label: "Room ready" },
  { key: "finalized", label: "Decision delivered" },
] as const;

type StepKey = (typeof STEPS)[number]["key"];
type StepState = "done" | "active" | "pending";

/**
 * Top-of-page progress strip showing which lane has completed.
 * Tracks the three flags on `cases`: ingestion_complete → ledger_complete → finalized.
 */
export function StageStepper({ caseRow }: { caseRow: DbCase }) {
  const reached: Record<StepKey, boolean> = {
    ingest: caseRow.ingestion_complete,
    ledger: caseRow.ledger_complete,
    ready: caseRow.ledger_complete, // same as ledger built — room becomes runnable
    finalized: caseRow.finalized,
  };

  return (
    <ol className="flex w-full items-center gap-3 overflow-x-auto rounded-card border border-border bg-panel/80 px-4 py-3">
      {STEPS.map((step, index) => (
        <StageStep
          key={step.key}
          label={step.label}
          index={index}
          state={stepState(step.key, index, reached)}
        />
      ))}
    </ol>
  );
}

function StageStep({
  label,
  index,
  state,
}: {
  label: string;
  index: number;
  state: StepState;
}) {
  return (
    <li className="flex min-w-35 flex-1 items-center gap-2">
      <span
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border font-medium text-[12px] ${DOT_CLASS[state]}`}
      >
        {state === "done" ? "✓" : index + 1}
      </span>
      <span className={`text-[12.5px] ${LABEL_CLASS[state]}`}>{label}</span>
    </li>
  );
}

const DOT_CLASS: Record<StepState, string> = {
  done: "border-ok/60 bg-ok/15 text-ok",
  active: "border-warn/60 bg-warn/15 text-warn",
  pending: "border-border bg-panel-2 text-muted-2",
};

const LABEL_CLASS: Record<StepState, string> = {
  done: "text-text",
  active: "text-warn",
  pending: "text-muted-2",
};

function stepState(
  key: StepKey,
  index: number,
  reached: Record<StepKey, boolean>,
): StepState {
  if (reached[key]) return "done";
  return STEPS.slice(0, index).every((step) => reached[step.key])
    ? "active"
    : "pending";
}
