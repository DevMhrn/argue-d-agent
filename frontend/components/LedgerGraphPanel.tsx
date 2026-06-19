"use client";

import type { EdgeRow, NodeRow } from "@/lib/types";

interface Props {
  hasLedger: boolean;
  nodes: NodeRow[];
  edges: EdgeRow[];
  ingestionComplete: boolean;
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
}: Props) {
  return (
    <section className="flex min-h-70 flex-1 flex-col overflow-hidden rounded-card border border-border bg-panel shadow-card">
      <div className="shrink-0 border-border-soft border-b px-5 pt-5 pb-3">
        <LedgerHeader hasLedger={hasLedger} nodes={nodes} edges={edges} />
      </div>
      <div className="flex-1 overflow-auto px-5 py-4">
        <LedgerContent
          hasLedger={hasLedger}
          nodes={nodes}
          edges={edges}
          ingestionComplete={ingestionComplete}
        />
      </div>
    </section>
  );
}

function LedgerHeader({
  hasLedger,
  nodes,
  edges,
}: Pick<Props, "hasLedger" | "nodes" | "edges">) {
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
      <LedgerBadge hasLedger={hasLedger} nodes={nodes} edges={edges} />
    </header>
  );
}

function LedgerBadge({
  hasLedger,
  nodes,
  edges,
}: Pick<Props, "hasLedger" | "nodes" | "edges">) {
  if (!hasLedger) {
    return (
      <span className="rounded-full border border-warn/40 bg-warn/10 px-2.5 py-0.5 text-[10.5px] text-warn uppercase tracking-wider">
        Locked
      </span>
    );
  }

  return (
    <span className="rounded-full border border-ok/40 bg-ok/10 px-2.5 py-0.5 text-[10.5px] text-ok uppercase tracking-wider">
      Built · {nodes.length} nodes / {edges.length} edges
    </span>
  );
}

function LedgerContent({ hasLedger, nodes, edges, ingestionComplete }: Props) {
  if (!hasLedger) {
    return <LockedLedger ingestionComplete={ingestionComplete} />;
  }
  if (nodes.length === 0) {
    return (
      <p className="text-[13px] text-muted">
        Ledger marked complete, but no nodes yet.
      </p>
    );
  }
  return <LedgerSections nodes={nodes} edges={edges} />;
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
