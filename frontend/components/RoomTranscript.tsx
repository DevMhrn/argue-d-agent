"use client";

import { useEffect, useRef } from "react";
import { Icon } from "@/components/Icon";
import {
  type AgentIdentity,
  agentIdentity,
  familyLabel,
  familyTint,
  familyWash,
  shapeRadius,
} from "@/lib/agents";
import type { RoomPosting } from "@/lib/types";

type PostingTone = "argument" | "room";

interface RoomTranscriptProps {
  postings: RoomPosting[];
  emptyAction: string;
  tone?: PostingTone;
  /** Transient "agent is doing X" indicator shown at the foot of the feed while
   *  we wait for the next message. */
  activity?: { agent: string; content: string } | null;
  /** True while the run is live (streaming/connecting). Drives a generic
   *  "deliberating…" beat so the indicator is never blank between agents. */
  running?: boolean;
  /** Fact id currently focused by a citation click (cross-component highlight). */
  highlightFact?: string | null;
  /** Invoked when a `[ID]` citation chip is clicked. */
  onCiteClick?: (factId: string) => void;
  /** Issue key to focus; non-matching postings dim. "all" / null shows everything. */
  issueFilter?: string | null;
}

const GENERIC_BEAT = { agent: "", content: "deliberating…" };

interface PhaseGroup {
  key: string;
  phase: string;
  label: string;
  issueLabel: string;
  postings: RoomPosting[];
}

export function RoomTranscript({
  postings,
  emptyAction,
  tone = "room",
  activity = null,
  running = false,
  highlightFact = null,
  onCiteClick,
  issueFilter = null,
}: RoomTranscriptProps) {
  const feedRef = useRef<HTMLDivElement>(null);
  // A specific agent beat when we have one; otherwise, while the run is live, a
  // generic beat — so the room never goes blank between steps.
  const beat = activity ?? (running ? GENERIC_BEAT : null);

  // Scroll the feed to the bottom whenever a posting or activity beat arrives.
  const postingCount = postings.length;
  const beatContent = beat?.content ?? null;
  useEffect(() => {
    // `postingCount`/`beatContent` are read here so the effect re-runs as the
    // feed grows (the scroll target itself is a stable ref).
    void postingCount;
    void beatContent;
    feedRef.current?.scrollTo({
      top: feedRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [postingCount, beatContent]);

  if (postings.length === 0 && !beat) {
    return (
      <div ref={feedRef} className="flex-1 overflow-auto">
        <EmptyRoomState action={emptyAction} />
      </div>
    );
  }

  const groups = groupByPhase(postings);
  // Role one-liner shows only on an agent's first message across the whole feed.
  const seen = new Set<string>();

  return (
    <div ref={feedRef} className="relative flex-1 overflow-auto">
      {groups.map((group) => (
        <section key={group.key}>
          <PhaseHeader label={group.label} issueLabel={group.issueLabel} />
          <div className="px-5.5 pt-1.5 pb-3.5">
            {group.postings.map((posting, idx) => (
              <Posting
                // biome-ignore lint/suspicious/noArrayIndexKey: transcript is append-only and never reordered, so position is a stable key
                key={`${group.key}:${idx}`}
                posting={posting}
                tone={tone}
                dimmed={isDimmed(posting, issueFilter)}
                firstForAgent={markFirst(posting, seen)}
                highlightFact={highlightFact}
                onCiteClick={onCiteClick}
              />
            ))}
          </div>
        </section>
      ))}
      {beat ? <ActivityIndicator activity={beat} /> : null}
      <div className="h-2" />
    </div>
  );
}

/** Returns true and records the agent the FIRST time a message agent is seen. */
function markFirst(posting: RoomPosting, seen: Set<string>): boolean {
  if (posting.kind !== "message") return false;
  if (seen.has(posting.agent)) return false;
  seen.add(posting.agent);
  return true;
}

function isDimmed(posting: RoomPosting, issueFilter: string | null): boolean {
  if (!issueFilter || issueFilter === "all") return false;
  const key = posting.metadata?.issue_key;
  return Boolean(key) && key !== issueFilter;
}

function groupByPhase(postings: RoomPosting[]): PhaseGroup[] {
  const groups: PhaseGroup[] = [];
  for (const posting of postings) {
    const phase = posting.metadata?.phase ?? "round";
    const issueLabel = posting.metadata?.issue_title ?? "";
    let group = groups.at(-1);
    if (!group || group.phase !== phase) {
      // Key by occurrence index, not the phase alone — a phase can recur
      // non-contiguously while streaming, which would collide on the React key.
      group = {
        key: `${phase}:${groups.length}`,
        phase,
        label: phaseLabel(phase),
        issueLabel: "",
        postings: [],
      };
      groups.push(group);
    }
    group.postings.push(posting);
    group.issueLabel ||= issueLabel;
  }
  return groups;
}

function PhaseHeader({
  label,
  issueLabel,
}: {
  label: string;
  issueLabel: string;
}) {
  return (
    <div
      className="sticky top-0 z-5 flex items-center gap-2.75 border-border-soft border-b px-5.5 py-2.25 backdrop-blur-md"
      style={{ background: "rgba(28,24,19,0.94)" }}
    >
      <span className="font-mono text-[10px] text-muted-2 uppercase tracking-[0.14em]">
        {label}
      </span>
      {issueLabel ? (
        <span
          className="rounded-chip border px-2 py-px font-mono text-[10px] text-accent"
          style={{
            background: "rgba(111,155,240,0.1)",
            borderColor: "rgba(111,155,240,0.25)",
          }}
        >
          {issueLabel}
        </span>
      ) : null}
      <div className="h-px flex-1 bg-border-soft" />
    </div>
  );
}

function Posting({
  posting,
  tone,
  dimmed,
  firstForAgent,
  highlightFact,
  onCiteClick,
}: {
  posting: RoomPosting;
  tone: PostingTone;
  dimmed: boolean;
  firstForAgent: boolean;
  highlightFact: string | null;
  onCiteClick?: (factId: string) => void;
}) {
  const reduce = prefersReducedMotion();
  return (
    <div
      style={{
        opacity: dimmed ? 0.28 : 1,
        transition: "opacity 0.4s",
        animation: reduce ? undefined : "postIn 0.45s ease-out",
      }}
    >
      <PostingBody
        posting={posting}
        tone={tone}
        firstForAgent={firstForAgent}
        highlightFact={highlightFact}
        onCiteClick={onCiteClick}
      />
    </div>
  );
}

function PostingBody({
  posting,
  tone,
  firstForAgent,
  highlightFact,
  onCiteClick,
}: {
  posting: RoomPosting;
  tone: PostingTone;
  firstForAgent: boolean;
  highlightFact: string | null;
  onCiteClick?: (factId: string) => void;
}) {
  if (posting.metadata?.tool?.name) return <ToolCard posting={posting} />;
  if (posting.kind === "gate") return <GateBox posting={posting} />;
  if (posting.kind === "message")
    return (
      <SpeakerCard
        posting={posting}
        firstForAgent={firstForAgent}
        highlightFact={highlightFact}
        onCiteClick={onCiteClick}
      />
    );
  // handoff / decision / system with no tool → centered clerk band
  return <HandoffBand content={posting.content} tone={tone} />;
}

function HandoffBand({
  content,
  tone,
}: {
  content: string;
  tone: PostingTone;
}) {
  return (
    <div className="my-1.5 mt-3.5 flex items-center gap-3.25">
      <div className="h-px flex-1 bg-border" />
      <div
        className={`flex items-center gap-2 font-mono text-[11px] ${tone === "argument" ? "text-muted" : "text-muted"}`}
      >
        <span className="h-1.25 w-1.25 rotate-45 bg-muted-2" />
        {content}
      </div>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

function ToolCard({ posting }: { posting: RoomPosting }) {
  const tool = posting.metadata?.tool;
  const call = tool?.query || tool?.name || posting.content;
  const result = tool?.result_ids?.join(", ") ?? "";
  return (
    <div
      className="my-2 rounded-pill border border-border px-3.25 py-2.5 font-mono text-[11.5px] leading-normal"
      style={{ background: "#171410" }}
    >
      <span className="text-muted-2">The clerk looked up </span>
      <span className="text-accent">{call}</span>
      {result ? (
        <>
          <span className="text-muted-2"> → found </span>
          <span className="text-ok">{result}</span>
        </>
      ) : null}
    </div>
  );
}

const GATE_VERDICT: Record<
  string,
  { color: string; border: string; bg: string; icon: string; label: string }
> = {
  passed: {
    color: "var(--color-ok)",
    border: "rgba(110,169,138,0.4)",
    bg: "rgba(110,169,138,0.06)",
    icon: "✓",
    label: "PASSED",
  },
  warning: {
    color: "var(--color-warn)",
    border: "rgba(212,164,74,0.4)",
    bg: "rgba(212,164,74,0.06)",
    icon: "!",
    label: "WARNING",
  },
  escalated: {
    color: "var(--color-warn)",
    border: "rgba(212,164,74,0.4)",
    bg: "rgba(212,164,74,0.06)",
    icon: "!",
    label: "ESCALATED",
  },
  rejected: {
    color: "var(--color-bad)",
    border: "rgba(198,106,90,0.4)",
    bg: "rgba(198,106,90,0.06)",
    icon: "✕",
    label: "REJECTED",
  },
  decline: {
    color: "var(--color-bad)",
    border: "rgba(198,106,90,0.4)",
    bg: "rgba(198,106,90,0.06)",
    icon: "✕",
    label: "DECLINE",
  },
};

interface GateView {
  tone: (typeof GATE_VERDICT)[string];
  name: string;
  detail: string;
  attempt: number | string | null;
}

function resolveGate(posting: RoomPosting): GateView {
  const gate = posting.metadata?.gate;
  const verdict = gate?.verdict ?? gateVerdictFromContent(posting.content);
  return {
    tone: GATE_VERDICT[verdict] ?? GATE_VERDICT.passed,
    name: gate?.name ?? firstLine(posting.content),
    detail: gate?.name ? posting.content : afterFirstLine(posting.content),
    attempt: readAttempt(gate?.attempt),
  };
}

function GateBox({ posting }: { posting: RoomPosting }) {
  const { tone: v, name, detail, attempt } = resolveGate(posting);
  const reduce = prefersReducedMotion();

  return (
    <div
      className="my-2.25 rounded-card border px-3.75 py-3.25"
      style={{
        borderColor: v.border,
        background: v.bg,
        borderLeft: `3px solid ${v.color}`,
        animation: reduce ? undefined : "gatePop 0.4s ease-out",
      }}
    >
      <div className="flex items-center gap-2.75">
        <span
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] border-[1.5px] font-bold text-[11px]"
          style={{ borderColor: v.border, color: v.color }}
        >
          {v.icon}
        </span>
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2.25">
            <span
              className="font-mono font-semibold text-[12.5px]"
              style={{ color: v.color }}
            >
              {name}
            </span>
            <span
              className="rounded-chip border px-2 py-px font-mono font-semibold text-[9.5px] tracking-[0.06em]"
              style={{
                background: v.bg,
                borderColor: v.border,
                color: v.color,
              }}
            >
              {v.label}
            </span>
            {attempt ? (
              <span className="font-mono text-[10px] text-muted-2">
                attempt {attempt}
              </span>
            ) : null}
          </div>
          {detail ? (
            <div className="mt-1 text-[12px] text-muted leading-[1.45]">
              {detail}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function SpeakerCard({
  posting,
  firstForAgent,
  highlightFact,
  onCiteClick,
}: {
  posting: RoomPosting;
  firstForAgent: boolean;
  highlightFact: string | null;
  onCiteClick?: (factId: string) => void;
}) {
  const identity = agentIdentity(posting.agent);
  const wash = familyWash(identity.family);
  const tint = familyTint(identity.family);

  return (
    <div className="my-1.75 rounded-card border border-border-soft bg-panel-2 px-3.75 py-3.25">
      <div className="flex gap-3">
        <Avatar identity={identity} wash={wash} tint={tint} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.25">
            <span
              className="font-semibold text-[13px]"
              style={{ color: identity.tint }}
            >
              {posting.agent}
            </span>
            <FamilyChip identity={identity} wash={wash} tint={tint} />
          </div>
          {firstForAgent && identity.role ? (
            <div className="mt-0.5 font-serif text-[11px] text-muted-2 italic">
              {identity.role}
            </div>
          ) : null}
          <div className="mt-2 text-[13px] text-text leading-[1.6]">
            <Content
              content={posting.content}
              highlightFact={highlightFact}
              onCiteClick={onCiteClick}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function Avatar({
  identity,
  wash,
  tint,
}: {
  identity: AgentIdentity;
  wash: { bg: string; border: string };
  tint: string;
}) {
  return (
    <span
      className="flex h-8.5 w-8.5 shrink-0 items-center justify-center font-bold font-mono text-[11px]"
      style={{
        borderRadius: shapeRadius(identity.shape),
        background: wash.bg,
        border: `1px solid ${wash.border}`,
        color: tint,
      }}
    >
      {identity.mono}
    </span>
  );
}

function FamilyChip({
  identity,
  wash,
  tint,
}: {
  identity: AgentIdentity;
  wash: { bg: string; border: string };
  tint: string;
}) {
  return (
    <span
      className="rounded-chip border px-1.5 py-px font-mono text-[9px] tracking-[0.04em]"
      style={{ background: wash.bg, borderColor: wash.border, color: tint }}
    >
      {familyLabel(identity.family)}
    </span>
  );
}

const CITE_RE = /\[([A-Za-z0-9-]+)\]/g;

function Content({
  content,
  highlightFact,
  onCiteClick,
}: {
  content: string;
  highlightFact: string | null;
  onCiteClick?: (factId: string) => void;
}) {
  const lines = String(content).split("\n");
  return (
    <>
      {lines.map((line, lineIdx) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: line order is stable for a fixed posting
          key={lineIdx}
          className="mb-1"
        >
          <Line
            line={line}
            highlightFact={highlightFact}
            onCiteClick={onCiteClick}
          />
        </div>
      ))}
    </>
  );
}

function Line({
  line,
  highlightFact,
  onCiteClick,
}: {
  line: string;
  highlightFact: string | null;
  onCiteClick?: (factId: string) => void;
}) {
  const segments = tokenizeCitations(line);
  if (segments.length === 0) return <span>{line}</span>;
  return (
    <>
      {segments.map((seg, i) =>
        seg.kind === "text" ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: segment order is stable for a fixed line
          <span key={i}>{seg.text}</span>
        ) : (
          <CiteChip
            // biome-ignore lint/suspicious/noArrayIndexKey: segment order is stable for a fixed line
            key={i}
            factId={seg.id}
            active={highlightFact === seg.id}
            onCiteClick={onCiteClick}
          />
        ),
      )}
    </>
  );
}

type Segment = { kind: "text"; text: string } | { kind: "cite"; id: string };

function tokenizeCitations(line: string): Segment[] {
  const segments: Segment[] = [];
  let last = 0;
  CITE_RE.lastIndex = 0;
  let match: RegExpExecArray | null = CITE_RE.exec(line);
  while (match !== null) {
    if (match.index > last)
      segments.push({ kind: "text", text: line.slice(last, match.index) });
    segments.push({ kind: "cite", id: match[1] });
    last = CITE_RE.lastIndex;
    match = CITE_RE.exec(line);
  }
  if (segments.length === 0) return [];
  if (last < line.length)
    segments.push({ kind: "text", text: line.slice(last) });
  return segments;
}

function CiteChip({
  factId,
  active,
  onCiteClick,
}: {
  factId: string;
  active: boolean;
  onCiteClick?: (factId: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onCiteClick?.(factId)}
      className="mx-px inline-block cursor-pointer appearance-none rounded-[5px] border px-1.25 py-0 align-baseline font-mono text-[11px] text-accent-strong"
      style={{
        borderColor: active ? "var(--color-accent)" : "rgba(111,155,240,0.3)",
        background: active ? "rgba(111,155,240,0.22)" : "rgba(111,155,240,0.1)",
      }}
    >
      [{factId}]
    </button>
  );
}

function ActivityIndicator({
  activity,
}: {
  activity: { agent: string; content: string };
}) {
  const identity = activity.agent ? agentIdentity(activity.agent) : null;
  return (
    <div className="mx-5.5 mb-3.5 flex items-center gap-2 rounded-pill border border-accent/20 bg-accent/5 px-3 py-2">
      <span className="flex shrink-0 gap-1">
        <ActivityDot />
        <ActivityDot delay="160ms" />
        <ActivityDot delay="320ms" />
      </span>
      {identity ? (
        <span
          className="font-semibold text-[12px]"
          style={{ color: identity.tint }}
        >
          {activity.agent}
        </span>
      ) : null}
      <span className="text-[12.5px] text-muted italic">
        {activity.content}
      </span>
    </div>
  );
}

function ActivityDot({ delay = "0ms" }: { delay?: string }) {
  return (
    <span
      className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent"
      style={{ animationDelay: delay }}
    />
  );
}

function EmptyRoomState({ action }: { action: string }) {
  return (
    <div className="grid h-full place-items-center p-5 text-center">
      <div>
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-full border-2 border-border-soft border-dashed text-muted-2">
          <Icon name="gavel" size={20} />
        </div>
        <h3 className="mt-3 font-medium text-sm">No active session</h3>
        <p className="mt-1 text-[12px] text-muted">
          Click <span className="text-text">{action}</span> to convene the
          bench.
        </p>
      </div>
    </div>
  );
}

const PHASE_LABELS: Record<string, string> = {
  docket: "Opening",
  intake: "Evidence",
  opening_briefs: "Round 1 · opening arguments",
  cross_examination: "Round 2 · opposing view responds",
  redirect: "Round 3 · our advocate replies",
  adjudication: "The adjudicator decides",
  source_alignment: "Checking claims vs evidence",
  drafting: "Writing the demand letter",
  disposition: "Recommendation",
};

function phaseLabel(phase: string): string {
  return PHASE_LABELS[phase] ?? snakeToTitle(phase);
}

/** Title-case a snake_case key, e.g. `legal_basis` → `Legal Basis`. */
export function snakeToTitle(value: string): string {
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function firstLine(content: string): string {
  return String(content).split("\n")[0] ?? content;
}

function afterFirstLine(content: string): string {
  const lines = String(content).split("\n");
  return lines.slice(1).join("\n").trim();
}

function gateVerdictFromContent(content: string): string {
  return /⛔|✕|fail|reject/i.test(content) ? "rejected" : "passed";
}

function readAttempt(value: unknown): number | string | null {
  if (typeof value === "number" && value > 0) return value;
  if (typeof value === "string" && value.trim()) return value;
  return null;
}

function prefersReducedMotion(): boolean {
  return Boolean(
    globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
  );
}
