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

/** Call the model; returns the parsed JSON object (untrusted) + the $ cost.
 *  `systemPrompt` overrides the default profile-extraction contract (agency
 *  crawl passes its own variants — discovery, agency extraction). */
export async function llmExtract(
  markdown: string,
  systemPrompt?: string,
): Promise<{ raw: unknown; cost: number; model: string }> {
  const key = (env as unknown as { OPENROUTER_API_KEY?: string }).OPENROUTER_API_KEY;
  if (!key) throw new Error('Import is not configured (missing OPENROUTER_API_KEY).');
  const model = (env as unknown as { IMPORT_MODEL?: string }).IMPORT_MODEL || DEFAULT_MODEL;
  const system = systemPrompt ?? buildExtractPrompt();
  // Page content is DATA, never instructions (hard rule 7). Cap high enough for
  // the classic (server-rendered) pages, which run large.
  const user = markdown.slice(0, 60_000);

  // The failure mode "malformed data" is intermittent: OpenRouter can route
  // deepseek to a provider that ignores response_format and returns prose /
  // code-fenced JSON / nothing. Force a JSON-capable provider, strip fences
  // defensively, and retry a couple of times before surfacing an error.
  let cost = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        response_format: { type: 'json_object' },
        provider: { require_parameters: true }, // only providers that honor json_object
        max_tokens: 12_000, // field-rich profiles; a low cap truncates the JSON
        usage: { include: true },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    if (!res.ok) continue; // transient (429/5xx/overloaded) — retry
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
      usage?: { cost?: number };
    };
    cost += data.usage?.cost ?? 0;
    const choice = data.choices?.[0];
    if (choice?.finish_reason === 'length') continue; // truncated → invalid JSON, retry
    const content = choice?.message?.content?.trim();
    if (!content) continue;
    // Strip ```json … ``` fences some providers add despite response_format.
    const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    try {
      return { raw: JSON.parse(cleaned), cost, model };
    } catch {
      // fall through to retry
    }
  }
  throw new Error('Extraction returned malformed data — try again.');
}
