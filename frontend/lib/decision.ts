/**
 * Decision view-model — translates the lean live `DecisionResult` into the
 * richer disposition shape the comp renders (lines 558-709 / logic 1364-1468).
 *
 * The backend `DecisionResult` carries the raw numbers (`otherFaultPct`,
 * `recoveryUsd`, `confidence`, `consensus`, `consensusDeltaPp`, `declineReason`,
 * `letter`, `auditHash`, ...). The comp's pre-baked decision object also held
 * derived display fields (uncertainty floor, plain-English consensus label,
 * synthesized escalation reasons, money labels). `deriveDecisionView` computes
 * those from the real fields plus the case's documented loss so the panel can
 * stay a pure render of live data.
 */

import type { DecisionResult } from "./types";

export type ConsensusKind = "agreement" | "split" | "single";
export type OutcomePillTone = "pursue" | "escalate" | "decline";

export interface DecisionView {
  isPursue: boolean;
  isDecline: boolean;

  /** Other-party (at-fault) liability, settled value, 0-100. */
  faultThemPct: number;
  /** Uncertainty floor the bar animates up from before adjudicators converge. */
  faultThemMin: number;

  /** Money strings (USD, no decimals). */
  recoveryUsd: number;
  recoveryLabel: string;
  documentedLabel: string;

  consensusKind: ConsensusKind;
  /** Plain-English consensus sentence derived from consensus + delta. */
  consensusLabel: string;

  /** Human-review reasons; synthesized from real thresholds when absent. */
  escalationReasons: string[];

  outcomeLabel: string;
  outcomePill: OutcomePillTone;

  /** Caption under the settled fault bar. */
  faultCaption: string;
}

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** Format a number as whole-dollar USD, e.g. `$35,700`. */
export function formatUsd(n: number): string {
  return USD.format(Math.round(n));
}

/** Money-review escalation threshold (recovery this size needs a human). */
const HUMAN_REVIEW_USD = 25_000;
/** Confidence floor below which the recommendation is escalated. */
const CONFIDENCE_FLOOR = 0.8;

function consensusKindOf(decision: DecisionResult): ConsensusKind {
  switch (decision.consensus) {
    case "agreement":
      return "agreement";
    case "disagreement":
      return "split";
    default:
      return "single";
  }
}

function consensusLabelOf(
  decision: DecisionResult,
  kind: ConsensusKind,
): string {
  const delta = decision.consensusDeltaPp;
  if (kind === "agreement") {
    return delta != null
      ? `Both adjudicators agreed (Δ ${delta}pp)`
      : "Both adjudicators agreed";
  }
  if (kind === "split") {
    return delta != null
      ? `Adjudicators split (Δ ${delta}pp) — escalated for review`
      : "Adjudicators split — escalated for review";
  }
  // single
  return "One adjudicator opinion — second family withheld · half-confidence";
}

function uncertaintyFloor(
  decision: DecisionResult,
  faultThemPct: number,
): number {
  const fromDelta =
    decision.consensusDeltaPp ?? Math.round((1 - decision.confidence) * 30);
  const spread = Math.max(fromDelta, 8);
  return Math.max(0, Math.round(faultThemPct - spread));
}

function synthesizeEscalations(
  decision: DecisionResult,
  recoveryLabel: string,
): string[] {
  const reasons: string[] = [];
  if (decision.recoveryUsd >= HUMAN_REVIEW_USD) {
    reasons.push(
      `recovery ${recoveryLabel} ≥ ${formatUsd(HUMAN_REVIEW_USD)} human-review threshold`,
    );
  }
  if (decision.confidence < CONFIDENCE_FLOOR) {
    reasons.push(
      `confidence ${decision.confidence.toFixed(2)} below ${CONFIDENCE_FLOOR.toFixed(2)}`,
    );
  }
  if (decision.consensus === "single") {
    reasons.push("one adjudicator opinion — second family withheld");
  } else if (decision.consensus === "disagreement") {
    const delta = decision.consensusDeltaPp;
    reasons.push(
      delta != null
        ? `adjudicators disagreed by ${delta}pp`
        : "adjudicators disagreed on fault",
    );
  }
  if (decision.escalate && reasons.length === 0) {
    reasons.push("flagged for human review by the bench");
  }
  return reasons;
}

function outcomePillOf(decision: DecisionResult): {
  label: string;
  tone: OutcomePillTone;
} {
  if (decision.outcome === "decline")
    return { label: "DECLINE", tone: "decline" };
  if (decision.outcome === "escalate" || decision.escalate) {
    return { label: "PURSUE · ESCALATE", tone: "escalate" };
  }
  return { label: "PURSUE", tone: "pursue" };
}

export function deriveDecisionView(
  decision: DecisionResult,
  documentedUsd: number | null,
): DecisionView {
  const isDecline = decision.outcome === "decline";
  const isPursue = !isDecline;

  const faultThemPct = Math.round(decision.otherFaultPct);
  const faultThemMin = uncertaintyFloor(decision, faultThemPct);

  const recoveryLabel = formatUsd(decision.recoveryUsd);

  // Documented loss: prefer the case's known damages; otherwise back it out of
  // the recovery and fault split (recovery = fault% × documented).
  const documented =
    documentedUsd != null && documentedUsd > 0
      ? documentedUsd
      : faultThemPct > 0
        ? Math.round(decision.recoveryUsd / (faultThemPct / 100))
        : decision.recoveryUsd;
  const documentedLabel = formatUsd(documented);

  const kind = consensusKindOf(decision);
  const consensusLabel = consensusLabelOf(decision, kind);

  const escalationReasons = synthesizeEscalations(decision, recoveryLabel);

  const pill = outcomePillOf(decision);

  const faultUsPct = Math.max(0, 100 - faultThemPct);
  const faultCaption = isDecline
    ? `at-fault party ${faultThemPct}% · our insured ${faultUsPct}%`
    : `at-fault party ${faultThemPct}% · our insured ${faultUsPct}% (${
        kind === "agreement" ? "both adjudicators agreed" : "adjudicated"
      })`;

  return {
    isPursue,
    isDecline,
    faultThemPct,
    faultThemMin,
    recoveryUsd: decision.recoveryUsd,
    recoveryLabel,
    documentedLabel,
    consensusKind: kind,
    consensusLabel,
    escalationReasons,
    outcomeLabel: pill.label,
    outcomePill: pill.tone,
    faultCaption,
  };
}
