import { Point, AlignmentResult, RebuttalSchema } from './types';

/**
 * A flat list of (point, factCitation) pairs ready to be sent to the
 * Source-Alignment Verifier. Statute citations are excluded — those are governed
 * by the Citation Gate's existence check; the Verifier audits FACT alignment only.
 */
export interface VerifierTask {
  pointIndex: number;
  pointSource: string;
  claim: string;
  citationId: string;
}

const FACT_ID = /^F\d+/i;

/**
 * Walks every cited claim in the debate transcript and produces one VerifierTask
 * per (point, factId) pair. Skips statute citations.
 */
export function collectVerifierTasks(args: {
  advocatePoints: Point[];
  opposingTheory: Point[];
  attackPoints: Point[];
  rebuttal: ReturnType<typeof RebuttalSchema.parse>;
}): VerifierTask[] {
  const tasks: VerifierTask[] = [];
  pushAll(args.advocatePoints, 'advocate_position', tasks);
  pushAll(args.opposingTheory, 'opposing_independent', tasks);
  pushAll(args.attackPoints, 'opposing_attack', tasks);
  // Rebuttal items have the same {claim, citations} shape, plus a stance.
  args.rebuttal.responses.forEach((r, i) => {
    for (const c of r.citations) {
      if (FACT_ID.test(c)) {
        tasks.push({
          pointIndex: i,
          pointSource: `advocate_rebuttal:${r.stance}`,
          claim: r.claim,
          citationId: c,
        });
      }
    }
  });
  return tasks;
}

function pushAll(points: Point[], source: string, out: VerifierTask[]): void {
  points.forEach((p, i) => {
    for (const c of p.citations) {
      if (FACT_ID.test(c)) {
        out.push({ pointIndex: i, pointSource: source, claim: p.claim, citationId: c });
      }
    }
  });
}

export interface VerifierSummary {
  total: number;
  supported: number;
  contradicted: number;
  overreach: number;
  neutral: number;
  contradictedDetails: AlignmentResult[];
  overreachDetails: AlignmentResult[];
}

export function summarizeAlignment(results: AlignmentResult[]): VerifierSummary {
  const summary: VerifierSummary = {
    total: results.length,
    supported: 0,
    contradicted: 0,
    overreach: 0,
    neutral: 0,
    contradictedDetails: [],
    overreachDetails: [],
  };
  for (const r of results) {
    if (r.alignment === 'supported') summary.supported++;
    else if (r.alignment === 'contradicted') {
      summary.contradicted++;
      summary.contradictedDetails.push(r);
    } else if (r.alignment === 'overreach') {
      summary.overreach++;
      summary.overreachDetails.push(r);
    } else summary.neutral++;
  }
  return summary;
}
