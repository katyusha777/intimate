# DATA.md — The Data Model

The authoritative shape of the data: the `public` Postgres schema, how it maps
to the Zod models the app validates against, and the mock→prod seam that swaps
underneath both. Companions: `API.md` (the seam + access rules this lands
behind), `SUPABASE.md` (the DDL/RLS/realtime law — decision 7 gives Drizzle the
`public` schema), `SECURITY.md` §3 (RLS + deny-test discipline), the taxonomy
(`src/lib/taxonomy.ts`, the enum source of truth).

Two type sources, one truth each — they must agree, and this doc is the map:

| Layer | File | Owns |
|---|---|---|
| **Validation / API contract** | `src/app/models/*.ts` (Zod) | boundary parsing, TS types components read, the `XxxApi` interfaces |
| **DB shape** | `src/db/schema.ts` (Drizzle) | tables, columns, enums, constraints, indexes — the server path |
| **Vocabulary** | `src/lib/taxonomy.ts` | every enum value (snake_case English); both layers derive from it |

Drizzle-inferred row types (`typeof profiles.$inferSelect`) are the server
path's types; the Zod models remain what pages/actions/components consume. The
db backend (`src/app/data/db/*`) projects rows → Zod models so call sites never
change (API.md §2). **List semantics live once**: `applyProfileListParams`
(models/profile.ts) owns filter/sort/paging.
`online` is derived from the `last_active_at` heartbeat (`ONLINE_WINDOW_MS`),
never stored. Real profiles only — the demo/seed catalog was removed
2026-08-09 (data is created through the app, nothing else).

---

## 1. Entities

14 tables. "Owner" = who the row belongs to; "public read" = surfaced on cached
anonymous pages (RLS `state='live'` only for profiles/media).

| Table | Owner | Public read | Purpose |
|---|---|---|---|
| `accounts` | auth user | no | one row per `auth.users` id; role + verification state |
| `orgs` | agency account (placeholder, no login) | name/slug/logo/description/`locations` via `/{locale}/agencies/{slug}` | partner agencies: KvK, verification, contact, branches (`locations` JSONB: address/phones/hours per city; profile's branch = city match), crawl config (`crawl_enabled`, `crawl_list_url`, `site_prompt` — THIS provider's own extraction prompt, appended to the site-neutral schema contract in `lib/import/prompt.ts`, `allowed_services` — deterministic import whitelist, `crawl_interval_hours`, `last_crawled_at`); a profile links via `org_id` |
| `profiles` | account | live only | the listing row — one flat, joinless row per profile |
| `media` | profile | approved only | one row per image (R2 object key + review state) |
| `verification_docs` | account | **never** | toxic-waste metadata (R2-backed doc; hard rule 3) |
| `conversation_settings` | profile | no | messaging mode (default OFF), screening question |
| `threads` | (profile, client) | participants | one conversation per client×profile pair |
| `messages` | thread | participants | text / photo / system / request cards |
| `contacts` | profile | no | the professional's CRM (conversations + manual entries) |
| `favorites` | client | own | client × profile (was a mock array) |
| `reports` | reporter | admin | user-filed, admin-triaged |
| `audit_log` | — | admin | append-only admin action + sensitive-read trail |
| `import_jobs` | — | admin | scrape→extract pipeline; agency crawl tags jobs with `org_id` (+ `profile_id` on re-crawl) — src/lib/crawl.ts |

**Deliberately absent:** no `articles` table — editorial articles are
markdown-in-git (Astro content collection, `src/content/articles/`), not the DB.
No `reviews`/`ratings` table either — the trust signal is
measured reply speed (MESSAGING.md, UX-PLAN 3.2), a SQL view over `messages`,
not user-authored reviews. Don't add one without a product decision.

## 2. Key tables in detail

Columns below are the load-bearing ones; see `src/db/schema.ts` for the full
list. All timestamps are `timestamptz`; all ids `uuid` (`defaultRandom` except
`accounts.id`).

**accounts** — `id` = `auth.users.id` (the FK is added in the Phase-0 migration;
the auth schema is Supabase-managed so Drizzle can't own it). `account_type`
(taxonomy `ACCOUNT_TYPES`: advertiser · agency · client · admin), `admin_role`
(only when admin), `id_verification` state, `verification_submitted_at`,
`verification_reason`. **Identity is denormalized here** — `email` (nullable:
phone-only signups; unique), `display_name`, `phone` + `phone_verified_at` —
written server-side at signup/change, because `app_server` has no auth-schema
access (SUPABASE.md decision 5) and the inbox + admin surfaces need it.

**profiles** — one flat row (fast SSR, no joins). `account_id` → accounts,
`org_id` → orgs (nullable). Offer dimensions are taxonomy enum **arrays**
(`services`, `meeting_types`, `languages`, `incall_locations`, `amenities`,
`payment_methods`, `available_for`) — GIN-indexed where filtered (`services`).
Appearance/physical columns (`body_type`, `hair_color`, …, `height_cm`,
`nationality char(2)`) are all nullable. `rates` is order-preserving JSONB;
`price_from` is the derived min, denormalized as an `integer` column for
sort/filter. `opening_hours` + `availability_dates` + `description_translations`
are JSONB — weekly hours plus per-date overrides (agency-style calendars); a
date entry beats the weekday for that day, weekly is the fallback.
`age_display` (nullable text) is a source-verbatim prose age ("midden twintig")
shown via `profileNameAge()` instead of the computed years — never a guessed
number. `''` is the import sentinel for "the source shows no age": the UI hides
the age entirely and the required, 21+-checked `birth_date` underneath is a
placeholder that the pending_review approval confirms before going live.
- **Not stored:** `online` — it comes from realtime presence (SUPABASE.md §5.4),
  projected onto the read model, never a column. `last_active_at` IS stored: the
  professional's island writes it via a throttled RLS-guarded own-row update
  (the §5.4 heartbeat decision) — it powers the `recently_online` sort in SSR.
- `state_changed_at` records every lifecycle transition — the anchor for the
  48-month verification-doc retention window (deactivation date) and 410s.
- **Edits publish immediately** (decided 2026-08-03): no revision/override
  layer. Human moderation = the first `pending_review → live` approval + per-
  image `media` review; AI text moderation can layer on later (ADMIN.md §6).
- **DB guards:** `CHECK (age(birth_date) ≥ 21)` — 21 = `POLICY_MIN_AGE` (NL
  operating minimum; 18 is the absolute legal-adult floor), also gated in
  `ProfileEditSchema` · `CHECK price_from ≥ 0`.

**media** — replaces the mock's `photos[]` / `private_photos[]`. `image_key` =
the **R2 object key**, visibility-prefixed: `pub/<profileId>/<uuid>` (public) or
`priv/<profileId>/<uuid>` (her locked set). Bytes live in the `intimate-media`
R2 bucket (hard rule 2 — EXIF stripped client-side first); `mediaUrl()` routes
keys through `/media/<key>` (`data/db/profiles.ts`), served by
`src/pages/media/[...key].ts`: public = edge-cached (Cache API, canonical key
per `?v` variant) + Images-transform resize (`?v=thumb|card|full` → WebP,
graceful fallback to original) — a `media⟕profiles` gate runs BEFORE the cache
lookup, so takedown (row deleted / `rejected` / profile not live) blocks even
cached copies, and `evictMediaCache` (`lib/media-keys.ts`) makes the serving
colo instant. Private = authorization-gated (owner, or a client with
`contacts.private_set_unlocked`) and `no-store`, never edge-cached. Uploads enter `pending_review` (images are the one
human-moderated surface, ADMIN.md §6); the owner dashboard badges them until
approved. Seed/static keys (absolute path or full URL) pass through `mediaUrl`
untouched. `state` (media review), `is_private` (her locked set, revealed
per-thread — UX-PLAN 4.4), `position` (gallery order), `nsfw_score`. The profile
read model still exposes `photos: string[]` / `privatePhotos: string[]` — the
backend projects them from approved/private media rows.

**verification_docs** — metadata ONLY; the document lives in the private EU R2
bucket (ARCHITECTURE §11, VERIFICATION.md). `r2_key`, `doc_hash` (proves nothing
alone — the doc is the proof, hence bounded retention not instant purge),
`kind` (`id_front`/`id_selfie` — the 2-photo flow; `code_selfie` is a legacy
enum value from the retired paper-code step, kept because pg enums can't drop
values and old rows carry it; pre-kind rows backfilled
`id_front`), `state`, `reviewed_by`/`reviewed_at`
(stamped by approve/reject since 2026-08-23), `purge_after` (48 months after
deactivation, pending final legal review). After retention the doc is purged;
state/hash/reviewer/date stay forever. Every read is audit-logged; the table
gets **no anon/authenticated grants** (server + admin path only).

**threads / messages / contacts** (MESSAGING.md) — a `thread` is one
`(profile, client_account)` pair (unique index). `messages.sender` ∈
professional·client·system; `request` (the pre-qualified card, UX-PLAN 4.1) is a
frozen JSONB snapshot. The mock carries the professional's CRM fields (note,
pin, media grant, private-set unlock) inline on the thread; prod splits them into
`contacts`, which **unifies** conversation-derived rows (`kind='thread'`, linked
`thread_id` + `client_account_id`) and manual address-book entries
(`kind='manual'`, both null). One contact per thread (unique index).

**audit_log** — append-only (the guard trigger lands Phase-0). `admin_account_id`
is a plain uuid with **no FK** and `admin_email` is a denormalized snapshot, so
deleting a user never vaporizes history (SUPABASE.md §10 defensibility). Same
no-FK rule for `reports.handled_by` and `verification_docs.reviewed_by`.

## 3. Enum ↔ taxonomy map

Every `pgEnum` in `schema.ts` mirrors one taxonomy array; extend the taxonomy
first, then the enum, then migrate (taxonomy = law). Column enums:
`account_type`, `admin_role`, `admin_action`, `profile_state`,
`verification_state`, `import_job_state`, `gender`, `available_for`,
`body_type`, `hair_color`, `hair_length`, `eye_color`, `cup_size`,
`breast_type`, `pubic_hair`, `appearance`, `smoking`, `drinking`, `tattoos`,
`piercings`, `language`, `city`, `service`, `meeting_type`, `incall_location`,
`amenity`, `payment_method`, `media_type`, `media_state`, `conversation_mode`,
`thread_state`, `message_kind`, `report_target`, `report_reason`,
`report_state`, `report_resolution` + two structural ones (`party`,
`sender`, `contact_kind`) not from taxonomy. `RATE_DURATIONS` / `REQUEST_WHEN`
live only inside JSONB (rates, request cards), validated by Zod, not DB enums.

## 4. JSONB columns (validated by Zod at the boundary, not by the DB)

| Column | Shape | Source of truth |
|---|---|---|
| `profiles.rates` | `RateRow[]` (order = display order) | `RateRowSchema` |
| `profiles.opening_hours` | `Partial<Record<Day, DayHours>>` | `OpeningHoursSchema` |
| `profiles.availability_dates` | `Record<IsoDate, DateAvailability>` (date beats weekday) | `AvailabilityDatesSchema` |
| `profiles.description_translations` | `Partial<Record<Locale, string>>` | profile model |
| `orgs.locations` | `OrgLocation[]` (branch: city/address/phones/hours) | `OrgLocationsSchema` (`models/org.ts`) |
| `messages.request` | `RequestPayload` (frozen snapshot) | `RequestPayloadSchema` |
| `audit_log.meta` | `Record<string, string>` | admin action |

`price_from` derives from `rates` (`priceFromRates`) — the app writes both; the
column exists so listings sort/filter without unpacking JSONB.

## 5. Mock → prod seam (what changes when the DB lands)

The Zod models and `XxxApi` interfaces are stable; only the backend swaps
(API.md §2). The shape shifts to know about:

| Mock (KV / JSON, today) | Prod (Postgres) |
|---|---|
| identity = **email** (`clientEmail`, `mockacct:{email}`) | identity = **`accounts.id` uuid**; email lives in `auth.users` |
| `profile.photos[]` / `privatePhotos[]` | `media` rows (projected back to `string[]`) |
| `account.profileOverride` + `extraPhotos` + `removedPhotos` (editor deltas over a base profile) | ✅ DONE — the profile row **is** edited directly (edits publish immediately) + `media` rows; no override layer. A fresh advertiser gets an unsaved blank profile to fill in; her first save INSERTs the row (`draft`, slug auto-derived) |
| admin profile-state overrides in KV | ✅ DONE — `profilesApi.setState` UPDATEs the row (`listAll`/`byId` = admin reads, every state); who/why lives in `audit_log` |
| admin client list inferred from the email local-part | ✅ DONE — `accounts.account_type` is a real column |
| mock messaging mode default `everyone` (explorable demo) | DB default `off` — the product law; the swap must NOT carry the mock default |
| `clientName` derived from email | `accounts.display_name` |
| `account.favorites[]` (slug array) | `favorites` table (client × profile) |
| thread inline `note`/`pinned`/`clientMediaAllowed`/`privateSetUnlocked` | ✅ DONE — `contacts` row (1:1 with the thread, created alongside it); manual entries are `contacts` with `kind='manual'` |
| messaging identity keyed by email/`clientEmail` | ✅ DONE — `threads.client_account_id`; `clientEmail`/`clientName` projected from the account join |
| reply-speed demo latency table | ✅ DONE — real median over `messages`, or honest `null` (no demo crutch) |
| `report.reporterEmail` | `reports.reporter_account_id` (nullable — anonymous reports) |
| `AuditEntry` in admin KV | ✅ DONE — `audit_log` table (append-only trigger; `record()`/`listAudit()` on Drizzle) |
| `ImportJob` / `Org` / `CallSession` seeded in KV | ✅ DONE — `import_jobs` / `orgs` (roster from `profiles.org_id`) / `call_sessions` tables |
| moderation queue seeded in KV | ✅ DONE — DERIVED: `new_profile` from profiles `pending_review` + `media` from pending media rows; decisions are real state UPDATEs |
| admin queue claims (10-min soft locks) | stays in **KV** (ephemeral coordination, TTL-expiring — not persistent data; realtime presence is the eventual "who's reviewing" signal) |
| reply-speed demo samples | ✅ DONE — real median over `messages` |

## 6. The security wall (BUILT: `drizzle/0001_security.sql` · deny tests: `tests/rls.test.ts`)

`schema.ts` is tables/enums/constraints/indexes; 0001 is everything else —
`app_server` role (explicit full-access policies, BYPASSRLS only as a bonus:
hosted postgres can't always grant it), default-privilege revokes, `private`
schema + `is_thread_participant`, RLS on all 14 tables, realtime policies, and
the triggers (audit append-only · message broadcast via `realtime.send` on
`thread:{id}` · thread `last_message_at` touch · `state_changed_at` stamp).
Posture per table, each with its deny test:

- **Public-read, live-only**: `profiles` (SELECT anon+authenticated, `state='live'`;
  owner reads own any-state; owner UPDATE **column-granted to `last_active_at`
  only** — the heartbeat) · `media` (`approved and not is_private` and profile
  live; owner sees all hers).
- **Participant-only**: `threads`, `messages` SELECT via participant policies;
  message INSERT stays server-side (actions validate; no browser grant).
- **Own-row**: `favorites` (select/insert/delete), `accounts` (select).
- **Zero browser access** (`orgs`, `conversation_settings`, `contacts`,
  `reports`, `audit_log`, `verification_docs`, `import_jobs`): no
  grants at all — PostgREST can't reach them; `app_server` + admin actions can.
- **NO `auth.users` FK on `accounts.id`** (decided 2026-08-03): GDPR erasure
  deletes the auth user while the scrubbed accounts row must survive for audit
  — a FK would block the delete or cascade away history. Convention + server-
  only row creation guarantee the link.

Presence (online-now, city counts) and favorite-sync ride realtime broadcast,
never polling (API.md §4). Advisor gate + staging order: SUPABASE.md §11.
