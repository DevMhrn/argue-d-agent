"use client";

import { useState } from "react";
import { postDecision } from "@/lib/api";
import type { DecisionResult } from "@/lib/types";

interface Props {
  caseId: string;
  decision: DecisionResult | null;
  letter: string;
}

type ReviewAction = "approve" | "reject";
type BadgeTone = "ok" | "bad" | "warn";
type Consensus = NonNullable<DecisionResult["consensus"]>;

const BADGE_TONE_CLASS: Record<BadgeTone, string> = {
  ok: "border-ok/40 bg-ok/10 text-ok",
  bad: "border-bad/40 bg-bad/10 text-bad",
  warn: "border-warn/40 bg-warn/10 text-warn",
};

const ACTION_TONE_CLASS: Record<
  ReviewAction,
  { idle: string; active: string }
> = {
  approve: {
    idle: "border-ok/40 bg-ok/10 text-ok hover:bg-ok/20",
    active: "border-ok/60 bg-ok/15 text-ok",
  },
  reject: {
    idle: "border-bad/40 bg-bad/10 text-bad hover:bg-bad/20",
    active: "border-bad/60 bg-bad/15 text-bad",
  },
};

const CONSENSUS_BADGE: Record<
  Consensus,
  (decision: DecisionResult) => { label: string; tone: BadgeTone }
> = {
  agreement: () => ({ label: "Consensus", tone: "ok" }),
  disagreement: (decision) => ({
    label: `Disagreement (Δ ${decision.consensusDeltaPp}pp)`,
    tone: "bad",
  }),
  single: () => ({ label: "Single adjudicator", tone: "warn" }),
  none: () => ({ label: "none", tone: "warn" }),
};

const REVIEW_BUTTON_COPY: Record<
  ReviewAction,
  { idle: string; active: string }
> = {
  approve: { idle: "Approve", active: "Approved ✓" },
  reject: { idle: "Reject", active: "Rejected ✕" },
};

function money(n: number): string {
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export function DecisionPanel({ caseId, decision, letter }: Props) {
  const [action, setAction] = useState<ReviewAction | null>(null);
  const [sending, setSending] = useState(false);

  async function send(a: ReviewAction) {
    setSending(true);
    try {
      await postDecision({ caseId, action: a });
      setAction(a);
    } finally {
      setSending(false);
    }
  }

  if (!decision) {
    return <PendingDecision />;
  }

  const isDecline = decision.outcome === "decline";

  return (
    <aside className="flex h-full flex-col gap-4 overflow-hidden rounded-card border border-border bg-panel p-5 shadow-card">
      <DecisionHeader decision={decision} />
      <DecisionOutcome decision={decision} isDecline={isDecline} />

      {decision.escalate || !isDecline ? (
        <ReviewActions action={action} sending={sending} onSend={send} />
      ) : null}

      <DemandLetter letter={letter} />
      <AuditHash hash={decision.auditHash} />
    </aside>
  );
}

function PendingDecision() {
  return (
    <aside className="flex h-full flex-col gap-3 rounded-card border border-border bg-panel p-5 shadow-card">
      <h2 className="font-semibold text-base tracking-tight">
        Recovery Decision
      </h2>
      <p className="text-[13px] text-muted">
        Pending — run the investigation to see fault %, recovery amount,
        consensus, and the demand letter.
      </p>
    </aside>
  );
}

function DecisionHeader({ decision }: { decision: DecisionResult }) {
  const badge = getConsensusBadge(decision);

  return (
    <header className="flex items-baseline justify-between gap-3">
      <h2 className="font-semibold text-base tracking-tight">
        Recovery Decision
      </h2>
      {badge ? (
        <span
          className={`rounded-full border px-2.5 py-0.5 text-[11px] uppercase tracking-wider ${BADGE_TONE_CLASS[badge.tone]}`}
        >
          {badge.label}
        </span>
      ) : null}
    </header>
  );
}

function getConsensusBadge(
  decision: DecisionResult,
): { label: string; tone: BadgeTone } | null {
  const consensus = decision.consensus;
  if (!consensus) return null;
  return CONSENSUS_BADGE[consensus](decision);
}

function DecisionOutcome({
  decision,
  isDecline,
}: {
  decision: DecisionResult;
  isDecline: boolean;
}) {
  return isDecline ? (
    <DeclineDecision />
  ) : (
    <RecoveryDecision decision={decision} />
  );
}

function DeclineDecision() {
  return (
    <div className="rounded-pill border-2 border-bad/60 bg-bad/10 p-4 text-center">
      <div className="text-[12px] text-bad uppercase tracking-wider">
        Do Not Pursue
      </div>
      <p className="mt-2 text-[13px] text-muted">
        Comparative-fault math does not justify a recovery demand. Recommend
        closing the file.
      </p>
    </div>
  );
}

function RecoveryDecision({ decision }: { decision: DecisionResult }) {
  return (
    <div className="grid gap-3 rounded-pill border border-border-soft bg-panel-2 p-4">
      <Metric label="Recovery" value={money(decision.recoveryUsd)} highlight />
      <Metric label="Other-party fault" value={`${decision.otherFaultPct}%`} />
      <Metric
        label="Confidence"
        value={`${(decision.confidence * 100).toFixed(0)}%`}
      />
      {decision.escalate ? (
        <div className="mt-2 rounded-md border border-warn/40 bg-warn/10 px-2.5 py-1.5 text-[12px] text-warn">
          ⚠ Escalate to human review
        </div>
      ) : null}
    </div>
  );
}

function Metric({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[13px]">
      <span
        className={
          highlight
            ? "text-[11px] text-muted-2 uppercase tracking-wider"
            : "text-muted"
        }
      >
        {label}
      </span>
      <span
        className={
          highlight ? "font-mono font-semibold text-2xl text-gold" : "font-mono"
        }
      >
        {value}
      </span>
    </div>
  );
}

function ReviewActions({
  action,
  sending,
  onSend,
}: {
  action: ReviewAction | null;
  sending: boolean;
  onSend: (action: ReviewAction) => void;
}) {
  return (
    <div className="flex gap-2">
      <ReviewButton
        type="approve"
        action={action}
        sending={sending}
        onSend={onSend}
      />
      <ReviewButton
        type="reject"
        action={action}
        sending={sending}
        onSend={onSend}
      />
    </div>
  );
}

function ReviewButton({
  type,
  action,
  sending,
  onSend,
}: {
  type: ReviewAction;
  action: ReviewAction | null;
  sending: boolean;
  onSend: (action: ReviewAction) => void;
}) {
  const display = reviewButtonDisplay(type, action);

  return (
    <button
      type="button"
      disabled={reviewButtonDisabled(sending, action)}
      onClick={() => onSend(type)}
      className={`flex-1 rounded-pill border px-3 py-2 text-sm ${
        display.className
      } disabled:opacity-50`}
    >
      {display.label}
    </button>
  );
}

function reviewButtonDisplay(type: ReviewAction, action: ReviewAction | null) {
  if (action === type) {
    return {
      label: REVIEW_BUTTON_COPY[type].active,
      className: ACTION_TONE_CLASS[type].active,
    };
  }
  return {
    label: REVIEW_BUTTON_COPY[type].idle,
    className: ACTION_TONE_CLASS[type].idle,
  };
}

function reviewButtonDisabled(
  sending: boolean,
  action: ReviewAction | null,
): boolean {
  return sending || action !== null;
}

function DemandLetter({ letter }: { letter: string }) {
  if (!letter) return null;

  return (
    <details className="rounded-pill border border-border-soft bg-panel-2">
      <summary className="cursor-pointer px-3 py-2 font-medium text-[12px] text-text">
        Demand letter
      </summary>
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap p-3 font-mono text-[11.5px] text-muted leading-relaxed">
        {letter}
      </pre>
    </details>
  );
}

function AuditHash({ hash }: { hash?: string }) {
  if (!hash) return null;

  return (
    <div className="border-border-soft border-t pt-3 text-[11px] text-muted-2">
      <div className="uppercase tracking-wider">Audit hash</div>
      <div className="mt-1 break-all font-mono text-[11px] text-muted">
        {hash}
      </div>
    </div>
  );
}
