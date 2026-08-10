/**
 * LLM extraction — turn scraped (Dutch) markdown into ONE JSON object shaped to
 * OUR profile schema and OUR taxonomy in a single pass (no intermediate
 * "canonical" — we own the vocabulary). The allowed values are interpolated from
 * src/lib/taxonomy.ts so this can never drift from the schema (taxonomy = law).
 * OpenRouter · Auth: Bearer OPENROUTER_API_KEY. Output is UNTRUSTED → the caller
 * strict-validates every field (normalize.ts) before use (hard rule 7).
 */
import { env } from 'cloudflare:workers';
import {
  ALL_SERVICES, AMENITIES, APPEARANCES, AVAILABLE_FOR, BODY_TYPES, BREAST_TYPES, CITIES, CUP_SIZES,
  DRINKING, EYE_COLORS, GENDERS, HAIR_COLORS, HAIR_LENGTHS, INCALL_LOCATIONS, LANGUAGES,
  MEETING_TYPES, PAYMENT_METHODS, PIERCINGS, PUBIC_HAIR, RATE_DURATIONS, SMOKING, TATTOOS,
} from '@/lib/taxonomy';

const BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_MODEL = 'deepseek/deepseek-v3.2'; // cheap, strong at structured JSON

const list = (a: readonly string[]) => a.join(', ');

/** The extraction contract. Built from the taxonomy so the model only ever sees
 *  values our schema accepts. */
function buildPrompt(): string {
  return `You extract ONE Dutch adult-services (escort) profile from scraped page markdown into a single JSON object for a Netherlands directory. Translate ALL free text to natural English. Map every controlled field to EXACTLY one of the allowed values below; if nothing fits, omit it (use null / []). Never invent data. Prices are integers in EUR. Output ONLY the JSON object.

Output keys (use null or [] when unknown):
{
  "gender": one of [${list(GENDERS)}] or null,
  "city": the nearest Dutch city SLUG from [${list(CITIES.map((c) => c.slug))}] or null,
  "services": array (max 20) of [${list(ALL_SERVICES)}],
  "meetingTypes": array of [${list(MEETING_TYPES)}] (incall = client visits her / private, outcall = escort / she travels, virtual = cam/phone),
  "languages": array of ISO-639-1 codes from [${list(LANGUAGES)}],
  "incallLocations": array of [${list(INCALL_LOCATIONS)}],
  "amenities": array of [${list(AMENITIES)}],
  "paymentMethods": array of [${list(PAYMENT_METHODS)}],
  "availableFor": array of [${list(AVAILABLE_FOR)}],
  "bodyType": one of [${list(BODY_TYPES)}] or null,
  "hairColor": one of [${list(HAIR_COLORS)}] or null,
  "hairLength": one of [${list(HAIR_LENGTHS)}] or null,
  "eyeColor": one of [${list(EYE_COLORS)}] or null,
  "cupSize": one of [${list(CUP_SIZES)}] or null,
  "breastType": one of [${list(BREAST_TYPES)}] or null,
  "pubicHair": one of [${list(PUBIC_HAIR)}] or null,
  "appearance": ethnic look, one of [${list(APPEARANCES)}] or null,
  "nationality": ISO-3166-1 alpha-2 lowercase (e.g. "nl", "ro") or null,
  "heightCm": integer or null, "weightKg": integer or null, "shoeSizeEu": integer or null,
  "smoking": one of [${list(SMOKING)}] or null,
  "drinking": one of [${list(DRINKING)}] or null,
  "tattoos": one of [${list(TATTOOS)}] or null,
  "piercings": one of [${list(PIERCINGS)}] or null,
  "phone": string or null, "whatsapp": string or null, "telegram": string or null, "instagram": string or null,
  "rates": array of { "duration": one of [${list(RATE_DURATIONS)}] or null, "label": short custom label or null, "incall": integer EUR or null, "outcall": integer EUR or null }
           (map "30 min"->min_30, "1 uur"->hour_1, "90 min"->min_90, "2 uur"->hour_2, "nacht"->overnight, "weekend"->weekend; set incall/outcall from the section: Prive/Thuisontvangst=incall, Escort=outcall; a row needs a duration OR label AND at least one price),
  "openingHours": object with only the weekdays shown, each { "closed": bool, "allDay": bool, "from": "HH:MM", "to": "HH:MM" } (24-hour times; "24 uur"->allDay true; a closed day -> closed true),
  "description": her profile text translated to natural English (max ~800 chars) or null,
  "depositPolicy": deposit/booking terms in English or null,
  "extrasNote": short note on extras/surcharges in English or null
}`;
}

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
        { role: 'system', content: buildPrompt() },
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
