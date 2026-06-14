import { PROVIDERS, ProviderName } from './config';
import { mockChat } from './mockResponses';

/** Decide whether to run without network. Default: mock when no keys are set. */
export function isMock(): boolean {
  if (process.env.LUMEN_MOCK === '1') return true;
  if (process.env.LUMEN_MOCK === '0') return false;
  return !PROVIDERS.aimlapi.apiKey && !PROVIDERS.featherless.apiKey;
}

// Lazily created OpenAI-compatible clients, one per provider.
const clients: Partial<Record<ProviderName, any>> = {};

async function clientFor(provider: ProviderName): Promise<any> {
  if (!clients[provider]) {
    const cfg = PROVIDERS[provider];
    if (!cfg.apiKey) {
      throw new Error(`Missing ${cfg.envKey}. Set it in .env, or run in mock mode (leave keys blank).`);
    }
    const { default: OpenAI } = await import('openai');
    clients[provider] = new OpenAI({ baseURL: cfg.baseURL, apiKey: cfg.apiKey });
  }
  return clients[provider];
}

export interface ChatOptions {
  provider: ProviderName;
  model: string;
  system: string;
  user: string;
  temperature?: number;
  json?: boolean;
  /** Stable key the mock backend uses to return canned content for this step. */
  mockKey: string;
}

/**
 * One call to a model. In mock mode this returns deterministic canned content
 * (keyed by mockKey) so the whole pipeline runs with no keys and no network.
 * Both providers are OpenAI-compatible, so the real path is identical.
 */
export async function chat(opts: ChatOptions): Promise<string> {
  if (isMock()) return mockChat(opts.mockKey);

  const client = await clientFor(opts.provider);
  const res = await client.chat.completions.create({
    model: opts.model,
    temperature: opts.temperature ?? 0.2,
    messages: [
      { role: 'system', content: opts.system },
      { role: 'user', content: opts.user },
    ],
    ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
  });
  return res.choices?.[0]?.message?.content ?? '';
}
