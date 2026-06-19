"use client";

import { useEffect, useState } from "react";
import type { EdgeRow, NodeRow } from "@/lib/types";
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
}

const NODE_TONE: Record<NodeRow["type"], string> = {
  Fact: "border-agent-evidence/50 bg-agent-evidence/10 text-agent-evidence",
  Party: "border-agent-advocate/50 bg-agent-advocate/10 text-agent-advocate",
  Vehicle: "border-agent-intake/50 bg-agent-intake/10 text-agent-intake",
  Event: "border-warn/50 bg-warn/10 text-warn",
  Location: "border-muted/50 bg-panel-3 text-muted",
  Statute: "border-gold/50 bg-gold/10 text-gold",
  Damage: "border-bad/50 bg-bad/10 text-bad",
  Document: "border-accent/50 bg-accent/10 text-accent",
};

/**
 * Read-only ledger graph viewer.
 *
 * Three states:
 *   - "Locked: waiting for ingestion" (ingestion_complete=false)
 *   - "Locked: ledger lane pending"   (ingestion_complete=true, ledger_complete=false)
 *   - "Locked & ready"                (ledger_complete=true) — shows nodes + edges
 *
 * The "Locked" framing is deliberate — once built, the ledger is the single
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
}: Props) {
  // "Building" covers: an active build (initial or rebuild), AND the brief
  // window where the build reports "done" but the full graph hasn't been
  // refetched yet (build present + !hasLedger) — without this the panel flashes
  // the "Locked" block for a split second before showing "Built".
  const building = build != null && (build.phase !== "done" || !hasLedger);
  return (
    <section className="flex min-h-70 flex-1 flex-col overflow-hidden rounded-card border border-border bg-panel shadow-card">
      <div className="shrink-0 border-border-soft border-b px-5 pt-5 pb-3">
        <LedgerHeader
          hasLedger={hasLedger}
          nodes={nodes}
          edges={edges}
          building={building}
        />
      </div>
      <div className="flex-1 overflow-auto px-5 py-4">
        <LedgerContent
          hasLedger={hasLedger}
          nodes={nodes}
          edges={edges}
          ingestionComplete={ingestionComplete}
          build={build}
          extracted={extracted}
          total={total}
          building={building}
        />
      </div>
    </section>
  );
}

function LedgerHeader({
  hasLedger,
  nodes,
  edges,
  building,
}: Pick<Props, "hasLedger" | "nodes" | "edges"> & { building: boolean }) {
  return (
    <header className="flex items-baseline justify-between gap-3">
      <div>
        <h3 className="font-semibold text-base tracking-tight">
          Evidence Ledger
        </h3>
        <p className="mt-0.5 text-[12px] text-muted">
          The locked graph of typed facts + relationships. Every Fact carries a
          verbatim quote anchored to its source page.
        </p>
      </div>
      <LedgerBadge
        hasLedger={hasLedger}
        nodes={nodes}
        edges={edges}
        building={building}
      />
    </header>
  );
}

function LedgerBadge({
  hasLedger,
  nodes,
  edges,
  building,
}: Pick<Props, "hasLedger" | "nodes" | "edges"> & { building: boolean }) {
  if (hasLedger) {
    return (
      <span className="rounded-full border border-ok/40 bg-ok/10 px-2.5 py-0.5 text-[10.5px] text-ok uppercase tracking-wider">
        Built · {nodes.length} nodes / {edges.length} edges
      </span>
    );
  }
  if (building) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-2.5 py-0.5 text-[10.5px] text-accent uppercase tracking-wider">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
        Building
      </span>
    );
  }
  return (
    <span className="rounded-full border border-warn/40 bg-warn/10 px-2.5 py-0.5 text-[10.5px] text-warn uppercase tracking-wider">
      Locked
    </span>
  );
}

function LedgerContent({
  hasLedger,
  nodes,
  edges,
  ingestionComplete,
  build,
  extracted,
  total,
  building,
}: Props & { building: boolean }) {
  // Live build view takes priority — covers the initial build, a rebuild on an
  // already-complete case, AND the brief done-but-not-yet-loaded window (so the
  // panel never flashes "Locked" before "Built").
  if (building && build) {
    return <BuildingLedger build={build} extracted={extracted} total={total} />;
  }
  if (hasLedger) {
    if (nodes.length === 0) {
      return (
        <p className="text-[13px] text-muted">
          Ledger marked complete, but no nodes yet.
        </p>
      );
    }
    return <LedgerSections nodes={nodes} edges={edges} />;
  }
  return <LockedLedger ingestionComplete={ingestionComplete} />;
}

const BUILD_PHASES: { key: string; label: string }[] = [
  { key: "extracting", label: "Extracting the typed evidence graph" },
  { key: "anchoring", label: "Validating fact anchors to sources" },
  { key: "writing", label: "Writing nodes + edges to the ledger" },
  { key: "done", label: "Ledger locked" },
];

function useElapsedSeconds(): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(timer);
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
    <div className="rounded-pill border border-accent/30 bg-accent/5 p-4">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
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
          <li key={phase.key} className="flex items-center gap-2 text-[12.5px]">
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
  );
}

function PhaseDot({ state }: { state: "done" | "active" | "todo" }) {
  if (state === "done") {
    return <span className="text-[12px] text-ok">✓</span>;
  }
  if (state === "active") {
    return (
      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" />
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
        Gowtham&apos;s extractor reads documents + statutes and emits typed
        nodes (Fact / Party / Vehicle / Event / Statute / …) plus typed edges
        (mentioned_in / corroborates / contradicts / attributed_to / …). Once
        that lane writes <span className="font-mono">ledger_complete=true</span>
        , the Argument Room opens.
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

function LedgerSections({ nodes, edges }: Pick<Props, "nodes" | "edges">) {
  const facts = nodes.filter((n) => n.type === "Fact");
  const otherNodes = nodes.filter((n) => n.type !== "Fact");

  return (
    <div className="space-y-4">
      <FactsSection facts={facts} />
      <OtherNodesSection nodes={otherNodes} />
      <EdgesSection edges={edges} />
    </div>
  );
}

function FactsSection({ facts }: { facts: NodeRow[] }) {
  if (facts.length === 0) return null;

  return (
    <div>
      <div className="mb-1.5 text-[11px] text-muted-2 uppercase tracking-wider">
        Facts ({facts.length})
      </div>
      <ul className="grid gap-2">
        {facts.map((node) => (
          <FactNode key={node.id} node={node} />
        ))}
      </ul>
    </div>
  );
}

function FactNode({ node }: { node: NodeRow }) {
  return (
    <li className="rounded-pill border border-border-soft bg-panel-2 p-2.5">
      <div className="flex items-baseline gap-2">
        <span
          className={`shrink-0 rounded-full border px-1.5 py-0.5 font-mono text-[10.5px] ${NODE_TONE.Fact}`}
        >
          {node.node_id}
        </span>
        <span className="text-[13px]">{factStatement(node)}</span>
      </div>
      <FactQuote quote={node.verbatim_quote} />
    </li>
  );
}

function factStatement(node: NodeRow): string {
  return (node.props.statement as string | undefined) ?? "(unstated)";
}

function FactQuote({ quote }: { quote: string | null }) {
  if (!quote) return null;

  return (
    <blockquote className="mt-1.5 border-border border-l-2 pl-2 font-mono text-[11px] text-muted italic">
      &ldquo;{quote}&rdquo;
    </blockquote>
  );
}

function OtherNodesSection({ nodes }: { nodes: NodeRow[] }) {
  if (nodes.length === 0) return null;

  return (
    <div>
      <div className="mb-1.5 text-[11px] text-muted-2 uppercase tracking-wider">
        Other nodes ({nodes.length})
      </div>
      <ul className="flex flex-wrap gap-1.5">
        {nodes.map((node) => (
          <OtherNode key={node.id} node={node} />
        ))}
      </ul>
    </div>
  );
}

function OtherNode({ node }: { node: NodeRow }) {
  return (
    <li
      className={`rounded-md border px-2 py-1 text-[11.5px] ${NODE_TONE[node.type]}`}
    >
      <span className="font-mono">{node.node_id}</span>
      <span className="ml-1.5 opacity-70">· {node.type}</span>
    </li>
  );
}

function EdgesSection({ edges }: { edges: EdgeRow[] }) {
  if (edges.length === 0) return null;

  return (
    <details className="rounded-pill border border-border-soft bg-panel-2">
      <summary className="cursor-pointer px-3 py-2 font-medium text-[12px] text-text">
        Edges ({edges.length})
      </summary>
      <ul className="space-y-0.5 px-3 pb-2 font-mono text-[11px] text-muted">
        {edges.map((edge) => (
          <li key={edge.id}>
            {edge.edge_id} · {edge.type}
          </li>
        ))}
      </ul>
    </details>
  );
}
