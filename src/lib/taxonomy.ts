/**
 * taxonomy.ts — the single source of truth for every controlled vocabulary.
 * Location in repo: src/lib/taxonomy.ts
 *
 * Rules (see CLAUDE.md "Taxonomy = law"):
 * - DB stores these exact snake_case English values (enums / CHECK constraints).
 * - UI labels come from i18n string files, keyed `taxonomy.<group>.<value>`
 *   (e.g. taxonomy.services.girlfriend_experience) — locales: en, nl, de.
 * - The import pipeline (Firecrawl + LLM) may ONLY output these values,
 *   using SYNONYMS below as mapping hints. Unmappable input → dropped + flagged.
 * - Zod enums derive directly: z.enum(GENDERS), z.enum(ALL_SERVICES), etc.
 * - Never add values ad hoc in code: extend here + add translations + migrate.
 */

// ---------------------------------------------------------------------------
// Accounts, lifecycle & moderation states
// ---------------------------------------------------------------------------

export const ACCOUNT_TYPES = ['advertiser', 'agency', 'client', 'admin'] as const;

// --- Admin (docs/ADMIN.md §1) --------------------------------------------
/** Admin sub-roles (the `admin_role` claim). Enforced in every admin action. */
export const ADMIN_ROLES = ['moderator', 'support', 'super'] as const;

export const PROFILE_STATES = [
  'draft',
  'pending_review',
  'live',
  'paused',
  'blocked',
  'deleted', // soft delete only — never hard-delete
] as const;

export const VERIFICATION_STATES = ['unverified', 'pending', 'approved', 'rejected'] as const;

export const MEDIA_TYPES = ['photo'] as const; // 'video' post-MVP (requires Cloudflare Stream)

// --- Messaging (docs/MESSAGING.md) ---------------------------------------
/** Who may message a professional. Product law: default OFF (0.1). */
export const CONVERSATION_MODES = ['off', 'everyone', 'verified_only'] as const;
/**
 * Message kinds. 'request' (UX-PLAN 4.1) = the pre-qualified contact card a
 * client sends instead of composing cold. 'call' (VIDEO-CALLING.md) = a call
 * outcome card (missed/declined/duration) rendered from its call_sessions row.
 */
export const MESSAGE_KINDS = ['text', 'photo', 'system', 'request', 'call'] as const;

// --- Calls (docs/VIDEO-CALLING.md) ----------------------------------------
/** 1:1 WebRTC call modes — she picks when she taps; fixed for the call. */
export const CALL_MODES = ['voice', 'video'] as const;
/**
 * Call lifecycle: ringing → active → ended; ringing → declined | timeout
 * (30s no answer — renders as "missed") | failed (connection never made it).
 */
export const CALL_STATES = ['ringing', 'active', 'ended', 'declined', 'timeout', 'failed'] as const;
/**
 * Thread lifecycle. pending (UX-PLAN 4.1) = a request awaiting the
 * professional's accept/decline; accept → open, decline → closed silently.
 * frozen = professional paused messaging; blocked = mutual cut.
 */
export const THREAD_STATES = ['pending', 'open', 'frozen', 'blocked'] as const;

/** Request timing (UX-PLAN 4.2): now, tonight, or a specific opening-hours slot. */
export const REQUEST_WHEN = ['now', 'tonight', 'slot'] as const;

export const MEDIA_STATES = ['pending_review', 'approved', 'rejected'] as const;

export const REJECTION_REASONS = [
  'photo_quality',
  'photos_suspected_stolen',
  'photos_not_matching',
  'text_policy_violation',
  'incomplete_information',
  'prohibited_content',
  'duplicate_profile',
  'other',
] as const;

export const REPORT_REASONS = [
  'fake_profile',
  'stolen_photos',
  'wrong_information',
  'no_show_scam',
  'underage_suspicion', // immediate escalation
  'coercion_suspicion', // immediate escalation
  'other',
] as const;

/** Reasons that force a report to the top of the queue + the admin banner. */
export const ESCALATION_REASONS = ['underage_suspicion', 'coercion_suspicion'] as const;

export const REPORT_TARGETS = ['profile', 'message'] as const;
export const REPORT_STATES = ['open', 'resolved', 'dismissed'] as const;
/** What an admin did when resolving a report (shown in audit + to the reporter as "reviewed"). */
export const REPORT_RESOLUTIONS = ['content_removed', 'profile_blocked', 'no_action'] as const;

export const ADMIN_ACTIONS = [
  // audit_log.action values
  'approve_profile',
  'reject_profile',
  'block_profile',
  'unblock_profile',
  'delete_profile',
  'approve_media',
  'reject_media',
  'approve_verification',
  'reject_verification',
  'resolve_report',
  'dismiss_report',
  'block_account',
  'delete_account',
  'edit_profile_admin',
  'add_note',
  // queue interaction + sensitive reads (ADMIN.md §0.3, §5, §9)
  'claim_item',
  'unclaim_item',
  'escalate',
  'verification_doc_viewed',
  'thread_viewed_by_admin',
  'send_platform_message',
  // GDPR fulfilment (items.md #6/#7)
  'gdpr_export',
  // Owner-only raw-data tools (/admin/danger)
  'owner_clear_phone',
  // Admin notification config (/admin/settings)
  'set_pushover_key',
] as const;

export const IMPORT_JOB_STATES = [
  'queued',
  'scraping',
  'extracting',
  'processing_images',
  'ready_for_review',
  'confirmed',
  'failed',
] as const;

// ---------------------------------------------------------------------------
// Person attributes
// ---------------------------------------------------------------------------

export const GENDERS = ['female', 'male', 'trans_woman', 'trans_man'] as const;

export const AVAILABLE_FOR = ['men', 'women', 'couples'] as const;

export const BODY_TYPES = ['slim', 'athletic', 'average', 'curvy', 'bbw', 'muscular'] as const;

export const HAIR_COLORS = ['blonde', 'brunette', 'black', 'red', 'grey', 'colored'] as const;

export const HAIR_LENGTHS = ['short', 'medium', 'long'] as const;

export const EYE_COLORS = ['blue', 'green', 'brown', 'hazel', 'grey'] as const;

export const CUP_SIZES = ['a', 'b', 'c', 'd', 'e', 'f_plus'] as const;

export const BREAST_TYPES = ['natural', 'enhanced'] as const;

export const PUBIC_HAIR = ['shaved', 'trimmed', 'natural'] as const;

/** Self-described appearance/origin — the advertiser's own public description. */
export const APPEARANCES = [
  'west_european',
  'east_european',
  'scandinavian',
  'mediterranean',
  'latina',
  'asian',
  'african',
  'caribbean',
  'middle_eastern',
  'mixed',
] as const;

export const SMOKING = ['no', 'socially', 'yes'] as const;
export const DRINKING = ['no', 'socially', 'yes'] as const;
export const TATTOOS = ['none', 'few', 'many'] as const;
export const PIERCINGS = ['none', 'few', 'many'] as const;

/** ISO 639-1 — languages spoken (subset; extend as needed). */
export const LANGUAGES = [
  'nl', 'en', 'de', 'fr', 'es', 'it', 'pt', 'ro', 'pl', 'ru', 'uk',
  'bg', 'hu', 'cs', 'sk', 'sr', 'el', 'tr', 'ar', 'he',
  'zh', 'ja', 'ko', 'th', 'vi', 'id', 'tl', 'hi',
] as const;

/**
 * Nationality: store ISO 3166-1 alpha-2 codes (free set, not enumerated here).
 * COMMON_NATIONALITIES only orders the top of the UI picker.
 */
export const COMMON_NATIONALITIES = [
  'nl', 'de', 'be', 'ro', 'bg', 'pl', 'hu', 'cz', 'es', 'it', 'pt', 'gr',
  'ru', 'ua', 'br', 'co', 've', 'do', 'sr', 'cw', 'th', 'ph', 'cn', 'ma', 'tr',
] as const;

/** Numeric field ranges (validated in Zod + DB CHECK constraints — not enums). */
export const NUMERIC_RANGES = {
  age: { min: 18, max: 99 }, // hard floor 18 at DB level; POLICY_MIN_AGE below may raise it
  height_cm: { min: 140, max: 210 },
  weight_kg: { min: 40, max: 160 },
  shoe_size_eu: { min: 34, max: 47 },
} as const;

/**
 * Policy minimum age to advertise: 21 (NL sex-work regulation). 18 stays the
 * absolute legal-adult floor (NUMERIC_RANGES.age.min); 21 is the market gate,
 * enforced at the profiles DB CHECK + ProfileEditSchema.
 */
export const POLICY_MIN_AGE = 21;

// ---------------------------------------------------------------------------
// Meetings, rates, amenities, availability
// ---------------------------------------------------------------------------

/**
 * THE TWO ORTHOGONAL DIMENSIONS of how clients meet professionals — the
 * foundation the data model builds on. Never conflate them:
 *
 *  1. MEETING_TYPES — how you meet: incall ("private visit", client comes to
 *     her) / outcall ("escort", she comes to the client) / virtual (cam,
 *     phone, sexting — no physical meeting). A profile may offer any mix.
 *     (2026-08-06: virtual PROMOTED from a derived delivery method to a real
 *     meeting type — one "visit type" picker everywhere; the old `online`
 *     pseudo-city died with it.)
 *  2. SERVICES / SERVICE_CATEGORIES — what is offered. BDSM is a service
 *     category with subcategories, massage likewise.
 *
 * Listing tabs (LISTING_CATEGORIES) are saved filter presets ACROSS these
 * dimensions over one profile pool — never partitions a profile "belongs" to.
 */
export const MEETING_TYPES = ['incall', 'outcall', 'virtual'] as const; // profiles may offer any mix

/** Week days for opening hours (Mon-first, EU). */
export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Day = (typeof DAYS)[number];

export const INCALL_LOCATIONS = ['private_apartment', 'private_house', 'hotel', 'club'] as const;

export const AMENITIES = [
  // incall amenities — common directory filters
  'parking_available',
  'discreet_entrance',
  'shower_available',
  'drinks_available',
  'air_conditioning',
  'wheelchair_accessible',
] as const;

export const RATE_DURATIONS = [
  'min_15',
  'min_30',
  'min_45',
  'hour_1',
  'min_90',
  'hour_2',
  'hour_3',
  'hour_4',
  'dinner_date',
  'overnight',
  'weekend',
] as const;
// A rate row is { duration?: RateDuration, label?: string, incall?: int, outcall?: int }
// (a preset duration OR a free-text custom line, priced per meeting column).
// See RateRowSchema in src/app/models/profile.ts — stored as profiles.rates JSONB.

export const CURRENCIES = ['eur'] as const;

export const PAYMENT_METHODS = ['cash', 'pin', 'bank_transfer', 'tikkie', 'crypto'] as const;

export const CONTACT_CHANNELS = ['phone', 'whatsapp', 'telegram', 'signal', 'sms'] as const;

// Weekdays for opening hours live in DAYS (Mon-first, 3-letter) above — the one
// day vocabulary. Availability is profiles.opening_hours JSONB keyed by DAYS,
// each value a DayHours { closed, allDay, from 'HH:MM', to 'HH:MM' }.

// ---------------------------------------------------------------------------
// Services — canonical tags by category (tag-level naming as used industry-wide;
// human-readable labels & translations live in i18n files, never here)
// ---------------------------------------------------------------------------

export const SERVICE_CATEGORIES = [
  'companionship',
  'massage',
  'intimacy',
  'oral',
  'fetish_bdsm',
  'group',
  'virtual',
] as const;

export const SERVICES = {
  companionship: [
    'girlfriend_experience',
    'pornstar_experience',
    'dinner_date',
    'travel_companion',
    'party_companion',
    'overnight_stay',
    'striptease',
    'erotic_dance',
  ],
  massage: [
    'relaxing_massage',
    'erotic_massage',
    'body_to_body_massage',
    'nuru_massage',
    'tantra_massage',
    'four_hands_massage',
    'prostate_massage',
  ],
  intimacy: [
    'kissing',
    'french_kissing',
    'position_69',
    'multiple_positions',
    'sex_toys',
    'dirty_talk',
    'shower_together',
    'anal_sex',
    'anal_play',
    'rimming',
    'cum_on_body',
    'cum_in_mouth',
  ],
  oral: [
    'oral_with_condom',
    'oral_without_condom',
    'deep_throat',
    'oral_for_her',
  ],
  fetish_bdsm: [
    'light_bdsm',
    'domination',
    'submission',
    'role_play',
    'spanking',
    'bondage',
    'strap_on',
    'foot_fetish',
    'golden_shower',
    'latex_leather',
    'humiliation',
  ],
  group: [
    'couples',
    'duo_with_colleague',
    'threesome',
  ],
  virtual: [
    'video_call',
    'sexting',
    'custom_content',
  ],
} as const;

/**
 * Import-normalization hints: lowercase source term → canonical value.
 * Covers common acronyms + Dutch/German terms seen on source sites.
 * The LLM prompt embeds this map; extend it as unmapped terms surface
 * in the admin queue. Matching is case-insensitive, punctuation-stripped.
 */
export const SERVICE_SYNONYMS: Record<string, string> = {
  // acronyms
  'gfe': 'girlfriend_experience',
  'pse': 'pornstar_experience',
  'owo': 'oral_without_condom',
  'cim': 'cum_in_mouth',
  'cob': 'cum_on_body',
  'daty': 'oral_for_her',
  'dfk': 'french_kissing',
  'bdsm': 'light_bdsm',
  'b2b': 'body_to_body_massage',
  // english variants
  'girlfriend experience': 'girlfriend_experience',
  'dinner date': 'dinner_date',
  'overnight': 'overnight_stay',
  'travel': 'travel_companion',
  'lap dance': 'erotic_dance',
  'toys': 'sex_toys',
  'anal': 'anal_sex',
  'rimming receive': 'rimming',
  'watersports': 'golden_shower',
  'roleplay': 'role_play',
  'duo': 'duo_with_colleague',
  'trio': 'threesome',
  'cam': 'video_call',
  // dutch
  'vriendinnetje ervaring': 'girlfriend_experience',
  'tongzoenen': 'french_kissing',
  'zoenen': 'kissing',
  'standje 69': 'position_69',
  'meerdere standjes': 'multiple_positions',
  'erotische massage': 'erotic_massage',
  'lichaam tegen lichaam': 'body_to_body_massage',
  'plasseks': 'golden_shower',
  'sm': 'light_bdsm',
  'meesteres': 'domination',
  'slavin': 'submission',
  'voetfetisj': 'foot_fetish',
  'samen douchen': 'shower_together',
  'striptease': 'striptease',
  'escort voor stellen': 'couples',
  // german
  'freundin erlebnis': 'girlfriend_experience',
  'zungenkuesse': 'french_kissing',
  'rollenspiele': 'role_play',
  'natursekt': 'golden_shower',
};

// ---------------------------------------------------------------------------
// Geography — launch set (slugs are URL segments; Amsterdam first)
// ---------------------------------------------------------------------------

export const CITIES = [
  // NOTE: the 'online' pseudo-city was removed 2026-08-06 (virtual is a
  // meeting type, not a place); the DB enum keeps the orphaned value.
  { slug: 'amsterdam', name: 'Amsterdam', province: 'Noord-Holland' },
  { slug: 'rotterdam', name: 'Rotterdam', province: 'Zuid-Holland' },
  { slug: 'den-haag', name: 'Den Haag', province: 'Zuid-Holland' },
  { slug: 'utrecht', name: 'Utrecht', province: 'Utrecht' },
  { slug: 'eindhoven', name: 'Eindhoven', province: 'Noord-Brabant' },
  { slug: 'groningen', name: 'Groningen', province: 'Groningen' },
  { slug: 'tilburg', name: 'Tilburg', province: 'Noord-Brabant' },
  { slug: 'almere', name: 'Almere', province: 'Flevoland' },
  { slug: 'breda', name: 'Breda', province: 'Noord-Brabant' },
  { slug: 'nijmegen', name: 'Nijmegen', province: 'Gelderland' },
  { slug: 'apeldoorn', name: 'Apeldoorn', province: 'Gelderland' },
  { slug: 'haarlem', name: 'Haarlem', province: 'Noord-Holland' },
  { slug: 'arnhem', name: 'Arnhem', province: 'Gelderland' },
  { slug: 'enschede', name: 'Enschede', province: 'Overijssel' },
  { slug: 'amersfoort', name: 'Amersfoort', province: 'Utrecht' },
  { slug: 'zaanstad', name: 'Zaanstad', province: 'Noord-Holland' },
  { slug: 'den-bosch', name: 'Den Bosch', province: 'Noord-Brabant' },
  { slug: 'zwolle', name: 'Zwolle', province: 'Overijssel' },
  { slug: 'leiden', name: 'Leiden', province: 'Zuid-Holland' },
  { slug: 'maastricht', name: 'Maastricht', province: 'Limburg' },
  { slug: 'dordrecht', name: 'Dordrecht', province: 'Zuid-Holland' },
  { slug: 'ede', name: 'Ede', province: 'Gelderland' },
  { slug: 'alphen-aan-den-rijn', name: 'Alphen aan den Rijn', province: 'Zuid-Holland' },
  { slug: 'alkmaar', name: 'Alkmaar', province: 'Noord-Holland' },
  { slug: 'emmen', name: 'Emmen', province: 'Drenthe' },
  { slug: 'delft', name: 'Delft', province: 'Zuid-Holland' },
  { slug: 'venlo', name: 'Venlo', province: 'Limburg' },
  { slug: 'deventer', name: 'Deventer', province: 'Overijssel' },
  { slug: 'leeuwarden', name: 'Leeuwarden', province: 'Friesland' },
  { slug: 'heerlen', name: 'Heerlen', province: 'Limburg' },
] as const;

export const PROVINCES = [
  'Drenthe', 'Flevoland', 'Friesland', 'Gelderland', 'Groningen', 'Limburg',
  'Noord-Brabant', 'Noord-Holland', 'Overijssel', 'Utrecht', 'Zeeland', 'Zuid-Holland',
] as const;

// ---------------------------------------------------------------------------
// UI / query vocab
// ---------------------------------------------------------------------------

/**
 * Top-level listing categories (main nav + /service/{slug}/{city} pages).
 * Presets over one pool — `kind` names WHICH dimension each tab addresses
 * (see the dimensions doc above); `filter` is the primitive query it applies.
 * Labels via i18n keys `cat_*`.
 */
export const LISTING_CATEGORIES = [
  {
    slug: 'private-visit',
    kind: 'meeting_type',
    icon: 'house',
    filter: { meetingType: 'incall' },
    slugs: { nl: 'prive-ontvangst', en: 'private-visit', de: 'privatempfang', ro: 'vizita-privata', it: 'visita-privata' },
  },
  {
    slug: 'escort',
    kind: 'meeting_type',
    icon: 'car-side',
    filter: { meetingType: 'outcall' },
    slugs: { nl: 'escort', en: 'escort', de: 'escort', ro: 'escorte', it: 'escort' },
  },
  {
    slug: 'erotic-massage',
    kind: 'service_category',
    icon: 'spa',
    filter: { serviceCategory: 'massage' },
    slugs: { nl: 'erotische-massage', en: 'erotic-massage', de: 'erotische-massage', ro: 'masaj-erotic', it: 'massaggio-erotico' },
  },
  {
    slug: 'virtual-sex',
    kind: 'meeting_type',
    icon: 'camera-web',
    filter: { meetingType: 'virtual' },
    slugs: { nl: 'virtuele-seks', en: 'virtual-sex', de: 'virtueller-sex', ro: 'sex-virtual', it: 'sesso-virtuale' },
  },
  // BDSM tab removed 2026-08-02 — the fetish_bdsm SERVICE category stays
  // filterable in the sidebar; it just no longer owns a top-level tab/page.
] as const;

export const SORT_OPTIONS = [
  'newest',
  'recently_online',
  'price_low_high',
  'price_high_low',
] as const;

export const LOCALES = ['nl', 'en', 'de', 'ro', 'it'] as const;
export const DEFAULT_LOCALE = 'nl' as const;

export const THEMES = ['light', 'dark', 'system'] as const;

// ---------------------------------------------------------------------------
// Types & helpers
// ---------------------------------------------------------------------------

export type AccountType = (typeof ACCOUNT_TYPES)[number];
export type AdminRole = (typeof ADMIN_ROLES)[number];
export type ReportTarget = (typeof REPORT_TARGETS)[number];
export type ReportState = (typeof REPORT_STATES)[number];
export type ReportResolution = (typeof REPORT_RESOLUTIONS)[number];
export type ProfileState = (typeof PROFILE_STATES)[number];
export type VerificationState = (typeof VERIFICATION_STATES)[number];
export type MediaType = (typeof MEDIA_TYPES)[number];
export type ConversationMode = (typeof CONVERSATION_MODES)[number];
export type MessageKind = (typeof MESSAGE_KINDS)[number];
export type ThreadState = (typeof THREAD_STATES)[number];
export type CallMode = (typeof CALL_MODES)[number];
export type CallState = (typeof CALL_STATES)[number];
export type RequestWhen = (typeof REQUEST_WHEN)[number];
export type MediaState = (typeof MEDIA_STATES)[number];
export type RejectionReason = (typeof REJECTION_REASONS)[number];
export type ReportReason = (typeof REPORT_REASONS)[number];
export type AdminAction = (typeof ADMIN_ACTIONS)[number];
export type ImportJobState = (typeof IMPORT_JOB_STATES)[number];
export type Gender = (typeof GENDERS)[number];
export type AvailableFor = (typeof AVAILABLE_FOR)[number];
export type BodyType = (typeof BODY_TYPES)[number];
export type HairColor = (typeof HAIR_COLORS)[number];
export type HairLength = (typeof HAIR_LENGTHS)[number];
export type EyeColor = (typeof EYE_COLORS)[number];
export type CupSize = (typeof CUP_SIZES)[number];
export type BreastType = (typeof BREAST_TYPES)[number];
export type PubicHair = (typeof PUBIC_HAIR)[number];
export type Appearance = (typeof APPEARANCES)[number];
export type Language = (typeof LANGUAGES)[number];
export type MeetingType = (typeof MEETING_TYPES)[number];
export type IncallLocation = (typeof INCALL_LOCATIONS)[number];
export type Amenity = (typeof AMENITIES)[number];
export type RateDuration = (typeof RATE_DURATIONS)[number];
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];
export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number];
export type Service = (typeof SERVICES)[ServiceCategory][number];
export type CitySlug = (typeof CITIES)[number]['slug'];
export type Province = (typeof PROVINCES)[number];
export type SortOption = (typeof SORT_OPTIONS)[number];
export type ListingCategory = (typeof LISTING_CATEGORIES)[number];
export type ListingCategorySlug = ListingCategory['slug'];
export type Locale = (typeof LOCALES)[number];
export type Theme = (typeof THEMES)[number];

export const ALL_SERVICES = Object.values(SERVICES).flat() as readonly Service[];

export function serviceCategory(service: Service): ServiceCategory {
  for (const [category, services] of Object.entries(SERVICES)) {
    if ((services as readonly string[]).includes(service)) return category as ServiceCategory;
  }
  throw new Error(`Unknown service: ${service}`);
}
