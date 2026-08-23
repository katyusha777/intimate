/**
 * Drizzle schema — the `public` DDL (SUPABASE.md decision 7: Drizzle owns it).
 *
 * This file is the DB shape (server path: Drizzle → Hyperdrive → Postgres).
 * The Zod models in `src/app/models/*` stay the source of truth for validation
 * and the API contracts; DATA.md maps the two and the mock→prod seam. Every
 * enum here mirrors `src/lib/taxonomy.ts` (taxonomy = law) — extend there first.
 *
 * NOT in this file — drizzle/0001_security.sql owns everything drizzle-kit
 * can't express: roles, grants, RLS policies, `private.*` helpers, triggers
 * (audit append-only, message broadcast, thread touch, state stamp). Deny
 * tests: tests/rls.test.ts. See DATA.md §6 for the per-table posture.
 *
 * Relative taxonomy import (not `@/lib/taxonomy`): drizzle-kit bundles this file
 * with esbuild and does not resolve tsconfig path aliases. Type-only imports are
 * erased, so pulling jsonb shapes from app/models drags nothing into the bundle.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  ACCOUNT_TYPES,
  ADMIN_ACTIONS,
  ADMIN_ROLES,
  AMENITIES,
  APPEARANCES,
  AVAILABLE_FOR,
  BODY_TYPES,
  BREAST_TYPES,
  CALL_MODES,
  CALL_STATES,
  CITIES,
  CONVERSATION_MODES,
  CUP_SIZES,
  DRINKING,
  EYE_COLORS,
  GENDERS,
  HAIR_COLORS,
  HAIR_LENGTHS,
  IMPORT_JOB_STATES,
  INCALL_LOCATIONS,
  LANGUAGES,
  MEDIA_STATES,
  MEDIA_TYPES,
  MEETING_TYPES,
  MESSAGE_KINDS,
  PAYMENT_METHODS,
  PIERCINGS,
  PROFILE_STATES,
  PUBIC_HAIR,
  REPORT_REASONS,
  REPORT_RESOLUTIONS,
  REPORT_STATES,
  REPORT_TARGETS,
  SMOKING,
  TATTOOS,
  THREAD_STATES,
  VERIFICATION_STATES,
  VERIFICATION_DOC_KINDS,
  ALL_SERVICES,
  type CitySlug,
} from '../lib/taxonomy';
import type { DateAvailability, DayHours, RateRow } from '../app/models/profile';
import type { OrgLocation } from '../app/models/org';
import type { RequestPayload } from '../app/models/messaging';

/** Preserve literal enum values while satisfying pgEnum's `[string, ...string[]]`. */
const vals = <T extends string>(a: readonly T[]) => a as unknown as [T, ...T[]];

// ---------------------------------------------------------------------------
// Enums — every one mirrors a taxonomy vocabulary (snake_case English values).
// ---------------------------------------------------------------------------

export const accountTypeEnum = pgEnum('account_type', vals(ACCOUNT_TYPES));
export const adminRoleEnum = pgEnum('admin_role', vals(ADMIN_ROLES));
export const adminActionEnum = pgEnum('admin_action', vals(ADMIN_ACTIONS));
export const profileStateEnum = pgEnum('profile_state', vals(PROFILE_STATES));
export const verificationStateEnum = pgEnum('verification_state', vals(VERIFICATION_STATES));
export const verificationDocKindEnum = pgEnum('verification_doc_kind', vals(VERIFICATION_DOC_KINDS));
export const importJobStateEnum = pgEnum('import_job_state', vals(IMPORT_JOB_STATES));

export const genderEnum = pgEnum('gender', vals(GENDERS));
export const availableForEnum = pgEnum('available_for', vals(AVAILABLE_FOR));
export const bodyTypeEnum = pgEnum('body_type', vals(BODY_TYPES));
export const hairColorEnum = pgEnum('hair_color', vals(HAIR_COLORS));
export const hairLengthEnum = pgEnum('hair_length', vals(HAIR_LENGTHS));
export const eyeColorEnum = pgEnum('eye_color', vals(EYE_COLORS));
export const cupSizeEnum = pgEnum('cup_size', vals(CUP_SIZES));
export const breastTypeEnum = pgEnum('breast_type', vals(BREAST_TYPES));
export const pubicHairEnum = pgEnum('pubic_hair', vals(PUBIC_HAIR));
export const appearanceEnum = pgEnum('appearance', vals(APPEARANCES));
export const smokingEnum = pgEnum('smoking', vals(SMOKING));
export const drinkingEnum = pgEnum('drinking', vals(DRINKING));
export const tattoosEnum = pgEnum('tattoos', vals(TATTOOS));
export const piercingsEnum = pgEnum('piercings', vals(PIERCINGS));
export const languageEnum = pgEnum('language', vals(LANGUAGES));

// ponytail: 'online' stays in the DB enum (pseudo-city removed from taxonomy
// 2026-08-06, rows migrated off it) — dropping a pg enum value needs a type
// rebuild; the orphaned value is harmless.
export const cityEnum = pgEnum('city', vals([...CITIES.map((c) => c.slug), 'online' as CitySlug]));
export const serviceEnum = pgEnum('service', vals(ALL_SERVICES));
export const meetingTypeEnum = pgEnum('meeting_type', vals(MEETING_TYPES));
export const incallLocationEnum = pgEnum('incall_location', vals(INCALL_LOCATIONS));
export const amenityEnum = pgEnum('amenity', vals(AMENITIES));
export const paymentMethodEnum = pgEnum('payment_method', vals(PAYMENT_METHODS));

export const mediaTypeEnum = pgEnum('media_type', vals(MEDIA_TYPES));
export const mediaStateEnum = pgEnum('media_state', vals(MEDIA_STATES));

export const conversationModeEnum = pgEnum('conversation_mode', vals(CONVERSATION_MODES));
export const threadStateEnum = pgEnum('thread_state', vals(THREAD_STATES));
export const messageKindEnum = pgEnum('message_kind', vals(MESSAGE_KINDS));
/** The two sides of a thread (also messages.sender adds 'system'). */
export const partyEnum = pgEnum('party', ['professional', 'client']);
export const senderEnum = pgEnum('sender', ['professional', 'client', 'system']);
/** A CRM contact is either conversation-derived or an address-book entry. */
export const contactKindEnum = pgEnum('contact_kind', ['thread', 'manual']);

export const reportTargetEnum = pgEnum('report_target', vals(REPORT_TARGETS));
export const reportReasonEnum = pgEnum('report_reason', vals(REPORT_REASONS));
export const reportStateEnum = pgEnum('report_state', vals(REPORT_STATES));
export const reportResolutionEnum = pgEnum('report_resolution', vals(REPORT_RESOLUTIONS));

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

// ---------------------------------------------------------------------------
// Accounts — one row per auth user (accounts.id = auth.users.id BY CONVENTION,
// deliberately NO FK: GDPR erasure deletes the auth user while this row must
// survive scrubbed for audit — see 0001_security.sql header). Holds the
// supply/demand role + verification state + identity denormalized from auth
// (email/display_name/phone), written server-side at signup/change.
// ---------------------------------------------------------------------------

export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey(), // = auth.users.id (convention, no FK — header)
    accountType: accountTypeEnum('account_type').notNull(),
    adminRole: adminRoleEnum('admin_role'), // only when accountType = 'admin'
    // Denormalized from auth.users, written server-side at signup/change —
    // app_server has no auth-schema access (SUPABASE.md decision 5), and the
    // inbox/admin surfaces need email + a display name. Email nullable:
    // phone-only signups have none.
    email: text('email'),
    displayName: text('display_name'),
    phone: text('phone'),
  phoneVerifiedAt: timestamp('phone_verified_at', { withTimezone: true }),
  /** Pushover user key (admins only) — admin-event notifications (lib/pushover.ts). */
  pushoverKey: text('pushover_key'),
    idVerification: verificationStateEnum('id_verification').notNull().default('unverified'),
    verificationSubmittedAt: timestamp('verification_submitted_at', { withTimezone: true }),
    verificationReason: text('verification_reason'),
    // GDPR self-service requests (items.md #6/#7): user flags, admin fulfils
    // (deletion needs approval; export is a one-click JSON from the admin).
    deletionRequestedAt: timestamp('deletion_requested_at', { withTimezone: true }),
    dataRequestedAt: timestamp('data_requested_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('accounts_email_idx').on(t.email)],
);

// ---------------------------------------------------------------------------
// Orgs (partner agencies, ADMIN.md §8). A profile links to at most one org via
// profiles.org_id — no join table needed (roster = profiles where org_id = X;
// a professional on two agency sites yields two scraped profiles, one per org).
// Agencies have NO login yet: account_id points at a placeholder `agency`-type
// accounts row (satisfies profiles.account_id ownership; upgradeable to a real
// auth user later). Public face: /{locale}/agencies/{slug}. Crawl config powers
// the auto-import pipeline (src/lib/crawl.ts).
// ---------------------------------------------------------------------------

export const orgs = pgTable(
  'orgs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    name: text('name').notNull(),
    /** Public URL segment: /{locale}/agencies/{slug}. */
    slug: text('slug').notNull(),
    kvk: text('kvk'), // Dutch Chamber of Commerce number (nullable: unknown at onboarding)
    verified: boolean('verified').notNull().default(false),
    city: cityEnum('city').notNull(),
    /** R2 key `org/<orgId>/<uuid>` — served via /media, shown on the partner page. */
    logoKey: text('logo_key'),
    siteUrl: text('site_url'),
    contactEmail: text('contact_email'),
    contactPhone: text('contact_phone'),
    /** Physical branches (OrgLocation[]): address/phones/hours per city, shown
     *  on the agency page; a profile's branch = the entry matching its city.
     *  Empty = single-location org (city/contact_phone above are the storefront). */
    locations: jsonb('locations').$type<OrgLocation[]>().notNull().default([]),
    description: text('description').notNull().default(''),
    /** Periodic re-crawl of crawl_list_url (roster page) by the cron tick. */
    crawlEnabled: boolean('crawl_enabled').notNull().default(false),
    crawlListUrl: text('crawl_list_url'),
    /** THIS provider's extraction prompt (one per site, admin-edited):
     *  everything about how the site expresses fields — appended verbatim to
     *  the site-neutral schema contract (lib/import/prompt.ts). A new provider
     *  is a row + this text, never a code change. */
    sitePrompt: text('site_prompt'),
    /** Deterministic per-org service whitelist: imported services are filtered
     *  to this set in the crawl engine (the LLM occasionally ignores prose
     *  whitelists in the site prompt). NULL/empty = no restriction. */
    allowedServices: serviceEnum('allowed_services').array(),
    /** Re-crawl cadence for the cron tick. Schedule-bearing sites (rolling
     *  date calendars) need daily; raise for static rosters. */
    crawlIntervalHours: integer('crawl_interval_hours').notNull().default(24),
    lastCrawledAt: timestamp('last_crawled_at', { withTimezone: true }),
    /** One-line summary of the last discovery run (admin display only). */
    lastCrawlNote: text('last_crawl_note'),
    /** The §12.7 consent record (PRE-LAUNCH-GRANT-CARDONE.md): when the agency
     *  submitted the public consent form, from which IP, in which locale.
     *  contact_email holds the submitted address; the checkbox label text is
     *  versioned in git with the form. */
    consentAt: timestamp('consent_at', { withTimezone: true }),
    consentIp: text('consent_ip'),
    consentLocale: text('consent_locale'),
    createdAt: createdAt(),
  },
  (t) => [index('orgs_account_idx').on(t.accountId), uniqueIndex('orgs_slug_idx').on(t.slug)],
);

// ---------------------------------------------------------------------------
// Pre-launch leads — professionals who pre-registered on the intimate.nl
// landing page (no account, no auth). Server-only writes (app_server); zero
// browser grants. Contacted manually; table retires at launch.
// ---------------------------------------------------------------------------

export const prelaunchLeads = pgTable(
  'prelaunch_leads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    // Contact handles — advertisers fill at least one (phone/whatsapp/telegram),
    // clients none. Stored raw; the closer reaches out on whichever's given.
    phone: text('phone'),
    whatsapp: text('whatsapp'),
    telegram: text('telegram'),
    // 'advertiser' | 'client' — which pitch to open with. Agencies never land
    // here (their card routes to the dedicated /agencies/ consent flow).
    kind: text('kind'),
    locale: text('locale').notNull().default('nl'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('prelaunch_leads_email_idx').on(t.email)],
);

// ---------------------------------------------------------------------------
// Profiles — the public listing row. One flat row per profile (fast, joinless
// SSR reads). `online` is NOT stored: it comes from realtime presence, projected
// onto the read model. `price_from` is denormalized from `rates` for sort/filter.
// ---------------------------------------------------------------------------

export const profiles = pgTable(
  'profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    orgId: uuid('org_id').references(() => orgs.id),
    slug: text('slug').notNull(),
    state: profileStateEnum('state').notNull().default('draft'),
    /** When `state` last changed — anchors the 48-month verification-doc
     *  retention window (deactivation date) and dead-page 410 handling. */
    stateChangedAt: timestamp('state_changed_at', { withTimezone: true }).notNull().defaultNow(),
    name: text('name').notNull(),
    birthDate: date('birth_date').notNull(),
    /** Verbatim age text from an import source ("midden twintig") — displayed
     *  instead of the computed age when set. Never a guessed number. */
    ageDisplay: text('age_display'),
    gender: genderEnum('gender').notNull(),
    city: cityEnum('city').notNull(),

    // Trust receipts (hard rule 3) — public projection of account verification.
    verified: boolean('verified').notNull().default(false),
    idVerifiedAt: timestamp('id_verified_at', { withTimezone: true }),
    photoVerifiedAt: timestamp('photo_verified_at', { withTimezone: true }),
    featured: boolean('featured').notNull().default(false),
    /** Owner visibility modifier: still live (direct URL + messaging + calls
     *  work) but excluded from listings/search/sitemap and noindexed. */
    unlisted: boolean('unlisted').notNull().default(false),
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }),

    // Rates: order-preserving JSONB (RateRow[]); price_from is the derived min.
    priceFrom: integer('price_from'),
    rates: jsonb('rates').$type<RateRow[]>().notNull().default([]),
    phone: text('phone'),
    // Direct contact channels — open tap-to-contact buttons on the profile.
    whatsapp: text('whatsapp'),
    telegram: text('telegram'),
    instagram: text('instagram'),
    depositPolicy: text('deposit_policy'),
    extrasNote: text('extras_note'),

    // Offer dimensions (taxonomy arrays; GIN-indexed where filtered).
    services: serviceEnum('services').array().notNull().default([]),
    meetingTypes: meetingTypeEnum('meeting_types').array().notNull().default([]),
    languages: languageEnum('languages').array().notNull().default([]),
    incallLocations: incallLocationEnum('incall_locations').array().notNull().default([]),
    amenities: amenityEnum('amenities').array().notNull().default([]),
    paymentMethods: paymentMethodEnum('payment_methods').array().notNull().default([]),
    availableFor: availableForEnum('available_for').array().notNull().default([]),

    // Appearance & physical (all nullable — a sparse profile omits them).
    bodyType: bodyTypeEnum('body_type'),
    hairColor: hairColorEnum('hair_color'),
    hairLength: hairLengthEnum('hair_length'),
    eyeColor: eyeColorEnum('eye_color'),
    cupSize: cupSizeEnum('cup_size'),
    breastType: breastTypeEnum('breast_type'),
    pubicHair: pubicHairEnum('pubic_hair'),
    appearance: appearanceEnum('appearance'),
    nationality: char('nationality', { length: 2 }), // ISO 3166-1 alpha-2
    heightCm: integer('height_cm'),
    weightKg: integer('weight_kg'),
    shoeSizeEu: integer('shoe_size_eu'),
    smoking: smokingEnum('smoking'),
    drinking: drinkingEnum('drinking'),
    tattoos: tattoosEnum('tattoos'),
    piercings: piercingsEnum('piercings'),

    openingHours: jsonb('opening_hours').$type<Partial<Record<string, DayHours>>>().notNull().default({}),
    /** Per-date availability overrides ('YYYY-MM-DD' → DateAvailability):
     *  agency-style calendars (kimnl "BESCHIKBAAR/AFWEZIG per date"). A date
     *  entry beats opening_hours for that day; past keys are pruned on write. */
    availabilityDates: jsonb('availability_dates').$type<Record<string, DateAvailability>>().notNull().default({}),
    description: text('description').notNull().default(''),
    descriptionTranslations: jsonb('description_translations')
      .$type<Partial<Record<string, string>>>()
      .notNull()
      .default({}),
    // Provenance: the source URL she imported her data from (self-service import
    // or admin apply). We never persist the scraped profile itself — just this
    // pointer, so we can see where her fields came from. Null = hand-entered.
    importedFromUrl: text('imported_from_url'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('profiles_slug_idx').on(t.slug),
    index('profiles_account_idx').on(t.accountId),
    index('profiles_org_idx').on(t.orgId),
    index('profiles_state_idx').on(t.state),
    index('profiles_city_idx').on(t.city),
    index('profiles_gender_idx').on(t.gender),
    index('profiles_featured_idx').on(t.featured),
    index('profiles_last_active_idx').on(t.lastActiveAt),
    index('profiles_price_from_idx').on(t.priceFrom),
    index('profiles_services_idx').using('gin', t.services),
    // Hard rule 4: 18 is the absolute legal-adult floor; 21 = POLICY_MIN_AGE
    // (NL sex-work operating minimum). The market gate is 21 — enforced here + Zod.
    check('profiles_min_age', sql`date_part('year', age(${t.birthDate})) >= 21`),
    check('profiles_price_from_nonneg', sql`${t.priceFrom} is null or ${t.priceFrom} >= 0`),
  ],
);

// ---------------------------------------------------------------------------
// Media — one row per image (replaces the mock's photos[] / privatePhotos[]).
// Per-image review state + EXIF-stripped Cloudflare Images key (hard rule 2).
// `is_private` = her locked set, revealed per-thread (UX-PLAN 4.4).
// ---------------------------------------------------------------------------

export const media = pgTable(
  'media',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => profiles.id),
    kind: mediaTypeEnum('kind').notNull().default('photo'),
    state: mediaStateEnum('state').notNull().default('pending_review'),
    imageKey: text('image_key').notNull(), // Cloudflare Images id (never a URL/data-URL)
    isPrivate: boolean('is_private').notNull().default(false),
    position: integer('position').notNull().default(0), // gallery order
    nsfwScore: real('nsfw_score'),
    createdAt: createdAt(),
  },
  (t) => [
    index('media_profile_idx').on(t.profileId, t.position),
    // The /media takedown gate looks up by key alone (every image view).
    index('media_image_key_idx').on(t.imageKey),
  ],
);

// ---------------------------------------------------------------------------
// Verification docs (hard rule 3) — TOXIC WASTE. Metadata only; the document
// itself lives in the private EU R2 bucket. Every read is audit-logged; the
// doc is purged after retention (purge_after), state/hash/reviewer kept forever.
// ---------------------------------------------------------------------------

export const verificationDocs = pgTable(
  'verification_docs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    r2Key: text('r2_key').notNull(),
    docHash: text('doc_hash').notNull(), // proves nothing alone; the doc is the proof
    // Which of the 3 photos this is (id_front default backfills the pre-kind
    // rows, which were all plain ID shots). Admin review labels docs by this.
    kind: verificationDocKindEnum('kind').notNull().default('id_front'),
    state: verificationStateEnum('state').notNull().default('pending'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
    reviewedBy: uuid('reviewed_by'), // admin account id — no FK (defensibility, GDPR §10)
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    purgeAfter: date('purge_after'),
    // Set by the purge cron once the R2 object is deleted (hard rule 3): the
    // skeletal row (state/hash/reviewer/date) is retained forever; this marks
    // the bytes as gone so the cron never re-processes it.
    purgedAt: timestamp('purged_at', { withTimezone: true }),
  },
  (t) => [
    index('verification_docs_account_idx').on(t.accountId),
    index('verification_docs_purge_idx').on(t.purgeAfter),
  ],
);

// ---------------------------------------------------------------------------
// Messaging (MESSAGING.md). settings per profile · threads (a client×profile
// conversation) · messages · contacts (the professional's CRM: conversation
// rows + manual address-book entries, unified).
// ---------------------------------------------------------------------------

export const conversationSettings = pgTable('conversation_settings', {
  profileId: uuid('profile_id')
    .primaryKey()
    .references(() => profiles.id),
  mode: conversationModeEnum('mode').notNull().default('everyone'), // default OPEN — reachable unless she opts out (2026-08-09)
  allowCallRequests: boolean('allow_call_requests').notNull().default(true),
  screeningQuestion: text('screening_question').notNull().default(''),
});

export const threads = pgTable(
  'threads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => profiles.id),
    clientAccountId: uuid('client_account_id')
      .notNull()
      .references(() => accounts.id),
    state: threadStateEnum('state').notNull().default('open'),
    blockedBy: partyEnum('blocked_by'),
    /** "Block & delete" (items.md #1): the party who removed this (blocked)
     *  thread from their lists. Unblocking clears it. */
    hiddenBy: partyEnum('hidden_by'),
    createdAt: createdAt(),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('threads_pair_idx').on(t.profileId, t.clientAccountId), // one thread per pair
    index('threads_client_idx').on(t.clientAccountId),
  ],
);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => threads.id),
    sender: senderEnum('sender').notNull(),
    kind: messageKindEnum('kind').notNull().default('text'),
    body: text('body').notNull().default(''),
    imageKey: text('image_key'), // photo kind: Cloudflare Images id (signed on read)
    request: jsonb('request').$type<RequestPayload>(), // request kind: frozen snapshot
    callId: uuid('call_id').references(() => callSessions.id), // call kind: outcome card
    createdAt: createdAt(),
    readAt: timestamp('read_at', { withTimezone: true }),
    // 90-day retention (SECURITY.md §8) — the purge cron deletes rows past this;
    // inline photo bytes live in the row, so the row delete removes them too.
    expiresAt: timestamp('expires_at', { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '90 days'`),
  },
  (t) => [
    index('messages_thread_idx').on(t.threadId, t.createdAt),
    index('messages_expires_idx').on(t.expiresAt),
    // Dock badge (unreadCount, every signed-in SSR render): partial index keeps
    // the COUNT O(unread rows) instead of O(lifetime message history).
    index('messages_unread_idx').on(t.threadId).where(sql`${t.readAt} is null`),
  ],
);

// Single-use contact invite links (VIDEO-CALLING.md §5): she shares the token
// out-of-band; a signed-in client claims it → open thread + contact row.
export const contactInvites = pgTable(
  'contact_invites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => profiles.id),
    token: text('token').notNull(),
    name: text('name').notNull().default(''), // pre-fills the contact's name
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    claimedBy: uuid('claimed_by').references(() => accounts.id),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('contact_invites_token_idx').on(t.token),
    index('contact_invites_profile_idx').on(t.profileId),
  ],
);

export const contacts = pgTable(
  'contacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => profiles.id), // the owning professional
    kind: contactKindEnum('kind').notNull(),
    // conversation-derived contacts link a thread + client; manual ones don't.
    threadId: uuid('thread_id').references(() => threads.id),
    clientAccountId: uuid('client_account_id').references(() => accounts.id),
    name: text('name').notNull().default(''),
    handle: text('handle').notNull().default(''), // manual: phone/email
    note: text('note').notNull().default(''), // private to her
    pinned: boolean('pinned').notNull().default(false),
    clientMediaAllowed: boolean('client_media_allowed').notNull().default(false),
    privateSetUnlocked: boolean('private_set_unlocked').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    index('contacts_profile_idx').on(t.profileId),
    uniqueIndex('contacts_thread_idx').on(t.threadId), // at most one contact per thread
  ],
);

// ---------------------------------------------------------------------------
// Favorites — client × profile (was an array on the mock account; a table so
// realtime favorite-sync and counts are cheap).
// ---------------------------------------------------------------------------

export const favorites = pgTable(
  'favorites',
  {
    clientAccountId: uuid('client_account_id')
      .notNull()
      .references(() => accounts.id),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => profiles.id),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.clientAccountId, t.profileId] }),
    index('favorites_profile_idx').on(t.profileId),
  ],
);

// ---------------------------------------------------------------------------
// Reports (ADMIN.md §7) — filed by users, triaged by admins.
// ---------------------------------------------------------------------------

export const reports = pgTable(
  'reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Nullable: anonymous reports allowed (for now). A logged-in reporter is set.
    reporterAccountId: uuid('reporter_account_id').references(() => accounts.id),
    targetKind: reportTargetEnum('target_kind').notNull(),
    targetId: text('target_id').notNull(),
    targetLabel: text('target_label').notNull().default(''),
    profileSlug: text('profile_slug'),
    threadId: uuid('thread_id').references(() => threads.id),
    reason: reportReasonEnum('reason').notNull(),
    note: text('note').notNull().default(''),
    state: reportStateEnum('state').notNull().default('open'),
    escalated: boolean('escalated').notNull().default(false), // underage/coercion
    resolution: reportResolutionEnum('resolution'),
    resolutionNote: text('resolution_note').notNull().default(''),
    handledBy: uuid('handled_by'), // admin account id — no FK (defensibility)
    handledAt: timestamp('handled_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('reports_state_idx').on(t.state),
    index('reports_target_idx').on(t.targetKind, t.targetId),
  ],
);

// ---------------------------------------------------------------------------
// Audit log (ADMIN.md §0.3) — append-only (the guard trigger lands Phase-0).
// admin_account_id keeps the actor as a plain UUID (no FK) so deleting a user
// never vaporizes history; admin_email is a denormalized snapshot.
// ---------------------------------------------------------------------------

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    adminAccountId: uuid('admin_account_id').notNull(),
    adminEmail: text('admin_email').notNull(),
    adminRole: adminRoleEnum('admin_role').notNull(),
    action: adminActionEnum('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    reason: text('reason'),
    meta: jsonb('meta').$type<Record<string, string>>(),
  },
  (t) => [
    index('audit_log_at_idx').on(t.at),
    index('audit_log_entity_idx').on(t.entityType, t.entityId),
  ],
);

// ---------------------------------------------------------------------------
// Import jobs (ADMIN.md §3) — the self-service scrape→extract→review pipeline.
// ---------------------------------------------------------------------------

export const importJobs = pgTable(
  'import_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceUrl: text('source_url').notNull(),
    state: importJobStateEnum('state').notNull().default('queued'),
    /** Agency auto-crawl (src/lib/crawl.ts): the org this URL was discovered for. */
    orgId: uuid('org_id').references(() => orgs.id),
    /** Set when the URL matched an existing profile → the job UPDATES it
     *  instead of creating a new one (re-crawl path). */
    profileId: uuid('profile_id').references(() => profiles.id),
    /** Stamped by the claim (queued→scraping). The crawl-tick reaper fails any
     *  job claimed >15 min ago whose runner died mid-scrape — without this,
     *  a wedged 'scraping' row blocks its URL from re-enqueue forever. */
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    profileName: text('profile_name'),
    error: text('error'),
    createdAt: createdAt(),
  },
  (t) => [index('import_jobs_state_idx').on(t.state), index('import_jobs_org_idx').on(t.orgId)],
);

// ---------------------------------------------------------------------------
// Call sessions (ADMIN.md §11, ARCHITECTURE §10, VIDEO-CALLING.md §3) —
// metadata ONLY; calls are peer-to-peer DTLS-SRTP and never recorded.
// `initiated_by = professional` is a CHECK (SECURITY.md §3: clients can never
// initiate). Writes go through server actions exclusively (no browser grants);
// ring + state sync ride the insert/update trigger broadcasts (0010).
// ---------------------------------------------------------------------------

export const callModeEnum = pgEnum('call_mode', vals(CALL_MODES));
export const callStateEnum = pgEnum('call_state', vals(CALL_STATES));

export const callSessions = pgTable(
  'call_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => profiles.id),
    clientAccountId: uuid('client_account_id').references(() => accounts.id),
    clientName: text('client_name').notNull().default(''),
    /** The thread the call lives in (nullable only for legacy admin rows). */
    threadId: uuid('thread_id').references(() => threads.id),
    initiatedBy: text('initiated_by').notNull().default('professional'),
    mode: callModeEnum('mode').notNull(),
    state: callStateEnum('state').notNull().default('ringing'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(), // ring start
    answeredAt: timestamp('answered_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    lastBeatAt: timestamp('last_beat_at', { withTimezone: true }), // 30s heartbeat while active
    endReason: text('end_reason'), // hangup|timeout|declined|failed|blocked
    durationS: integer('duration_s').notNull().default(0),
  },
  (t) => [
    index('call_sessions_profile_idx').on(t.profileId),
    index('call_sessions_started_idx').on(t.startedAt),
    index('call_sessions_thread_idx').on(t.threadId, t.startedAt),
    check('call_sessions_initiator', sql`${t.initiatedBy} = 'professional'`),
  ],
);
