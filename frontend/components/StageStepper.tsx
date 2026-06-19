"use client";

import type { DbCase, DecisionResult } from "@/lib/types";

/**
 * Run status as surfaced by `useRunStream()` (see SPEC live-data contract).
 * Mapped to the comp's three macro states: running = connecting|streaming,
 * adjourned = complete.
 */
type RunStatus = "idle" | "connecting" | "streaming" | "complete" | "error";

const STAGE_DEFS = [
  { idx: "01", label: "Ingested" },
  { idx: "02", label: "Ledger built" },
  { idx: "03", label: "Room ready" },
  { idx: "04", label: "Decision delivered" },
] as const;

type StageStatus = "complete" | "ready" | "progress" | "pending";

const SIGIL: Record<StageStatus, string> = {
  complete: "✓",
  ready: "○",
  progress: "◑",
  pending: "·",
};

const SIGIL_COLOR: Record<StageStatus, string> = {
  complete: "var(--color-ok)",
  ready: "var(--color-accent)",
  progress: "var(--color-accent)",
  pending: "var(--color-muted-2)",
};

const SIGIL_BG: Record<StageStatus, string> = {
  complete: "rgba(110,169,138,0.15)",
  ready: "rgba(111,155,240,0.12)",
  progress: "rgba(111,155,240,0.12)",
  pending: "transparent",
};

const SIGIL_BORDER: Record<StageStatus, string> = {
  complete: "rgba(110,169,138,0.4)",
  ready: "rgba(111,155,240,0.4)",
  progress: "rgba(111,155,240,0.4)",
  pending: "var(--color-border)",
};

const REACHED_CONNECTOR = "rgba(110,169,138,0.4)";

function money(n: number): string {
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

/**
 * Top-of-page progress strip. Four steps with sage connectors before reached
 * steps; on adjourn (run complete) step 04 morphs into the Disposition pill.
 *
 * Reached state is driven by the persisted case flags
 * (ingestion_complete → ledger_complete → finalized) plus the live run status:
 * - 03 Room ready becomes complete while running or after a finished run.
 * - 04 Decision delivered shows progress (pulsing) while running, completes on
 *   adjourn, and ghosts the destination recovery label mid-run.
 */
export function StageStepper({
  caseRow,
  status = "idle",
  decision = null,
}: {
  caseRow: DbCase;
  status?: RunStatus;
  decision?: DecisionResult | null;
}) {
  const running = status === "connecting" || status === "streaming";
  const adjourned = status === "complete";
  const finalized = caseRow.finalized || adjourned;

  const stageStatus = (i: number): StageStatus => {
    if (i === 0) return caseRow.ingestion_complete ? "complete" : "ready";
    if (i === 1) return caseRow.ledger_complete ? "complete" : "pending";
    if (i === 2) {
      if (running || finalized) return "complete";
      return caseRow.ledger_complete ? "ready" : "pending";
    }
    // i === 3 (Decision delivered)
    if (finalized) return "complete";
    if (running) return "progress";
    return "pending";
  };

  // Connector before step i is sage once that step is reachable/reached.
  const connectorReached = (i: number): boolean => {
    if (i === 1) return caseRow.ingestion_complete;
    if (i === 2) return caseRow.ledger_complete;
    if (i === 3) return running || finalized;
    return false;
  };

  const isPursue = decision ? decision.outcome !== "decline" : true;
  const recoveryLabel = decision ? money(decision.recoveryUsd) : "";
  const faultPct = decision ? decision.otherFaultPct : 0;

  return (
    <ol className="flex w-full items-center rounded-card border border-border bg-panel px-5.5 py-4">
      {STAGE_DEFS.map((def, i) => {
        const st = stageStatus(i);
        const showPill = i === 3 && adjourned && decision !== null;
        return (
          <li
            key={def.idx}
            className="flex items-center"
            style={{ flex: i < 3 ? 1 : undefined }}
          >
            {showPill ? (
              <DispositionPill
                isPursue={isPursue}
                recoveryLabel={recoveryLabel}
                faultPct={faultPct}
              />
            ) : (
              <Step
                idx={def.idx}
                label={def.label}
                status={st}
                ghost={i === 3 && running}
                ghostLabel={
                  i === 3 && running ? `Decision · ${recoveryLabel}` : def.label
                }
              />
            )}
            {i < 3 ? (
              <div
                aria-hidden
                className="mx-4 h-[1.5px] flex-1"
                style={{
                  background: connectorReached(i + 1)
                    ? REACHED_CONNECTOR
                    : "var(--color-border)",
                }}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function Step({
  idx,
  label,
  status,
  ghost,
  ghostLabel,
}: {
  idx: string;
  label: string;
  status: StageStatus;
  ghost: boolean;
  ghostLabel: string;
}) {
  const labelColor = ghost
    ? "var(--color-muted-2)"
    : status === "pending"
      ? "var(--color-muted-2)"
      : "var(--color-text)";
  return (
    <div className="flex items-center gap-2.75">
      <span
        className="flex h-6.5 w-6.5 items-center justify-center rounded-lg text-[13px]"
        style={{
          border: `1.5px ${status === "pending" ? "dashed" : "solid"} ${SIGIL_BORDER[status]}`,
          background: SIGIL_BG[status],
          color: SIGIL_COLOR[status],
          animation: ghost ? "livePulse 1.6s infinite" : undefined,
        }}
      >
        {SIGIL[status]}
      </span>
      <div>
        <div className="font-mono text-[9.5px] text-muted-2 uppercase tracking-widest">
          {idx}
        </div>
        <div className="font-medium text-[13px]" style={{ color: labelColor }}>
          {ghost ? ghostLabel : label}
        </div>
      </div>
    </div>
  );
}

function DispositionPill({
  isPursue,
  recoveryLabel,
  faultPct,
}: {
  isPursue: boolean;
  recoveryLabel: string;
  faultPct: number;
}) {
  const color = isPursue ? "var(--color-money)" : "var(--color-bad)";
  const border = isPursue ? "rgba(231,211,168,0.4)" : "rgba(198,106,90,0.4)";
  const bg = isPursue ? "rgba(231,211,168,0.08)" : "rgba(198,106,90,0.08)";
  const value = isPursue
    ? `${recoveryLabel} · ${faultPct}%`
    : `Decline · ${faultPct}%`;
  return (
    <div
      className="flex items-center gap-2.75 rounded-[11px] px-3.5 py-2"
      style={{
        border: `1px solid ${border}`,
        background: bg,
        animation: "gatePop 0.5s ease-out",
      }}
    >
      <span
        className="flex h-6.5 w-6.5 items-center justify-center rounded-lg text-[12px]"
        style={{ border: `1.5px solid ${border}`, background: bg, color }}
      >
        ✦
      </span>
      <div className="flex flex-col leading-[1.15]">
        <span className="font-mono text-[9px] text-muted-2 uppercase tracking-[0.14em]">
          Disposition
        </span>
        <span
          className="tnum font-mono font-semibold text-[14px] tracking-[-0.01em]"
          style={{ color }}
        >
          {value}
        </span>
      </div>
    </div>
  );
}
