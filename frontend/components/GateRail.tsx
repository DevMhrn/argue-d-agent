"use client";

import type { RoomPosting } from "@/lib/types";

/**
 * The six harness gates light up as the pipeline fires them. We sniff the
 * incoming postings (kind='gate' or specific agent names) and bucket them
 * into stages so the rail stays in lockstep with the live debate.
 */
const STAGES = [
  { key: "docket", label: "Docket" },
  { key: "evidence", label: "Evidence + Fact Gate" },
  { key: "hearing", label: "Opening + Hearing" },
  { key: "adjudication", label: "Adjudication + Gates" },
  { key: "alignment", label: "Source Alignment" },
  { key: "letter", label: "Draft + Reconciliation" },
] as const;

const STAGE_OF: Record<string, (typeof STAGES)[number]["key"]> = {
  System: "docket",
  "Intake Parser": "docket",
  "Evidence Aggregator": "evidence",
  "Fact Gate": "evidence",
  "Liability Advocate": "hearing",
  "Opposing-Carrier Red Team": "hearing",
  "Citation Gate": "hearing",
  "Adjudicator A": "adjudication",
  "Adjudicator B": "adjudication",
  "Math Gate": "adjudication",
  "Consensus Gate": "adjudication",
  "Source-Alignment Verifier": "alignment",
  "Demand Letter Drafter": "letter",
  "Letter Reconciliation": "letter",
};

const PHASE_STAGE: Record<string, StageKey> = {
  docket: "docket",
  intake: "docket",
  evidence: "evidence",
  fact_gate: "evidence",
  ledger_lock: "evidence",
  opening_briefs: "hearing",
  issue_hearing: "hearing",
  tool_use: "hearing",
  cross_examination: "hearing",
  redirect: "hearing",
  adjudication: "adjudication",
  math_gate: "adjudication",
  consensus_gate: "adjudication",
  source_alignment: "alignment",
  disposition: "alignment",
  drafting: "letter",
  letter_gate: "letter",
};

type StageKey = (typeof STAGES)[number]["key"];
type GateState = "failed" | "active" | "pending";
type VerdictState = "failed" | "passed";
interface GateProgress {
  reached: Set<StageKey>;
  failed: StageKey | null;
}

const VERDICT_STATE: Record<string, VerdictState> = {
  rejected: "failed",
  decline: "failed",
  passed: "passed",
  warning: "passed",
  escalated: "passed",
};

export function GateRail({ postings }: { postings: RoomPosting[] }) {
  const progress = gateProgress(postings);

  return (
    <ol className="flex w-full items-center gap-2 overflow-x-auto rounded-card border border-border bg-panel/80 px-4 py-3">
      {STAGES.map((stage, index) => (
        <GateStep
          key={stage.key}
          label={stage.label}
          index={index}
          state={gateState(stage.key, progress)}
        />
      ))}
    </ol>
  );
}

function gateProgress(postings: RoomPosting[]) {
  return postings.reduce(advanceGateProgress, emptyGateProgress());
}

function emptyGateProgress(): GateProgress {
  return { reached: new Set<StageKey>(), failed: null };
}

function advanceGateProgress(progress: GateProgress, posting: RoomPosting) {
  const key = stageOfPosting(posting);
  if (!key) return progress;

  progress.reached.add(key);
  if (isFailedGate(posting)) progress.failed = key;
  return progress;
}

function isFailedGate(posting: RoomPosting) {
  const state = verdictState(posting.metadata?.gate?.verdict);
  return state ? state === "failed" : legacyFailedGate(posting);
}

function verdictState(verdict?: string) {
  return verdict ? VERDICT_STATE[verdict] : undefined;
}

function legacyFailedGate(posting: RoomPosting) {
  return posting.kind === "gate" && /⛔|fail|reject/i.test(posting.content);
}

function stageOfPosting(posting: RoomPosting): StageKey | undefined {
  const phase = posting.metadata?.phase;
  if (phase && PHASE_STAGE[phase]) return PHASE_STAGE[phase];
  return STAGE_OF[posting.agent];
}

function gateState(key: StageKey, progress: GateProgress): GateState {
  if (progress.failed === key) return "failed";
  if (progress.reached.has(key)) return "active";
  return "pending";
}

function GateStep({
  label,
  index,
  state,
}: {
  label: string;
  index: number;
  state: GateState;
}) {
  return (
    <li className="flex min-w-30 flex-1 items-center gap-2">
      <span
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border font-medium text-[12px] ${DOT_CLASS[state]}`}
      >
        {ICON[state] ?? index + 1}
      </span>
      <span className={`text-[12px] ${LABEL_CLASS[state]}`}>{label}</span>
    </li>
  );
}

const DOT_CLASS: Record<GateState, string> = {
  failed: "border-bad/60 bg-bad/15 text-bad",
  active: "border-ok/60 bg-ok/15 text-ok",
  pending: "border-border bg-panel-2 text-muted-2",
};

const LABEL_CLASS: Record<GateState, string> = {
  failed: "text-bad",
  active: "text-text",
  pending: "text-muted-2",
};

const ICON: Partial<Record<GateState, string>> = {
  failed: "✕",
  active: "✓",
};
