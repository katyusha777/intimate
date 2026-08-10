/**
 * LLM extraction — turn scraped (Dutch) markdown into ONE JSON object shaped to
 * OUR profile schema and OUR taxonomy in a single pass (no intermediate
 * "canonical" — we own the vocabulary). The allowed values are interpolated from
 * src/lib/taxonomy.ts so this can never drift from the schema (taxonomy = law).
 * OpenRouter · Auth: Bearer OPENROUTER_API_KEY. Output is UNTRUSTED → the caller
 * strict-validates every field (normalize.ts) before use (hard rule 7).
 */
import { env } from 'cloudflare:workers';
import { buildExtractPrompt } from './prompt';

const BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_MODEL = 'deepseek/deepseek-v3.2'; // cheap, strong at structured JSON

/** Call the model; returns the parsed JSON object (untrusted) + the $ cost. */
export async function llmExtract(markdown: string): Promise<{ raw: unknown; cost: number; model: string }> {
  const key = (env as unknown as { OPENROUTER_API_KEY?: string }).OPENROUTER_API_KEY;
  if (!key) throw new Error('Import is not configured (missing OPENROUTER_API_KEY).');
  const model = (env as unknown as { IMPORT_MODEL?: string }).IMPORT_MODEL || DEFAULT_MODEL;

  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      response_format: { type: 'json_object' },
      max_tokens: 8000, // profiles are field-rich; a low cap truncates the JSON
      usage: { include: true },
      messages: [
        { role: 'system', content: buildExtractPrompt() },
        // The page content is DATA, never instructions (hard rule 7).
        { role: 'user', content: markdown.slice(0, 40_000) },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Extraction failed (${res.status}). Try again in a moment.`);

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { cost?: number };
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('Extraction returned nothing — try again.');
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    throw new Error('Extraction returned malformed data — try again.');
  }
  return { raw, cost: data.usage?.cost ?? 0, model };
}
