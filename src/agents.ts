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

export const AGENTS = {
  intake: {
    name: 'Intake Parser',
    role: 'Extract the incident facts from the claim',
    provider: 'featherless',
    model: MODELS.intake,
    system: P.INTAKE_PROMPT,
    color: 245,
  },
  evidence: {
    name: 'Evidence Aggregator',
    role: 'Build the grounded Evidence Ledger',
    provider: 'featherless',
    model: MODELS.evidence,
    system: P.EVIDENCE_PROMPT,
    color: 109,
  },
  advocate: {
    name: 'Liability Advocate',
    role: 'Argue our insured is owed recovery',
    provider: 'aimlapi',
    model: MODELS.advocate,
    system: P.ADVOCATE_PROMPT,
    color: 39,
  },
  opposing: {
    name: 'Opposing-Carrier Red Team',
    role: 'Attack our case like the other insurer',
    provider: 'aimlapi',
    model: MODELS.opposing,
    system: P.OPPOSING_PROMPT,
    color: 203,
  },
  adjudicator: {
    name: 'Adjudicator',
    role: 'Neutrally set fault % and recovery',
    provider: 'aimlapi',
    model: MODELS.adjudicator,
    system: P.ADJUDICATOR_PROMPT,
    color: 178,
  },
  drafter: {
    name: 'Demand Letter Drafter',
    role: 'Write the formal demand letter',
    provider: 'aimlapi',
    model: MODELS.drafter,
    system: P.DRAFTER_PROMPT,
    color: 141,
  },
} satisfies Record<string, AgentDef>;

export type AgentKey = keyof typeof AGENTS;
