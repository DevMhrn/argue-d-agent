"use client";

import { useEffect, useRef } from "react";
import type { PostingMetadata, RoomPosting } from "@/lib/types";

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
type VerdictTone = "ok" | "fail";
interface ContextLabel {
  key: string;
  label: string;
}

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
  });

  return (
    <div ref={feedRef} className="flex-1 overflow-auto p-5">
      {postings.length === 0 ? (
        <EmptyRoomState action={emptyAction} />
      ) : (
        <ol className="space-y-3">
          {postings.map((posting) => (
            <Posting
              key={`${posting.seq ?? posting.at ?? "na"}:${posting.agent}:${posting.kind}:${posting.content}`}
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
      <PostingContext posting={posting} />
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

function PostingContext({ posting }: { posting: RoomPosting }) {
  const labels = postingContextLabels(posting.metadata);
  if (labels.length === 0) return null;

  return (
    <div className="mb-2 flex flex-wrap gap-1.5">
      {labels.map((item) => (
        <span
          key={item.key}
          className="rounded-full border border-border-soft bg-panel px-2 py-0.5 text-[10.5px] text-muted-2"
        >
          {item.label}
        </span>
      ))}
    </div>
  );
}

function agentMeta(agent: string) {
  return AGENT_META[agent] || FALLBACK_META;
}

function gateStateOf(posting: RoomPosting): GateState {
  if (posting.kind !== "gate") return "none";
  return (
    verdictGateState(posting.metadata?.gate?.verdict) ??
    getGateState(posting.content)
  );
}

const VERDICT_GATE_STATE: Record<string, VerdictTone> = {
  rejected: "fail",
  decline: "fail",
  passed: "ok",
  warning: "ok",
  escalated: "ok",
};

function verdictGateState(verdict?: string) {
  return verdict ? VERDICT_GATE_STATE[verdict] : undefined;
}

function postingContextLabels(metadata?: PostingMetadata): ContextLabel[] {
  if (!metadata) return [];
  return [
    contextLabel("issue", metadata.issue_title),
    contextLabel("phase", labelFromSnake(metadata.phase)),
    contextLabel("turn", labelFromSnake(metadata.turn_type)),
    contextLabel(
      "tool",
      metadata.tool?.name ? `tool: ${metadata.tool.name}` : null,
    ),
  ].filter((item): item is ContextLabel => Boolean(item));
}

function contextLabel(key: string, label?: string | null): ContextLabel | null {
  return label ? { key: `${key}:${label}`, label } : null;
}

function getGateState(content: string): Exclude<GateState, "none"> {
  return /⛔|fail|reject/i.test(content) ? "fail" : "ok";
}

function labelFromSnake(value?: string) {
  if (!value) return null;
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
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
