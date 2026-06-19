"use client";

import { Icon, type IconName } from "@/components/Icon";
import type { DecisionResult, RoomPosting } from "@/lib/types";

/**
 * The "Verification" rail — six independent checks the agents cannot bypass.
 * Each backend gate posting (kind='gate' with metadata.gate.verdict, or, as a
 * fallback, a recognizable gate agent/phase) is bucketed into one of six
 * columns; the column's verdict is the LAST verdict that hit it (mirrors the
 * comp's `forEach` last-write-wins over `gateStates[gateId]`). A column with no
 * verdict yet stays pending: dashed fill line, muted everything. Once a verdict
 * lands the card pops, the line solidifies into the verdict color, and a verdict
 * dot appears. When the run outcome is a decline, the whole rail switches to the
 * somber palette so a "no recovery" disposition reads as gravity, not failure.
 */

type GateId =
  | "intake"
  | "evidence"
  | "citation"
  | "adjudication"
  | "alignment"
  | "letter";

type Verdict = "passed" | "warning" | "rejected";

interface GateDef {
  num: string;
  label: string;
  id: GateId;
  icon: IconName;
}

const GATE_DEFS: GateDef[] = [
  { num: "1", label: "Case details", id: "intake", icon: "intake" },
  { num: "2", label: "Evidence", id: "evidence", icon: "evidence" },
  { num: "3", label: "Citations", id: "citation", icon: "citation" },
  {
    num: "4",
    label: "Decision + math",
    id: "adjudication",
    icon: "adjudication",
  },
  { num: "5", label: "Evidence match", id: "alignment", icon: "alignment" },
  { num: "6", label: "Letter", id: "letter", icon: "letter" },
];

/** Backend gate verdicts → the three visual verdict buckets. */
const VERDICT_MAP: Record<string, Verdict> = {
  passed: "passed",
  warning: "warning",
  escalated: "warning",
  rejected: "rejected",
  decline: "rejected",
};

/** Pipeline phase → gate column. */
const PHASE_GATE: Record<string, GateId> = {
  docket: "intake",
  intake: "intake",
  evidence: "evidence",
  fact_gate: "evidence",
  ledger_lock: "evidence",
  opening_briefs: "citation",
  issue_hearing: "citation",
  cross_examination: "citation",
  redirect: "citation",
  adjudication: "adjudication",
  math_gate: "adjudication",
  consensus_gate: "adjudication",
  source_alignment: "alignment",
  disposition: "alignment",
  drafting: "letter",
  letter_gate: "letter",
};

/** Exact backend agent/gate display name → gate column. */
const AGENT_GATE: Record<string, GateId> = {
  System: "intake",
  "Intake Parser": "intake",
  "Intake Gate": "intake",
  "Evidence Aggregator": "evidence",
  "Fact Gate": "evidence",
  "Liability Advocate": "citation",
  "Opposing-Carrier Red Team": "citation",
  "Citation Gate": "citation",
  "Adjudicator A": "adjudication",
  "Adjudicator B": "adjudication",
  "Math Gate": "adjudication",
  "Consensus Gate": "adjudication",
  "Source-Alignment Verifier": "alignment",
  "Demand Letter Drafter": "letter",
  "Letter Reconciliation": "letter",
};

/** Gate-name keyword → column, for postings that only name the gate in text. */
const NAME_GATE: Array<[RegExp, GateId]> = [
  [/intake/i, "intake"],
  [/evidence|fact|ledger/i, "evidence"],
  [/citation/i, "citation"],
  [/math|consensus|adjudicat/i, "adjudication"],
  [/source.?align|alignment/i, "alignment"],
  [/letter|reconcil/i, "letter"],
];

interface Palette {
  c: string;
  border: string;
  bg: string;
}

const LIVELY: Record<Verdict, Palette> = {
  passed: {
    c: "var(--color-ok)",
    border: "rgba(110,169,138,0.5)",
    bg: "rgba(110,169,138,0.07)",
  },
  warning: {
    c: "var(--color-warn)",
    border: "rgba(212,164,74,0.5)",
    bg: "rgba(212,164,74,0.07)",
  },
  rejected: {
    c: "var(--color-bad)",
    border: "rgba(198,106,90,0.5)",
    bg: "rgba(198,106,90,0.07)",
  },
};

/** Decline disposition: desaturated so "no recovery" reads as gravity. */
const SOMBER: Record<Verdict, Palette> = {
  passed: {
    c: "#7c8a80",
    border: "rgba(124,138,128,0.4)",
    bg: "rgba(124,138,128,0.05)",
  },
  warning: {
    c: "#8f7f5e",
    border: "rgba(143,127,94,0.4)",
    bg: "rgba(143,127,94,0.05)",
  },
  rejected: {
    c: "#9a6a60",
    border: "rgba(154,106,96,0.4)",
    bg: "rgba(154,106,96,0.05)",
  },
};

const PENDING: Palette = {
  c: "var(--color-muted-2)",
  border: "var(--color-border)",
  bg: "var(--color-panel)",
};

const VERDICT_ICON: Record<Verdict, IconName> = {
  passed: "check",
  warning: "info",
  rejected: "x",
};

export function GateRail({
  postings,
  decision = null,
}: {
  postings: RoomPosting[];
  /** When the run completes as a decline, the rail uses the somber palette. */
  decision?: DecisionResult | null;
}) {
  const verdicts = gateVerdicts(postings);
  const somber = decision?.outcome === "decline" || isDeclinePostings(postings);

  return (
    <div className="mb-6">
      <div className="mb-2.25 flex items-center gap-2.25">
        <span className="flex items-center gap-1.5 text-muted-2">
          <Icon name="shield" size={13} strokeWidth={1.75} />
          <span className="font-mono text-[10.5px] uppercase tracking-[0.14em]">
            Verification
          </span>
        </span>
        <span className="text-[11px] text-muted-2">
          — six independent checks of the evidence and the math. The agents
          cannot bypass them.
        </span>
        <button
          type="button"
          title="Six gates the pipeline must clear: case details, evidence, citations, decision math, evidence match, and the letter. None can be skipped."
          className="ml-auto flex items-center gap-1.25 rounded-[7px] border border-border bg-transparent px-2.25 py-1 text-[11px] text-muted-2 transition-colors hover:border-accent-dim hover:text-text"
        >
          <Icon name="help" size={13} strokeWidth={1.75} />
          What are these?
        </button>
      </div>

      <div className="grid grid-cols-6 gap-2">
        {GATE_DEFS.map((def) => (
          <GateCard
            key={def.id}
            def={def}
            verdict={verdicts[def.id]}
            somber={somber}
          />
        ))}
      </div>
    </div>
  );
}

function GateCard({
  def,
  verdict,
  somber,
}: {
  def: GateDef;
  verdict: Verdict | undefined;
  somber: boolean;
}) {
  const palette = verdict ? (somber ? SOMBER : LIVELY)[verdict] : PENDING;

  return (
    <div
      className="rounded-[11px] border px-3.25 py-3"
      style={{
        background: palette.bg,
        borderColor: palette.border,
        animation: verdict ? "gatePop 0.4s ease-out" : undefined,
      }}
    >
      <div className="mb-1.75 flex items-center justify-between">
        <span
          className="flex items-center gap-1.75"
          style={{ color: verdict ? palette.c : "var(--color-muted-2)" }}
        >
          <span className="tnum font-mono text-[9.5px] text-muted-2">
            {def.num}
          </span>
          <Icon name={def.icon} size={15} strokeWidth={1.75} />
        </span>
        <span
          className="flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full border-[1.5px]"
          style={{ borderColor: palette.border, color: palette.c }}
        >
          {verdict ? (
            <Icon name={VERDICT_ICON[verdict]} size={12} strokeWidth={2.2} />
          ) : null}
        </span>
      </div>

      <div
        className="min-h-7.25 font-medium text-[11.5px] leading-tight"
        style={{
          color: verdict ? "var(--color-text)" : "var(--color-muted-2)",
        }}
      >
        {def.label}
      </div>

      <div
        className="mt-2.25 h-0.75 rounded-[3px]"
        style={
          verdict
            ? { background: palette.c, opacity: 0.85 }
            : {
                background: "transparent",
                borderTop: "2px dashed var(--color-border)",
              }
        }
      />
    </div>
  );
}

/**
 * Reduce the live postings into one verdict per gate column. Last verdict that
 * hits a column wins (e.g. citation rejected → re-filed → passed lands passed;
 * adjudication math rejected → consensus warning lands warning).
 */
function gateVerdicts(
  postings: RoomPosting[],
): Partial<Record<GateId, Verdict>> {
  const out: Partial<Record<GateId, Verdict>> = {};
  for (const posting of postings) {
    const verdict = verdictOf(posting);
    if (!verdict) continue;
    const id = gateOf(posting);
    if (id) out[id] = verdict;
  }
  return out;
}

/** A posting only contributes a verdict if it actually carries a gate ruling. */
function verdictOf(posting: RoomPosting): Verdict | undefined {
  const raw = posting.metadata?.gate?.verdict;
  if (raw && VERDICT_MAP[raw]) return VERDICT_MAP[raw];
  if (posting.kind === "gate") return legacyVerdict(posting.content);
  return undefined;
}

/** Older mock postings encode the verdict only in the content string. */
function legacyVerdict(content: string): Verdict {
  if (/⛔|reject|fail/i.test(content)) return "rejected";
  if (/⚠|warn|escalat|overreach/i.test(content)) return "warning";
  return "passed";
}

function gateOf(posting: RoomPosting): GateId | undefined {
  const name = posting.metadata?.gate?.name;
  if (name) {
    const byName = NAME_GATE.find(([re]) => re.test(name));
    if (byName) return byName[1];
  }
  const phase = posting.metadata?.phase;
  if (phase && PHASE_GATE[phase]) return PHASE_GATE[phase];
  const byAgent = AGENT_GATE[posting.agent];
  if (byAgent) return byAgent;
  const firstLine = posting.content.split("\n", 1)[0] ?? "";
  return NAME_GATE.find(([re]) => re.test(firstLine))?.[1];
}

/** Fallback decline detection when no DecisionResult prop is supplied. */
function isDeclinePostings(postings: RoomPosting[]): boolean {
  for (const posting of postings) {
    if (posting.metadata?.gate?.verdict === "decline") return true;
    if (posting.kind === "decision" && /\bdecline\b/i.test(posting.content)) {
      return true;
    }
  }
  return false;
}
