"use client";

import { useState } from "react";
import { postDecision } from "@/lib/api";
import type { DecisionResult } from "@/lib/types";

interface Props {
  caseId: string;
  decision: DecisionResult | null;
  letter: string;
}

function money(n: number): string {
  return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

export function DecisionPanel({ caseId, decision, letter }: Props) {
  const [action, setAction] = useState<"approve" | "reject" | null>(null);
  const [sending, setSending] = useState(false);

  async function send(a: "approve" | "reject") {
    setSending(true);
    try {
      await postDecision({ caseId, action: a });
      setAction(a);
    } finally {
      setSending(false);
    }
  }

  if (!decision) {
    return (
      <aside className="flex h-full flex-col gap-3 rounded-[14px] border border-border bg-panel p-5 shadow-card">
        <h2 className="text-base font-semibold tracking-tight">Recovery Decision</h2>
        <p className="text-[13px] text-muted">
          Pending — run the investigation to see fault %, recovery amount,
          consensus, and the demand letter.
        </p>
      </aside>
    );
  }

  const isDecline = decision.outcome === "decline";
  const consensusBadge = (() => {
    if (!decision.consensus) return null;
    if (decision.consensus === "agreement")
      return { label: "Consensus", tone: "ok" as const };
    if (decision.consensus === "disagreement")
      return { label: `Disagreement (Δ ${decision.consensusDeltaPp}pp)`, tone: "bad" as const };
    if (decision.consensus === "single")
      return { label: "Single adjudicator", tone: "warn" as const };
    return { label: decision.consensus, tone: "warn" as const };
  })();

  return (
    <aside className="flex h-full flex-col gap-4 overflow-hidden rounded-[14px] border border-border bg-panel p-5 shadow-card">
      <header className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold tracking-tight">Recovery Decision</h2>
        {consensusBadge ? (
          <span
            className={`rounded-full border px-2.5 py-0.5 text-[11px] uppercase tracking-wider ${
              consensusBadge.tone === "ok"
                ? "border-ok/40 bg-ok/10 text-ok"
                : consensusBadge.tone === "bad"
                  ? "border-bad/40 bg-bad/10 text-bad"
                  : "border-warn/40 bg-warn/10 text-warn"
            }`}
          >
            {consensusBadge.label}
          </span>
        ) : null}
      </header>

      {isDecline ? (
        <div className="rounded-[9px] border-2 border-bad/60 bg-bad/10 p-4 text-center">
          <div className="text-[12px] uppercase tracking-wider text-bad">Do Not Pursue</div>
          <p className="mt-2 text-[13px] text-muted">
            Comparative-fault math does not justify a recovery demand. Recommend closing the file.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 rounded-[9px] border border-border-soft bg-panel-2 p-4">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[11px] uppercase tracking-wider text-muted-2">Recovery</span>
            <span className="font-mono text-2xl font-semibold text-gold">
              {money(decision.recoveryUsd)}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-3 text-[13px]">
            <span className="text-muted">Other-party fault</span>
            <span className="font-mono">{decision.otherFaultPct}%</span>
          </div>
          <div className="flex items-baseline justify-between gap-3 text-[13px]">
            <span className="text-muted">Confidence</span>
            <span className="font-mono">{(decision.confidence * 100).toFixed(0)}%</span>
          </div>
          {decision.escalate ? (
            <div className="mt-2 rounded-[6px] border border-warn/40 bg-warn/10 px-2.5 py-1.5 text-[12px] text-warn">
              ⚠ Escalate to human review
            </div>
          ) : null}
        </div>
      )}

      {decision.escalate || !isDecline ? (
        <div className="flex gap-2">
          <button
            type="button"
            disabled={sending || action !== null}
            onClick={() => send("approve")}
            className={`flex-1 rounded-[9px] border px-3 py-2 text-sm ${
              action === "approve"
                ? "border-ok/60 bg-ok/15 text-ok"
                : "border-ok/40 bg-ok/10 text-ok hover:bg-ok/20"
            } disabled:opacity-50`}
          >
            {action === "approve" ? "Approved ✓" : "Approve"}
          </button>
          <button
            type="button"
            disabled={sending || action !== null}
            onClick={() => send("reject")}
            className={`flex-1 rounded-[9px] border px-3 py-2 text-sm ${
              action === "reject"
                ? "border-bad/60 bg-bad/15 text-bad"
                : "border-bad/40 bg-bad/10 text-bad hover:bg-bad/20"
            } disabled:opacity-50`}
          >
            {action === "reject" ? "Rejected ✕" : "Reject"}
          </button>
        </div>
      ) : null}

      {letter ? (
        <details className="rounded-[9px] border border-border-soft bg-panel-2">
          <summary className="cursor-pointer px-3 py-2 text-[12px] font-medium text-text">
            Demand letter
          </summary>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap p-3 font-mono text-[11.5px] leading-relaxed text-muted">
            {letter}
          </pre>
        </details>
      ) : null}

      {decision.auditHash ? (
        <div className="border-t border-border-soft pt-3 text-[11px] text-muted-2">
          <div className="uppercase tracking-wider">Audit hash</div>
          <div className="mt-1 break-all font-mono text-[11px] text-muted">
            {decision.auditHash}
          </div>
        </div>
      ) : null}
    </aside>
  );
}
