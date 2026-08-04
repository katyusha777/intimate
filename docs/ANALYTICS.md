# ANALYTICS.md — PostHog Plan

PostHog EU Cloud (Frankfurt, AWS eu-central-1) is our analytics platform. It bundles product analytics, web analytics, session replay, feature flags, experiments, surveys, and error tracking under usage-based pricing with per-product free tiers (1M events, 5K recordings, 1M flag requests, 250 survey responses/mo) and per-product billing caps. **It is also our error tracker — we do not use Sentry** (one vendor, one SDK, errors correlated with the same session/flag context).

**Hosting path: EU Cloud now → likely self-hosted before launch.** Build everything cloud-first, but keep the migration trivial: the instance URL lives in ONE place (the `/relay` proxy target + the server-side client config, §3) — no `*.posthog.com` reference anywhere else in code. Self-hosting note: PostHog self-hosted (Docker, open-source hobby deploy) has no error-tracking/replay parity guarantees and no support — the switch is a deliberate pre-launch decision (data sovereignty for an adult platform), re-checked against feature parity when we make it. Event schema, wrapper, and dashboards carry over unchanged; historical cloud data does not migrate automatically (accepted — pre-launch data is disposable).

**Two laws before anything else:**
1. **Privacy law of this product:** we run an adult platform. Behavioral data about *clients* is radioactive. We collect the minimum that improves the product, anonymously wherever possible, and some PostHog products stay OFF for visitors permanently (see §2).
2. **Boundary law:** PostHog measures the product for US. **Professional-facing stats (her views, her contact clicks) come from first-party Postgres counters, never from PostHog** — adblockers make client-side analytics undercount, and her business numbers must be complete and realtime. PostHog and the first-party counters may disagree slightly; hers are the truth we show her.

---

## 1. Products we use, and when

| PostHog product | Use | Phase |
|---|---|---|
| Web analytics | Plausible-style dashboard: traffic, sources, **AI-referral channel**, devices, paths | Launch |
| Product analytics | Event funnels per §4 (registration, wizard, import, contact conversion) | Launch |
| Feature flags | Kill switches + gradual rollouts (InstallCoach, ranking tweaks, new features) | Launch |
| Surveys | Feedback from professionals (the founding-cohort strategy, instrumented) | Fast follow |
| Experiments (A/B) | Card layout, coach-mark copy, ranking variants | Post-launch |
| Error tracking | **Our error tracker — no Sentry.** Client + Worker exceptions land in PostHog (one vendor, same EU project, same proxy) | Launch |
| Session replay | **OFF for all public/client surfaces, permanently.** Optional later: professional onboarding/wizard only, explicit consent, all inputs masked | Not at launch |
| Group analytics | Agencies as groups (org-level product usage) | Later, if needed |

Session replay rationale, stated once: recordings of clients browsing an adult marketplace would be the most sensitive dataset we could possibly hold, for marginal product insight. The funnel events in §4 answer the same questions. This is a permanent product decision, not a launch shortcut.

## 2. Privacy & consent model

- **EU hosting** (eu.i.posthog.com ingestion), no US transfer.
- **Anonymous by default.** Visitors and clients are tracked as PostHog *anonymous events* (also ~4x cheaper): `person_profiles: 'identified_only'`, no identify() call for visitors — ever for clients on public browsing.
- **Cookieless pre-consent:** initialize with `persistence: 'memory'` (no cookies/localStorage) until consent; flip to persistent on accept. Analytics events pre-consent are anonymous, session-scoped, and contain no identifiers — aligned with the consent banner's "essential + anonymous analytics" default.
- **identify() only on login**, with the account UUID only — never email, never name, never phone. Person properties limited to: role (client|professional|agency), locale, theme, created_at. Professionals get product-usage tracking (they're business users improving their tool); clients stay pseudonymous even logged in (account UUID, no enrichment).
- **Autocapture OFF.** Explicit events only (§4) — controls both privacy and event-volume billing.
- **Property hygiene (enforced in the typed wrapper, §5):** no free-text user input in properties (no search text — use the *structured* filters only), no message content, no URLs with querystrings that could carry tokens, no client IP retention (enable PostHog IP anonymization), profile *slugs* are fine (public data).
- Data retention: set to 12 months.
- Cookie/consent copy names PostHog EU explicitly; opt-out honored via `opt_out_capturing()` and respected in the wrapper.

## 3. Implementation (Astro + Workers)

- **Reverse proxy through our domain** (adblock resistance — a large share of our privacy-conscious audience runs blockers): Worker route `https://<domain>/relay/*` → `https://eu.i.posthog.com/*` (static assets via eu-assets host). Configure `api_host: '/relay'`, `ui_host: 'https://eu.posthog.com'`. Never use the default posthog domain client-side.
- **posthog-js** loaded lazily (after hydration/idle) — zero impact on LCP; it must never enter the critical path or the <50KB public-page JS budget conversation (loaded async post-interactive, not counted against the island budget, but keep the wrapper tiny).
- **View Transitions:** automatic pageview capture misses soft navigations — capture `$pageview` manually on `astro:page-load` (fires on initial + every transition), with `$pageleave` on `astro:before-swap` for bounce/duration correctness.
- **Server-side events** (posthog-node from Workers, batched, `flushAt` tuned for edge): events that must not depend on the client — `profile_published`, `verification_decided`, `import_completed`, `account_created`. Same event schema, `source: 'server'` property.
- **Feature flags on the edge without flicker:** evaluate flags server-side in the Astro request (posthog-node with a KV-cached flag-definitions poll, or `/decide` remote evaluation with KV cache, TTL ~60s), render the chosen variant in SSR, and **bootstrap** the flags into posthog-js so client and server agree. No client-side flag flicker, ever — it's a native-feel violation.
- `capture_performance` web vitals: ON (free ammunition for the performance budgets).
- `debug` mode + a separate PostHog project for **staging** — staging events never pollute production analytics. Two projects: `<brand>-prod`, `<brand>-staging`.

## 4. Event taxonomy (the complete launch set — nothing else gets sent)

Convention: `object_action`, snake_case, past tense for completed things. All events carry auto: locale, theme, device class, `app_mode` (browser|standalone — from display-mode media query; measures PWA adoption), `source` (client|server).

**Acquisition/context (anonymous):**
- `$pageview` / `$pageleave` (manual, per §3) — page_type property: home|city|category_city|profile|content|dashboard…
- Channel: PostHog custom channel type defs classify referrers chatgpt.com/openai/perplexity/claude/gemini/copilot → **"AI"** channel (the headline acquisition metric, per our own traffic data)

**Discovery (anonymous):**
- `search_performed` {city, category, filters_used: [taxonomy keys only], result_count, sort}
- `filter_opened`, `filter_applied` {filter_key, value_count}
- `profile_viewed` {profile_slug, position_in_results?, from: search|city|home|similar|direct}
- `gallery_opened` {photo_count}

**Conversion (anonymous — THE metrics):**
- `contact_clicked` {channel: phone|whatsapp|telegram|…, profile_slug} ← the north-star conversion
- `favorite_added` / `favorite_removed` {profile_slug, logged_in: bool}

**PWA/app:**
- `install_coach_shown` / `_dismissed` / `_completed_guide`
- `app_installed` (heuristic: first `$pageview` with app_mode=standalone per device) — plus `?source=pwa` start_url lands as UTM automatically

**Professional funnel (identified from account creation):**
- `account_created` {role, method} · `onboarding_step_completed` {step} · `import_started` {source_domain} · `import_completed` {fields_filled_pct, duration_s} · `import_failed` {stage}
- `profile_submitted` · `profile_published` (server) · `verification_submitted` · `verification_decided` {outcome} (server)
- `profile_paused` / `profile_activated` · `install_coach_shown` in dashboard context (the push-notification pitch surface)

**Client funnel (identified only after login, still minimal):**
- `account_created` {role: client} · `saved_search_created`

**Meta:** `theme_changed`, `locale_changed`, `consent_updated` {level}

Property values from taxonomy keys only — never free text. This list is the contract; adding an event = PR that edits this file first.

## 5. Typed wrapper (the only way events get sent)

`src/lib/analytics.ts`: a typed `track()` whose event names + property shapes are a TypeScript union generated from §4 (and Zod-validated in dev). Rules enforced in the wrapper: consent gate, no-PII property lint (dev-time assert against forbidden keys/patterns), automatic context props, no-op when PostHog unavailable (blocked/erroring analytics must never break the product — fire-and-forget always). Server twin in `src/lib/analytics-server.ts` with the same types.

## 6. Dashboards & insights (build these in PostHog at launch, not "later")

1. **Acquisition:** sessions by channel with AI split per platform (ChatGPT vs Perplexity vs Claude…), by locale, by country — the SEO.md §9 measurement loop's quantitative half.
2. **Conversion:** `profile_viewed → contact_clicked` funnel; contact rate by city, category, position-in-results; favorites rate.
3. **Supply funnel:** `account_created → onboarding steps → profile_submitted → published` with the import path vs manual path compared (import wizard ROI, measured).
4. **Verification ops:** submitted→decided time (from server events) — the moderation SLA.
5. **PWA adoption:** app_mode split, install-coach funnel, standalone retention (professionals especially).
6. **Web vitals:** p75 LCP/CLS/INP by page_type — the performance budget, observed in the field.
Weekly review ritual: these five dashboards + the SEO prompt audit = the whole measurement loop.

## 7. Feature flags & surveys (how we'll actually use them)

- Flags at launch: `install-coach` (rollout %), `ranking-v2` (server-side, ranking function variants), `online-tab` (the deferred 4th tab — ship dark, flip when supply density justifies), per-feature kill switches for realtime layers (graceful degradation is a flag away).
- Surveys (fast follow): targeted to role=professional after N sessions — "What's missing? What's broken?" (open text + score). This instruments the founding-cohort feedback strategy; responses reviewed weekly, answered visibly (the anti-kinky.nl move).
- Experiments only after baseline data exists (≥2 weeks) — first candidates: card info hierarchy, InstallCoach copy per locale.

## 8. Billing guardrails

- Per-product spending caps set on day one: analytics, flags, surveys (small), replay ($0 — it's off), error tracking (if adopted).
- Anonymous-first + autocapture-off + the §4 contract keep event volume lean; 1M free events/mo covers our current scale many times over — expected launch cost: **€0/mo** until real growth.
- Flag requests: server-side KV-cached evaluation keeps request counts near-zero vs client polling.
- Review usage monthly; the wrapper's event contract prevents accidental event explosions (the classic PostHog bill story).

## 9. Rollout phases

**A (with launch):** proxy Worker route · posthog-js lazy init + consent gating · typed wrapper · §4 events wired · manual pageviews for View Transitions · two projects (prod/staging) · channel defs for AI · dashboards 1–2 · flags bootstrapped server-side · billing caps.
**B (weeks 1–2 post-launch):** server-side events · dashboards 3–6 · first survey to professionals.
**C (when data justifies):** experiments · group analytics for agencies if org-level questions arise · revisit replay for professional-onboarding-only with consent (requires a deliberate decision + this doc updated).

## 10. Definition of done (Phase A)

- [ ] `/relay` proxy works; no requests to *.posthog.com from the page; events arrive in EU project
- [ ] Consent flow: pre-consent = memory persistence + anonymous; accept = persistent; decline = opt-out honored
- [ ] No identify() before login; person properties limited to the §2 set (assert in wrapper tests)
- [ ] Pageviews fire on every View Transition navigation (Playwright test: navigate 3 pages, expect 3 $pageviews)
- [ ] §4 events implemented via wrapper only — CI grep: no raw `posthog.capture(` outside src/lib/analytics*
- [ ] PII lint passes: forbidden property patterns (email/phone/free-text keys) fail dev build
- [ ] Flags render server-side with client bootstrap — zero visible flicker (Playwright screenshot compare)
- [ ] app_mode + AI channel classification verified with real fixtures
- [ ] Billing caps set; replay confirmed disabled at project level
- [ ] Analytics failure (blocked script) breaks nothing — Playwright run with /relay blackholed passes all product flows
