import { ClaimInput, EvidenceLedger } from './types';

export interface FactGateResult {
  ok: boolean;
  violations: string[];
}

/**
 * The fact gate. CODE, not a prompt — anchors the Evidence Ledger to verifiable
 * source text. Without this, the ledger is just an LLM summary; everything
 * built on top of it (debate, adjudication, letter) inherits any silent
 * extraction error.
 *
 * Rule: every fact MUST carry a `verbatimQuote` that is a contiguous substring
 * of the cited source document's text. We normalize whitespace and case for the
 * substring check (models reformat trivially), but otherwise the quote must
 * appear as-is. Sources are matched by filename prefix so an attribution like
 * "police_report.pdf p.2 ¶3" still resolves to the police_report.pdf document.
 *
 * Mirrors the Citation Gate in spirit: a single function the LLM cannot bypass.
 */
export function checkLedgerAnchoring(ledger: EvidenceLedger, claim: ClaimInput): FactGateResult {
  const docs = claim.documents.map((d) => ({ name: d.name, normText: normalize(d.text) }));
  const violations: string[] = [];

  for (const fact of ledger.facts) {
    const label = `[${fact.id}] (${truncate(fact.statement)})`;

    if (!fact.verbatimQuote || fact.verbatimQuote.trim().length === 0) {
      violations.push(`${label} has no verbatimQuote — every fact must anchor to a source substring.`);
      continue;
    }

    const matchingDoc = docs.find((d) => fact.source.startsWith(d.name));
    if (!matchingDoc) {
      violations.push(`${label} source "${fact.source}" does not match any input document.`);
      continue;
    }

    const normQuote = normalize(fact.verbatimQuote);
    if (!matchingDoc.normText.includes(normQuote)) {
      violations.push(
        `${label} verbatimQuote not found in ${matchingDoc.name}: "${truncate(fact.verbatimQuote, 80)}"`,
      );
    }
  }

  return { ok: violations.length === 0, violations };
}

function normalize(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

function truncate(s: string, n = 48): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}
