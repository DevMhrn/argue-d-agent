"use client";

import { useEffect, useState } from "react";
import type { EdgeRow, NodeRow, NodeType } from "@/lib/types";
import type { CaseBuildProgress } from "@/lib/useCaseStream";

interface Props {
  hasLedger: boolean;
  nodes: NodeRow[];
  edges: EdgeRow[];
  ingestionComplete: boolean;
  /** Live ledger-build progress from the case-status stream (null until build starts). */
  build?: CaseBuildProgress | null;
  extracted?: number;
  total?: number;
  /** node_id of the fact a citation click is pointing at — gets accent + ringPulse/glow. */
  highlightFact?: string | null;
}

/**
 * Read-only ledger graph viewer (the DB path).
 *
 * Three states:
 *   - "Locked: waiting for ingestion" (ingestion_complete=false)
 *   - "Locked: ledger lane pending"   (ingestion_complete=true, ledger_complete=false)
 *   - "Locked & ready"                (ledger_complete=true) — List / Graph view
 *
 * The "LOCKED" framing is deliberate — once built, the ledger is the single
 * source of truth the agents argue over and is never mutated by the debate.
 */
export function LedgerGraphPanel({
  hasLedger,
  nodes,
  edges,
  ingestionComplete,
  build = null,
  extracted,
  total,
  highlightFact = null,
}: Props) {
  // "Building" covers: an active build (initial or rebuild), AND the brief
  // window where the build reports "done" but the full graph hasn't been
  // refetched yet (build present + !hasLedger) — without this the panel flashes
  // the "Locked" block for a split second before showing the built ledger.
  const building = build != null && (build.phase !== "done" || !hasLedger);
  const built = hasLedger && !building && nodes.length > 0;

  // Built path is fully self-contained (header + LOCKED chip + toggle + count
  // line + List/Graph body), so the toggle mode can drive the body.
  if (built) {
    return (
      <LedgerShell>
        <LedgerView nodes={nodes} edges={edges} highlightFact={highlightFact} />
      </LedgerShell>
    );
  }

  // Pre-built states keep the header but show a status chip instead of the
  // toggle, and a placeholder body.
  return (
    <LedgerShell>
      <LedgerHeader chip={building ? "building" : "locked"} />
      <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
        {building && build ? (
          <BuildingLedger build={build} extracted={extracted} total={total} />
        ) : hasLedger && nodes.length === 0 ? (
          <p className="text-[13px] text-muted">
            Ledger marked complete, but no nodes yet.
          </p>
        ) : (
          <LockedLedger ingestionComplete={ingestionComplete} />
        )}
      </div>
    </LedgerShell>
  );
}

/** The outer panel surface, shared by every state. */
function LedgerShell({ children }: { children: React.ReactNode }) {
  return (
    <section className="flex min-h-70 flex-1 flex-col overflow-hidden rounded-card border border-border bg-panel shadow-(--shadow-card)">
      {children}
    </section>
  );
}

/* ===========================================================================
   Shared ledger presentation — header chip, List/Graph toggle, the list view
   model (grouped cards + confidence dots), and the deterministic SVG graph.
   Imported by LedgerPanel (the demo path) so both surfaces match the comp.
   =========================================================================== */

type LedgerMode = "list" | "graph";

/** A type-erased ledger node — both the DB and demo paths normalize into this. */
export interface LedgerNode {
  id: string;
  type: NodeType;
  statement: string;
  quote: string | null;
  /** Source line (e.g. "police_report.pdf · p.2") — Fact/Statute only. */
  source: string | null;
  confidence: number | null;
}

export interface LedgerEdge {
  /** Stable key (edge_id from the DB; synthesized for the demo path). */
  key: string;
  fromId: string;
  toId: string;
  kind: "corroborates" | "contradicts" | "relates";
}

/**
 * Panel header row: "Evidence Ledger" + a status chip. `chip` is one of:
 *   "locked-on"  → sage LOCKED (ledger built and frozen)
 *   "building"   → accent pip + Building (lane is writing)
 *   "locked"     → amber Locked (pre-build / waiting)
 * An optional right-hand slot carries the List/Graph toggle when built.
 */
function LedgerHeader({
  chip,
  right,
}: {
  chip: "locked-on" | "building" | "locked";
  right?: React.ReactNode;
}) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-3 border-border-soft border-b px-4 py-3">
      <div className="flex items-center gap-2.5">
        <h3 className="font-semibold text-[13px] tracking-tight">
          Evidence Ledger
        </h3>
        {chip === "locked-on" ? (
          <span className="rounded-chip border border-ok/30 bg-ok/15 px-1.5 py-0.5 font-mono text-[9.5px] text-ok">
            LOCKED
          </span>
        ) : chip === "building" ? (
          <span className="inline-flex items-center gap-1.5 rounded-chip border border-accent/40 bg-accent/10 px-2 py-0.5 font-mono text-[9.5px] text-accent uppercase tracking-wider">
            <span className="h-1.5 w-1.5 animate-[livePulse_1s_ease-in-out_infinite] rounded-full bg-accent" />
            Building
          </span>
        ) : (
          <span className="rounded-chip border border-warn/40 bg-warn/10 px-2 py-0.5 font-mono text-[9.5px] text-warn uppercase tracking-wider">
            Locked
          </span>
        )}
      </div>
      {right}
    </div>
  );
}

function ModeToggle({
  mode,
  onMode,
}: {
  mode: LedgerMode;
  onMode: (m: LedgerMode) => void;
}) {
  return (
    <div className="flex rounded-[7px] border border-border bg-panel-2 p-0.5">
      <SegBtn active={mode === "list"} onClick={() => onMode("list")}>
        List
      </SegBtn>
      <SegBtn active={mode === "graph"} onClick={() => onMode("graph")}>
        Graph
      </SegBtn>
    </div>
  );
}

function SegBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-[5px] border-0 px-3 py-1 text-[11px] ${
        active ? "bg-panel-3 text-text" : "bg-transparent text-muted-2"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * The full built-ledger view: header (LOCKED chip + List/Graph toggle), a count
 * line, then the matching List or Graph body. Self-owns the toggle mode. Used
 * by both the DB and demo surfaces — each normalizes its rows first.
 */
export function LedgerView({
  nodes,
  edges,
  highlightFact = null,
}: {
  nodes: NodeRow[] | LedgerNode[];
  edges: EdgeRow[] | LedgerEdge[];
  highlightFact?: string | null;
}) {
  const [mode, setMode] = useState<LedgerMode>("list");
  const ledgerNodes = nodes.map(toLedgerNode);
  // DB edges reference nodes by UUID (from_id/to_id), but the graph keys nodes
  // by their display node_id (F1, P1, …). Translate so edges actually connect.
  const uuidToNodeId = new Map<string, string>();
  for (const n of nodes) {
    if (!isLedgerNode(n)) uuidToNodeId.set(n.id, n.node_id);
  }
  const resolveId = (id: string) => uuidToNodeId.get(id) ?? id;
  const ledgerEdges = edges.map(toLedgerEdge).map((e) => ({
    ...e,
    fromId: resolveId(e.fromId),
    toId: resolveId(e.toId),
  }));

  return (
    <>
      <LedgerHeader
        chip="locked-on"
        right={<ModeToggle mode={mode} onMode={setMode} />}
      />
      <div className="shrink-0 border-border-soft border-b px-3.5 pt-2.5 pb-1.5 font-mono text-[10.5px] text-muted-2">
        {ledgerNodes.length} node{ledgerNodes.length === 1 ? "" : "s"} /{" "}
        {ledgerEdges.length} edge{ledgerEdges.length === 1 ? "" : "s"}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {mode === "list" ? (
          <ListMode nodes={ledgerNodes} highlightFact={highlightFact} />
        ) : (
          <GraphMode
            nodes={ledgerNodes}
            edges={ledgerEdges}
            highlightFact={highlightFact}
          />
        )}
      </div>
    </>
  );
}

/* ---- normalizers ---------------------------------------------------------- */

function toLedgerNode(n: NodeRow | LedgerNode): LedgerNode {
  if (isLedgerNode(n)) return n;
  return {
    id: n.node_id,
    type: n.type,
    statement: nodeLabel(n.props),
    quote: n.verbatim_quote,
    source: sourceLine(n),
    confidence: toNumOrNull(n.confidence),
  };
}

/** Coerce an API numeric (which may arrive as a Decimal-serialized string) to a
 *  real number, or null. Guards against `.toFixed`/arithmetic on a string. */
function toNumOrNull(value: unknown): number | null {
  if (value == null) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** The display text for a node. The ledger lane stores it under `props.label`;
 *  fall back across the other shapes seen in the wild before giving up. */
function nodeLabel(props: Record<string, unknown>): string {
  for (const key of ["label", "statement", "text", "title", "name"]) {
    const v = props[key];
    if (typeof v === "string" && v.trim()) return v;
  }
  return "(unstated)";
}

function isLedgerNode(n: NodeRow | LedgerNode): n is LedgerNode {
  return (n as NodeRow).node_id === undefined;
}

function sourceLine(n: NodeRow): string | null {
  const doc =
    (n.props.source as string | undefined) ??
    (n.props.source_document as string | undefined) ??
    n.source_document_id ??
    null;
  if (!doc) return null;
  return n.source_page_number != null
    ? `${doc} · p.${n.source_page_number}`
    : doc;
}

function toLedgerEdge(e: EdgeRow | LedgerEdge): LedgerEdge {
  if (isLedgerEdge(e)) return e;
  return {
    key: e.edge_id,
    fromId: e.from_id,
    toId: e.to_id,
    kind: edgeKind(e.type),
  };
}

function isLedgerEdge(e: EdgeRow | LedgerEdge): e is LedgerEdge {
  return (e as EdgeRow).from_id === undefined;
}

function edgeKind(type: EdgeRow["type"]): LedgerEdge["kind"] {
  if (type === "corroborates") return "corroborates";
  if (type === "contradicts") return "contradicts";
  return "relates";
}

/* ---- LIST mode ------------------------------------------------------------ */

// Group order from the comp: Facts first, then everything else; only non-empty.
const GROUP_ORDER: NodeType[] = [
  "Fact",
  "Statute",
  "Party",
  "Vehicle",
  "Event",
  "Location",
  "Damage",
  "Document",
];

const GROUP_TITLE: Record<NodeType, string> = {
  Fact: "Facts",
  Statute: "Statutes",
  Party: "Parties",
  Vehicle: "Vehicles",
  Event: "Events",
  Location: "Locations",
  Damage: "Damages",
  Document: "Documents",
};

function ListMode({
  nodes,
  highlightFact,
}: {
  nodes: LedgerNode[];
  highlightFact: string | null;
}) {
  const groups = GROUP_ORDER.map((type) => ({
    type,
    items: nodes.filter((n) => n.type === type),
  })).filter((g) => g.items.length > 0);

  if (groups.length === 0) {
    return (
      <p className="px-3.5 py-4 text-[13px] text-muted">No ledger nodes yet.</p>
    );
  }

  return (
    <div className="flex flex-col gap-3.5 p-3">
      {groups.map((g) => (
        <div key={g.type}>
          <div className="mb-2 font-mono text-[10px] text-muted-2 uppercase tracking-widest">
            {GROUP_TITLE[g.type]} · {g.items.length}
          </div>
          <div className="flex flex-col gap-2.5">
            {g.items.map((n) => (
              <LedgerCard
                key={n.id}
                node={n}
                highlighted={n.id === highlightFact}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function LedgerCard({
  node,
  highlighted,
}: {
  node: LedgerNode;
  highlighted: boolean;
}) {
  const isFact = node.type === "Fact" || node.type === "Statute";
  return (
    <div
      className={`rounded-pill border px-3 py-2.5 ${
        highlighted
          ? "border-accent bg-[rgba(111,155,240,0.08)]"
          : "border-border-soft bg-panel-2"
      }`}
      style={highlighted ? { animation: "ringPulse 1.2s ease-out" } : undefined}
    >
      <div className="flex items-start gap-2.5">
        <span
          className={`shrink-0 rounded-[5px] px-1.5 py-0.5 font-mono font-semibold text-[10.5px] ${
            highlighted
              ? "bg-[rgba(111,155,240,0.2)] text-accent-strong"
              : "bg-panel-3 text-muted"
          }`}
        >
          {node.id}
        </span>
        <div className="flex-1">
          <div className="text-[12.5px] text-text leading-[1.4]">
            {node.statement}
          </div>
          {node.quote ? (
            <div
              className="mt-1.5 border-l-2 pl-2.5 font-serif text-[11.5px] text-muted italic leading-[1.45]"
              style={{ borderColor: "var(--color-accent-dim)" }}
            >
              {node.quote}
            </div>
          ) : null}
          {isFact && (node.source || node.confidence != null) ? (
            <div className="mt-2 flex items-center gap-2.5 font-mono text-[10px] text-muted-2">
              {node.source ? <span>{node.source}</span> : null}
              {node.confidence != null ? (
                <>
                  <ConfidenceDots confidence={node.confidence} />
                  <span>conf {node.confidence.toFixed(2)}</span>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ConfidenceDots({ confidence }: { confidence: number }) {
  const filled = Math.round(confidence * 4);
  return (
    <span className="flex items-center gap-0.5">
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className="h-1.25 w-1.25 rounded-full"
          style={{
            background: i < filled ? "var(--color-ok)" : "var(--color-border)",
          }}
        />
      ))}
    </span>
  );
}

/* ---- GRAPH mode ----------------------------------------------------------- */

const VIEW_W = 340;
const VIEW_H = 360;
const CX = VIEW_W / 2;
const CY = VIEW_H / 2 - 20;

interface PlacedNode extends LedgerNode {
  x: number;
  y: number;
  r: number;
}

/** Tint a node by its family/type (mirrors the comp's per-type fills). */
function nodeTint(type: NodeType): { fill: string; stroke: string } {
  switch (type) {
    case "Fact":
      return {
        fill: "rgba(216,184,136,0.16)",
        stroke: "var(--color-family-claude)",
      };
    case "Statute":
      return { fill: "rgba(212,164,74,0.16)", stroke: "var(--color-warn)" };
    case "Party":
      return {
        fill: "rgba(143,184,189,0.12)",
        stroke: "var(--color-family-gpt)",
      };
    case "Vehicle":
      return {
        fill: "rgba(143,184,189,0.1)",
        stroke: "var(--color-family-gpt)",
      };
    case "Damage":
      return { fill: "rgba(231,211,168,0.14)", stroke: "var(--color-money)" };
    case "Event":
      return { fill: "rgba(212,164,74,0.12)", stroke: "var(--color-warn)" };
    default:
      return { fill: "var(--color-panel-3)", stroke: "var(--color-border)" };
  }
}

/**
 * Deterministic radial layout — the data has no coordinates, so Facts ride an
 * inner ring and every other type rides an outer ring, both centered. Order is
 * stable (input order), so the same ledger always lays out the same way.
 */
function layout(nodes: LedgerNode[]): PlacedNode[] {
  const facts = nodes.filter((n) => n.type === "Fact");
  const others = nodes.filter((n) => n.type !== "Fact");
  const placed: PlacedNode[] = [];

  const ring = (
    group: LedgerNode[],
    radius: number,
    r: number,
    phase: number,
  ) => {
    const count = Math.max(group.length, 1);
    group.forEach((n, i) => {
      const angle = phase + (2 * Math.PI * i) / count;
      placed.push({
        ...n,
        x: CX + radius * Math.cos(angle),
        y: CY + radius * Math.sin(angle),
        r,
      });
    });
  };

  // Single fact sits dead center; otherwise an inner ring.
  if (facts.length === 1) {
    placed.push({ ...facts[0], x: CX, y: CY, r: 18 });
  } else {
    ring(facts, 70, 15, -Math.PI / 2);
  }
  ring(others, 132, 13, -Math.PI / 2 + Math.PI / Math.max(others.length, 1));
  return placed;
}

function GraphMode({
  nodes,
  edges,
  highlightFact,
}: {
  nodes: LedgerNode[];
  edges: LedgerEdge[];
  highlightFact: string | null;
}) {
  if (nodes.length === 0) {
    return (
      <p className="px-3.5 py-4 text-[13px] text-muted">
        Nothing to graph yet.
      </p>
    );
  }
  const placed = layout(nodes);
  const byId = new Map(placed.map((n) => [n.id, n]));

  return (
    <div className="p-2.5">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        role="img"
        aria-label="Evidence ledger relationship graph"
        className="block h-auto w-full"
      >
        {edges.map((e) => {
          const a = byId.get(e.fromId);
          const b = byId.get(e.toId);
          if (!a || !b) return null;
          const stroke =
            e.kind === "corroborates"
              ? "var(--color-ok)"
              : e.kind === "contradicts"
                ? "var(--color-bad)"
                : "var(--color-muted-2)";
          return (
            <line
              key={e.key}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={stroke}
              strokeWidth={e.kind === "relates" ? 1 : 1.5}
              strokeDasharray={
                e.kind === "contradicts"
                  ? "4 3"
                  : e.kind === "relates"
                    ? "3 3"
                    : undefined
              }
            />
          );
        })}
        {placed.map((n) => {
          const tint = nodeTint(n.type);
          const hl = n.id === highlightFact;
          return (
            <g key={n.id}>
              {hl ? (
                <circle
                  cx={n.x}
                  cy={n.y}
                  r={n.r + 6}
                  fill="none"
                  stroke="var(--color-accent)"
                  strokeWidth={1.5}
                  opacity={0.6}
                />
              ) : null}
              <circle
                cx={n.x}
                cy={n.y}
                r={n.r}
                fill={hl ? "rgba(111,155,240,0.18)" : tint.fill}
                stroke={hl ? "var(--color-accent)" : tint.stroke}
                strokeWidth={1.5}
              />
              <text
                x={n.x}
                y={n.y + 3}
                textAnchor="middle"
                fontSize={9}
                fontFamily="Geist Mono, monospace"
                fill={hl ? "var(--color-accent-strong)" : "var(--color-text)"}
              >
                {n.type === "Statute" ? "§" : n.id}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="flex justify-center gap-3.5 pt-2 pb-1 font-mono text-[10px] text-muted-2">
        <LegendItem color="var(--color-ok)">corroborates</LegendItem>
        <LegendItem color="var(--color-bad)">contradicts</LegendItem>
        <LegendItem color="var(--color-muted-2)">relates</LegendItem>
      </div>
    </div>
  );
}

function LegendItem({
  color,
  children,
}: {
  color: string;
  children: React.ReactNode;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-0.5 w-3.5" style={{ background: color }} />
      {children}
    </span>
  );
}

/* ===========================================================================
   Pre-built states (DB path only): live build progress + locked placeholders.
   =========================================================================== */

/* ===========================================================================
   Pre-built states (DB path only): live build progress + locked placeholders.
   =========================================================================== */

const BUILD_PHASES: { key: string; label: string }[] = [
  { key: "extracting", label: "Extracting the typed evidence graph" },
  { key: "anchoring", label: "Validating fact anchors to sources" },
  { key: "writing", label: "Writing nodes + edges to the ledger" },
  { key: "done", label: "Ledger locked" },
];

function useElapsedSeconds(): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const timer = globalThis.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => globalThis.clearInterval(timer);
  }, []);
  return seconds;
}

function BuildingLedger({
  build,
  extracted,
  total,
}: {
  build: CaseBuildProgress;
  extracted?: number;
  total?: number;
}) {
  const elapsed = useElapsedSeconds();
  const activeIdx = Math.max(
    0,
    BUILD_PHASES.findIndex((p) => p.key === build.phase),
  );

  return (
    <div className="px-5 py-4">
      <div className="rounded-pill border border-accent/30 bg-accent/5 p-4">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 animate-[livePulse_1s_ease-in-out_infinite] rounded-full bg-accent" />
          <span className="font-medium text-[13px] text-text">
            Building the Evidence Ledger…
          </span>
          <span className="ml-auto font-mono text-[11px] text-muted-2">
            {elapsed}s
          </span>
        </div>
        {build.detail ? (
          <p className="mt-2 text-[12.5px] text-muted">{build.detail}</p>
        ) : null}
        <ol className="mt-3 grid gap-1.5">
          {BUILD_PHASES.map((phase, i) => (
            <li
              key={phase.key}
              className="flex items-center gap-2 text-[12.5px]"
            >
              <PhaseDot
                state={
                  i < activeIdx ? "done" : i === activeIdx ? "active" : "todo"
                }
              />
              <span className={i <= activeIdx ? "text-text" : "text-muted-2"}>
                {phase.label}
              </span>
            </li>
          ))}
        </ol>
        {typeof total === "number" && total > 0 ? (
          <p className="mt-3 text-[11.5px] text-muted-2">
            {extracted ?? 0}/{total} document(s) extracted
          </p>
        ) : null}
      </div>
    </div>
  );
}

function PhaseDot({ state }: { state: "done" | "active" | "todo" }) {
  if (state === "done") {
    return <span className="text-[12px] text-ok">✓</span>;
  }
  if (state === "active") {
    return (
      <span className="inline-block h-2 w-2 animate-[livePulse_1s_ease-in-out_infinite] rounded-full bg-accent" />
    );
  }
  return <span className="inline-block h-2 w-2 rounded-full bg-border" />;
}

function LockedLedger({ ingestionComplete }: { ingestionComplete: boolean }) {
  return (
    <div className="rounded-pill border border-border-soft bg-panel-2 p-4 text-[13px] text-muted">
      {ingestionComplete ? <LedgerPending /> : <WaitingForIngestion />}
    </div>
  );
}

function LedgerPending() {
  return (
    <>
      <p className="text-text">Ingestion complete. Ledger lane pending.</p>
      <p className="mt-1.5 text-[12.5px] text-muted">
        The extractor reads documents + statutes and emits typed nodes (Fact /
        Party / Vehicle / Event / Statute / …) plus typed edges (mentioned_in /
        corroborates / contradicts / attributed_to / …). Once that lane writes{" "}
        <span className="font-mono">ledger_complete=true</span>, the Argument
        Room opens.
      </p>
    </>
  );
}

function WaitingForIngestion() {
  return (
    <>
      <p className="text-text">Waiting for ingestion to finish.</p>
      <p className="mt-1.5 text-[12.5px] text-muted">
        Every uploaded document needs its text extracted before the ledger lane
        can build the graph.
      </p>
    </>
  );
}
