# SEO Build Plan — status & phases

Execution tracker for `SEO.md` (the spec; read it first). Organized by *when*
each item can be built. Update statuses as phases land.

## Phase 1 — skeleton (DONE, this codebase)

| Item | Spec | Status |
|---|---|---|
| Locale routing: everything under `/{nl\|en\|de}/`, no locale-less URLs | §2 | ✅ `src/middleware.ts` + paraglide URL strategy |
| `/` 302 by Accept-Language (fallback en) | §2 | ✅ middleware, `negotiateLocale()` tested |
| Full reciprocal hreflang + x-default→en, localized slugs mapped | §2 | ✅ Layout `alternates` prop; `_listing.ts` builds per-locale paths |
| Canonicals: querystrings → clean path | §1.8 | ✅ every listing page |
| Localized category slugs (prive-ontvangst / private-visit / privatempfang…) | §2 | ✅ `LISTING_CATEGORIES.slugs`, collision-tested vs city slugs |
| City hubs `/{l}/{city}/` + category×city pages | §2 | ✅ one route, disambiguated by slug set |
| Answer-first intro from live data, per locale (= meta description) | §3 | ✅ `seo_intro` message, `_listing.ts` |
| Visible "Updated {date}" | §3 | ✅ listing + stats pages |
| Title templates per locale | §3 | ✅ `title_listing` message |
| JSON-LD: WebSite+SearchAction, Organization, ItemList, BreadcrumbList | §4 | ✅ `src/lib/seo.ts`, tests |
| robots.txt with AI-crawler allowlist | §1.2 | ✅ + CI test asserting every bot allowed |
| llms.txt (static v1) | §1.7 | ✅ `public/llms.txt` |
| Sitemap index + per-locale listings sitemaps, real lastmod, no empty pages | §1.4 | ✅ dynamic endpoints |
| Stats page per locale from live data | §5 | ✅ `/{l}/stats/` |
| Profile description translations (base + per-locale JSON) | — | ✅ model `description` + `descriptionTranslations`, `localizedDescription()` |
| Facts in raw SSR HTML | §1.1 | ✅ by architecture (zero-JS default) |

## Phase 2 — schema/auth time (build WITH the real DB)

- [ ] Profile pages `/{l}/profile/{slug}/` → then: profiles sitemaps per locale,
      ProfilePage/Person JSON-LD, answer-first profile summary line, OG image =
      SFW cover (tiered photo policy).
- [ ] HTTP 410 for blocked/deleted profiles + IndexNow removal ping (§1.6).
- [ ] IndexNow wired into the publish/update/delete pipeline (§1.5) — a
      `services/indexnow.ts` called from server actions; `INDEXNOW_KEY` env exists.
- [ ] FAQPage JSON-LD on city/category templates (needs written Q&As ×3 locales, §4).
- [ ] llms.txt regeneration weekly (Cloudflare Cron) from live hubs (§1.7).
- [ ] Stats page daily regeneration/cache + Dataset markup consideration (§5).
- [ ] Description auto-translation pipeline (OpenRouter) filling
      `description_translations` on profile publish/edit.

## Phase 3 — launch window

- [ ] 301 map from old WordPress URLs, shipped with cutover, curl-verified (§2).
- [ ] Content cluster: 6 pieces × 3 locales with FAQ schema (§6).
- [ ] Lighthouse mobile 95+ CI gate on home/city/category×city/profile (§7).
- [ ] OG cards verified with crawler-UA fetches (§3).
- [ ] Cloudflare AI-crawler blocking OFF for allowlisted bots; bot rules never
      challenge them (§1.3) — dashboard task, document the setting.
- [ ] Bulk IndexNow ping of all URLs + sitemap submissions (§8.4).

## Owner tasks (off-repo, THIS WEEK per §8)

- [ ] Bing Webmaster Tools: register CURRENT site + sitemap now.
- [ ] Brave Webmaster + Google Search Console: same, now.
- [ ] Baseline prompt audit (~25 prompts, §9) against the current site.

## Measurement (from launch, §9)

- [ ] AI-referral classification (server-side referrer log / KV counter).
- [ ] Weekly prompt audit routine · Bing position tracking · indexation counts.
