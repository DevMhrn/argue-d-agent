/**
 * Storyboard — the Citation Gate micro-interaction, told in four static frames:
 * brief filed → gate rejects → retry slides in → gate passes. This is the moment
 * a judge sees the harness police itself: the gate is code, not a prompt, so an
 * uncited claim is rejected before it can influence the bench, then the cited
 * retry is accepted. Static page (no data). Mirrors the design comp's storyboard
 * view (Lumen.dc.html lines 902-946, data 1506-1527).
 */
import type { CSSProperties, ReactNode } from "react";
import { agentIdentity, familyWash } from "../../lib/agents";

const LA = agentIdentity("Liability Advocate");
const LA_WASH = familyWash(LA.family);

/** The cited fact chip (F3 / F7) — mono, accent-strong, soft blue wash. */
function FactChip({ id }: { id: string }) {
  return (
    <span
      className="rounded-sm border px-1 font-mono text-[10px] text-accent-strong"
      style={{
        background: "rgba(111,155,240,0.12)",
        borderColor: "rgba(111,155,240,0.3)",
      }}
    >
      {id}
    </span>
  );
}

interface Frame {
  num: string;
  title: string;
  titleColor: string;
  showFaded: boolean;
  postStyle: CSSProperties;
  /** Sentence fragment before the trailing claim. */
  tail: string;
  /** The claim that the gate is policing (uncited prose, or a cited F7 chip). */
  claim: ReactNode;
  gate: {
    color: string;
    border: string;
    verdict: string;
    style: CSSProperties;
  } | null;
  caption: string;
}

// Card surface shared by every "live posting" pill.
const POST_BASE: CSSProperties = {
  padding: "9px 11px",
  borderRadius: "9px",
};

// Gate-chip row shared layout; per-frame color/border/wash layered on top.
const GATE_BASE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  padding: "8px 11px",
  borderRadius: "9px",
};

const FRAMES: Frame[] = [
  {
    num: "1",
    title: "Brief filed",
    titleColor: "var(--color-text)",
    showFaded: false,
    postStyle: {
      ...POST_BASE,
      background: "var(--color-panel-2)",
      border: "1px solid var(--color-border-soft)",
    },
    tail: ". Blake was also ",
    claim: <span className="text-muted">traveling well above the limit.</span>,
    gate: null,
    caption:
      "Opening brief is posted. One claim — the speed assertion — carries no citation to any ledger fact.",
  },
  {
    num: "2",
    title: "Gate rejects",
    titleColor: "var(--color-bad)",
    showFaded: false,
    postStyle: {
      ...POST_BASE,
      background: "rgba(198,106,90,0.08)",
      border: "1px solid rgba(198,106,90,0.4)",
    },
    tail: ". Blake was also ",
    claim: (
      <span
        className="rounded-[3px] px-0.5"
        style={{
          background: "rgba(198,106,90,0.22)",
          borderBottom: "1.5px solid var(--color-bad)",
          color: "#e6b0a4",
        }}
      >
        traveling well above the limit.
      </span>
    ),
    gate: {
      color: "var(--color-bad)",
      border: "rgba(198,106,90,0.4)",
      verdict: "REJECTED · attempt 1",
      style: {
        ...GATE_BASE,
        background: "rgba(198,106,90,0.06)",
        border: "1px solid rgba(198,106,90,0.35)",
        borderLeft: "3px solid var(--color-bad)",
      },
    },
    caption:
      "The Citation Gate fires on its own. The uncited claim flashes red; the posting cannot influence the bench.",
  },
  {
    num: "3",
    title: "Retry slides in",
    titleColor: "var(--color-accent-strong)",
    showFaded: true,
    postStyle: {
      ...POST_BASE,
      background: "var(--color-panel-2)",
      border: "1px solid var(--color-accent-dim)",
      animation: "postIn 0.5s ease-out",
    },
    tail: ". Skid analysis places Blake at 47 mph ",
    claim: <FactChip id="F7" />,
    gate: null,
    caption:
      "Advocate re-files with a cited speed fact. The rejected posting fades to a passive history color above.",
  },
  {
    num: "4",
    title: "Gate passes",
    titleColor: "var(--color-ok)",
    showFaded: true,
    postStyle: {
      ...POST_BASE,
      background: "var(--color-panel-2)",
      border: "1px solid var(--color-border-soft)",
    },
    tail: ". Skid analysis places Blake at 47 mph ",
    claim: <FactChip id="F7" />,
    gate: {
      color: "var(--color-ok)",
      border: "rgba(110,169,138,0.4)",
      verdict: "PASSED · attempt 2",
      style: {
        ...GATE_BASE,
        background: "rgba(110,169,138,0.06)",
        border: "1px solid rgba(110,169,138,0.35)",
        borderLeft: "3px solid var(--color-ok)",
      },
    },
    caption:
      "Every claim now cites a supporting fact. The gate passes and the bench proceeds to cross-examination.",
  },
];

/** The "Liability Advocate" speaker chip — warm-sand LA monogram + name. */
function AdvocateSpeaker() {
  return (
    <div className="mb-1.75 flex items-center gap-1.75">
      <span
        className="flex h-5.5 w-5.5 items-center justify-center rounded-[7px] border font-bold font-mono text-[9px]"
        style={{
          background: LA_WASH.bg,
          borderColor: LA_WASH.border,
          color: "var(--color-family-claude)",
        }}
      >
        {LA.mono}
      </span>
      <span
        className="font-semibold text-[11.5px]"
        style={{ color: "var(--color-family-claude)" }}
      >
        {LA.name}
      </span>
    </div>
  );
}

function StoryFrame({ frame }: { frame: Frame }) {
  return (
    <div>
      {/* numbered header */}
      <div className="mb-2.5 flex items-center gap-2">
        <span className="flex h-5 w-5 items-center justify-center rounded-md border border-border bg-panel-3 font-mono text-[10px] text-muted">
          {frame.num}
        </span>
        <span
          className="font-semibold text-[12px]"
          style={{ color: frame.titleColor }}
        >
          {frame.title}
        </span>
      </div>

      {/* card */}
      <div className="flex min-h-57.5 flex-col gap-2.25 rounded-[11px] border border-border bg-panel p-3.5">
        {/* faded prior posting */}
        {frame.showFaded && (
          <div className="rounded-pill border border-border-soft bg-panel-2 px-2.75 py-2.25 opacity-40">
            <div
              className="mb-1 font-semibold text-[11px]"
              style={{ color: "var(--color-family-claude)" }}
            >
              Liability Advocate
            </div>
            <div className="text-[11px] text-muted leading-[1.4] line-through">
              …traveling well above the posted limit.
            </div>
          </div>
        )}

        {/* live posting */}
        <div style={frame.postStyle}>
          <AdvocateSpeaker />
          <div className="text-[11.5px] text-text leading-normal">
            Blake entered against a steady red <FactChip id="F3" />
            {frame.tail}
            {frame.claim}
          </div>
        </div>

        {/* gate chip */}
        {frame.gate && (
          <div style={frame.gate.style}>
            <span
              className="font-mono font-semibold text-[11px]"
              style={{ color: frame.gate.color }}
            >
              Citation Gate
            </span>
            <span
              className="rounded-chip border px-1.75 py-px font-mono font-semibold text-[9px]"
              style={{
                color: frame.gate.color,
                borderColor: frame.gate.border,
              }}
            >
              {frame.gate.verdict}
            </span>
          </div>
        )}
      </div>

      {/* caption */}
      <div className="mt-2.5 text-[11px] text-muted-2 leading-normal">
        {frame.caption}
      </div>
    </div>
  );
}

export default function StoryboardPage() {
  return (
    <div className="mx-auto w-full max-w-7xl px-6 pt-8 pb-20">
      <div className="mb-2 font-mono text-[11px] text-muted-2 uppercase tracking-[0.14em]">
        Micro-interaction
      </div>
      <h1 className="mb-2 font-semibold text-[28px] tracking-[-0.02em]">
        Citation Gate — reject → retry → pass
      </h1>
      <p className="mb-8 max-w-165 text-[14px] text-muted leading-[1.6]">
        The harness is code, not a prompt. When the Advocate posts an uncited
        claim, the gate rejects it before it can influence the bench — then
        accepts the cited retry. This is the moment a judge sees the system
        police itself.
      </p>

      <div className="grid grid-cols-4 items-start gap-4">
        {FRAMES.map((frame) => (
          <StoryFrame key={frame.num} frame={frame} />
        ))}
      </div>

      <div className="mt-4.5 text-center font-mono text-[11.5px] text-muted-2">
        animation cue — retry posting slides in (translateY+fade); the rejected
        posting fades to a passive history color
      </div>
    </div>
  );
}
