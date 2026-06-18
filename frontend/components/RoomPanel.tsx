"use client";

import { useEffect, useRef } from "react";
import type { RoomPosting } from "@/lib/types";

/** Agent → role label + Tailwind colour token from the legacy palette. */
const AGENT_META: Record<string, { role: string; color: string }> = {
  "Intake Parser": {
    role: "Extracts incident facts",
    color: "text-agent-intake",
  },
  "Evidence Aggregator": {
    role: "Builds the grounded ledger",
    color: "text-agent-evidence",
  },
  "Liability Advocate": {
    role: "Argues our insured's recovery",
    color: "text-agent-advocate",
  },
  "Opposing-Carrier Red Team": {
    role: "Attacks the case (red team)",
    color: "text-agent-opposing",
  },
  "Adjudicator A": {
    role: "Neutral referee · Claude",
    color: "text-agent-adj-a",
  },
  "Adjudicator B": {
    role: "Independent referee · Gemini",
    color: "text-agent-adj-b",
  },
  "Source-Alignment Verifier": {
    role: "Audits cited claims",
    color: "text-agent-verifier",
  },
  "Demand Letter Drafter": {
    role: "Drafts the demand letter",
    color: "text-agent-drafter",
  },
};

interface Props {
  postings: RoomPosting[];
  status: "idle" | "connecting" | "streaming" | "complete" | "error";
  onRun: () => void;
  canRun: boolean;
  bandRoomId: string | null;
}

export function RoomPanel({
  postings,
  status,
  onRun,
  canRun,
  bandRoomId,
}: Props) {
  const feedRef = useRef<HTMLDivElement>(null);
  // Auto-scroll to the bottom as new postings arrive.
  useEffect(() => {
    feedRef.current?.scrollTo({
      top: feedRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [postings.length]);

  return (
    <section className="flex h-full flex-col overflow-hidden rounded-card border border-border bg-panel shadow-card">
      <header className="flex items-center justify-between gap-3 border-border-soft border-b p-5">
        <div>
          <h2 className="font-semibold text-base tracking-tight">
            Live Band Room
          </h2>
          <p className="mt-0.5 text-[12px] text-muted">
            Agents post in turn. Gates fire on their own — they are code, not
            prompts.
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
            disabled={
              !canRun || status === "streaming" || status === "connecting"
            }
            className="rounded-pill border border-accent/40 bg-accent/15 px-4 py-2 text-accent text-sm hover:bg-accent/25 disabled:opacity-50"
          >
            {status === "streaming" || status === "connecting"
              ? "Running…"
              : status === "complete"
                ? "Run again"
                : "Run investigation"}
          </button>
        </div>
      </header>

      <div ref={feedRef} className="flex-1 overflow-auto p-5">
        {postings.length === 0 ? (
          <div className="grid h-full place-items-center text-center">
            <div>
              <div className="mx-auto h-12 w-12 rounded-full border-2 border-border-soft border-dashed" />
              <h3 className="mt-3 font-medium text-sm">No active session</h3>
              <p className="mt-1 text-[12px] text-muted">
                Click <span className="text-text">Run investigation</span> to
                convene the band.
              </p>
            </div>
          </div>
        ) : (
          <ol className="space-y-3">
            {postings.map((p) => (
              <Posting
                key={`${p.at ?? "na"}:${p.agent}:${p.kind}:${p.content}`}
                p={p}
              />
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

function Posting({ p }: { p: RoomPosting }) {
  const meta = AGENT_META[p.agent];
  const isGate = p.kind === "gate";
  const isSystem = p.kind === "system";
  const ok = isGate && !/⛔|fail|reject/i.test(p.content);
  const fail = isGate && /⛔|fail|reject/i.test(p.content);

  return (
    <li className="rounded-pill border border-border-soft bg-panel-2 p-3">
      <header className="mb-1.5 flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span
            className={`font-semibold text-[12px] ${meta?.color ?? "text-muted"}`}
          >
            {p.agent}
          </span>
          {meta?.role ? (
            <span className="text-[11px] text-muted-2">{meta.role}</span>
          ) : null}
        </div>
        <span
          className={`text-[10px] uppercase tracking-wider ${
            isGate
              ? ok
                ? "text-ok"
                : fail
                  ? "text-bad"
                  : "text-muted"
              : isSystem
                ? "text-muted-2"
                : "text-muted"
          }`}
        >
          {p.kind}
          {ok ? " ✓" : ""}
          {fail ? " ⛔" : ""}
        </span>
      </header>
      <p className="whitespace-pre-wrap text-[13px] text-text leading-relaxed">
        {p.content}
      </p>
    </li>
  );
}
