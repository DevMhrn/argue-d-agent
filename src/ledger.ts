import { EvidenceLedger, Statute } from './types';

/** The set of citation ids the gate will accept: every fact id + every statute id. */
export function validCitationIds(ledger: EvidenceLedger, statutes: Statute[]): Set<string> {
  const ids = new Set<string>();
  for (const f of ledger.facts) ids.add(f.id);
  for (const s of statutes) ids.add(s.id);
  return ids;
}

/** Compact, model-friendly rendering of the ledger for inclusion in prompts. */
export function renderLedger(ledger: EvidenceLedger): string {
  return ledger.facts
    .map((f) => `[${f.id}] ${f.statement}  (source: ${f.source}; confidence ${f.confidence})`)
    .join('\n');
}

export function renderStatutes(statutes: Statute[]): string {
  return statutes
    .map((s) => `[${s.id}] ${s.title} (${s.jurisdiction})\n"""${s.text.trim()}"""`)
    .join('\n\n');
}
