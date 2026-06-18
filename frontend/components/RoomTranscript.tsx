"use client";

import { useEffect, useRef } from "react";
import type { RoomPosting } from "@/lib/types";

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
    role: "Independent referee · GPT",
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

const FALLBACK_META = {
  role: "",
  color: "text-muted",
};

type PostingTone = "argument" | "room";
type GateState = "ok" | "fail" | "none";

interface RoomTranscriptProps {
  postings: RoomPosting[];
  emptyAction: string;
  tone?: PostingTone;
}

export function RoomTranscript({
  postings,
  emptyAction,
  tone = "room",
}: RoomTranscriptProps) {
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    feedRef.current?.scrollTo({
      top: feedRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [postings.length]);

  return (
    <div ref={feedRef} className="flex-1 overflow-auto p-5">
      {postings.length === 0 ? (
        <EmptyRoomState action={emptyAction} />
      ) : (
        <ol className="space-y-3">
          {postings.map((posting) => (
            <Posting
              key={`${posting.at ?? "na"}:${posting.agent}:${posting.kind}:${posting.content}`}
              posting={posting}
              tone={tone}
            />
          ))}
        </ol>
      )}
    </div>
  );
}

function EmptyRoomState({ action }: { action: string }) {
  return (
    <div className="grid h-full place-items-center text-center">
      <div>
        <div className="mx-auto h-12 w-12 rounded-full border-2 border-border-soft border-dashed" />
        <h3 className="mt-3 font-medium text-sm">No active session</h3>
        <p className="mt-1 text-[12px] text-muted">
          Click <span className="text-text">{action}</span> to convene the band.
        </p>
      </div>
    </div>
  );
}

function Posting({
  posting,
  tone,
}: {
  posting: RoomPosting;
  tone: PostingTone;
}) {
  const meta = agentMeta(posting.agent);
  const gateState = gateStateOf(posting);

  return (
    <li className="rounded-pill border border-border-soft bg-panel-2 p-3">
      <header className="mb-1.5 flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className={`font-semibold text-[12px] ${meta.color}`}>
            {posting.agent}
          </span>
          <AgentRole role={meta.role} />
        </div>
        <span
          className={`text-[10px] uppercase tracking-wider ${kindClass(posting, tone, gateState)}`}
        >
          {posting.kind}
          {GATE_ICON[gateState]}
        </span>
      </header>
      <p className="whitespace-pre-wrap text-[13px] text-text leading-relaxed">
        {posting.content}
      </p>
    </li>
  );
}

function AgentRole({ role }: { role: string }) {
  if (!role) return null;
  return <span className="text-[11px] text-muted-2">{role}</span>;
}

function agentMeta(agent: string) {
  return AGENT_META[agent] || FALLBACK_META;
}

function gateStateOf(posting: RoomPosting): GateState {
  if (posting.kind !== "gate") return "none";
  return getGateState(posting.content);
}

function getGateState(content: string): Exclude<GateState, "none"> {
  return /⛔|fail|reject/i.test(content) ? "fail" : "ok";
}

const GATE_ICON: Record<GateState, string> = {
  ok: " ✓",
  fail: " ⛔",
  none: "",
};

const GATE_KIND_CLASS: Record<Exclude<GateState, "none">, string> = {
  ok: "text-ok",
  fail: "text-bad",
};

function kindClass(
  posting: RoomPosting,
  tone: PostingTone,
  gateState: GateState,
) {
  if (gateState !== "none") return GATE_KIND_CLASS[gateState];
  if (tone === "argument" || posting.kind === "system") return "text-muted-2";
  return "text-muted";
}
