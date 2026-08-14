/**
 * The extraction SCHEMA CONTRACT — pure (no env), built from the taxonomy so
 * the model only ever sees values our schema accepts (taxonomy = law, can't
 * drift). Kept separate from extract.ts (which is env-bound) so it's testable.
 *
 * SITE-NEUTRAL BY LAW (decision 2026-08-14, tested by tests/import-prompt.test.ts):
 * this file describes only OUR output shape — the JSON keys and allowed values,
 * identical for every source site because normalize.ts and the DB are identical
 * for every site. Everything about how a SPECIFIC provider's site expresses
 * these fields (its schedule widget's wording, whose phone appears on a page,
 * menu naming, age conventions, URL structure) lives in that org's SITE PROMPT
 * (`orgs.site_prompt` — one per provider, admin-edited) appended verbatim via
 * withSitePrompt(). A new provider is a DB row, never a change here: no site
 * names, no site vocabulary, no per-site flags or conditionals, ever.
 */
import {
  ALL_SERVICES, AMENITIES, APPEARANCES, AVAILABLE_FOR, BODY_TYPES, BREAST_TYPES, CITIES, CUP_SIZES,
  DRINKING, EYE_COLORS, GENDERS, HAIR_COLORS, HAIR_LENGTHS, INCALL_LOCATIONS, LANGUAGES,
  MEETING_TYPES, PAYMENT_METHODS, PIERCINGS, PUBIC_HAIR, RATE_DURATIONS, SMOKING, TATTOOS,
} from '@/lib/taxonomy';

const list = (a: readonly string[]) => a.join(', ');

/**
 * Append a provider's site prompt (orgs.site_prompt — admin-authored, trusted
 * config, not code) to a crawl prompt. Dumb concatenation by design: the
 * pipeline never inspects a site prompt's content. The scraped page itself
 * stays data-never-instructions (hard rule 7); this block is the operator.
 */
export function withSitePrompt(prompt: string, sitePrompt?: string): string {
  const n = sitePrompt?.trim();
  return n
    ? `${prompt}\n\nSITE-SPECIFIC INSTRUCTIONS for this provider (admin-authored, trusted — they describe how THIS site expresses the fields above and take precedence over generic interpretation):\n${n.slice(0, 4000)}`
    : prompt;
}

export function buildExtractPrompt(opts: { agency?: boolean; sitePrompt?: string; today?: string } = {}): string {
  // Agency crawl (app/data/db/crawl.ts): nobody types identity/photos in by
  // hand, so the extraction must carry them. Self-service NEVER gets these
  // keys — she owns her identity (normalize.ts header).
  const agencyKeys = opts.agency
    ? `
  "name": her display/working name exactly as shown (first name or alias, no titles) or null,
  "age": her age in years as an integer ONLY when the page lists a number — NEVER estimate from words, or null,
  "ageText": her age EXACTLY as written on the page when it is words rather than a number, else null,
  "photoUrls": array (max 12) of absolute URLs of HER photos on this page — pick the largest/original variants; exclude logos, icons, banners, thumbnails of OTHER people,`
    : '';
  return withSitePrompt(`${opts.today ? `Today is ${opts.today}. ` : ''}You extract ONE Dutch adult-services profile from scraped page markdown into a single JSON object for a Netherlands directory. Translate ALL free text to natural English. Map every controlled field to EXACTLY one of the allowed values below; if nothing fits, omit it (use null / []). Never invent data. Prices are integers in EUR. Output ONLY the JSON object.

Output keys (use null or [] when unknown):
{${agencyKeys}
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
  "openingHours": object with only the weekdays shown, each { "closed": bool, "allDay": bool, "from": "HH:MM", "to": "HH:MM" } (24-hour times; a closed day -> closed true) — ONLY for weekly recurring schedules,
  "availabilityDates": ONLY when the site instructions describe a per-DATE schedule: object keyed by ISO date "YYYY-MM-DD" (infer the year from today's date), each { "available": bool, "from": "HH:MM" or "", "to": "HH:MM" or "" }, covering every date the page shows; null when the schedule is weekly or absent,
  "description": her profile text translated to natural English (max ~800 chars) or null,
  "depositPolicy": deposit/booking terms in English or null,
  "extrasNote": short note on extras/surcharges in English or null
}`, opts.sitePrompt);
}
