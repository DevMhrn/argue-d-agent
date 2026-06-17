"use client";

import { useEffect, useRef } from "react";

import type { DecisionResult, RoomPosting } from "@/lib/types";

/**
 * The Argument Room — where the agents convene to debate once the ledger is
 * locked. Three modes:
 *   - locked    : ledger isn't ready yet; CTA disabled with a clear reason
 *   - ready     : ledger is built; CTA opens the room
 *   - in-session: SSE is streaming; transcript scrolls live
 */
const AGENT_META: Record<string, { role: string; color: string }> = {
  "Intake Parser": { role: "Extracts incident facts", color: "text-agent-intake" },
  "Evidence Aggregator": { role: "Builds the grounded ledger", color: "text-agent-evidence" },
  "Liability Advocate": { role: "Argues our insured's recovery", color: "text-agent-advocate" },
  "Opposing-Carrier Red Team": { role: "Attacks the case (red team)", color: "text-agent-opposing" },
  "Adjudicator A": { role: "Neutral referee · Claude", color: "text-agent-adj-a" },
  "Adjudicator B": { role: "Independent referee · Gemini", color: "text-agent-adj-b" },
  "Source-Alignment Verifier": { role: "Audits cited claims", color: "text-agent-verifier" },
  "Demand Letter Drafter": { role: "Drafts the demand letter", color: "text-agent-drafter" },
};

interface Props {
  status: "idle" | "connecting" | "streaming" | "complete" | "error";
  postings: RoomPosting[];
  decision: DecisionResult | null;
  bandRoomId: string | null;
  canRun: boolean;
  lockedReason: string | null;
  onRun: () => void;
}

export function ArgumentRoom({
  status,
  postings,
  decision: _decision,
  bandRoomId,
  canRun,
  lockedReason,
  onRun,
}: Props) {
  const feedRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    feedRef.current?.scrollTo({
      top: feedRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [postings.length]);

  const isLocked = !canRun;
  const running = status === "streaming" || status === "connecting";

  return (
    <section className="flex h-full flex-col overflow-hidden rounded-[14px] border border-border bg-panel shadow-card">
      <header className="flex items-center justify-between gap-3 border-b border-border-soft p-5">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold tracking-tight">Argument Room</h2>
            {isLocked ? (
              <span className="rounded-full border border-warn/40 bg-warn/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-warn">
                Locked
              </span>
            ) : status === "complete" ? (
              <span className="rounded-full border border-ok/40 bg-ok/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-ok">
                Adjourned
              </span>
            ) : running ? (
              <span className="rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-accent">
                In session
              </span>
            ) : (
              <span className="rounded-full border border-ok/40 bg-ok/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-ok">
                Ready
              </span>
            )}
          </div>
          <p className="mt-1 text-[12px] text-muted">
            Agents convene over the locked Evidence Ledger. Gates fire on their own — they are code, not prompts.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {bandRoomId ? (
            <span className="rounded-full border border-accent/40 bg-accent/10 px-2.5 py-0.5 font-mono text-[11px] text-accent">
              band: {bandRoomId.slice(0, 8)}…
            </span>
          ) : null}
          <button
            type="button"
            onClick={onRun}
            disabled={isLocked || running}
            className="rounded-[9px] border border-accent/40 bg-accent/15 px-4 py-2 text-sm text-accent hover:bg-accent/25 disabled:opacity-50"
          >
            {running
              ? "In session…"
              : status === "complete"
                ? "Reconvene the band"
                : "Open the room"}
          </button>
        </div>
      </header>

      {isLocked && postings.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-10">
          <div className="max-w-md rounded-[14px] border border-border-soft bg-panel-2 p-6 text-center">
            <div className="mx-auto mb-3 h-10 w-10 rounded-full border-2 border-dashed border-warn" />
            <h3 className="text-sm font-medium">Room not yet in session</h3>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
              {lockedReason ?? "Waiting for the ledger to be built."}
            </p>
          </div>
        </div>
      ) : (
        <div ref={feedRef} className="flex-1 overflow-auto p-5">
          {postings.length === 0 ? (
            <div className="grid h-full place-items-center text-center">
              <div>
                <div className="mx-auto h-12 w-12 rounded-full border-2 border-dashed border-border-soft" />
                <h3 className="mt-3 text-sm font-medium">No active session</h3>
                <p className="mt-1 text-[12px] text-muted">
                  Click <span className="text-text">Open the room</span> to convene the band.
                </p>
              </div>
            </div>
          ) : (
            <ol className="space-y-3">
              {postings.map((p, i) => (
                <Posting key={i} p={p} />
              ))}
            </ol>
          )}
        </div>
      )}
    </section>
  );
}

function Posting({ p }: { p: RoomPosting }) {
  const meta = AGENT_META[p.agent];
  const isGate = p.kind === "gate";
  const ok = isGate && !/⛔|fail|reject/i.test(p.content);
  const fail = isGate && /⛔|fail|reject/i.test(p.content);
  return (
    <li className="rounded-[9px] border border-border-soft bg-panel-2 p-3">
      <header className="mb-1.5 flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className={`text-[12px] font-semibold ${meta?.color ?? "text-muted"}`}>
            {p.agent}
          </span>
          {meta?.role ? <span className="text-[11px] text-muted-2">{meta.role}</span> : null}
        </div>
        <span
          className={`text-[10px] uppercase tracking-wider ${
            ok ? "text-ok" : fail ? "text-bad" : "text-muted-2"
          }`}
        >
          {p.kind}
          {ok ? " ✓" : ""}
          {fail ? " ⛔" : ""}
        </span>
      </header>
      <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-text">{p.content}</p>
    </li>
  );
}
