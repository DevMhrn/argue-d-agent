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
export function LedgerGraphPanel({ hasLedger, nodes, edges, ingestionComplete }: Props) {
  const facts = nodes.filter((n) => n.type === "Fact");
  const otherNodes = nodes.filter((n) => n.type !== "Fact");

  return (
    <section className="rounded-[14px] border border-border bg-panel p-5 shadow-card">
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold tracking-tight">Evidence Ledger</h3>
          <p className="mt-0.5 text-[12px] text-muted">
            The locked graph of typed facts + relationships. Every Fact carries a
            verbatim quote anchored to its source page.
          </p>
        </div>
        {hasLedger ? (
          <span className="rounded-full border border-ok/40 bg-ok/10 px-2.5 py-0.5 text-[10.5px] uppercase tracking-wider text-ok">
            Built · {nodes.length} nodes / {edges.length} edges
          </span>
        ) : (
          <span className="rounded-full border border-warn/40 bg-warn/10 px-2.5 py-0.5 text-[10.5px] uppercase tracking-wider text-warn">
            Locked
          </span>
        )}
      </header>

      {!hasLedger ? (
        <div className="rounded-[9px] border border-border-soft bg-panel-2 p-4 text-[13px] text-muted">
          {ingestionComplete ? (
            <>
              <p className="text-text">Ingestion complete. Ledger lane pending.</p>
              <p className="mt-1.5 text-[12.5px] text-muted">
                Gowtham&apos;s extractor reads documents + statutes and emits typed
                nodes (Fact / Party / Vehicle / Event / Statute / …) plus typed
                edges (mentioned_in / corroborates / contradicts / attributed_to / …).
                Once that lane writes <span className="font-mono">ledger_complete=true</span>,
                the Argument Room opens.
              </p>
            </>
          ) : (
            <>
              <p className="text-text">Waiting for ingestion to finish.</p>
              <p className="mt-1.5 text-[12.5px] text-muted">
                Every uploaded document needs its text extracted before the
                ledger lane can build the graph.
              </p>
            </>
          )}
        </div>
      ) : nodes.length === 0 ? (
        <p className="text-[13px] text-muted">Ledger marked complete, but no nodes yet.</p>
      ) : (
        <div className="space-y-4">
          {facts.length > 0 ? (
            <div>
              <div className="mb-1.5 text-[11px] uppercase tracking-wider text-muted-2">
                Facts ({facts.length})
              </div>
              <ul className="grid gap-2">
                {facts.map((n) => (
                  <li
                    key={n.id}
                    className="rounded-[9px] border border-border-soft bg-panel-2 p-2.5"
                  >
                    <div className="flex items-baseline gap-2">
                      <span
                        className={`shrink-0 rounded-full border px-1.5 py-0.5 font-mono text-[10.5px] ${NODE_TONE.Fact}`}
                      >
                        {n.node_id}
                      </span>
                      <span className="text-[13px]">
                        {(n.props.statement as string) ?? "(unstated)"}
                      </span>
                    </div>
                    {n.verbatim_quote ? (
                      <blockquote className="mt-1.5 border-l-2 border-border pl-2 font-mono text-[11px] italic text-muted">
                        &ldquo;{n.verbatim_quote}&rdquo;
                      </blockquote>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {otherNodes.length > 0 ? (
            <div>
              <div className="mb-1.5 text-[11px] uppercase tracking-wider text-muted-2">
                Other nodes ({otherNodes.length})
              </div>
              <ul className="flex flex-wrap gap-1.5">
                {otherNodes.map((n) => (
                  <li
                    key={n.id}
                    className={`rounded-[6px] border px-2 py-1 text-[11.5px] ${NODE_TONE[n.type]}`}
                  >
                    <span className="font-mono">{n.node_id}</span>
                    <span className="ml-1.5 opacity-70">· {n.type}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {edges.length > 0 ? (
            <details className="rounded-[9px] border border-border-soft bg-panel-2">
              <summary className="cursor-pointer px-3 py-2 text-[12px] font-medium text-text">
                Edges ({edges.length})
              </summary>
              <ul className="space-y-0.5 px-3 pb-2 font-mono text-[11px] text-muted">
                {edges.map((e) => (
                  <li key={e.id}>
                    {e.edge_id} · {e.type}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      )}
    </section>
  );
}
