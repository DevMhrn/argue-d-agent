import { Point } from './types';

export interface GateResult {
  ok: boolean;
  violations: string[];
}

/**
 * The citation gate. This is CODE, not a prompt — it is the hard guarantee that
 * no agent can assert a factual point without pointing at real evidence.
 *
 * Rule: every point must carry >= 1 citation, and every citation must resolve to
 * a known fact id (F*) or statute id. A failing message is rejected and sent back
 * for a redo. This is also where Band's "room rules" / governance would live.
 */
export function checkPoints(points: Point[], validIds: Set<string>): GateResult {
  const violations: string[] = [];
  points.forEach((p, i) => {
    const label = `point #${i + 1} ("${truncate(p.claim)}")`;
    if (!p.citations || p.citations.length === 0) {
      violations.push(`${label} has NO citation — every claim must cite evidence.`);
      return;
    }
    for (const c of p.citations) {
      if (!validIds.has(c)) {
        violations.push(`${label} cites unknown id [${c}] — not in the evidence ledger or statute store.`);
      }
    }
  });
  return { ok: violations.length === 0, violations };
}

function truncate(s: string, n = 48): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}
