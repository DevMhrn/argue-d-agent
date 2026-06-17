import 'dotenv/config';

export type ProviderName = 'anthropic' | 'gemini' | 'openai';

export interface ProviderConfig {
  baseURL: string;
  apiKey: string | undefined;
  envKey: string;
  label: string;
}

// Three direct providers, all via the OpenAI-compatible chat-completions surface —
// three different model families (Anthropic / Google / OpenAI), which makes the
// cross-family debate and dual-adjudicator consensus genuinely independent.
export const PROVIDERS: Record<ProviderName, ProviderConfig> = {
  anthropic: {
    baseURL: process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com/v1/',
    apiKey: process.env.ANTHROPIC_API_KEY || undefined,
    envKey: 'ANTHROPIC_API_KEY',
    label: 'Anthropic (Claude)',
  },
  gemini: {
    baseURL: process.env.GEMINI_BASE_URL ?? 'https://generativelanguage.googleapis.com/v1beta/openai/',
    apiKey: process.env.GEMINI_API_KEY || undefined,
    envKey: 'GEMINI_API_KEY',
    label: 'Google (Gemini)',
  },
  openai: {
    baseURL: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
    apiKey: process.env.OPENAI_API_KEY || undefined,
    envKey: 'OPENAI_API_KEY',
    label: 'OpenAI (GPT)',
  },
};

/**
 * Default model id per agent. Confirm exact ids in each provider's catalog before
 * running live (override via env). They don't matter in mock mode.
 */
export const MODELS = {
  intake: process.env.MODEL_INTAKE ?? 'gpt-4o-mini',
  evidence: process.env.MODEL_EVIDENCE ?? 'gemini-2.5-flash',
  advocate: process.env.MODEL_ADVOCATE ?? 'claude-opus-4-8',
  opposing: process.env.MODEL_OPPOSING ?? 'gpt-4o',
  adjudicator: process.env.MODEL_ADJUDICATOR ?? 'claude-opus-4-8',
  /** Second adjudicator — a different model family (Gemini) from Adjudicator A. */
  adjudicator_b: process.env.MODEL_ADJUDICATOR_B ?? 'gemini-2.5-pro',
  verifier: process.env.MODEL_VERIFIER ?? 'gemini-2.5-flash',
  drafter: process.env.MODEL_DRAFTER ?? 'claude-sonnet-4-6',
} as const;

export const ESCALATE_USD = Number(process.env.ESCALATE_USD ?? 25000);

// Below these, pursuing the recovery isn't worth the cost → recommend DECLINE.
export const PURSUE_MIN_USD = Number(process.env.PURSUE_MIN_USD ?? 2500);
export const PURSUE_MIN_FAULT_PCT = Number(process.env.PURSUE_MIN_FAULT_PCT ?? 25);
