"use client";

import type { RoomPosting } from "@/lib/types";

/**
 * The six harness gates light up as the pipeline fires them. We sniff the
 * incoming postings (kind='gate' or specific agent names) and bucket them
 * into stages so the rail stays in lockstep with the live debate.
 */
const STAGES = [
  { key: "intake", label: "Intake" },
  { key: "evidence", label: "Evidence + Fact Gate" },
  { key: "debate", label: "Debate + Citation Gate" },
  { key: "adjudication", label: "Adjudication + Math + Consensus" },
  { key: "alignment", label: "Source-Alignment" },
  { key: "letter", label: "Letter + Reconciliation" },
] as const;

const STAGE_OF: Record<string, (typeof STAGES)[number]["key"]> = {
  "Intake Parser": "intake",
  "Evidence Aggregator": "evidence",
  "Fact Gate": "evidence",
  "Liability Advocate": "debate",
  "Opposing-Carrier Red Team": "debate",
  "Citation Gate": "debate",
  "Adjudicator A": "adjudication",
  "Adjudicator B": "adjudication",
  "Math Gate": "adjudication",
  "Consensus Gate": "adjudication",
  "Source-Alignment Verifier": "alignment",
  "Demand Letter Drafter": "letter",
  "Letter Reconciliation": "letter",
};

type StageKey = (typeof STAGES)[number]["key"];
type GateState = "failed" | "active" | "pending";
interface GateProgress {
  reached: Set<StageKey>;
  failed: StageKey | null;
}

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
  const key = STAGE_OF[posting.agent];
  if (!key) return progress;

  progress.reached.add(key);
  if (isFailedGate(posting)) progress.failed = key;
  return progress;
}

function isFailedGate(posting: RoomPosting) {
  return posting.kind === "gate" && /⛔|fail|reject/i.test(posting.content);
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
