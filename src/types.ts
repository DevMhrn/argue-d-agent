import { z } from 'zod';

/** A single grounded fact. Everything downstream may only argue over these. */
export const FactSchema = z.object({
  id: z.string(), // e.g. "F1"
  statement: z.string(),
  source: z.string(), // e.g. "police_report.pdf p.2"
  confidence: z.number().min(0).max(1),
});
export type Fact = z.infer<typeof FactSchema>;

export const EvidenceLedgerSchema = z.object({
  caseId: z.string(),
  facts: z.array(FactSchema),
});
export type EvidenceLedger = z.infer<typeof EvidenceLedgerSchema>;

/** Raw claim input handed to Lumen. */
export interface ClaimInput {
  caseId: string;
  insured: string; // our policyholder (Driver A)
  otherParty: string; // at-fault target (Driver B)
  jurisdiction: string; // e.g. "CA"
  damagesUsd: number;
  documents: { name: string; kind: string; text: string }[];
}

export interface Statute {
  id: string; // e.g. "CA-1431.2"
  jurisdiction: string;
  title: string;
  text: string;
}

export const IntakeSchema = z.object({
  parties: z.object({ insured: z.string(), otherParty: z.string() }),
  date: z.string(),
  location: z.string(),
  damagesUsd: z.number(),
});
export type Intake = z.infer<typeof IntakeSchema>;

/** A cited argumentative point. citations must reference known fact/statute ids. */
export const PointSchema = z.object({
  claim: z.string(),
  citations: z.array(z.string()),
});
export type Point = z.infer<typeof PointSchema>;

export const PointsSchema = z.object({ points: z.array(PointSchema) });

export const RebuttalSchema = z.object({
  responses: z.array(
    z.object({
      stance: z.enum(['rebut', 'concede']),
      claim: z.string(),
      citations: z.array(z.string()),
    }),
  ),
});

export const DecisionSchema = z.object({
  faultTable: z.array(
    z.object({
      factId: z.string(),
      favors: z.enum(['us', 'them', 'neutral']),
      weight: z.number(),
    }),
  ),
  otherDriverFaultPct: z.number().min(0).max(100),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
});
export type Decision = z.infer<typeof DecisionSchema>;

export interface FinalDecision extends Decision {
  recoveryUsd: number;
  escalate: boolean;
  escalateReasons: string[];
  nearFiftyFifty: boolean;
}
