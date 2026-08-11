/**
 * The extraction contract — pure (no env), built from the taxonomy so the model
 * only ever sees values our schema accepts (taxonomy = law, can't drift). Kept
 * separate from extract.ts (which is env-bound) so it stays testable.
 */
import {
  ALL_SERVICES, AMENITIES, APPEARANCES, AVAILABLE_FOR, BODY_TYPES, BREAST_TYPES, CITIES, CUP_SIZES,
  DRINKING, EYE_COLORS, GENDERS, HAIR_COLORS, HAIR_LENGTHS, INCALL_LOCATIONS, LANGUAGES,
  MEETING_TYPES, PAYMENT_METHODS, PIERCINGS, PUBIC_HAIR, RATE_DURATIONS, SMOKING, TATTOOS,
} from '@/lib/taxonomy';

const list = (a: readonly string[]) => a.join(', ');

export function buildExtractPrompt(opts: { agency?: boolean } = {}): string {
  // Agency crawl (src/lib/crawl.ts): nobody types identity/photos in by hand,
  // so the extraction must carry them. Self-service NEVER gets these keys —
  // she owns her identity (normalize.ts header).
  const agencyKeys = opts.agency
    ? `
  "name": her display/working name exactly as shown (first name or alias, no titles) or null,
  "age": her age in years as an integer, as listed on the page, or null,
  "photoUrls": array (max 12) of absolute URLs of HER photos on this page — pick the largest/original variants; exclude logos, icons, banners, thumbnails of OTHER people,`
    : '';
  return `You extract ONE Dutch adult-services (escort) profile from scraped page markdown into a single JSON object for a Netherlands directory. Translate ALL free text to natural English. Map every controlled field to EXACTLY one of the allowed values below; if nothing fits, omit it (use null / []). Never invent data. Prices are integers in EUR. Output ONLY the JSON object.

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
  "openingHours": object with only the weekdays shown, each { "closed": bool, "allDay": bool, "from": "HH:MM", "to": "HH:MM" } (24-hour times; "24 uur"->allDay true; a closed day -> closed true),
  "description": her profile text translated to natural English (max ~800 chars) or null,
  "depositPolicy": deposit/booking terms in English or null,
  "extrasNote": short note on extras/surcharges in English or null
}`;
}
