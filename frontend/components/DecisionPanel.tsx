"use client";

import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { postDecision } from "@/lib/api";
import {
  type DecisionView,
  deriveDecisionView,
  formatUsd,
} from "@/lib/decision";
import type { DecisionResult } from "@/lib/types";

/** Write to the clipboard, tolerating insecure/SSR contexts. Kept at module
 *  scope so the optional chaining lives outside any try/catch (React Compiler
 *  cannot compile value blocks inside a try statement). */
function copyToClipboard(text: string): void {
  const clip = globalThis.navigator?.clipboard;
  if (clip) clip.writeText(text);
}

/** Copy text to the clipboard and flash a "copied" state for 1.6s. Shared by
 *  the demand-letter toolbar and the audit seal (both copy a value on click). */
function useCopyFlash(): { copied: boolean; copy: (text: string) => void } {
  const [copied, setCopied] = useState(false);
  const resetRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetRef.current) clearTimeout(resetRef.current);
    },
    [],
  );

  const copy = (text: string) => {
    if (!text) return;
    try {
      copyToClipboard(text);
    } catch {
      // Clipboard may be unavailable (insecure / SSR context); ignore.
    }
    setCopied(true);
    if (resetRef.current) clearTimeout(resetRef.current);
    resetRef.current = setTimeout(() => setCopied(false), 1600);
  };

  return { copied, copy };
}

interface Props {
  caseId: string;
  decision: DecisionResult | null;
  letter: string;
  /** Documented loss for this case (USD), used to label the demand math. */
  documentedUsd?: number | null;
}

type ReviewAction = "approve" | "reject";

const OUTCOME_PILL_STYLE: Record<DecisionView["outcomePill"], CSSProperties> = {
  pursue: {
    background: "rgba(111,155,240,0.12)",
    border: "1px solid var(--color-accent-dim)",
    color: "var(--color-accent-strong)",
  },
  escalate: {
    background: "rgba(212,164,74,0.1)",
    border: "1px solid rgba(212,164,74,0.4)",
    color: "var(--color-warn)",
  },
  decline: {
    background: "rgba(198,106,90,0.1)",
    border: "1px solid rgba(198,106,90,0.4)",
    color: "var(--color-bad)",
  },
};

const CONSENSUS_STYLE: Record<
  DecisionView["consensusKind"],
  { color: string; bg: string; border: string }
> = {
  agreement: {
    color: "var(--color-ok)",
    bg: "rgba(110,169,138,0.1)",
    border: "rgba(110,169,138,0.4)",
  },
  split: {
    color: "var(--color-warn)",
    bg: "rgba(212,164,74,0.1)",
    border: "rgba(212,164,74,0.4)",
  },
  single: {
    color: "var(--color-warn)",
    bg: "rgba(212,164,74,0.1)",
    border: "rgba(212,164,74,0.4)",
  },
};

function prefersReducedMotion(): boolean {
  return Boolean(
    globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
  );
}

export function DecisionPanel({
  caseId,
  decision,
  letter,
  documentedUsd = null,
}: Props) {
  if (!decision) return <PendingDecision />;

  const view = deriveDecisionView(decision, documentedUsd);
  const auditHash = decision.auditHash ?? "";
  const letterText = decision.letter ?? letter;

  return (
    <section
      className="mt-4.5 overflow-hidden rounded-card bg-panel"
      style={{
        border: view.isDecline
          ? "1px solid rgba(198,106,90,0.28)"
          : "1px solid var(--color-border)",
        boxShadow: view.isDecline
          ? "0 0 0 1px rgba(198,106,90,0.04), 0 1px 24px -16px rgba(198,106,90,0.5)"
          : undefined,
      }}
    >
      <header
        className="flex items-center justify-between px-5.5 py-3.5"
        style={{
          borderBottom: view.isDecline
            ? "1px solid rgba(198,106,90,0.28)"
            : "1px solid var(--color-border)",
        }}
      >
        <div className="flex items-center gap-2.75">
          <h2 className="m-0 font-semibold text-[16px] text-text">
            Disposition
          </h2>
          <span
            className="rounded-pill px-2.5 py-0.75 font-mono font-semibold text-[10px] tracking-[0.06em]"
            style={OUTCOME_PILL_STYLE[view.outcomePill]}
          >
            {view.outcomeLabel}
          </span>
        </div>
        {decision.bandRoomId ? (
          <span className="rounded-md border border-border bg-panel-2 px-2.25 py-0.75 font-mono text-[9.5px] text-muted-2">
            band {decision.bandRoomId}
          </span>
        ) : null}
      </header>

      <div className="grid grid-cols-1 gap-0 lg:grid-cols-2">
        <div className="px-7 py-6.5 lg:border-border-soft lg:border-r">
          <LeftColumn caseId={caseId} decision={decision} view={view} />
        </div>
        <div className="px-7 py-6.5">
          <RightColumn
            view={view}
            letterText={letterText}
            auditHash={auditHash}
            caseId={caseId}
          />
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ pending */

function PendingDecision() {
  return (
    <section className="mt-4.5 rounded-card border border-border bg-panel p-5 shadow-(--shadow-card)">
      <h2 className="m-0 font-semibold text-[16px] text-text">Disposition</h2>
      <p className="mt-2 text-[13px] text-muted">
        Pending — run the recovery analysis to settle fault, the recoverable
        amount, consensus, and the demand letter.
      </p>
    </section>
  );
}

/* --------------------------------------------------------------- left column */

function LeftColumn({
  caseId,
  decision,
  view,
}: {
  caseId: string;
  decision: DecisionResult;
  view: DecisionView;
}) {
  return (
    <>
      {view.isPursue ? (
        <RecoverableAmount view={view} />
      ) : (
        <DeclineBanner reason={decision.declineReason} />
      )}

      <FaultSplitBar view={view} />

      <Consensus view={view} />

      {view.escalationReasons.length > 0 ? (
        <Escalation caseId={caseId} reasons={view.escalationReasons} />
      ) : null}
    </>
  );
}

function RecoverableAmount({ view }: { view: DecisionView }) {
  const value = useCountUp(view.recoveryUsd);

  return (
    <div>
      <div className="mb-2 font-mono text-[11px] text-muted-2 uppercase tracking-[0.14em]">
        Recoverable amount
      </div>
      <div className="flex items-baseline gap-3.25">
        <div
          className="tnum font-mono font-semibold text-money"
          style={{
            fontSize: "58px",
            letterSpacing: "-0.03em",
            lineHeight: "0.9",
          }}
        >
          {formatUsd(value)}
        </div>
      </div>
      <div className="tnum mt-2.5 font-mono text-[13px] text-muted">
        {view.recoveryLabel} = {view.faultThemPct}% ×{" "}
        <span className="text-text">{view.documentedLabel}</span> documented
      </div>
    </div>
  );
}

function DeclineBanner({ reason }: { reason?: string | null }) {
  return (
    <div
      className="rounded-[11px] px-5 py-4.5"
      style={{
        background: "rgba(198,106,90,0.1)",
        border: "1px solid rgba(198,106,90,0.45)",
      }}
    >
      <div className="flex items-center gap-2.5">
        <span
          className="flex h-6 w-6 items-center justify-center rounded-full text-bad"
          style={{ border: "1.5px solid var(--color-bad)" }}
        >
          <Icon name="x" size={13} strokeWidth={2.4} />
        </span>
        <span
          className="font-bold text-[19px] text-bad"
          style={{ letterSpacing: "0.03em" }}
        >
          DO NOT PURSUE
        </span>
      </div>
      <div className="mt-2.75 text-[12.5px] text-muted leading-[1.55]">
        {reason ||
          "Comparative-fault math does not justify a recovery demand. Recommend closing the file."}
      </div>
    </div>
  );
}

function FaultSplitBar({ view }: { view: DecisionView }) {
  const settled = useFaultSettle();
  const reduce = prefersReducedMotion();

  const themDisplay = settled ? view.faultThemPct : view.faultThemMin;
  const usDisplay = settled
    ? Math.max(0, 100 - view.faultThemPct)
    : Math.max(0, 100 - view.faultThemMin);
  const barWidth = settled ? `${view.faultThemPct}%` : `${view.faultThemMin}%`;
  const bandWidth = Math.max(0, view.faultThemPct - view.faultThemMin);

  const caption = settled
    ? `settled · ${view.faultCaption}`
    : `adjudicators converging — range ${view.faultThemMin}–${view.faultThemPct}%`;

  return (
    <div className="mt-6.5">
      <div className="mb-2 flex justify-between text-[12px]">
        <span className="font-medium text-text">
          At-fault party{" "}
          <span className="tnum font-mono text-bad">{themDisplay}%</span>
        </span>
        <span className="font-medium text-muted">
          <span className="tnum font-mono text-ok">{usDisplay}%</span> our
          insured
        </span>
      </div>
      <div className="relative h-4 overflow-hidden rounded-lg border border-border bg-panel-3">
        <div
          className="absolute top-0 bottom-0 left-0"
          style={{
            width: barWidth,
            background: "linear-gradient(90deg,#c66a5a,#d4856f)",
            transition: reduce
              ? undefined
              : "width 1.1s cubic-bezier(0.16,1,0.3,1)",
          }}
        />
        <div
          aria-hidden="true"
          className="absolute top-0 bottom-0"
          style={{
            left: `${view.faultThemMin}%`,
            width: `${bandWidth}%`,
            backgroundImage:
              "repeating-linear-gradient(45deg,rgba(212,164,74,0.5) 0,rgba(212,164,74,0.5) 3px,transparent 3px,transparent 7px)",
            borderRight: "1px dashed var(--color-warn)",
            opacity: settled ? 0 : 1,
            transition: reduce ? undefined : "opacity 0.8s",
          }}
        />
      </div>
      <div className="mt-1.75 font-mono text-[10.5px] text-muted-2">
        {caption}
      </div>
    </div>
  );
}

function Consensus({ view }: { view: DecisionView }) {
  const c = CONSENSUS_STYLE[view.consensusKind];
  return (
    <div className="mt-5.5">
      <span
        className="inline-flex items-center gap-2 rounded-pill px-3 py-1.5 font-mono text-[11.5px]"
        style={{
          background: c.bg,
          border: `1px solid ${c.border}`,
          color: c.color,
        }}
      >
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: c.color }}
        />
        {view.consensusLabel}
      </span>
    </div>
  );
}

function Escalation({
  caseId,
  reasons,
}: {
  caseId: string;
  reasons: string[];
}) {
  const [action, setAction] = useState<ReviewAction | null>(null);
  const [sending, setSending] = useState(false);

  async function send(a: ReviewAction) {
    setSending(true);
    try {
      await postDecision({ caseId, action: a });
      setAction(a);
    } catch {
      // Keep the current review state if the acknowledgement endpoint fails.
    }
    setSending(false);
  }

  const done = action !== null;

  return (
    <div
      className="mt-5.5 rounded-[11px] px-4.5 py-4"
      style={{
        background: "rgba(212,164,74,0.06)",
        border: "1px solid rgba(212,164,74,0.25)",
      }}
    >
      <div className="mb-2.75 font-mono text-[10.5px] text-warn uppercase tracking-[0.12em]">
        Flagged for human review
      </div>
      <div className="flex flex-col gap-2.25">
        {reasons.map((r) => (
          <div
            key={r}
            className="flex items-start gap-2.25 text-[12px] text-muted leading-[1.45]"
          >
            <span className="mt-px text-warn">›</span>
            <span>{r}</span>
          </div>
        ))}
      </div>
      <div className="mt-4 flex gap-2.25">
        <button
          type="button"
          disabled={sending || done}
          onClick={() => send("approve")}
          className="flex-1 rounded-lg py-2.25 font-sans font-semibold text-[12.5px] text-ok disabled:opacity-60"
          style={{
            border: "1px solid var(--color-ok)",
            background: "rgba(110,169,138,0.12)",
          }}
        >
          {action === "approve" ? "Approved ✓" : "Approve"}
        </button>
        <button
          type="button"
          disabled={sending || done}
          onClick={() => send("reject")}
          className="flex-1 rounded-lg border border-border bg-transparent py-2.25 font-sans font-semibold text-[12.5px] text-muted disabled:opacity-60"
        >
          {action === "reject" ? "Rejected ✕" : "Reject"}
        </button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- right column */

function RightColumn({
  view,
  letterText,
  auditHash,
  caseId,
}: {
  view: DecisionView;
  letterText: string;
  auditHash: string;
  caseId: string;
}) {
  return (
    <>
      {view.isPursue ? (
        <DemandLetter view={view} letterText={letterText} caseId={caseId} />
      ) : (
        <CaseClosed />
      )}
      <Seal view={view} auditHash={auditHash} />
    </>
  );
}

function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function DemandLetter({
  view,
  letterText,
  caseId,
}: {
  view: DecisionView;
  letterText: string;
  caseId: string;
}) {
  const { copied, copy } = useCopyFlash();

  function downloadLetter() {
    try {
      const blob = new Blob([letterText], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = globalThis.document.createElement("a");
      a.href = url;
      a.download = `demand-letter-${caseId}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // Download unavailable (SSR / restricted context); ignore.
    }
  }

  const paragraphs = splitParagraphs(letterText);

  return (
    <>
      <DemandLetterToolbar
        copied={copied}
        letterText={letterText}
        onCopy={() => copy(letterText)}
        onDownload={downloadLetter}
      />
      <DemandLetterBody view={view} paragraphs={paragraphs} />
    </>
  );
}

function DemandLetterToolbar({
  copied,
  letterText,
  onCopy,
  onDownload,
}: {
  copied: boolean;
  letterText: string;
  onCopy: () => void;
  onDownload: () => void;
}) {
  return (
    <div className="mb-3.5 flex items-center justify-between">
      <div className="font-mono text-[11px] text-muted-2 uppercase tracking-[0.14em]">
        Demand letter
      </div>
      <div className="flex gap-1.75">
        <button
          type="button"
          onClick={onCopy}
          disabled={!letterText}
          className="flex items-center gap-1.25 rounded-[7px] border border-border bg-panel-2 px-2.75 py-1.25 font-mono text-[11px] text-muted disabled:opacity-50"
        >
          <Icon name={copied ? "check" : "copy"} size={12} />
          {copied ? "Copied" : "Copy"}
        </button>
        <button
          type="button"
          onClick={onDownload}
          disabled={!letterText}
          className="flex items-center gap-1.25 rounded-[7px] border border-border bg-panel-2 px-2.75 py-1.25 font-mono text-[11px] text-muted disabled:opacity-50"
        >
          <Icon name="download" size={12} />
          Download
        </button>
      </div>
    </div>
  );
}

function DemandLetterBody({
  view,
  paragraphs,
}: {
  view: DecisionView;
  paragraphs: string[];
}) {
  return (
    <div
      className="relative rounded-[10px] p-1.25"
      style={{ background: "linear-gradient(180deg,#0c0a07,#13100b)" }}
    >
      <div
        className="relative max-h-130 overflow-y-auto rounded-[7px] font-serif"
        style={{
          background: "#f1ebdd",
          padding: "32px 34px",
          color: "#241f17",
          boxShadow:
            "inset 0 7px 16px -9px rgba(50,40,22,0.7), inset 0 1px 0 rgba(120,105,80,0.35)",
        }}
      >
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            top: "46%",
            left: "50%",
            transform: "translate(-50%,-50%) rotate(-19deg)",
            pointerEvents: "none",
            fontFamily: "var(--font-serif)",
            fontWeight: 700,
            fontSize: "108px",
            letterSpacing: "0.06em",
            color: "#ece4d2",
            textShadow:
              "0 1px 0 rgba(255,253,247,0.9), 0 -1px 1px rgba(120,105,78,0.5), 0 2px 3px rgba(120,105,78,0.25)",
            userSelect: "none",
          }}
        >
          DEMAND
        </div>

        <div className="relative">
          <DemandParagraphs paragraphs={paragraphs} />

          <TotalDemandBox view={view} />

          <div className="mt-5.5 text-[13px]">
            Respond within <strong>30 days</strong>.
          </div>
        </div>
      </div>
    </div>
  );
}

function DemandParagraphs({ paragraphs }: { paragraphs: string[] }) {
  if (paragraphs.length === 0) {
    return (
      <p
        className="m-0 text-[#6b6354] text-[13.5px]"
        style={{ lineHeight: 1.7 }}
      >
        Demand letter not yet drafted.
      </p>
    );
  }

  return (
    <>
      {paragraphs.map((para, i) => (
        <p
          // biome-ignore lint/suspicious/noArrayIndexKey: paragraphs are positional, content can repeat
          key={i}
          className="m-0 mb-3.25 text-[13.5px]"
          style={{ lineHeight: 1.7 }}
        >
          {para}
        </p>
      ))}
    </>
  );
}

function TotalDemandBox({ view }: { view: DecisionView }) {
  return (
    <div
      className="mt-5 rounded-[7px] px-4 py-3.5 text-center"
      style={{
        background: "#e6dcc7",
        boxShadow: "inset 0 2px 5px -2px rgba(80,65,40,0.4)",
      }}
    >
      <div
        className="mb-1 font-mono text-[10px] uppercase tracking-widest"
        style={{ color: "#6b6354" }}
      >
        Total demand
      </div>
      <div className="tnum font-mono font-semibold text-[26px]">
        {view.recoveryLabel}
      </div>
      <div className="mt-0.75 text-[11px]" style={{ color: "#6b6354" }}>
        {view.faultThemPct}% of {view.documentedLabel}
      </div>
    </div>
  );
}

function CaseClosed() {
  return (
    <>
      <div className="mb-3.5 font-mono text-[11px] text-muted-2 uppercase tracking-[0.14em]">
        Case file closed
      </div>
      <div
        className="relative overflow-hidden rounded-[11px] bg-panel-2 p-6 text-center"
        style={{ border: "1px solid rgba(198,106,90,0.3)" }}
      >
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%,-50%) rotate(-12deg)",
            fontSize: "30px",
            fontWeight: 800,
            letterSpacing: "0.14em",
            color: "rgba(198,106,90,0.13)",
            pointerEvents: "none",
            whiteSpace: "nowrap",
          }}
        >
          CASE FILE CLOSED
        </div>
        <div className="relative">
          <div
            className="mx-auto mb-3.5 flex h-10.5 w-10.5 items-center justify-center rounded-pill text-bad"
            style={{ border: "1.5px solid rgba(198,106,90,0.4)" }}
          >
            <Icon name="x" size={18} strokeWidth={2} />
          </div>
          <div className="mb-2 font-semibold text-[14px] text-text">
            No demand letter drafted
          </div>
          <div className="mx-auto max-w-82.5 text-[12.5px] text-muted leading-[1.6]">
            At a sub-threshold recoverable share the proportional recovery does
            not clear the cost of pursuit. Lumen recommends closing the file
            rather than chasing it.
          </div>
        </div>
      </div>
      <div className="mt-4 rounded-pill border border-border bg-panel-2 px-4 py-3.5">
        <div className="mb-2 font-mono text-[10.5px] text-muted-2 uppercase tracking-widest">
          The system could have pursued
        </div>
        <div className="text-[12px] text-muted leading-[1.55]">
          The full analysis ran and the ledger held. Lumen chose not to chase —
          that restraint is the product working, not failing.
        </div>
      </div>
    </>
  );
}

function Seal({ view, auditHash }: { view: DecisionView; auditHash: string }) {
  const { copied, copy } = useCopyFlash();

  const sealColor = view.isDecline ? "var(--color-bad)" : "var(--color-ok)";
  const reduce = prefersReducedMotion();
  const shortHash = auditHash
    ? auditHash.length > 12
      ? `${auditHash.slice(0, 4)}…${auditHash.slice(-4)}`
      : auditHash
    : "—";

  return (
    <div
      className="mt-5 flex items-center gap-4.5 rounded-[11px] border border-border px-5 py-4.5"
      style={{ background: "#171410" }}
    >
      <SealMark
        sealColor={sealColor}
        auditHash={auditHash}
        reduce={reduce}
        onCopy={() => copy(auditHash)}
      />
      <SealRecord
        shortHash={shortHash}
        copied={copied}
        auditHash={auditHash}
        onCopy={() => copy(auditHash)}
      />
    </div>
  );
}

function SealMark({
  sealColor,
  auditHash,
  reduce,
  onCopy,
}: {
  sealColor: string;
  auditHash: string;
  reduce: boolean;
  onCopy: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onCopy}
      title="Click to copy full SHA-256"
      className="relative h-23 w-23 shrink-0 cursor-pointer appearance-none rounded-full border-0 bg-transparent p-0"
    >
      <svg
        viewBox="0 0 100 100"
        aria-hidden="true"
        style={{
          width: "100%",
          height: "100%",
          display: "block",
          animation: reduce ? undefined : "sealIn 0.5s ease-out",
        }}
      >
        <defs>
          <path id="sealRimTop" d="M 50,50 m -38,0 a 38,38 0 1,1 76,0" />
          <path id="sealRimBot" d="M 50,50 m 38,0 a 38,38 0 1,1 -76,0" />
        </defs>
        <circle
          cx="50"
          cy="50"
          r="46"
          fill="none"
          stroke={sealColor}
          strokeWidth="1"
          opacity="0.5"
        />
        <circle
          cx="50"
          cy="50"
          r="42"
          fill="none"
          stroke={sealColor}
          strokeWidth="2.5"
        />
        <circle
          cx="50"
          cy="50"
          r="29"
          fill="none"
          stroke={sealColor}
          strokeWidth="1"
          strokeDasharray="2 2.4"
          opacity="0.7"
        />
        <text
          fill={sealColor}
          fontFamily="Geist Mono, monospace"
          fontSize="7.4"
          letterSpacing="1.2"
        >
          <textPath href="#sealRimTop" startOffset="50%" textAnchor="middle">
            SHA-256 · TAMPER-EVIDENT
          </textPath>
        </text>
        <text
          fill={sealColor}
          fontFamily="Geist Mono, monospace"
          fontSize="7.4"
          letterSpacing="1.6"
        >
          <textPath href="#sealRimBot" startOffset="50%" textAnchor="middle">
            {auditHash || "unsealed"}
          </textPath>
        </text>
        <text x="50" y="47" textAnchor="middle" fontSize="22" fill={sealColor}>
          ✦
        </text>
        <text
          x="50"
          y="62"
          textAnchor="middle"
          fontFamily="Geist Mono, monospace"
          fontSize="6.4"
          letterSpacing="1.4"
          fill={sealColor}
          opacity="0.8"
        >
          LUMEN
        </text>
      </svg>
    </button>
  );
}

function SealRecord({
  shortHash,
  copied,
  auditHash,
  onCopy,
}: {
  shortHash: string;
  copied: boolean;
  auditHash: string;
  onCopy: () => void;
}) {
  return (
    <div className="min-w-0 flex-1">
      <div className="font-mono text-[10px] text-muted-2 uppercase tracking-widest">
        Record sealed
      </div>
      <div className="mt-0.75 break-all font-mono text-[14px] text-text">
        {shortHash}
      </div>
      <button
        type="button"
        onClick={onCopy}
        disabled={!auditHash}
        className="mt-2.25 rounded-[7px] border border-border bg-panel-2 px-3 py-1.25 font-mono text-[11px] disabled:opacity-50"
        style={{ color: copied ? "var(--color-ok)" : "var(--color-muted)" }}
      >
        {copied ? "✓ copied to clipboard" : "Copy full hash"}
      </button>
    </div>
  );
}

/* ----------------------------------------------------------------- rAF hooks */

/** Counts up 0 → target with easeOutCubic over 1200ms; snaps if reduced-motion. */
function useCountUp(target: number): number {
  const [value, setValue] = useState(() =>
    prefersReducedMotion() ? target : 0,
  );
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (prefersReducedMotion()) {
      setValue(target);
      return;
    }
    const duration = 1200;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) ** 3;
      setValue(target * eased);
      if (t < 1) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [target]);

  return value;
}

/** Fault bar settles (uncertainty band collapses) ~1.46s after mount. */
function useFaultSettle(): boolean {
  const [settled, setSettled] = useState(() => prefersReducedMotion());

  useEffect(() => {
    if (prefersReducedMotion()) {
      setSettled(true);
      return;
    }
    const timer = setTimeout(() => setSettled(true), 1460);
    return () => clearTimeout(timer);
  }, []);

  return settled;
}
