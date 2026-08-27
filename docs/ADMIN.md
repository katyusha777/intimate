# ADMIN.md — Admin System

The admin is not a CRUD afterthought — it IS the trust product. Verification speed, moderation legibility, and report responsiveness are the brand promises; this system is where they're kept. Design goal: one admin processes hundreds of queue items per day without fatigue, every decision is explainable to the person it affects, and every sensitive access leaves a trace.

Lives inside the main Astro app at `/admin` (same repo, same design system, same component law). Desktop-first is acceptable here (the one exception to MOBILE.md), BUT queues must be fully usable from a phone — moderation happens from the couch (tested, DoD §16).

---

## 0. Principles

1. **Queue-driven, not page-driven.** Admins live in queues (profile approval, reports, taxonomy, imports). Everything else is lookup.
2. **Every decision carries a reason** from taxonomy (`REJECTION_REASONS` etc. — added to `src/lib/taxonomy.ts` like every controlled vocabulary, taxonomy = law) + optional note. Reasons are shown to the affected user verbatim — the anti-"arbitrary moderation" commitment made concrete.
3. **Every admin action → `audit_log`. Every sensitive READ → `audit_log`** (verification docs, message threads — hard rule 6). Access without traces does not exist here.
4. **Realtime, not refresh.** Queues update live (Supabase Realtime) — new items appear, claimed items show who's on them.
5. **Calls have no content to view — by architecture.** P2P, never recorded (MESSAGING.md). Admin sees call *metadata* only. This is a feature of our safety story, not a gap in the admin.
6. **Same design system, same laws.** Admin is not a second product with its own look. Atomic rules, tokens, style tests, and the kitchen-sink gate apply to every admin component (§2).

## 1. Access & security (leverage the stack)

- **Layer 1 — Cloudflare Access (Zero Trust)** in front of `intimate.nl/admin` (self-hosted app with path `admin` — the subdomain experiment was reverted 2026-08-09 after it coincided with an apex-DNS outage): edge-level auth wall (email OTP/SSO, free tier covers a small team) — bots and credential-stuffers never reach the app. Environment config, verified in the deploy checklist, so the edge wall holds even if app middleware regresses. **The Access rule is scoped to the `intimate.nl/admin` PATH, so the worker must answer ONLY on the custom domains:** `workers_dev: false` + `preview_urls: false` in `wrangler.jsonc` (set 2026-08-10) close the `*.workers.dev`/preview back doors that would otherwise reach `/admin` *around* the Access wall.
- **Layer 2 — Supabase Auth + mandatory MFA (TOTP)** for admin accounts. The `aal2` assertion is enforced **per call in `requireAdmin`/`getAdmin`** (every admin page + every admin action — NOT in middleware, which BYPASSes `/admin`), and is **staged OFF behind `ADMIN_REQUIRE_AAL2`** so it can't lock out an admin who hasn't enrolled TOTP yet. The **enroll + step-up UI is built** (2026-08-10): `MfaCard` on `/admin/settings` (every admin, not just super) enrolls a TOTP factor via `auth.mfa` (client-side, `src/app/mfa.ts`); `AdminLogin` runs the step-up after a correct password — a code **challenge** if a factor exists, or **forced enrollment on the spot** if `ADMIN_REQUIRE_AAL2` is on and the admin has none (so the aal2 gate can't lock a factor-less admin out with no path to settings). **Owner steps to turn it on:** every admin enrolls at `/admin/settings` → confirm login step-up works → set `ADMIN_REQUIRE_AAL2=true`. Until then admin auth is single-factor (password) behind Layer 1. The in-app role check (below) still fails closed regardless, so a non-admin who passes Access still gets nothing.
- **Layer 3 — roles:** `admin_role` claim: `moderator` (queues, profiles) · `support` (users, platform messages) · `super` (everything + admin management + settings). Values live in taxonomy (`ADMIN_ROLES`). Enforced in every server action AND every admin page (`requireAdmin`/`getAdmin`), resolved from the server-controlled `accounts.admin_role` column via a verified `getClaims()` session — never UI-only, never from a forgeable JWT claim.
- **Code isolation (same app, hard fence — CLAUDE.md "Admin boundary", CI-enforced):** admin code lives ONLY in `src/pages/admin/`, `src/actions/admin/`, `src/components/organisms/admin/`. Nothing outside those folders imports from them (ESLint boundary rule); the Supabase **service-role client is constructed only in `src/actions/admin/**`** (CI grep asserts zero occurrences elsewhere). Boundary lint + grep land in the SAME PR that creates the folders — grandfather nothing. This folder discipline is also the migration path: admin can be promoted to its own Worker later by moving three folders.
- **`/admin` is locale-less by design** — the one deliberate exception to the "URLs always locale-prefixed" convention. Internal tool, English UI (§2), never indexed, never in sitemaps.
- Session length short (8h re-auth); audit_log records the role used per action.

## 2. Design system & components (atomic law applies — no admin fork)

The admin is built from the SAME component pyramid as the public site. Consistency here is not aesthetics — it's why admin screens are cheap to build and never drift:

- **Reuse before anything** (CLAUDE.md "Reuse is law"): existing atoms/molecules — `Button`, `SlabField`, `Combobox`, `ActionSheet`, `Section`, `SafeImage`, `Icon` — are the admin's vocabulary too. Check `/kitchen-sink` before writing any markup.
- **Levels hold:** generic controls the admin needs that don't exist yet (data table, tabs, key→value list, status chip, confirm dialog, toast) are **molecules** — domain-agnostic, usable anywhere, built once. Domain-aware sections (`VerificationReviewPanel`, `ModerationQueue`, `ReportCard`, `AuditLogTable`, `RelationsPanel`, `DiffView`) are **organisms in `organisms/admin/`**. Imports flow strictly downward as everywhere; admin organisms may import shared molecules/atoms, nothing may import admin.
- **Variants, not forks.** A queue row, a state chip, a claim banner — one component with props across all five queues. The queues sharing one interaction model (§5) starts with them sharing one set of components.
- **Tokens only.** Same `global.css` scale, role utilities, and glass/slab materials; `tests/style.test.ts` runs on admin code — arbitrary bracket values fail there too. Admin may run **denser** (tighter spacing steps, smaller type from the same scale) but never off-scale. Light + dark both first-class (couch moderation is night-shift work). New visual needs become tokens, never inline values.
- **Kitchen sink is still the merge gate:** every admin component/variant appears on `/kitchen-sink` (mock data, both themes) in the same change.
- **Admin strings are hardcoded English — the one sanctioned exception to the no-hardcoded-strings law** (internal tool, English-only by design; extract to Paraglide only if admin ever needs translation — as implemented, see the ponytail note in `AdminShell.astro`). The strings users *see* (rejection reasons, platform messages) are NOT admin strings — they're taxonomy labels, localized like all taxonomy.
- **Interactivity ladder holds** (none → vanilla → island), but the public-page JS budget does not: admin is exempt from Lighthouse/JS-budget CI (CLAUDE.md boundary rule 4) and may use heavy islands freely where queues genuinely need them (realtime lists, diff view, doc viewer). Exempt ≠ careless — SSR-first with realtime layered on top remains the pattern (§13).
- **Sensitive media renders through `SafeImage` — deliberately.** Admin media (moderation strip, doc viewer thumbnails) defaults to **blurred, per-item tap-to-reveal**. This keeps the non-negotiable imagery contract intact AND is a moderator-wellbeing feature: nobody triages explicit media full-bright on a couch by accident. Reveal state is per-item, never a page-wide toggle.

## 3. Information architecture

The sidebar is grouped by purpose — the SLA-bearing queues on top, then the
directory, people, read-only logs, and system — with a header + rule per group;
a group whose items are all role-hidden drops entirely (no empty header). Group
headers are i18n'd (`adm_navgrp_*`); on the mobile rail they collapse to a single
horizontal scroll (headers hidden).

```
/admin
├─ Overview            live ops dashboard
├─ Queues
│  ├─ Profile approval ID doc + new profiles + media — one review, one decision
│  └─ Reports          user reports (escalations pinned)
├─ Directory
│  ├─ Profiles         search/filter, detail, state, completeness · + New profile
│  ├─ Agencies         tabbed detail: Roster (+ New profile) / Crawler / Details
│  └─ Imports          per-agency crawl dashboard (last run outcome, backlog, overdue-cadence alarm) + job monitor + /imports/test (paste-URL → mapping preview, apply-to-profile)
├─ Users
│  ├─ Accounts         every account, relations, status, GDPR (was "Users")
│  └─ Client accounts  clients: favorites, phone, reports made (was "Clients")
├─ Logs
│  ├─ Messaging        platform messages + governed thread access
│  ├─ Calls            metadata log
│  ├─ Audit log        everything, filterable
│  └─ Analytics        ops stats (first-party) + PostHog links
└─ System
   ├─ Settings         admins, taxonomy mgmt, policy text, flags
   └─ Danger zone      owner-only raw-data tools
```

## 4. Overview (the live cockpit)

Server-rendered, realtime-layered (our SSR-first + broadcast pattern, reused):
- Queue depths + oldest-item age (SLA at a glance), each → click-through
- Today: new registrations, profiles submitted/published, reports, contact-clicks (first-party counter), professionals online now (presence — the supply heartbeat)
- Escalation banner: any open `underage_suspicion`/`coercion_suspicion` report renders a red, un-dismissable banner site-wide in admin until handled
- Supply map: live profiles per city vs target (the city-by-city strategy, measured)

## 5. Profile approval queue (the crown jewel — build first)

**One queue, one decision** (merged 2026-08-11 — was two, "Verification" + "Moderation"; splitting the ID review from the profile review surfaced every new professional in BOTH and made an admin approve the same person twice — bad design, gone). A pending submission is ONE item — keyed by profile (or by account, for an ID with no profile yet) — carrying whatever is pending: the ID document, the profile's first publish, and its pending photos. The engine is `approvalQueue()` / `approveWholeSubmission()` / `rejectWholeSubmission()` in `actions/admin/queues.ts`; the page is `pages/admin/approvals/`.

**Flow:** oldest-first list → claim (broadcast "Anna is reviewing", prevents double-work) → one review screen showing everything pending side by side:
- **ID documents** (only when pending) via **short-TTL presigned GETs (≤5 min) from the dedicated private R2 bucket** (hard rule 3 / ARCHITECTURE §11 — R2, NOT Supabase Storage); our admin action is the only issuer, so issuance AND render both land in audit (`verification_doc_viewed`); overlay watermark "ADMIN VIEW · {admin} · {ts}" on the doc viewer (screenshot deterrent). Since 2026-08-27 a submission is **2 kind-labeled photos** (ID · selfie with ID; legacy `code_selfie` photos from the retired paper-code flow still render on old submissions) — the reviewer checks the ID reads and the face matches. Approve/reject stamps the doc rows themselves (state/reviewer/date — the skeletal record that outlives the purge).
- **Profile summary** — claimed name/birth date (vs the doc), city, **SMS verification state** (docs/VERIFICATION.md — both gates must pass before `live`), plus a **"View full profile ↗"** link to the public page (admins see non-live profiles at their public URL, §8) so the whole listing is one click away
- **Media strip** (when photos are pending) with NSFW-triage scores (OpenRouter vision pass, pre-computed by the import/upload pipeline) sorting riskiest first; cover-photo rule check (tiered explicitness policy); blurred-by-default per-item reveal (§2)
- Actions — **one** for the whole submission: **Approve** (verifies the ID, publishes the profile if ready, approves its pending photos, schedules the doc purge per retention policy, notifies — each step state-guarded so a re-click or a photo-only item is safe) · **Reject** with taxonomy reason → ID → rejected, profile → draft, photos → rejected; user sees exactly why + how to fix · **Escalate** to super (when there's an account)
- Keyboard-first: `a`/`r`/`e`, arrows between items — throughput matters

**Text edits to live profiles publish immediately** (decided 2026-08-03): no edit-review queue, no revision layer — human moderation is images-only; an AI text-moderation pass can be layered later. Reports remain the recourse for bad text. (So the queue's non-new items are photos added to already-live profiles.)

**SLA target surfaced in UI:** oldest pending age; goal <24h (a brand promise — "verified fast").
**Retention machinery visible:** each approved item shows its purge date; the purge job (Workers Cron sweeping R2 against the retention window, hard rule 3) reports last-run status on this page — the toxic-waste policy, observable.

## 6. (folded into §5)

The old separate Moderation queue merged into **§5 Profile approval** on 2026-08-11 — new-profile approval and media review are the same review now. Section number kept so §7+ cross-references stay valid.

## 7. Reports queue

- Sorted: escalations (underage/coercion) pinned top with distinct treatment; then age.
- Item view: report + reporter context + target profile/thread snippet (scoped: the reported content, not the whole thread — §9 governs widening access).
- Actions: resolve (with action taken: content removed / profile blocked / no action) · dismiss (reason) · one-tap chains: block profile, remove media, open governed thread view, message the reporter/reported (platform message, §10).
- Every resolution notifies the reporter that the report was reviewed (not the details) — reports that vanish into silence train people to stop reporting.

## 8. Profiles, Users, Organizations (lookup surfaces)

**Profiles:** filter by state/city/verification/completeness; list shows state chips + **completeness %** (SQL view scoring filled fields/photos/rates — also shown to the professional herself as "profile strength"; same view, two audiences) + quality flags (1 photo only, no rates, stale >90d). Super admins get **+ New profile** (the shared `NewProfileForm` organism, also mounted on the agency roster): identity-only stub — name, DOB (picker capped at the 21st birthday), gender, city — owned by a login-less placeholder `advertiser` account, landing **pending_review** (`profileCreate` action → `createManualProfile`, 21+ enforced at the action AND the DB CHECK; audit `edit_profile_admin` note=`manual create`). Photos/rates/services are filled after — either by the owner or by a super admin in the **full editor**. Detail (a right-edge slide-over drawer so the table runs full-width): everything — incl. the owning **account** (email/phone click-to-copy, type, created, other profiles on the account, link to Users), an **ID-verification panel** (state + submitted/reason, docs via the audited DocViewer/vdoc route, reject-submission-with-reason while pending via `approvalDecision` (mirrors the approvals queue: ID → rejected, pending profile → draft, pending photos → rejected)) and copyable profile/account IDs — + full history (audit slice) + state-machine actions with reasons + the **unlisted** visibility toggle (the same switch the owner has in her settings — out of listings/search, direct URL still resolves; `profileUnlisted` action, no 410/IndexNow) + "view public page" + an **Edit profile** link. State transitions honor lifecycle law (hard rule 6): blocked/deleted public pages → 410 + IndexNow removal.
**Full editor (`/admin/profiles/edit?id=`, super-only):** every field the advertiser has, for any profile by id — it **reuses the exact frontend `ProfileEditorForm` + `MediaManager`** (organisms/dashboard) via their `adminId` prop, which swaps the save target to the admin actions (`profileEdit`/`profileAddPhoto`/`profileRemovePhoto` → `saveProfileById`/`addPhotoById`/`removePhotoById`) instead of the session's own profile. Photo upload runs the same on-device canvas re-encode (EXIF stripped, hard rule 2) → R2 → `media` row. A **data-import bar** pulls fields from a supported provider URL (`importApply` → `importFromUrl`, DATA ONLY — never photos) and overwrites the matching ones. Every save/photo/import is audit-logged `edit_profile_admin`.
**In-place moderation:** an admin session viewing any public profile page gets the `ProfileAdminBar` strip (act where you look): set live / pause / block-with-reason / unblock + single-photo takedown (`mediaReject`), all through the guarded admin actions (audit-logged, cache-busted); admins also see non-live profiles at their public URL (god view, never edge-cached).
**Users:** search by email/phone/name; detail = **relations panel** (one recursive query view): account → profiles ↔ org ↔ org-members, threads count, reports made/received, verification attempts, favorites count, sessions (last seen, app_mode). Status actions: warn (platform message), suspend, block, soft-delete — each with reason, each notifying the user (legibility again). Owner-only **login-email change** (`setAccountEmail`): updates the auth user (auto-confirmed, no mail) and the denormalized `accounts.email` together, fails closed without the service-role key, audit-logged with old→new.
**Organizations (partner agencies):** full lifecycle lives here — agencies have **no login** (each org owns a placeholder `agency`-type account that holds its profiles; upgradeable to a real auth user later). The detail is **tabbed**: **Roster** (the profiles this agency holds — per-profile states + unassign, the shared **+ New profile** module scoped to this agency, and assign-existing-by-UUID) · **Crawler** (the auto-crawl tools + import-job log) · **Details** (the agency record itself). Admin CRUD: name/city/KvK/verification, contact, description, logo (client re-encode → R2 `org/…` → `/media`), public page `/{locale}/agencies/{slug}`, and the org **unlisted** kill-switch (`orgs.unlisted`, Details-tab checkbox): hides the agency page AND its entire roster from every public read — listings, direct profile slugs, sitemap (stricter than profile-level unlisted) — reversible, no lifecycle change on the profiles; `orgUpdate` cache-busts and audit-logs it. **Auto-crawl** (the agency KVP: they never import anything): set a roster URL → *Test discovery* (Firecrawl + LLM → profile URLs) → *Test import* one URL (agency extraction adds name/age/photoUrls to the shared contract) → *Crawl now* queues `import_jobs` (org-tagged) and the page drains them with live progress. Each provider has its own **site prompt** (Details tab, `orgs.site_prompt`): ONE self-contained, admin-authored prompt describing how THAT site expresses the fields (its schedule widget, whose phone appears on a page, menu naming + mappings, age conventions, URL structure). It is appended verbatim to the shared, **site-neutral schema contract** (`lib/import/prompt.ts` — enforced by `tests/import-prompt.test.ts`: no provider names/vocabulary/conditionals there, ever; a new provider is a DB row, never a code change). The test tools read the *unsaved* textarea so a site prompt can be iterated before saving. `orgs.allowed_services` (Details tab) is the deterministic belt under the prompt: imported services are hard-filtered to that set in the engine (empty = unrestricted) — prompts steer, config enforces. The cron tick (workers/purge `*/5 * * * *` → `/api/crawl-tick`) re-crawls stale `crawl_enabled` orgs on their per-org cadence (`crawl_interval_hours`, default 24 — rolling date-calendars need daily), drains the queue continuously, and reaps jobs whose runner died mid-scrape (`claimed_at` > 15 min → `failed`, re-queued next crawl) — engine: `app/data/db/crawl.ts`. New profiles land **pending_review** with pending photos (hard rule 5 — moderation decides); **re-crawls patch fields in place and WIN over manual edits** (the agency's site is the source of truth — fix the site, not our copy; the 21+ age gate runs on every crawl, create and update). Under-21/no-age pages become `failed` jobs (with the extracted name), never rows. Agency profiles keep messaging default-OFF — nobody reads the placeholder account's inbox; contact = the profile's phone/WhatsApp buttons. Roster shows per-profile states + unassign/assign.

## 9. Messaging oversight (governed, not casual)

Admin access to private threads exists — with governance that protects users AND us:
- **Default path is report-scoped:** a report opens the reported message(s) ± a small context window.
- **Full-thread access** requires clicking "Open full thread" + selecting a reason (report investigation / legal request / safety escalation) → thread renders read-only, banner shows the access is logged; `thread_viewed_by_admin` lands in audit_log with reason. `support`: no thread access · `moderator`: report-scoped · full access: `super` or report-linked.
- No editing/deleting user content except removal actions tied to a report (removal leaves a tombstone system card: "removed by moderation").
- Metadata views (thread counts, last activity, block relationships) are unrestricted — content is what's governed.

## 10. Platform messaging (admin → user)

A first-class `system` thread per user with the **Platform** identity (distinct avatar/badge, cannot be confused with a professional):
- Templates + free compose: verification follow-ups ("your doc was blurry — reupload here"), moderation explanations, warnings, feature announcements to professionals.
- Two-way: user replies land in a **Support inbox** tab (role: support) — this becomes the support channel, reusing the entire messaging stack with `thread.kind = 'platform'`.
- Every outbound platform message is audit-logged and template-versioned (we can always show exactly what we told a user).
- Messaging is already built (`api/messaging`, `organisms/messaging/`) — platform messaging is a `thread.kind = 'platform'` extension of it, plus the dashboard reason display on affected items as the always-there fallback.

## 11. Calls (metadata log) — *rides on the calls build (not built yet)*

List of `call_sessions`: participants, initiated_by (always professional — assert visually), mode, state, duration, timestamps. Filter by user/profile/date. Used for report corroboration, abuse patterns (30 calls/day), support. Permanent note in the UI header: *"Calls are peer-to-peer and never recorded; no content exists."*

## 12. Analytics & audit

- **Ops analytics = first-party SQL** (the accuracy law from ANALYTICS.md — her business numbers and our ops numbers come from Postgres, never client-side capture): supply by city/state over time, verification SLA percentiles, queue throughput per admin, report resolution times, contact-clicks (the north star) by city/category, import success rates, completeness distribution. Materialized views + one chart island; refreshed by Workers Cron.
- **Product analytics = PostHog** — deep-links from admin into the relevant PostHog dashboards; don't rebuild PostHog in admin. No posthog-js on `/admin` pages (nothing to measure, keep the surface lean); **PostHog error tracking DOES cover admin** — Worker exceptions from admin actions land in the same project (ANALYTICS.md: PostHog is our error tracker, no Sentry).
- **Audit log viewer:** filter by admin/action/entity/date; sensitive-read actions visually distinct; export (CSV) for the legal-review folder. Retention: long — the audit trail is our defensibility (a deliberate, documented exception to GDPR-minimal, grounded in legitimate interest).

## 13. Built on the stack (the leverage list)

- **Supabase Realtime:** queue live-updates + claim broadcasts (no two admins on one item) + escalation banner push + presence for "admins online". Private channels authorized via RLS, SSR-first paint with realtime layered after — the standard pattern.
- **Postgres does the logic:** completeness score, queue SLA ages, relations panel — views/functions, not app code; audit via triggers on sensitive tables (can't forget to log).
- **Cloudflare R2:** verification docs (dedicated private bucket, hard rule 3); presigned short-TTL GETs issued only by admin actions; purge via Workers Cron.
- **Supabase Auth MFA:** aal2 enforcement for admins.
- **Cloudflare Access:** the edge wall on `intimate.nl/admin`.
- **Workers Cron:** materialized-view refresh, R2 purge job, SLA alert (queue >24h → email/platform-message to admins).
- **Astro server islands:** admin pages SSR fast, live widgets hydrate on top — same architecture as the public site, no separate SPA.
- **Feature flags (PostHog):** admin features roll out behind flags like everything else.

## 14. Build order & prerequisites

Admin phase 1 presumes **real Supabase auth + Postgres** — it does not get built against the mock KV data layer. Sequence when that lands:

1. **Boundary scaffolding** — the three admin folders + ESLint boundary rule + service-role CI grep, all in one PR (grandfather nothing). Cloudflare Access on staging `/admin/*` from day one.
2. **Verification queue** (§5) — the crown jewel; carries the R2 doc path, audit-on-read, purge machinery.
3. **Overview + Moderation + Reports + Users/Profiles lookup + Audit viewer** — in whatever order the queues fill; shared queue components (§2) mean each subsequent queue is mostly wiring.
4. **Messaging oversight + Platform messaging (§9–10)** — messaging is built; these join phase 1 scope once the queues exist (thread governance needs the role matrix from step 1).
5. **Taxonomy + Imports queues** — ride on the import pipeline build.
6. **Calls (§11)** — rides on the calls build (not built yet).

## 15. Future roadmap (parking lot — do not build now)

Bulk operations (multi-select approve/state-change) · canned-response macros · trust scores (verification + tenure + report history composite) · duplicate detection (photo phash + phone match queue) · ML triage tuning UI (adjust NSFW thresholds) · admin push notifications (escalations to phone) · legal-hold mechanism (freeze purges for a flagged account under a real legal request) · per-admin performance dashboards · public transparency report generator (annual: reports received/actioned — a trust-brand asset).

## 16. Definition of done (phase 1: Overview + Profile approval + Reports + Users + Audit)

- [ ] Boundary CI live: ESLint admin-import rule + service-role grep pass, added in the same PR as the folders
- [ ] Cloudflare Access active on /admin/* in prod; Supabase MFA enforced (aal2 middleware test)
- [ ] Role matrix enforced in server actions (tests per role per action, not just UI hiding)
- [ ] Profile approval flow end-to-end: one item unifies ID doc + profile + photos · claim broadcast visible to a second admin · doc URL TTL ≤5min · every doc issuance AND render in audit_log · one approve verifies the ID + publishes the profile + approves its photos and schedules the doc purge · reject reason reaches the user's dashboard verbatim · media triage ordering + blurred-by-default per-item reveal
- [ ] Escalation reports pin + site-wide admin banner via realtime (test: insert escalation → banner within 2s)
- [ ] Thread access governance: support role denied · report-scoped default · full-open requires reason · audit entry created (asserted)
- [ ] Platform messages: distinct Platform identity in the user's inbox · replies land in Support inbox · template versions logged
- [ ] Relations panel resolves a seeded tangle (agency + 3 profiles + reports + threads) in one view
- [ ] Completeness view matches hand-computed fixtures; shown identically to the professional as "profile strength"
- [ ] Queues usable on a phone (MOBILE.md automated checks on queue screens)
- [ ] Audit viewer filters + export; sensitive reads visually flagged
- [ ] Every admin component on /kitchen-sink (both themes, mock data); `tests/architecture.test.ts` + `tests/style.test.ts` green on admin code
- [ ] `/admin` absent from sitemaps, noindex, locale-less routing works
