import { Decision } from './types';

export interface MathGateResult {
  ok: boolean;
  computedPct: number;
  statedPct: number;
  delta: number;
  violation?: string;
}

/**
 * The math gate. This is CODE, not a prompt — the second hard guarantee in the harness.
 *
 * The Adjudicator outputs a faultTable AND a final otherDriverFaultPct. Both are
 * model-produced and LLMs are unreliable at arithmetic. The gate independently
 * computes the percentage implied by the table and rejects answers whose stated
 * percentage does not follow from their own table.
 *
 * Convention (matches the Adjudicator prompt and DecisionSchema):
 *   favors: 'us'      → fact points at the OTHER driver being at fault
 *                        (i.e. it raises otherDriverFaultPct)
 *   favors: 'them'    → fact points at OUR insured being at fault
 *                        (i.e. it lowers otherDriverFaultPct)
 *   favors: 'neutral' → no contribution
 *
 * Tolerance: ±10pp. LLMs aren't great at exact ratios, and the table is a
 * coarse instrument; we only want to catch table/percentage disagreement that
 * is clearly inconsistent, not nitpick rounding.
 */
export function checkAdjudicatorMath(decision: Decision, tolerance = 10): MathGateResult {
  let weightForOtherDriver = 0;
  let weightForOurInsured = 0;
  for (const row of decision.faultTable) {
    if (row.favors === 'us') weightForOtherDriver += row.weight;
    else if (row.favors === 'them') weightForOurInsured += row.weight;
  }
  const total = weightForOtherDriver + weightForOurInsured;
  const computed = total === 0 ? 50 : Math.round((weightForOtherDriver / total) * 100);
  const stated = decision.otherDriverFaultPct;
  const delta = Math.abs(computed - stated);
  if (delta > tolerance) {
    return {
      ok: false,
      computedPct: computed,
      statedPct: stated,
      delta,
      violation: `Math gate: fault table implies ${computed}% but Adjudicator stated ${stated}% (delta ${delta}pp > tolerance ${tolerance}pp).`,
    };
  }
  return { ok: true, computedPct: computed, statedPct: stated, delta };
}
