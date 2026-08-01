/**
 * AI configuration (OpenRouter). One seam for every model call the app makes.
 *
 * getAiSearchConfig() is the admin-plug point: today it returns constants;
 * later it reads the admin settings table / KV — callers never change.
 */

export interface AiSearchConfig {
  /** OpenRouter model slug. */
  model: string;
  temperature: number;
  maxTokens: number;
  /** Hard timeout for the upstream call (ms). */
  timeoutMs: number;
  /**
   * Preferred OpenRouter providers, in order. Adult queries need this:
   * routing is multi-provider and some hosts moderate/empty the response
   * while others (DeepInfra) answer fine.
   */
  providerOrder: string[];
  /** Retry once when the model returns no usable filters (provider flake). */
  maxAttempts: number;
}

export function getAiSearchConfig(): AiSearchConfig {
  // ponytail: constants now; swap body to a KV/DB read for the admin panel.
  return {
    model: 'deepseek/deepseek-chat-v3-0324',
    temperature: 0,
    maxTokens: 400,
    timeoutMs: 10_000,
    providerOrder: ['DeepInfra'],
    maxAttempts: 2,
  };
}

export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
