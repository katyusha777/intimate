# UX-PLAN.md — Product/UX build plan (from the 01 Aug 2026 design review)

**Temporary execution tracker — not a living spec. Delete this file when the phases have landed.** The durable principles it carries were moved into the permanent docs (roles-not-genders → CLAUDE.md Conventions; product honesty + the client/professional tension → DESIGN.md §1); everything else here is build instructions that die on completion. Feature specs it amends (MESSAGING.md §4.1) are updated in the building PRs, not here.

Execution plan for the external UX review ("Design review with safe-mode update", reviewed at 390px, safe mode ON). The review's verdicts were accepted with three amendments (§0). Spec here, statuses updated as phases land, one GitHub Issue per numbered item — sessions stay scoped to one item.

**The tension every item serves:** the client wants zero friction to contact; the professional wants enough friction to filter. The winning controls do both at once — the same structure reads as convenience on one screen and as screening on the other.

---

## 0. Amendments to the review (decided, not open)

1. **Roles, not genders.** The review's "him/her" is persona shorthand. Clients may be women; professionals span the full `GENDERS` taxonomy. Rule: code, UI copy, i18n keys, and docs say **client / professional** (existing `ACCOUNT_TYPES`), never gendered pronouns for a role. Persona language is allowed only inside analysis documents. No copy may assume the client is male.
2. **Trust-receipt copy follows hard rule 3 as it is NOW:** documents are held for a bounded legal-retention window, then purged — the receipt says that honestly ("never public, never in the product, purged on schedule"). The review predates this policy and quotes the old instant-deletion wording; that phrasing must not ship.
3. **"Notify me when she's back" is parked** — it assumes web push; MOBILE.md forbids architecture that depends on push existing. It returns as a progressive enhancement when push ships.

## 1. Current-state grounding (what the plan builds on)

- `ProfileCard` (grid/featured/compact) · `SearchListing`/`FilterSidebar` · `ActionSheet` · `Lightbox` · `SafeImage` + safe-images manifest · `ProfileSheet`/`ProfilePhotoMosaic` · `BottomTabBar`/`UserMenu` — all live.
- Profile model: `priceFrom` (no rates table), `openingHours`, static `online` boolean, `birthDate`, services/meetingTypes from taxonomy.
- Messaging: built on the mock backend (threads, messages, contacts, media grant, modes). Enforcement in the action layer until the Supabase swap (MESSAGING.md).
- Presence is mock. Every availability feature below is built against a **derivation helper** so the realtime upgrade (Phase 0 Supabase) swaps the input, not the UI.
- AI search action + input exist (desktop header); safe mode = footer toggle, anime placeholder set, default ON.

## 2. Cross-cutting laws for every item

Kitchen-sink in the same change (both themes + safe mode) · i18n nl/en/de from day one · mobile 390px first, MOBILE.md automated checks · zero-JS unless the item genuinely interacts (the sheets and boss key are the islands; chips/cards/tables are SSR) · taxonomy extensions via `taxonomy.ts` + translations, never ad hoc · style/architecture tests green.

---

## Phase 1 — The honest shelf (home/browse)

The fold answers the every-visit question ("who's here, now?") instead of the first-visit pitch.

**1.1 Fold rework.** Signed-out mobile fold = compact search affordance, live local header line ("AMSTERDAM · 34 ONLINE NOW" — count from data, mock until presence), first row of cards ~fully visible at 390×844. Hero pitch collapses to one line; START ADVERTISING moves to menu + footer (professionals find it deliberately; clients never trip over it). No account CTA above the fold — browsing needs no account and nothing may smell like a signup wall.
**1.2 Ask the city once, then own it.** First visit: `ActionSheet` — "Where are you looking?" — six city buttons + ALL OF NL, stored in a cookie, changeable in the header. Deliberately NO geolocation permission (coarse by design: more private, less scary). From then on the fold is that city's live shelf.
**1.3 Three honest card states.** Availability derives in one helper (`availabilityState(profile, now)` → `online | today_until | back_at`, from presence flag + `openingHours` + `lastActiveAt`): ● Online now / ◐ Today until 23:00 / ○ Back Tue (+ "active today 14:20" when off). Model gains `lastActiveAt`; seed data updated. State lives in dot + text — photos stay calm (Misprint rule 9). Offline cards are never online-minus-a-dot again.
**1.4 Split NEW from ONLINE.** Default sort = ONLINE NOW. "NEW THIS WEEK" becomes its own shelf (the professional's cold-start boost). Each shelf makes one claim it can prove; "NEW & ONLINE." dies.
**1.5 Link-chips.** `[City ▾] [Now · Tonight ▾] [≤ €150 ▾]` — server-rendered link-chips to canonical listing URLs, thumb-height, one tap each. Filter sheet keeps only the long tail.
**1.6 Verified mark on every card name** — verified-only is the moat; assert it per profile, not per marquee slogan.

DoD: fold shows cards at 390×844 (Playwright screenshot) · card states match hand-computed fixtures across timezones/hours edge cases · chips are `<a>` tags (zero JS) · city cookie honored SSR-side without cache poisoning (city via URL, not per-cookie cached HTML variants — the shelf is `/{locale}/{city}/`, the cookie only picks the redirect/default).

## Phase 2 — Rates & the money screen (profile)

The two questions the profile never answers — the real price, and what contact leads to — get answered above the fold.

**2.1 Rates as a first-class object.** Model: `rates: [{ duration: RATE_DURATIONS, incall?: number, outcall?: number }]` + optional `depositPolicy`/`extrasNote`; `priceFrom` becomes derived (min of table). Editor section in ProfileEditorForm; seed data; import wizard extracts it later (noted in its spec). Closing line under every table: "The listed price is the price." Full tables earn a small CLEAR PRICING mark — on the card too (Phase 1 ties in). A nudge, never a requirement.
**2.2 Rates table above ABOUT** (mobile) — duration × price, incall/outcall columns where relevant.
**2.3 One availability truth line.** Merge presence + hours into a single sentence under the name AND in the price/deal card: "● Available today until 23:00" / "○ Back Tuesday 12:00". One shared component (`molecules/AvailabilityLine` fed by the 1.3 helper) — cards, profile, sticky card all consume it.
**2.4 Desktop: the sticky card becomes the deal card.** Compact rates table, availability truth line, request CTA (Phase 4; SEND MESSAGE until then), trust-receipt link. Gender/city/member-since metadata demotes to the card's bottom. The left column keeps ABOUT/SERVICES; the deal lives on screen at all times.
**2.5 Good-to-know rows.** The ten questions clients ask, as structured facts filled once: languages, place (private/hotel/visits), parking, shower, payment methods, deposit. Taxonomy groups + profile fields + editor + a compact two-column list after SERVICES. Every row is one less message answered at midnight.
**2.6 Offline fallback, respectfully.** Only when paused/away: "3 similar profiles online in {city} now" at the very bottom. Never on a live profile — keep the browsing loop alive without shelving a person as inventory.

DoD: rates render in first viewport on 390 · derived `priceFrom` consistent everywhere · good-to-know values are taxonomy keys (labels via i18n) · deal card carries rates/availability/CTA in every scroll position (Playwright).

**Status: ✅ landed.** `rates`/`depositPolicy`/`extrasNote` + good-to-know fields (`languages`/`incallLocations`/`amenities`/`paymentMethods`) added to the profile model; `priceFrom` is derived via `ratesMinPrice()` (schema transform + `myProfile` re-derive) so every reader keeps its number. Components: `organisms/profile/RatesTable` (full/compact), `GoodToKnow`, `SimilarProfiles`; `ProfileFacts` reworked into the deal card; `AvailabilityLine` reused under name + in the card. Editor gains a rates table + good-to-know editor. Seed: all 30 profiles carry a table (min = old `priceFrom`, so nothing shifted).

## Phase 3 — Trust receipts

Dated proof beats badges in a market where everyone has been burned.

**3.1 Receipt sheet.** Tap any verified mark (card or profile) → `ActionSheet` of dated facts: "ID + live selfie · checked Jun 2026" · "Photos verified Jun 2026" · the retention policy in plain words (amendment §0.2) · "Photos watermarked, theft-monitored for advertisers" (deterrence made visible — professional-protection line). Data: verification state/date already retained (hard rule 3); photo-verification date joins the account model.
**3.2 Measured reply speed.** "Usually replies in ~10 min" — system-measured from messaging data (median first-reply time, rolling 30d), shown on profile + receipt. The review-free trust signal this market is allowed to have (we keep NO reviews of people). Mock computation now against KV threads; real SQL view after the swap. Shown only when the sample is honest (≥5 replies) — never fabricated.
**3.3 Member-since demotes** to weakest-last in the receipt, not headline metadata.

DoD: receipt opens from every verified mark · dates come from stored state (no hardcoding) · reply stat hidden below sample threshold · copy passes amendment §0.2 (the pre-amendment instant-deletion phrasing appears nowhere — `tests/docs.test.ts` enforces the banned string).

## Phase 4 — The request sheet (flagship)

Client's zero-effort contact = professional's pre-qualification. Nobody else in the category has it.

**4.1 Spec delta to MESSAGING.md (same PR as the build):** `messages.kind` gains `request` (payload: service, duration, price-at-request, when: now|tonight|slot, note ≤140, screeningAnswer?) · threads gain state `pending` (created by a request; `open` on accept; declined → closed silently client-side, no penalty) · `conversation_settings` gains `screening_question` (≤140, optional) · the client message throttle becomes: **no free-compose until an accepted request** (replaces "3 messages before first reply" for new threads). RLS/action enforcement per MESSAGING.md §4 discipline — mock action layer now, SQL at the swap.
**4.2 RequestSheet organism.** SEND MESSAGE → `ActionSheet`, three taps, all from her data: service (her chips) → duration with price attached (from the 2.1 rates table) → when (Now / Tonight / a slot inside her opening hours) + optional one-line note + her screening question if set. Sends as a compact card. The client never composes cold; the professional never reads "hi"; the price was agreed before word one.
**4.3 Professional side.** Request card in inbox/thread: accept / decline (+ optional quick-reply on decline: "fully booked tonight"). Accept opens chat + system card. Her settings: screening question editor, request on/off rides the existing modes.
**4.4 A private set, granted per accept.** Profile gains an optional locked set: public photos + "5 more, shared when she accepts your request." Unlock is per-thread on accept (rides the existing per-contact grant machinery, reversed direction — her media shown to him). Her photo control becomes a *visible feature* and the client's best reason to send a real request instead of "more pics?".

DoD: MESSAGING.md updated in the same PR · deny tests: free-compose blocked pre-accept, request blocked when mode=off / blocked pair, price snapshot immutable in the card · full flow passes MOBILE.md checks (sheet physics, keyboard) · decline is silent and unpunished.

**Status: ✅ landed.** Taxonomy gains `request` (MESSAGE_KINDS), `pending` (THREAD_STATES) and `REQUEST_WHEN`. `models/messaging.ts`: `RequestPayloadSchema` (immutable `priceAtRequest` snapshot), `Message.request`, `ConversationSettings.screeningQuestion`, `Thread.privateSetUnlocked`; new api methods `startRequest`/`respondRequest`/`setScreeningQuestion`. Enforcement lives in `data/json/messaging.ts` (the mock stand-in for RLS): `send` now gates free-compose on `state === 'open'` (a `pending` thread blocks both sides = the new-thread throttle); `startRequest` denies when mode=off or the pair is blocked and creates the thread `pending`; `respondRequest` (professional-only) accept → `open` + system card + `privateSetUnlocked`, decline → `frozen` silently (optional quick reply only). Profile gains `privatePhotos` (public pages show only the count). UI: `organisms/profile/RequestSheet` (deal card SEND MESSAGE → three-tap ActionSheet), `organisms/messaging/RequestCard` (card + Accept/Decline in the thread), private-set teaser in the deal card + unlocked set in the thread, screening-question editor in settings. Deny tests in `tests/messaging.test.ts`. Kitchen-sink shows the sheet + both card views.

## Phase 5 — The discretion kit (safe mode graduates from dev skin)

Discretion is a client feature too — a wall of bright anime draws the glance it should deflect.

**5.1 Neutral placeholder set.** Second safeimg set: genuinely boring (muted, abstract, gallery-wall neutral). Safe mode becomes three-valued: `off | neutral (default ON for visitors) | dev` (anime — our work-in-public skin). Same fail-closed plumbing (DESIGN.md §6).
**5.2 Toggle on the floating bar.** Mobile: safe-mode toggle joins the floating glass bar (one thumb, every screen). Desktop: an always-visible glass button. Footer keeps a mirror. No more full-page-scroll to the panic switch.
**5.3 Neutral tab title + favicon** while safe mode is on (generic title, monochrome favicon) — the browser chrome is part of the glance test.
**5.4 Boss key (desktop).** Esc·Esc flips safe mode + tab title/favicon instantly, both directions. One tiny island, sitewide.

DoD: all three states in kitchen-sink · toggle reachable without scrolling on every template · tab title/favicon flip verified (Playwright) · fail-closed default intact (no-JS shows neutral set).

**Status: ✅ landed.** Safe mode is three-valued (`off | neutral | dev`); `neutral` is the deterministic muted-SVG set generated in `safe-images.ts` (`neutralImageFor`, no committed files), `dev` is the old anime set. `SafeImage` ships neutral as the fail-closed server `src` + `data-dev`/`data-real`. New `molecules/SafeModeBar` floats above the dock (mobile) / in the corner (desktop); footer + settings keep the `SafeModeToggle` mirror; both cycle off→neutral→dev. The sitewide inline script neutralizes the tab title + favicon while on and restores them off, and adds the Esc·Esc boss key (flips off↔neutral). Kitchen-sink shows all three states. Design decision: the neutral set is generated (SVG gradients) rather than sourced — real discreet stock wasn't available, and generation reuses the existing deterministic-by-key FNV mechanism, keeping SSR/edge cache stable with zero test drift.

## Phase 6 — Finders' quality-of-life

**6.1 The wand on mobile.** AI search opens from the search icon as a sheet with three tappable example queries; parses into taxonomy + presence filters (the existing `aiSearch` action) so typing stays optional. Not promoted to a hero position until it reliably beats keyword matching — the page's best promise must not break on first use.
**6.2 Compare rail from saves (desktop).** Thin SAVED(n) rail — hearts already sync — turns tab-juggling into one row. `compact` ProfileCard variant, no new components.

## Parked (do not build; revisit trigger noted)

Notify-me on offline profiles (→ when web push ships) · response-time SQL view productionization (→ Supabase swap) · import-wizard rates extraction (→ import pipeline build) · neighborhood-level location display (→ only ever as the professional's explicit choice; city-level stays default).

## Sequencing & dependencies

1 → 2 → 3 are independent of messaging and land on the mock data layer (model + seed updates each phase). 4 depends on 2.1 (rates feed the sheet) and amends MESSAGING.md. 5 and 6 are independent and can interleave anywhere. Nothing here waits on Supabase — but 1.3/3.2/4.x are built behind helpers/seams so the realtime + RLS upgrade swaps inputs, not UI. Recommended order: **1, 2, 5, 3, 4, 6** — the shelf and the money screen move the daily numbers; discretion is cheap and protects users in public; the request sheet is the flagship but touches the most surface, so it goes when the rails under it (rates, availability) are real.
