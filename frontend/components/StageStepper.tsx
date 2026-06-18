"use client";

import type { DbCase } from "@/lib/types";

const STEPS = [
  { key: "ingest", label: "Ingested" },
  { key: "ledger", label: "Ledger built" },
  { key: "ready", label: "Room ready" },
  { key: "finalized", label: "Decision delivered" },
] as const;

/**
 * Top-of-page progress strip showing which lane has completed.
 * Tracks the three flags on `cases`: ingestion_complete → ledger_complete → finalized.
 */
export function StageStepper({ caseRow }: { caseRow: DbCase }) {
  const reached = {
    ingest: caseRow.ingestion_complete,
    ledger: caseRow.ledger_complete,
    ready: caseRow.ledger_complete, // same as ledger built — room becomes runnable
    finalized: caseRow.finalized,
  };

  return (
    <ol className="flex w-full items-center gap-3 overflow-x-auto rounded-card border border-border bg-panel/80 px-4 py-3">
      {STEPS.map((s, i) => {
        const done = reached[s.key];
        const active =
          !done &&
          // first not-yet-done step is the "active" / in-progress step
          STEPS.slice(0, i).every((p) => reached[p.key]);
        return (
          <li key={s.key} className="flex min-w-35 flex-1 items-center gap-2">
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border font-medium text-[12px] ${
                done
                  ? "border-ok/60 bg-ok/15 text-ok"
                  : active
                    ? "border-warn/60 bg-warn/15 text-warn"
                    : "border-border bg-panel-2 text-muted-2"
              }`}
            >
              {done ? "✓" : i + 1}
            </span>
            <span
              className={`text-[12.5px] ${
                done ? "text-text" : active ? "text-warn" : "text-muted-2"
              }`}
            >
              {s.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
