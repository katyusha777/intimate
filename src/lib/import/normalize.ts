/**
 * Normalize the UNTRUSTED LLM extraction into a guaranteed-valid
 * Partial<ProfileEdit> (the trust boundary — hard rule 7). Every controlled
 * field is checked against the taxonomy; anything unrecognised is dropped and
 * reported in `warnings` so the preview can be honest ("skipped 2 services").
 * Identity she owns — name and birthDate — is never imported (she enters her
 * real DOB during onboarding; the 21+ gate depends on it).
 *
 * Pure (no env / no I/O) so it's unit-testable against a fixture.
 */
import {
  ALL_SERVICES, AMENITIES, APPEARANCES, AVAILABLE_FOR, BODY_TYPES, BREAST_TYPES, CITY_SLUGS, CUP_SIZES,
  DAYS, DRINKING, EYE_COLORS, GENDERS, HAIR_COLORS, HAIR_LENGTHS, INCALL_LOCATIONS, LANGUAGES,
  MEETING_TYPES, NUMERIC_RANGES, PAYMENT_METHODS, PIERCINGS, PUBIC_HAIR, RATE_DURATIONS, SMOKING,
  TATTOOS,
} from '@/lib/taxonomy';
import { ProfileEditSchema, type ProfileEdit } from '@/app/models/account';

export interface ImportResult {
  fields: Partial<ProfileEdit>;
  warnings: string[];
}


export function normalizeImported(raw: unknown, now: Date = new Date()): ImportResult {
  const warnings: string[] = [];
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  const str = (v: unknown, max: number): string | undefined => {
    if (typeof v !== 'string') return undefined;
    const s = v.trim();
    return s ? s.slice(0, max) : undefined;
  };
  const int = (v: unknown, min: number, max: number, label: string): number | undefined => {
    const n = typeof v === 'number' ? v : typeof v === 'string' ? parseInt(v, 10) : NaN;
    if (!Number.isFinite(n)) return undefined;
    const i = Math.round(n);
    if (i < min || i > max) {
      warnings.push(`Ignored out-of-range ${label} (${i})`);
      return undefined;
    }
    return i;
  };
  const oneOf = (v: unknown, allowed: readonly string[], label: string): string | undefined => {
    if (v == null) return undefined;
    const s = String(v).trim().toLowerCase();
    if (allowed.includes(s)) return s;
    if (s) warnings.push(`Couldn't match ${label} "${s}"`);
    return undefined;
  };
  const subsetOf = (v: unknown, allowed: readonly string[], label: string, max = 99): string[] => {
    if (!Array.isArray(v)) return [];
    const kept: string[] = [];
    let dropped = 0;
    for (const item of v) {
      const s = String(item).trim().toLowerCase();
      if (allowed.includes(s)) {
        if (!kept.includes(s)) kept.push(s);
      } else if (s) dropped++;
    }
    if (dropped) warnings.push(`Skipped ${dropped} unrecognised ${label}`);
    return kept.slice(0, max);
  };
  const setArr = (key: string, arr: string[]) => {
    if (arr.length) out[key] = arr;
  };
  const setVal = (key: string, v: unknown) => {
    if (v !== undefined) out[key] = v;
  };

  // Enums
  setVal('gender', oneOf(r.gender, GENDERS, 'gender'));
  setVal('city', oneOf(r.city, CITY_SLUGS, 'city'));
  setVal('bodyType', oneOf(r.bodyType, BODY_TYPES, 'body type'));
  setVal('hairColor', oneOf(r.hairColor, HAIR_COLORS, 'hair colour'));
  setVal('hairLength', oneOf(r.hairLength, HAIR_LENGTHS, 'hair length'));
  setVal('eyeColor', oneOf(r.eyeColor, EYE_COLORS, 'eye colour'));
  setVal('cupSize', oneOf(r.cupSize, CUP_SIZES, 'cup size'));
  setVal('breastType', oneOf(r.breastType, BREAST_TYPES, 'breast type'));
  setVal('pubicHair', oneOf(r.pubicHair, PUBIC_HAIR, 'pubic hair'));
  setVal('appearance', oneOf(r.appearance, APPEARANCES, 'appearance'));
  setVal('smoking', oneOf(r.smoking, SMOKING, 'smoking'));
  setVal('drinking', oneOf(r.drinking, DRINKING, 'drinking'));
  setVal('tattoos', oneOf(r.tattoos, TATTOOS, 'tattoos'));
  setVal('piercings', oneOf(r.piercings, PIERCINGS, 'piercings'));

  // Arrays (taxonomy-filtered)
  setArr('services', subsetOf(r.services, ALL_SERVICES, 'services', 20));
  setArr('meetingTypes', subsetOf(r.meetingTypes, MEETING_TYPES, 'visit types'));
  setArr('languages', subsetOf(r.languages, LANGUAGES, 'languages', 12));
  setArr('incallLocations', subsetOf(r.incallLocations, INCALL_LOCATIONS, 'incall locations'));
  setArr('amenities', subsetOf(r.amenities, AMENITIES, 'amenities'));
  setArr('paymentMethods', subsetOf(r.paymentMethods, PAYMENT_METHODS, 'payment methods'));
  setArr('availableFor', subsetOf(r.availableFor, AVAILABLE_FOR, 'available-for'));

  // Numbers
  setVal('heightCm', int(r.heightCm, NUMERIC_RANGES.height_cm.min, NUMERIC_RANGES.height_cm.max, 'height'));
  setVal('weightKg', int(r.weightKg, NUMERIC_RANGES.weight_kg.min, NUMERIC_RANGES.weight_kg.max, 'weight'));
  setVal('shoeSizeEu', int(r.shoeSizeEu, NUMERIC_RANGES.shoe_size_eu.min, NUMERIC_RANGES.shoe_size_eu.max, 'shoe size'));

  // Nationality: ISO 3166-1 alpha-2 (lowercase, free set — not enumerated)
  const nat = typeof r.nationality === 'string' ? r.nationality.trim().toLowerCase() : '';
  if (/^[a-z]{2}$/.test(nat)) out.nationality = nat;

  // Contact + text
  setVal('phone', str(r.phone, 30));
  setVal('whatsapp', str(r.whatsapp, 30));
  setVal('telegram', str(r.telegram, 40));
  setVal('instagram', str(r.instagram, 40));
  setVal('description', str(r.description, 1000));
  setVal('depositPolicy', str(r.depositPolicy, 200));
  setVal('extrasNote', str(r.extrasNote, 200));

  // Rates: keep rows with (duration OR label) AND (incall OR outcall)
  if (Array.isArray(r.rates)) {
    const rows: Array<Record<string, unknown>> = [];
    let dropped = 0;
    for (const row of r.rates.slice(0, 24)) {
      if (!row || typeof row !== 'object') continue;
      const rr = row as Record<string, unknown>;
      const duration = oneOf(rr.duration, RATE_DURATIONS, 'rate duration');
      const label = str(rr.label, 60);
      const incall = int(rr.incall, 1, 100000, 'incall price');
      const outcall = int(rr.outcall, 1, 100000, 'outcall price');
      if ((duration || label) && (incall !== undefined || outcall !== undefined)) {
        const clean: Record<string, unknown> = {};
        if (duration) clean.duration = duration;
        else if (label) clean.label = label;
        if (incall !== undefined) clean.incall = incall;
        if (outcall !== undefined) clean.outcall = outcall;
        rows.push(clean);
      } else dropped++;
    }
    if (dropped) warnings.push(`Skipped ${dropped} incomplete rate row(s)`);
    if (rows.length) out.rates = rows;
  }

  // Opening hours: only real weekday keys, coerced to the DayHours shape
  if (r.openingHours && typeof r.openingHours === 'object') {
    const oh: Record<string, unknown> = {};
    for (const [day, val] of Object.entries(r.openingHours as Record<string, unknown>)) {
      const d = day.trim().toLowerCase().slice(0, 3);
      if (!DAYS.includes(d as (typeof DAYS)[number]) || !val || typeof val !== 'object') continue;
      const dv = val as Record<string, unknown>;
      oh[d] = {
        closed: dv.closed === true,
        allDay: dv.allDay === true,
        from: typeof dv.from === 'string' ? dv.from.trim().slice(0, 5) : '',
        to: typeof dv.to === 'string' ? dv.to.trim().slice(0, 5) : '',
      };
    }
    if (Object.keys(oh).length) out.openingHours = oh;
  }

  // Date availability (kimnl-style calendars): ISO keys within today..+60d —
  // past/far dates are noise; times must be real HH:MM or they become ''.
  if (r.availabilityDates && typeof r.availabilityDates === 'object') {
    const dayMs = 86_400_000;
    const min = now.toISOString().slice(0, 10);
    const max = new Date(now.getTime() + 60 * dayMs).toISOString().slice(0, 10);
    const hhmm = (v: unknown): string => (typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v.trim()) ? v.trim() : '');
    const ad: Record<string, unknown> = {};
    let dropped = 0;
    for (const [key, val] of Object.entries(r.availabilityDates as Record<string, unknown>).slice(0, 90)) {
      const k = key.trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || !val || typeof val !== 'object') continue;
      if (k < min || k > max) {
        dropped++;
        continue;
      }
      const dv = val as Record<string, unknown>;
      ad[k] = { available: dv.available === true, from: hhmm(dv.from), to: hhmm(dv.to) };
    }
    if (dropped) warnings.push(`Skipped ${dropped} past/far availability date(s)`);
    if (Object.keys(ad).length) out.availabilityDates = ad;
  }

  return finalGate(out, warnings);
}

// ---------------------------------------------------------------------------
// Agency-crawl pickers (used by src/lib/import/agency.ts) — pure, same trust
// boundary: LLM output in, validated values out.
// ---------------------------------------------------------------------------

/** Untrusted URL list → clean absolute same-site URLs (subdomains of the base
 *  host allowed, base page excluded) — the LLM must not send us elsewhere.
 *  "Same site" anchors on the base HOSTNAME (minus a leading www.), never on a
 *  guessed apex: slicing the last two labels would make a .co.uk base accept
 *  every domain under co.uk. */
function sameSiteUrls(arr: unknown, baseUrl: string, cap: number): string[] {
  if (!Array.isArray(arr)) return [];
  const base = new URL(baseUrl);
  const site = base.hostname.replace(/^www\./, '');
  const out: string[] = [];
  for (const item of arr.slice(0, 200)) {
    if (typeof item !== 'string') continue;
    let u: URL;
    try {
      u = new URL(item, base);
    } catch {
      continue;
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') continue;
    if (u.hostname !== site && !u.hostname.endsWith(`.${site}`)) continue;
    u.hash = '';
    const href = u.href;
    if (href === base.href || out.includes(href)) continue;
    out.push(href);
    if (out.length >= cap) break;
  }
  return out;
}

/** Untrusted {profileUrls} from discovery → clean absolute same-site URLs. */
export function pickProfileUrls(raw: unknown, baseUrl: string): string[] {
  return sameSiteUrls((raw as { profileUrls?: unknown })?.profileUrls, baseUrl, 100);
}

/** Untrusted {nextPageUrls} (roster pagination) → same-site URLs, small cap. */
export function pickPaginationUrls(raw: unknown, baseUrl: string): string[] {
  return sameSiteUrls((raw as { nextPageUrls?: unknown })?.nextPageUrls, baseUrl, 10);
}

/** Untrusted agency-extraction extras → validated identity + photo URLs. */
export function pickAgencyExtras(raw: unknown): { name?: string; age?: number; photoUrls: string[] } {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 40) : undefined;
  const ageN = typeof r.age === 'number' ? Math.round(r.age) : typeof r.age === 'string' ? parseInt(r.age, 10) : NaN;
  const age = Number.isFinite(ageN) && ageN >= 18 && ageN <= 80 ? ageN : undefined;
  const photoUrls: string[] = [];
  if (Array.isArray(r.photoUrls)) {
    for (const p of r.photoUrls.slice(0, 30)) {
      if (typeof p !== 'string') continue;
      try {
        const u = new URL(p);
        if (u.protocol !== 'https:' && u.protocol !== 'http:') continue;
        if (!photoUrls.includes(u.href)) photoUrls.push(u.href);
      } catch {
        /* relative/garbage URL — drop */
      }
      if (photoUrls.length >= 12) break;
    }
  }
  return { name, age, photoUrls };
}

/** WordPress (and most CMS) resize convention: `foo-400x517.jpg` is a generated
 *  thumbnail; the full original lives at `foo.jpg` — the `-WIDTHxHEIGHT` suffix
 *  right before the extension is the only marker, so stripping it is a pure,
 *  site-agnostic transform (no probing). Returns null when there is no such
 *  suffix (already an original), so callers can tell "de-resized" from "as-is".
 *  `-scaled`/other WP markers are deliberately left alone. */
export function originalImageUrl(url: string): string | null {
  // Match only the query-less path so `?w=400` etc. never gets mistaken for a size.
  const m = url.match(/^(https?:\/\/[^?#]*?)-\d{2,4}x\d{2,4}(\.(?:jpe?g|png|webp|avif|gif))(\?[^#]*)?(#.*)?$/i);
  return m ? `${m[1]}${m[2]}${m[3] ?? ''}${m[4] ?? ''}` : null;
}

function finalGate(out: Record<string, unknown>, warnings: string[]): ImportResult {
  // Final gate: guarantee validity so the downstream save can't reject the whole
  // patch over one bad field — drop offending top-level keys and re-parse.
  let candidate: Record<string, unknown> = out;
  for (let i = 0; i < 3; i++) {
    const parsed = ProfileEditSchema.partial().safeParse(candidate);
    if (parsed.success) return { fields: parsed.data, warnings };
    const bad = new Set(parsed.error.issues.map((is) => String(is.path[0])).filter(Boolean));
    if (!bad.size) break;
    bad.forEach((k) => warnings.push(`Dropped invalid ${k}`));
    candidate = Object.fromEntries(Object.entries(candidate).filter(([k]) => !bad.has(k)));
  }
  return { fields: {}, warnings };
}
