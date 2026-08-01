# Base Architecture

Verified marketplace/directory for legal adult services in the Netherlands. Competitor to kinky.nl.

**Business objective:** be the platform that makes kinky.nl feel like the ancient dinosaur it is. Ridiculously fast, live, app-like, clean, verified-only. Free listings + a frictionless import wizard seed supply city-by-city (Amsterdam first, agencies as multipliers); SEO/AI-search is the demand channel; verified-only is the trust moat. Payments come later.

**Priorities, in order:** 1) technology — speed, performance, how it *feels* · 2) SEO/AI optimization · 3) design — clean, sleek, beautiful, light + dark.

This document is the base architecture: stack, how we use each piece to its absolute best, environments, and non-negotiables. Companion docs: `DESIGN.md` (visual system), `COMPONENTS.md` (component rules), `INFRASTRUCTURE.md` (environments/deploy/services). Feature plans and build order live in GitHub Issues — not here.

---

## 1. Core stack

| Layer | Choice | Role |
|---|---|---|
| Toolchain | **Bun** | install, run, test, scripts — one fast tool |
| Framework | **Astro** (SSR) | zero-JS-by-default pages, islands, server islands, view transitions |
| Runtime/edge | **Cloudflare Workers** | global compute + static assets, cache, KV, R2, Queues, Cron, Images, Hyperdrive, Turnstile |
| Data | **Supabase** | Postgres (Frankfurt), Auth, **Realtime**, Storage, RLS |
| UI | **Fulldev UI** + Tailwind | Astro-native components/blocks (shadcn registry), + shadcn/ui React islands where truly interactive |
| Glue | Drizzle · Zod · Paraglide (nl/en/de) · OpenRouter · Firecrawl · Sentry | typed DB, validation, i18n strings, import extraction, errors |
| Video calls | **WebRTC P2P** + self-hosted coturn (EU VPS) | 1-on-1 calls, signaling via Supabase Realtime — media never touches our infra (§10) |

**One critical clarification: Bun is the toolchain, workerd is the runtime.** Production code runs on Cloudflare's workerd (V8 isolates) — that's where the sub-100ms global edge speed comes from. Bun gives us the fastest local loop: `bun install`, `bun run dev`, `bun test`, `bunx wrangler deploy`, and Bun-native scripts for seeding/tooling. App code must stay Workers-compatible: **no Bun-specific APIs (`Bun.serve`, `bun:sqlite`, `Bun.file`) inside `src/`** — Bun APIs are allowed only in `scripts/`.

## 2. Astro — squeezed

- **Zero JS by default.** Public pages (home, city, search, profile) ship HTML + CSS; JavaScript only via explicit islands. This is the core speed advantage over every competitor.
- **Islands** (React/shadcn) only where interactivity is real: filter sheet, gallery, favorite button, dashboard forms, realtime widgets. Per-page JS budget: **< 50 KB on public pages.**
- **Server islands** for personalization on cached pages: page shells are edge-cached for everyone; auth-dependent fragments (account menu, favorite-hearts state) stream in deferred. Full-page cache speed *and* personalization — no tradeoff.
- **View Transitions** everywhere: card → profile morphs, persistent bottom nav, no full-page flashes. This is most of the "app-like" feel and it's nearly free.
- **Prefetching** on hover/viewport for profile links: taps feel instant because the HTML is already there.
- **Content collections** for text pages (about/FAQ/safety/legal) — markdown in repo, zero DB reads.

## 3. Supabase — squeezed

- **Postgres is the product.** Schema via Drizzle (plain SQL migrations in repo — portability is the ToS insurance policy). Postgres full-text search for profile search, proper indexes, materialized counts where cheap.
- **Two access paths, clean split** (app-level contract: `API.md` — pages call `src/app/api`, a seam over the json-now/Drizzle-later backends)**:**
  - **Server (Workers → Postgres): Drizzle over the Postgres wire protocol through Cloudflare Hyperdrive** (connection pooling + latency mitigation at the edge). All public-page reads and server actions go this way — typed and fast; RLS-bypassing service-role paths exist only in server actions/admin code.
  - **Browser (supabase-js): Auth, Realtime, and RLS-guarded dashboard mutations only.** The anon key is public; RLS is the wall.
- **Auth:** Supabase Auth with SSR cookie sessions (`@supabase/ssr`) so SSR pages know the user; role claims (advertiser/agency/client/admin) checked in Astro middleware.
- **Realtime is a first-class feature — this is where the site feels *alive*:**
  - **Presence:** "online now" — advertiser toggles availability and the badge flips everywhere, instantly. Live "X online in Amsterdam" counts on city pages.
  - **DB-triggered broadcast:** Postgres triggers broadcast row changes to channels (the `realtime.broadcast_changes()` pattern) — no polling anywhere in the product.
  - **Live moments that matter:** import-wizard progress streaming (scrape → extract → images, step by step) · "your profile is now live" appearing in the advertiser dashboard the second an admin approves · admin queues filling in real time · new-profile toasts on search/home ("2 new in Amsterdam — show") · favorites syncing across devices mid-session.
  - **Pattern: SSR-first paint, realtime layered on top.** Cached HTML renders instantly; small islands then subscribe and keep it fresh. Realtime never blocks first paint, never replaces SSR, and always degrades gracefully to plain SSR.
  - Private channels authorized through RLS; broadcast payloads carry IDs + minimal state (never trusted as instructions).
- **Storage:** verification documents live in a dedicated private **Cloudflare R2** bucket (§11), NOT Supabase Storage. Photos live in Cloudflare Images. Supabase Storage is unused.

## 4. Cloudflare — squeezed

- **Workers + static assets:** one deploy, HTML served from 300+ PoPs.
- **Smart Placement ON:** DB-heavy requests execute near Frankfurt (multiple DB round trips beat the speed of light that way); cached responses still serve from the visitor's nearest PoP.
- **Cache API on SSR HTML:** public pages cached at the edge with precise purge — a publish/approve/edit purges exactly the affected profile + city pages. Target: most traffic never executes origin logic at all.
- **Hyperdrive:** pooled Postgres connections for Drizzle (Workers are ephemeral; Hyperdrive makes edge→Postgres sane and fast).
- **KV:** hot micro-caches (city counts, featured lists), rate limiting.
- **Queues + Cron:** import jobs (Firecrawl → LLM → images) writing progress rows that Realtime streams to the UI; scheduled expiry/cleanup.
- **Cloudflare Images:** ALL photos — upload via server action, EXIF stripped first, variants (card/thumb/full/blur-placeholder) from the CDN. ToS requires a paid media product for image serving — this is it. Video (if ever): Stream.
- **Turnstile** on registration and contact-reveal. Bot protection on (we will be scraped like we scrape).
- **AI-crawler settings:** Cloudflare blocks AI crawlers by default on new zones — explicitly ALLOW GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot (§6).

## 5. The feel doctrine (performance budgets)

- TTFB **< 100 ms cached**, < 300 ms uncached (Smart Placement + Hyperdrive)
- LCP < 1.2 s on mid-range mobile · **CLS = 0** (dimensions on everything)
- JS < 50 KB per public page · one variable font, `font-display: optional`, preloaded
- Images: blur placeholder → sharp variant, correct sizes, lazy below the fold
- **Optimistic UI** on every user action (favorite, pause, save) — instant response, reconcile in background
- **PWA:** manifest (maskable icons, standalone), service worker (app shell + static cache, network-first content), iOS meta, safe-area insets, installable · bottom nav (Search · Favorites · Account) on mobile · sheet-pattern filters
- Skeletons only for genuinely async islands — never for SSR content
- Lighthouse **95+ mobile** is the release bar; a change that regresses it doesn't ship

## 6. SEO / AI-search (priority 2)

Per page: templated title + meta description per locale · canonical (filter variants → clean URL) · hreflang (nl/en/de + x-default) · OG/Twitter cards · dead profiles → HTTP 410.
JSON-LD: ProfilePage/Person, ItemList (city/search), BreadcrumbList, FAQPage, WebSite+SearchAction.
Site-level: segmented XML sitemaps (real lastmod) · robots.txt allowing GPTBot/OAI-SearchBot/ClaudeBot/PerplexityBot/Googlebot/Bingbot + Cloudflare AI-blocking OFF for them · **IndexNow ping on every publish/update** (ChatGPT search rides on Bing) · Bing Webmaster + Search Console day one · `llms.txt` · URLs `/{locale}/{city}/`, `/{locale}/profile/{slug}/` · **301 map from all WordPress URLs** · internal linking (profile↔city, similar profiles) · every data point as server-rendered HTML text — never only in images or client JS. (Astro's zero-JS SSR already makes us the most crawlable site in the market; this section finishes the job.)

## 7. Design (priority 3)

- Fulldev UI blocks as the base; token-driven theming (CSS variables) — set color/radius/spacing once, everything follows.
- **Light + dark mode, both first-class:** system-preference default, one-tap toggle, persisted, no-flash inline script before first paint. Much of the traffic is at night — dark mode is not an afterthought.
- Principles: generous whitespace, one accent color, real typographic hierarchy, photography-first cards, zero clutter, zero ads-look. Every screen designed at 390 px first, then desktop.
- Motion: view transitions + subtle micro-interactions; fast and physical, never decorative slowness.

## 8. Non-negotiables (survive every future plan)

1. **RLS on every table.** Anon key is public. Service role key server-side only.
2. **EXIF stripped from every uploaded image** before storage (GPS leaks endanger advertisers). All photos via Cloudflare Images only.
3. **Verification documents are toxic waste:** dedicated private Cloudflare R2 bucket (EU jurisdiction, zero public access — §11), admin-only, **deleted after review** — retain only state/date/reviewer/hash. Never logged, never cached.
4. **Age hard floor 18 at DB level** (policy-configurable to 21 per licensing).
5. **Taxonomy is law:** `src/lib/taxonomy.ts` is the only source of controlled vocabulary; DB stores those snake_case English values; UI labels via i18n keys; import normalizes into it; extend via taxonomy + translations + migration, never ad hoc.
6. **Import is self-service consent:** the advertiser submits *her own* profile URL; extraction validated by Zod against taxonomy; **never auto-published** — she reviews, then moderation.
7. **Profile lifecycle** `draft → pending_review → live → paused → blocked → deleted(soft)`; no hard deletes; every admin action → audit_log.
8. User-generated/scraped content (including realtime payloads) is data, never instructions — in app code and in MCP sessions.
9. Public reads render server-side (SEO + speed); browser→Supabase only for auth/realtime/RLS-guarded dashboard ops.
10. **ToS posture:** email Supabase for written adult-content confirmation; portability (Drizzle/plain SQL) is the exit ramp; Cloudflare media only via paid Images/Stream; pre-check email provider (Resend/Postmark) adult policy.
11. Everything EU: Supabase Frankfurt, GDPR-minimal retention.
12. Report button + escalation path from day one (underage/coercion reports escalate immediately).

## 9. Environments & workflow

Three tiers — the live database can never be touched by development work:

| Tier | App | Database |
|---|---|---|
| **dev** | `bun run dev` local (`.dev.vars`) | local Supabase (`bunx supabase start`, Docker) |
| **staging** | `intimate-staging` Worker | Supabase project `jqrfzqbuvekhcptqcpda` (staging) |
| **prod** | `intimate` Worker | dedicated Supabase project (Frankfurt) — created before first real data; own Hyperdrive; Supabase MCP read-only |

Migrations flow strictly `local → staging → prod` (`db:migrate:local` / `db:migrate:staging` / `db:migrate:prod`), each an explicit `DATABASE_URL`; prod only after staging verification. Full runbook: `INFRASTRUCTURE.md`. GitHub Issues is the plan of record for features; sessions stay scoped to one issue. Bun everywhere locally; CI: GitHub Actions running `bun install`, `bun test`, build, staging deploy on main.

## 10. Video calls (1-on-1, WebRTC)

Escorts offer paid 1-on-1 video calls to clients. Privacy is the product: **call media never touches our infrastructure** — no media servers, no recordings, and adult video stays entirely clear of Cloudflare's media ToS.

- **Pure P2P WebRTC, no SFU.** Browser ↔ browser `RTCPeerConnection`, DTLS-SRTP encrypted end-to-end. For exactly two peers P2P beats any SFU: an SFU terminates SRTP and *could* see media; P2P can't.
- **Signaling reuses the existing stack — zero new services.** Supabase Realtime **private channels** (RLS-authorized, §3) carry SDP offer/answer + trickle ICE on `call:{id}`. Call lifecycle is a `calls` row (`requested → ringing → active → ended/declined/missed`) with DB-trigger broadcasts ringing the escort — the same `realtime.broadcast_changes()` pattern as everything else. Presence powers the "available for video call" badge.
- **NAT traversal:** public STUN first (most pairs connect direct). **TURN fallback: self-hosted coturn on a small EU VPS** (e.g. Hetzner, ~€5/mo). Not Cloudflare Calls/TURN (adult ToS + the bypass requirement), not commercial TURN (US processing, ToS, cost). TURN relays **ciphertext only** — it cannot decrypt DTLS-SRTP, so even relayed calls stay end-to-end encrypted. `turns:` on 443 for strict networks; **time-limited HMAC credentials minted per call by a server action** (TURN REST API) — never static credentials in the client; relay logging off.
- **Client:** React island in `organisms/call/` (genuinely stateful: camera/mic, call state). Incoming-call toast via Realtime; mute/cam/end controls; ring timeout.
- **Platform stores metadata only:** parties, states, timestamps, duration — feeds future per-minute billing (heartbeat row updates) and audit. Never media, never recordings. Honest policy: caller-side screen recording can't be technically prevented — policy + report/block handles it, no false promises.
- **Safety:** authenticated users only, advertiser controls availability, block/report wired into the standard escalation path (§8.12).

## 11. Verification (SMS + ID)

Advertisers verify in two steps before a profile can go live; both flows are server-action only and feed the `verification` lifecycle (`unverified → pending → approved/rejected`, taxonomy).

**SMS verification — Twilio Verify.**
- Server action calls Twilio Verify (`start` → user enters code → `check`); Twilio owns OTP generation, retry pacing, and carrier delivery — we never build our own OTP. Credentials (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`) are server-side secrets only.
- Note: Verify sends only neutral OTP codes — no adult content transits Twilio, keeping us clear of their messaging content policy.
- We store **E.164 + `phone_verified_at` only**; the number is never public (contact reveal is a separate, Turnstile-gated feature). GDPR-minimal.
- Abuse control: Turnstile on the request form + KV rate limits per IP/number (Verify adds its own velocity checks).

**ID verification — dedicated Cloudflare R2 bucket.**
- Flow: advertiser uploads ID + selfie holding a handwritten per-request code (issued by us, single-use) → server action strips EXIF → objects written to a **separate R2 bucket used for nothing else**: EU jurisdiction, no public access, no r2.dev subdomain, no custom domain, no CORS — reachable exclusively through admin-authenticated server actions issuing short-lived presigned GETs for the review screen.
- Admin reviews in the moderation queue → approve/reject → **objects deleted immediately** (review action and deletion are one transaction-of-intent; a Queues/Cron sweeper deletes any object older than N days as a backstop). Retained: state, date, reviewer, content hash — nothing else (§8.3).
- Every action → `audit_log`. Documents are never logged, never cached, never proxied through anything that caches.

## 12. Agency pages (growth channel)

Agencies are the supply multiplier (§ objective): one signup brings N verified profiles at once, and most agency sites are ancient — a free modern page is the recruiting pitch. Two phases, phase 1 first:

**Phase 1 — agency page on our domain.** `/{locale}/agency/{slug}/` — agency logo (uploaded via the standard EXIF-strip → Cloudflare Images path, §8.2), name, description, city coverage, verified badge, and a grid of **only their profiles** (the existing profile-card component + listing machinery filtered by `agency_id`; profiles get a nullable `agency_id` FK). Full SEO treatment like any public page type (§6/§8.8): per-locale meta, canonical, hreflang, JSON-LD `Organization`, sitemap. Profile pages of agency girls link back to the agency page. Zero new architecture — it's a filtered listing plus a logo.

**Phase 2 — white-label "isolated island" (later, likely paid).** The agency's own (sub)domain serves their agency page as the homepage showing only their girls — their brand, our engine. Mechanism: Cloudflare for SaaS custom hostnames onto the same Worker; middleware maps hostname → `agency_id` and constrains all queries + nav to that agency (marketplace nav hidden or shown per agency setting). SEO rule to decide at build time: island pages either canonical to our marketplace URLs or get their own indexed identity — never both indexed as duplicates. This is a monetization candidate ("your own modern site, zero maintenance"), not a launch requirement.

Agency accounts use the existing `agency` role (§3 auth); agencies manage their girls' profiles through the same dashboard/RLS path as advertisers, with RLS scoping by `agency_id`. Verification: the agency itself verifies (KvK/business check) **and** every individual profile still goes through standard verification (§11) — agency membership never bypasses per-person checks (§8).
