# AI Search & SEO — Build Spec

**Read this as requirements, not suggestions.** Priority order: (1) AI search — ChatGPT above all, then Perplexity/Claude/Gemini; (2) classic SEO — Bing explicitly ahead of Google; (3) both served mobile-first.

**Why this order — our own data (Jul 2026, old WordPress site):** ChatGPT is the **#1 traffic source** (389/mo — ahead of Direct at 331, ~4× Google at 89) with zero optimization, no Bing registration, and one dummy profile. 87% of visitors are mobile (iOS 495 / Android 229 vs Windows+Mac 98). Germany is the #2 country (50) on a Dutch-only site. Engagement: 3.86 pages/visit, 2m45s. The channel already chose us; this spec is how the new site captures it deliberately.

**Mechanics to never forget:** ChatGPT Search rides **Bing's index** (~87% of ChatGPT citations match Bing top results). Claude rides **Brave**. AI crawlers do not reliably render JavaScript. LLMs cite only 2–7 domains per answer. Freshness is weighted heavily.

---

## 1. Hard technical requirements (build-time)

1. **Every fact in raw SSR HTML.** Profile data, rates, counts, services — never only in images, client JS, or hydrated islands. (Astro zero-JS default already guarantees this; never regress it.)
2. **robots.txt** — Allow: Googlebot, Bingbot, GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, Claude-SearchBot, anthropic-ai, PerplexityBot, Brave. Disallow: /admin, /dashboard, /api, /auth. No blanket disallows.
3. **Cloudflare:** AI-crawler blocking OFF for the bots above (ON by default for new zones — verify in dashboard, document the setting). Bot-protection rules must never challenge these UAs.
4. **Sitemaps:** segmented per type and locale (profiles / cities+categories / content), real `lastmod`, auto-regenerated on publish. Index sitemap at /sitemap.xml.
5. **IndexNow:** ping on every profile publish, update, and removal, and on every content-page change. This is wired into the publish pipeline, not a cron afterthought. (Instant Bing/Brave indexing = our freshness edge; ChatGPT citation eligibility follows Bing.)
6. **HTTP 410** for blocked/deleted/expired profiles + IndexNow removal ping. No soft-404s.
7. **llms.txt** at root: markdown overview of the site (what it is, verified-only claim, links to city/category hubs per locale + key guides). Regenerate weekly via cron.
8. **Canonicals:** filter/sort querystrings canonicalize to clean path. Indexable = path-level pages only (locale, category, city, profile, content).
9. **No cloaking.** Bots get exactly what users get.

## 2. URL & language architecture

- Locales `/{nl|en|de}/`, full hreflang + x-default everywhere. **EN and DE ship at launch** — DE demand is already arriving with zero DE content; tourist EN/DE queries are the underserved wedge.
- Programmatic pages (the demand surface):
  - `/{locale}/{city}/` — city hub
  - `/{locale}/{category-slug}/{city}/` — category × city, localized slugs (nl: prive-ontvangst, en: private-visit, de: privatempfang, etc.)
  - Category slugs map to the tab presets (tabs are filters over one pool; these pages ARE the tabs, indexable).
- Profiles: `/{locale}/profile/{slug}/`.
- **301 map from the real old-site URLs** (traffic-proven, must survive cutover intact): `/` · `/advertenties/` → new listing index · `/advertenties/{name}/` → profile or city fallback · `/vrouwen/` and `/vrouwen/escort/` → category pages · `/producten/*` and `/marketplace` → nearest equivalent or home · `/auth/` → new auth. Ship the map in the same deploy as cutover; verify with curl before DNS flips.

## 3. Answer-first page templates

AI engines extract the first direct statement that answers the query. Every indexable page opens with one.

- **City/category pages** — generated intro block from live DB data, per locale:
  > "Er zijn {n} geverifieerde professionals voor {category} in {city}. Tarieven vanaf €{min}; {online} nu online. Elk profiel op {Brand} is geverifieerd."
  Same block feeds the meta description. Auto-updates → automatic freshness signal.
- **Profile pages** open with a one-line factual summary (name, age, city, meeting types, from-rate) above the gallery — extractable, and useful to humans on mobile.
- **Titles:** `{Category} {City} – {n} geverifieerde profielen | {Brand}`; profile: `{Name} ({age}) – {Category} in {City} | {Brand}`. ≤60 chars, keyword first, per locale.
- Visible **"Bijgewerkt {date}"** on city/category/content pages.
- OG/Twitter cards on everything; profile OG image = SFW cover (tiered photo policy keeps previews unfiltered).

## 4. Structured data (JSON-LD, every page)

- Home: WebSite + SearchAction, Organization (name, logo, sameAs → socials).
- City/category: ItemList (profiles) + BreadcrumbList + **FAQPage** (2–4 real Q&As per template: legality, verification, what the category means — per locale).
- Profile: ProfilePage/Person (name, areaServed, knowsLanguage) + BreadcrumbList.
- Guides: Article (datePublished, dateModified) + BreadcrumbList + FAQPage where fitting.
- Validate in CI (a test that parses JSON-LD on each template's fixture render).

## 5. The unique-data asset (highest-leverage GEO play)

Auto-generated, per-locale **stats page** (`/{locale}/stats/` or woven into city hubs): verified professionals per city, average/min rates per category per city, % online now, counts by language spoken. Regenerated daily from live data, visible last-updated stamp.
Rationale: LLMs preferentially cite **named, unique statistics**; we are the only party with this dataset. This page is built to be the market's citable source for "how much does X cost in NL" in three languages.

## 6. Content cluster (launch set — write once, ship with the site)

Domain-level topical depth drives AI citation eligibility; informational pages get cited even where adult listing pages are filtered. Launch with, per locale (NL/EN/DE):

1. Pillar: legal adult services in the Netherlands — how it works
2. How our verification works (the trust differentiator, spelled out)
3. Amsterdam guide (the tourist-query goldmine)
4. Pricing guide (sourced from OUR stats page — interlink)
5. Category explainers (one per tab: what it is, etiquette, typical rates)
6. Safety guide (clients + professionals)

Format rules: H2s phrased as questions people ask AI ("Is escort legaal in Nederland?"), direct answer in the first 1–2 sentences under each heading, FAQ schema, dateModified visible, interlinked to pillar + relevant city/category pages. Quarterly refresh cycle after launch.

## 7. Mobile = ranking requirement (not just UX)

87% of our traffic is mobile; Bing and Google rank the mobile experience; slow mobile pages lose both the click and the crawl budget.

- Budgets (from Foundation, enforced here as SEO requirements): TTFB <100ms cached, LCP <1.2s mid-range mobile, CLS = 0, <50KB JS on public pages.
- Lighthouse mobile 95+ on: home, city page, category×city page, profile page — checked in CI, regression blocks merge.
- All QA at 390px first; desktop second. OG images and tap targets verified on iOS Safari specifically (iOS = 60% of traffic).
- PWA shell ships at launch (installability is a retention play for the 87%).

## 8. Off-repo actions (owner tasks — do THIS WEEK, before the new site)

The 4–8 week AI-indexation lag means registrations must predate launch:

1. **Bing Webmaster Tools**: register the CURRENT site now, submit its sitemap. At cutover, the new site inherits a Bing-known domain instead of starting cold.
2. **Brave Webmaster** + **Google Search Console**: same, now.
3. Run the baseline **prompt audit** (see §9) against the current site this week — it's the before-picture.
4. At cutover: submit new sitemaps everywhere + IndexNow bulk ping of all URLs.

## 9. Measurement loop (from launch day)

- Server-side referrer logging → classify chatgpt/openai/perplexity/claude/gemini/copilot as **AI Referral** channel (analytics tool later; a KV counter + log query suffices at MVP).
- **Weekly prompt audit** (~25 prompts, NL/EN/DE: "beste escort site nederland", "verified escorts amsterdam", "escort agentur amsterdam deutsch", per-city and per-category variants) across ChatGPT, Perplexity, Claude, Gemini. Log: cited? recommended? how described? 30 min/week, ground truth.
- Track Bing positions with the same seriousness as Google.
- Leading indicators: Bing/Brave indexation counts, IndexNow acceptance rate, branded search growth.

## 10. Definition of done (Claude Code checklist)

- [ ] robots.txt exactly per §1; CI test asserts allowed bots not disallowed
- [ ] Segmented sitemaps per locale, lastmod real, in sitemap index
- [ ] IndexNow wired into publish/update/delete pipeline (+ removal pings on 410)
- [ ] 410 handling for dead profiles
- [ ] llms.txt generated + weekly cron
- [ ] Canonical + hreflang correct on every template (CI fixture test)
- [ ] Answer-first stat blocks on city/category templates, per locale, from live data
- [ ] Title/meta templates per page type per locale
- [ ] JSON-LD per §4, CI-validated
- [ ] Stats page auto-generation (daily)
- [ ] 301 map for all §2 legacy URLs, curl-verified
- [ ] Lighthouse mobile 95+ CI gate on the four key templates
- [ ] OG cards render correctly (test with real crawler UA fetch)
- [ ] Launch content: 6 cluster pieces × 3 locales, FAQ schema included
