import { MODELS, ProviderName } from './config';
import * as P from './prompts';

export interface AgentDef {
  name: string;
  role: string;
  provider: ProviderName;
  model: string;
  system: string;
  /** Display color (ANSI 256) for the terminal transcript. */
  color: number;
}

// Provider assignment is deliberate: Advocate (Claude) debates Opposing (GPT), and
// Adjudicator A (Claude) is checked against Adjudicator B (Gemini) — different model
// families, so the consensus check is genuinely independent.
export const AGENTS = {
  intake: {
    name: 'Intake Parser',
    role: 'Extract the incident facts from the claim',
    provider: 'openai',
    model: MODELS.intake,
    system: P.INTAKE_PROMPT,
    color: 245,
  },
  evidence: {
    name: 'Evidence Aggregator',
    role: 'Build the grounded Evidence Ledger',
    provider: 'gemini',
    model: MODELS.evidence,
    system: P.EVIDENCE_PROMPT,
    color: 109,
  },
  advocate: {
    name: 'Liability Advocate',
    role: 'Argue our insured is owed recovery',
    provider: 'anthropic',
    model: MODELS.advocate,
    system: P.ADVOCATE_PROMPT,
    color: 39,
  },
  opposing: {
    name: 'Opposing-Carrier Red Team',
    role: 'Attack our case like the other insurer',
    provider: 'openai',
    model: MODELS.opposing,
    system: P.OPPOSING_PROMPT,
    color: 203,
  },
  adjudicator: {
    name: 'Adjudicator A',
    role: 'Neutrally set fault % and recovery (Claude)',
    provider: 'anthropic',
    model: MODELS.adjudicator,
    system: P.ADJUDICATOR_PROMPT,
    color: 178,
  },
  adjudicator_b: {
    name: 'Adjudicator B',
    role: 'Independent adjudicator on a different family (Gemini)',
    provider: 'gemini',
    model: MODELS.adjudicator_b,
    system: P.ADJUDICATOR_PROMPT,
    color: 214,
  },
  verifier: {
    name: 'Source-Alignment Verifier',
    role: 'Audit every cited claim against its source fact',
    provider: 'gemini',
    model: MODELS.verifier,
    system: P.VERIFIER_PROMPT,
    color: 105,
  },
  drafter: {
    name: 'Demand Letter Drafter',
    role: 'Write the formal demand letter',
    provider: 'anthropic',
    model: MODELS.drafter,
    system: P.DRAFTER_PROMPT,
    color: 141,
  },
} satisfies Record<string, AgentDef>;

export type AgentKey = keyof typeof AGENTS;
