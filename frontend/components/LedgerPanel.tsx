"use client";

import {
  type LedgerEdge,
  type LedgerNode,
  LedgerView,
} from "@/components/LedgerGraphPanel";
import type { LegacyClaim } from "@/lib/types";

interface Props {
  claim: LegacyClaim | null;
  ledgerText?: string | null;
  /** node_id of the fact a citation click is pointing at — gets accent + ringPulse/glow. */
  highlightFact?: string | null;
}

/**
 * Evidence Ledger panel for the DEMO path (the static `LegacyClaim` shape).
 *
 * The demo claim has no extracted typed graph, so we derive a small,
 * on-theme ledger from the claim metadata: the two Parties, the Damages line,
 * and one Document node per attached file. This renders through the same
 * shared `LedgerView` (List / Graph toggle, LOCKED chip, count line) the DB
 * path uses, so both surfaces match the comp.
 */
export function LedgerPanel({
  claim,
  ledgerText,
  highlightFact = null,
}: Props) {
  if (!claim) {
    return (
      <aside className="flex h-full flex-col overflow-hidden rounded-card border border-border bg-panel shadow-(--shadow-card)">
        <div className="flex shrink-0 items-center gap-2.5 border-border-soft border-b px-4 py-3">
          <h3 className="font-semibold text-[13px] tracking-tight">
            Evidence Ledger
          </h3>
        </div>
        <p className="px-5 py-4 text-[13px] text-muted">Loading case…</p>
      </aside>
    );
  }

  const { nodes, edges } = deriveLedger(claim);

  return (
    <aside className="flex h-full flex-col overflow-hidden rounded-card border border-border bg-panel shadow-(--shadow-card)">
      <LedgerView nodes={nodes} edges={edges} highlightFact={highlightFact} />
      {ledgerText ? (
        <div className="shrink-0 border-border-soft border-t px-3.5 py-3 font-mono text-[11px] text-muted leading-relaxed">
          {ledgerText}
        </div>
      ) : null}
    </aside>
  );
}

/**
 * Project a `LegacyClaim` into the shared ledger view model. No Facts/quotes
 * exist for demo claims, so this surfaces Parties, the Damages line, and the
 * documents on file, with "relates" edges from each party to the damages.
 */
function deriveLedger(claim: LegacyClaim): {
  nodes: LedgerNode[];
  edges: LedgerEdge[];
} {
  const nodes: LedgerNode[] = [
    {
      id: "P1",
      type: "Party",
      statement: `${claim.insured} — our insured (claimant).`,
      quote: null,
      source: null,
      confidence: null,
    },
    {
      id: "P2",
      type: "Party",
      statement: `${claim.otherParty} — other party.`,
      quote: null,
      source: null,
      confidence: null,
    },
    {
      id: "L1",
      type: "Location",
      statement: `Jurisdiction — ${claim.jurisdiction}.`,
      quote: null,
      source: null,
      confidence: null,
    },
    {
      id: "D1",
      type: "Damage",
      statement: `Total claimed damages — $${Number(
        claim.damagesUsd,
      ).toLocaleString("en-US")}.`,
      quote: null,
      source: null,
      confidence: null,
    },
  ];

  claim.documents.forEach((d, i) => {
    nodes.push({
      id: `DOC${i + 1}`,
      type: "Document",
      statement: d.filename ? `${d.kind} — ${d.filename}` : d.kind,
      quote: null,
      source: null,
      confidence: null,
    });
  });

  const edges: LedgerEdge[] = [
    { key: "P1-D1", fromId: "P1", toId: "D1", kind: "relates" },
    { key: "P2-D1", fromId: "P2", toId: "D1", kind: "relates" },
  ];

  return { nodes, edges };
}
