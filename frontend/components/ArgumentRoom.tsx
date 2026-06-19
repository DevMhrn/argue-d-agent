"use client";

import { useState } from "react";
import { Icon } from "@/components/Icon";
import { RoomTranscript, snakeToTitle } from "@/components/RoomTranscript";
import {
  type AgentIdentity,
  agentIdentity,
  BENCH_ORDER,
  familyTint,
  familyWash,
  shapeRadius,
} from "@/lib/agents";
import type { RoomPosting } from "@/lib/types";

interface Props {
  status: "idle" | "connecting" | "streaming" | "complete" | "error";
  postings: RoomPosting[];
  bandRoomId: string | null;
  activeRunId: string | null;
  lastSeq: number | null;
  canRun: boolean;
  lockedReason: string | null;
  onRun: () => void;
  activity?: { agent: string; content: string } | null;
  /** Fact id currently focused by a citation click (cross-component highlight). */
  highlightFact?: string | null;
  /** Invoked when a `[ID]` citation chip is clicked. */
  onCiteClick?: (factId: string) => void;
  /** How many analyses have run today; drives the "Nth run today" badge. */
  runCount?: number;
}

const DOCKET_ISSUES = [
  {
    key: "primary_liability",
    title: "Who was at fault?",
    preview: "primary liability",
  },
  {
    key: "comparative_fault",
    title: "Was our insured partly at fault?",
    preview: "comparative fault",
  },
  { key: "damages", title: "How much is recoverable?", preview: "damages" },
  {
    key: "legal_basis",
    title: "On what legal basis?",
    preview: "legal basis",
  },
] as const;

const ISSUE_CHIPS = [
  { key: "all", label: "All issues" },
  { key: "primary_liability", label: "primary liability" },
  { key: "comparative_fault", label: "comparative fault" },
  { key: "damages", label: "damages" },
  { key: "legal_basis", label: "legal basis" },
] as const;

const PHASE_PLAIN: Record<string, string> = {
  docket: "Opening",
  intake: "Evidence",
  opening_briefs: "Round 1: opening arguments",
  cross_examination: "Round 2: opposing view responds",
  redirect: "Round 3: our advocate replies",
  adjudication: "The adjudicator decides",
  source_alignment: "Checking claims vs evidence",
  drafting: "Writing the demand letter",
  disposition: "Recommendation",
};

const ISSUE_PLAIN: Record<string, string> = {
  primary_liability: "Who was at fault?",
  comparative_fault: "Was our insured partly at fault?",
  damages: "How much is recoverable?",
  legal_basis: "On what legal basis?",
};

export function ArgumentRoom({
  status,
  postings,
  bandRoomId,
  activeRunId,
  lastSeq,
  canRun,
  lockedReason,
  onRun,
  activity = null,
  highlightFact = null,
  onCiteClick,
  runCount = 0,
}: Props) {
  const [issueFilter, setIssueFilter] = useState<string>("all");
  const isLocked = !canRun;
  const running = status === "streaming" || status === "connecting";
  const adjourned = status === "complete";
  const idle = !running && !adjourned && postings.length === 0;

  // The currently-speaking agent = the agent of the last `message` posting.
  const lastMessage = lastMessagePosting(postings);
  const speakingAgent = running && lastMessage ? lastMessage.agent : null;

  return (
    <section className="flex min-h-150 flex-col overflow-hidden rounded-card border border-border bg-panel shadow-(--shadow-card)">
      <header className="border-border-soft border-b px-5.5 py-4.5">
        <RoomTopRow
          bandRoomId={bandRoomId}
          running={running}
          adjourned={adjourned}
          isLocked={isLocked}
          runCount={runCount}
          onRun={onRun}
        />
        <BenchStrip postings={postings} speakingAgent={speakingAgent} />
        <LiveFeed postings={postings} idle={idle} />
        <StatusLine
          postings={postings}
          running={running}
          adjourned={adjourned}
          idle={idle}
          runCount={runCount}
          activeRunId={activeRunId}
          lastSeq={lastSeq}
        />
        <IssueChips active={issueFilter} onSelect={setIssueFilter} />
      </header>

      <div className="relative flex-1">
        {isLocked && postings.length === 0 ? (
          <LockedRoomNotice reason={lockedReason} />
        ) : idle ? (
          <DocketStoryboard />
        ) : (
          <RoomTranscript
            postings={postings}
            emptyAction="Run the recovery analysis"
            tone="argument"
            activity={activity}
            running={running}
            highlightFact={highlightFact}
            onCiteClick={onCiteClick}
            issueFilter={issueFilter}
          />
        )}
      </div>
    </section>
  );
}

function RoomTopRow({
  bandRoomId,
  running,
  adjourned,
  isLocked,
  runCount,
  onRun,
}: {
  bandRoomId: string | null;
  running: boolean;
  adjourned: boolean;
  isLocked: boolean;
  runCount: number;
  onRun: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4.5">
      <div>
        <div className="flex items-center gap-2.5">
          <h2 className="font-semibold text-[19px]">The analysis</h2>
          <RoomChip bandRoomId={bandRoomId} />
        </div>
        <p className="mt-1.5 max-w-145 text-[12.5px] text-muted leading-normal">
          Our advocate argues for recovery. The opposing view argues back. An
          adjudicator decides — double-checked by an independent reviewer from a
          different model family.
        </p>
      </div>
      <CtaCluster
        running={running}
        adjourned={adjourned}
        isLocked={isLocked}
        runCount={runCount}
        onRun={onRun}
      />
    </div>
  );
}

function RoomChip({ bandRoomId }: { bandRoomId: string | null }) {
  const label = bandRoomId ? `room ${bandRoomId.slice(0, 6)}` : "room";
  return (
    <span
      title="Band coordination room"
      className="flex items-center gap-1.25 rounded-md border border-border bg-panel-2 px-2 py-0.5 font-mono text-[9.5px] text-muted-2"
    >
      <Icon name="layers" size={11} />
      {label}
    </span>
  );
}

function CtaCluster({
  running,
  adjourned,
  isLocked,
  runCount,
  onRun,
}: {
  running: boolean;
  adjourned: boolean;
  isLocked: boolean;
  runCount: number;
  onRun: () => void;
}) {
  const ctaBase =
    "inline-flex items-center whitespace-nowrap rounded-pill px-[17px] py-2.5 font-sans font-semibold text-[13px]";

  if (running) {
    return (
      <div className="flex shrink-0 items-center gap-2.25">
        <button
          type="button"
          disabled
          className={`${ctaBase} cursor-not-allowed border border-border bg-panel-3 text-muted-2`}
        >
          <Spinner />
          <span>Analyzing…</span>
        </button>
      </div>
    );
  }

  if (adjourned) {
    return (
      <div className="flex shrink-0 items-center gap-2.25">
        <button
          type="button"
          onClick={onRun}
          disabled={isLocked}
          className={`${ctaBase} cursor-pointer border bg-panel-2 text-accent-strong disabled:cursor-not-allowed disabled:opacity-50`}
          style={{ borderColor: "var(--color-accent-dim)" }}
        >
          <span>Run a new analysis →</span>
          {runCount >= 1 ? (
            <span
              className="ml-2.25 rounded-chip border px-2 py-0.5 font-mono text-[10px] text-accent-strong"
              style={{
                background: "rgba(111,155,240,0.16)",
                borderColor: "var(--color-accent-dim)",
              }}
            >
              {ordinal(runCount + 1)} run today
            </span>
          ) : null}
        </button>
      </div>
    );
  }

  // idle / ready
  return (
    <div className="flex shrink-0 items-center gap-2.25">
      <button
        type="button"
        onClick={onRun}
        disabled={isLocked}
        className={`${ctaBase} cursor-pointer border border-transparent disabled:cursor-not-allowed disabled:opacity-50`}
        style={{
          background: "linear-gradient(180deg,#6f9bf0,#5b8def)",
          color: "#0e1320",
        }}
      >
        Run the recovery analysis →
      </button>
    </div>
  );
}

function Spinner() {
  return (
    <span
      className="mr-2 inline-block h-3.25 w-3.25 rounded-full align-[-2px]"
      style={{
        border: "2px solid rgba(165,155,140,0.3)",
        borderTopColor: "var(--color-accent)",
        animation: "spin 0.7s linear infinite",
      }}
    />
  );
}

function BenchStrip({
  postings,
  speakingAgent,
}: {
  postings: RoomPosting[];
  speakingAgent: string | null;
}) {
  const spoken = new Set(
    postings.filter((p) => p.kind === "message").map((p) => p.agent),
  );

  return (
    <>
      <div className="mt-4 mb-2.25 flex items-center gap-2">
        <span className="font-mono text-[10px] text-muted-2 uppercase tracking-[0.14em]">
          The bench
        </span>
        <span className="font-mono text-[10px] text-muted-2">
          8 agents · 4 from each model family
        </span>
        <span className="ml-auto flex items-center gap-2.5 font-mono text-[9.5px] text-muted-2">
          <span className="flex items-center gap-1.25">
            <span
              className="h-2 w-2 rounded-xs"
              style={{ background: "var(--color-family-claude)" }}
            />
            family A
          </span>
          <span className="flex items-center gap-1.25">
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: "var(--color-family-gpt)" }}
            />
            family B
          </span>
        </span>
      </div>
      <div className="grid grid-cols-8 gap-1.5 rounded-[11px] border border-border bg-panel-2 px-2.25 py-3">
        {BENCH_ORDER.map((identity) => (
          <BenchCell
            key={identity.name}
            identity={identity}
            speaking={speakingAgent === identity.name}
            hasSpoken={spoken.has(identity.name)}
          />
        ))}
      </div>
    </>
  );
}

function BenchCell({
  identity,
  speaking,
  hasSpoken,
}: {
  identity: AgentIdentity;
  speaking: boolean;
  hasSpoken: boolean;
}) {
  const reduce = prefersReducedMotion();
  const wash = familyWash(identity.family);
  const tint = familyTint(identity.family);

  return (
    <div
      title={`${identity.name} — ${identity.role}`}
      className="rounded-pill px-1.75 py-2.25"
      style={{
        background: speaking ? wash.bg : "transparent",
        border: `1px solid ${speaking ? wash.border : "transparent"}`,
        transition: "all 0.3s",
        animation:
          speaking && !reduce ? "benchRise 0.3s ease-out forwards" : undefined,
      }}
    >
      <div className="relative flex justify-center">
        <span
          className="flex h-7.5 w-7.5 shrink-0 items-center justify-center font-bold font-mono text-[11px]"
          style={{
            borderRadius: shapeRadius(identity.shape),
            background: wash.bg,
            border: `1px solid ${wash.border}`,
            color: tint,
          }}
        >
          {identity.mono}
        </span>
        {speaking ? (
          <span
            className="absolute -top-0.75 h-2.25 w-2.25 rounded-full"
            style={{
              right: "50%",
              marginRight: "-19px",
              background: tint,
              boxShadow: `0 0 8px ${tint}`,
              border: "2px solid var(--color-panel-2)",
              animation: reduce ? undefined : "livePulse 1.1s infinite",
            }}
          />
        ) : null}
      </div>
      <div
        className="mt-2 truncate text-center font-semibold text-[9.5px] leading-[1.1]"
        style={{ color: speaking ? "var(--color-text)" : "var(--color-muted)" }}
      >
        {identity.benchName}
      </div>
      <div className="mt-0.5 h-4.75 overflow-hidden text-center text-[8px] text-muted-2 leading-[1.2]">
        {identity.benchRole}
      </div>
      <div className="mt-1.25 flex justify-center gap-0.75">
        {[0, 1, 2].map((i) => (
          <PipeDot
            key={i}
            index={i}
            speaking={speaking}
            hasSpoken={hasSpoken}
            tint={tint}
          />
        ))}
      </div>
    </div>
  );
}

function PipeDot({
  index,
  speaking,
  hasSpoken,
  tint,
}: {
  index: number;
  speaking: boolean;
  hasSpoken: boolean;
  tint: string;
}) {
  const reduce = prefersReducedMotion();
  const background = speaking
    ? tint
    : hasSpoken
      ? "rgba(165,155,140,0.5)"
      : "var(--color-border)";
  return (
    <span
      className="h-1 w-1 rounded-full"
      style={{
        background,
        animation:
          speaking && !reduce
            ? `livePulse 1s infinite ${index * 0.18}s`
            : undefined,
      }}
    />
  );
}

function LiveFeed({
  postings,
  idle,
}: {
  postings: RoomPosting[];
  idle: boolean;
}) {
  const rows = idle ? idleFeedRows() : liveFeedRows(postings);

  return (
    <div
      className="mt-3 flex flex-col gap-1.5 rounded-[10px] border border-border-soft px-3 py-2.5"
      style={{ background: "#13100b" }}
    >
      {rows.map((row, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: feed rows are positional (last 3)
          key={i}
          className="flex items-baseline gap-2.25 text-[11.5px] leading-[1.4]"
        >
          <span
            className="w-6.5 shrink-0 font-bold font-mono text-[9.5px]"
            style={{ color: row.monoColor }}
          >
            {row.mono}
          </span>
          <span
            style={{
              color: row.textColor,
              fontFamily: row.serif ? "var(--font-serif)" : undefined,
              fontStyle: row.italic ? "italic" : undefined,
              fontSize: row.small ? "10.5px" : undefined,
            }}
          >
            {row.text}
          </span>
        </div>
      ))}
    </div>
  );
}

interface FeedRow {
  mono: string;
  monoColor: string;
  textColor: string;
  text: string;
  italic?: boolean;
  serif?: boolean;
  small?: boolean;
}

function idleFeedRows(): FeedRow[] {
  return [
    {
      mono: "AD",
      monoColor: "var(--color-family-claude)",
      textColor: "var(--color-muted-2)",
      text: "(waiting for opening argument)",
      italic: true,
    },
    {
      mono: "OV",
      monoColor: "var(--color-family-gpt)",
      textColor: "var(--color-muted-2)",
      text: "(waiting)",
      italic: true,
    },
    {
      mono: "AJ",
      monoColor: "#cdb07f",
      textColor: "var(--color-muted-2)",
      text: "(waiting)",
      italic: true,
    },
  ];
}

const GATE_FEED_TONE: Record<string, { color: string; suffix: string }> = {
  passed: { color: "var(--color-ok)", suffix: " — cleared" },
  warning: { color: "var(--color-warn)", suffix: " — flagged" },
  escalated: { color: "var(--color-warn)", suffix: " — flagged" },
  rejected: { color: "var(--color-bad)", suffix: " — rejected" },
  decline: { color: "var(--color-bad)", suffix: " — rejected" },
};

function gateFeedRow(p: RoomPosting): FeedRow {
  const verdict = p.metadata?.gate?.verdict ?? "passed";
  const tone = GATE_FEED_TONE[verdict] ?? GATE_FEED_TONE.passed;
  const name = p.metadata?.gate?.name ?? p.content.split("\n")[0] ?? "Gate";
  return {
    mono: "✓",
    monoColor: tone.color,
    textColor: tone.color,
    text: name + tone.suffix,
    small: true,
  };
}

function messageFeedRow(p: RoomPosting): FeedRow {
  const identity = agentIdentity(p.agent);
  const firstLine = String(p.content)
    .split("\n")[0]
    .replace(/\[[A-Za-z0-9-]+\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const cited = (String(p.content).match(/\[([A-Za-z0-9-]+)\]/g) ?? []).join(
    " ",
  );
  const clipped =
    firstLine.length > 78 ? `${firstLine.slice(0, 78)}…` : firstLine;
  return {
    mono: identity.mono,
    monoColor: identity.tint,
    textColor: "var(--color-muted)",
    text: cited ? `${clipped}  ${cited}` : clipped,
  };
}

function liveFeedRows(postings: RoomPosting[]): FeedRow[] {
  const recent = postings
    .filter((p) => p.kind === "message" || p.kind === "gate")
    .slice(-3);
  const rows: FeedRow[] = recent.map((p) =>
    p.kind === "gate" ? gateFeedRow(p) : messageFeedRow(p),
  );
  while (rows.length < 3) {
    rows.unshift({
      mono: "··",
      monoColor: "var(--color-muted-2)",
      textColor: "var(--color-muted-2)",
      text: "—",
      italic: true,
    });
  }
  return rows;
}

function StatusLine({
  postings,
  running,
  adjourned,
  idle,
  runCount,
  activeRunId,
  lastSeq,
}: {
  postings: RoomPosting[];
  running: boolean;
  adjourned: boolean;
  idle: boolean;
  runCount: number;
  activeRunId: string | null;
  lastSeq: number | null;
}) {
  const reduce = prefersReducedMotion();
  const last = postings.at(-1) ?? null;
  const decline = isDecline(postings);

  let label = "Ready";
  let color = "var(--color-muted)";
  let dot = "var(--color-muted-2)";
  if (running) {
    label = "Analyzing";
    color = "var(--color-accent)";
    dot = "var(--color-accent)";
  } else if (adjourned) {
    label = "Complete";
    color = decline ? "var(--color-bad)" : "var(--color-ok)";
    dot = color;
  }

  const round = roundLabel(last, idle);
  const reached = new Set(
    postings.map((p) => p.metadata?.issue_key).filter(Boolean),
  );

  return (
    <div className="mt-3.25 flex items-center gap-2.5 font-mono text-[11.5px]">
      <span className="flex items-center gap-1.5" style={{ color }}>
        <span
          className="h-1.75 w-1.75 rounded-full"
          style={{
            background: dot,
            animation:
              running && !reduce ? "livePulse 1.4s infinite" : undefined,
          }}
        />
        {label}
      </span>
      <span className="text-muted-2">·</span>
      <span className="text-muted">{round}</span>
      <span className="text-muted-2">·</span>
      <span className="text-muted-2">Run #{Math.max(runCount, 1)}</span>
      {activeRunId ? (
        <span className="text-muted-2" title={`run ${activeRunId}`}>
          ({activeRunId.slice(0, 6)}
          {lastSeq ? ` · ${lastSeq}` : ""})
        </span>
      ) : null}
      <span className="ml-auto flex items-center gap-1.5">
        {DOCKET_ISSUES.map((issue) => (
          <IssueDot
            key={issue.key}
            issueKey={issue.key}
            done={adjourned || reached.has(issue.key)}
            active={!adjourned && last?.metadata?.issue_key === issue.key}
          />
        ))}
      </span>
    </div>
  );
}

function IssueDot({
  issueKey,
  done,
  active,
}: {
  issueKey: string;
  done: boolean;
  active: boolean;
}) {
  const reduce = prefersReducedMotion();
  return (
    <span
      title={issueKey.replace(/_/g, " ")}
      className="h-1.75 w-1.75 rounded-full"
      style={{
        background: done ? "var(--color-accent)" : "var(--color-panel-3)",
        border: `1px solid ${done ? "var(--color-accent)" : "var(--color-border)"}`,
        boxShadow:
          active && !reduce ? "0 0 6px var(--color-accent)" : undefined,
        animation: active && !reduce ? "livePulse 1.2s infinite" : undefined,
      }}
    />
  );
}

function IssueChips({
  active,
  onSelect,
}: {
  active: string;
  onSelect: (key: string) => void;
}) {
  return (
    <div className="mt-3.25 flex flex-wrap gap-1.75">
      {ISSUE_CHIPS.map((chip) => {
        const selected = active === chip.key;
        return (
          <button
            key={chip.key}
            type="button"
            onClick={() => onSelect(chip.key)}
            className="cursor-pointer rounded-chip border px-3.25 py-1.5 font-mono text-[11px] tracking-[0.02em]"
            style={{
              borderColor: selected
                ? "var(--color-accent)"
                : "var(--color-border)",
              background: selected ? "rgba(111,155,240,0.16)" : "transparent",
              color: selected
                ? "var(--color-accent-strong)"
                : "var(--color-muted)",
            }}
          >
            {chip.label}
          </button>
        );
      })}
    </div>
  );
}

function DocketStoryboard() {
  return (
    <div className="px-7.5 py-8.5">
      <div className="rounded-card border-[1.5px] border-border border-dashed bg-panel-2 px-7 py-7.5">
        <div className="mb-1.5 font-mono text-[11px] text-muted-2 uppercase tracking-[0.14em]">
          Ready to run
        </div>
        <div className="mb-1 font-semibold text-[16px]">
          This case is ready for analysis.
        </div>
        <div className="mb-5.5 text-[13px] text-muted leading-[1.55]">
          Eight specialist agents — four from each of two model families — will
          argue both sides over the locked evidence file, settling four
          questions in order:
        </div>
        <div className="mb-6 flex flex-col gap-0.5">
          {DOCKET_ISSUES.map((issue, i) => (
            <div
              key={issue.key}
              className="flex items-center gap-3.25 border-border-soft border-b py-2.75"
            >
              <span className="w-5.5 font-mono text-[11px] text-muted-2">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="flex-1 font-medium text-[13.5px]">
                {issue.title}
              </span>
              <span className="font-mono text-[11px] text-muted-2">
                {issue.preview}
              </span>
            </div>
          ))}
        </div>
        <div className="text-[12px] text-muted-2 leading-normal">
          Press <span className="text-accent">Run the recovery analysis</span>{" "}
          to begin. The discussion appears here, the six checks run above, and
          the recommendation settles below.
        </div>
      </div>
    </div>
  );
}

function LockedRoomNotice({ reason }: { reason: string | null }) {
  return (
    <div className="flex flex-1 items-center justify-center p-10">
      <div className="max-w-md rounded-card border border-border-soft bg-panel-2 p-6 text-center">
        <div className="mx-auto mb-3 h-10 w-10 rounded-full border-2 border-warn border-dashed" />
        <h3 className="font-medium text-sm">Room not yet in session</h3>
        <p className="mt-1.5 text-[12.5px] text-muted leading-relaxed">
          {reason ?? "Waiting for the ledger to be built."}
        </p>
      </div>
    </div>
  );
}

function lastMessagePosting(postings: RoomPosting[]): RoomPosting | null {
  for (let i = postings.length - 1; i >= 0; i--) {
    if (postings[i].kind === "message") return postings[i];
  }
  return null;
}

function roundLabel(last: RoomPosting | null, idle: boolean): string {
  if (!last) return idle ? "Not started" : "—";
  const phase = last.metadata?.phase;
  const base = phase ? (PHASE_PLAIN[phase] ?? snakeToTitle(phase)) : "—";
  const issueKey = last.metadata?.issue_key;
  const issue = issueKey ? ISSUE_PLAIN[issueKey] : "";
  return issue ? `${base} · ${issue}` : base;
}

function isDecline(postings: RoomPosting[]): boolean {
  return postings.some(
    (p) =>
      p.metadata?.gate?.verdict === "decline" ||
      p.metadata?.gate?.verdict === "rejected",
  );
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

function prefersReducedMotion(): boolean {
  return Boolean(
    globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
  );
}
