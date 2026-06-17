import 'dotenv/config';

export type ProviderName = 'aimlapi' | 'featherless';

export interface ProviderConfig {
  baseURL: string;
  apiKey: string | undefined;
  envKey: string;
  label: string;
}

export const PROVIDERS: Record<ProviderName, ProviderConfig> = {
  aimlapi: {
    baseURL: process.env.AIMLAPI_BASE_URL ?? 'https://api.aimlapi.com/v1',
    apiKey: process.env.AIMLAPI_API_KEY || undefined,
    envKey: 'AIMLAPI_API_KEY',
    label: 'AI/ML API (frontier)',
  },
  featherless: {
    baseURL: process.env.FEATHERLESS_BASE_URL ?? 'https://api.featherless.ai/v1',
    apiKey: process.env.FEATHERLESS_API_KEY || undefined,
    envKey: 'FEATHERLESS_API_KEY',
    label: 'Featherless (open-source)',
  },
};

/**
 * Default model id per agent. These are PLACEHOLDERS — confirm the exact ids in
 * each provider's model catalog before running live. They don't matter in mock mode.
 */
export const MODELS = {
  intake: process.env.MODEL_INTAKE ?? 'meta-llama/Meta-Llama-3.1-8B-Instruct',
  evidence: process.env.MODEL_EVIDENCE ?? 'Qwen/Qwen2.5-72B-Instruct',
  advocate: process.env.MODEL_ADVOCATE ?? 'claude-3-opus',
  opposing: process.env.MODEL_OPPOSING ?? 'gpt-4o',
  adjudicator: process.env.MODEL_ADJUDICATOR ?? 'claude-3-5-sonnet',
  /** Second, independent adjudicator on a different model family (OSS). */
  adjudicator_b: process.env.MODEL_ADJUDICATOR_B ?? 'meta-llama/Meta-Llama-3.1-70B-Instruct',
  /** Source-Alignment Verifier — high-volume textual alignment, OSS fits well. */
  verifier: process.env.MODEL_VERIFIER ?? 'Qwen/Qwen2.5-72B-Instruct',
  drafter: process.env.MODEL_DRAFTER ?? 'claude-3-5-sonnet',
} as const;

export const ESCALATE_USD = Number(process.env.ESCALATE_USD ?? 25000);

// Below these, pursuing the recovery isn't worth the cost → recommend DECLINE.
export const PURSUE_MIN_USD = Number(process.env.PURSUE_MIN_USD ?? 2500);
export const PURSUE_MIN_FAULT_PCT = Number(process.env.PURSUE_MIN_FAULT_PCT ?? 25);
