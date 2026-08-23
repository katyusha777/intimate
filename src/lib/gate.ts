/**
 * Registration wall (2026-08-23): the live site is gated — an anonymous HUMAN
 * sees only the /{locale}/welcome/ pitch page (rewritten in place on the home
 * URLs) until they register. Search/AI crawlers and link-preview fetchers pass
 * by user-agent so every public page stays fully indexable (SEO.md §1.9 records
 * this deliberate crawler exception), signed-in users pass by session cookie,
 * and the warm cron passes by its X-Warm secret so the home cache never goes
 * cold. Successor to the pre-launch corridor (lib/prelaunch.ts, deleted at
 * launch b80c5b99) — same pure-function shape so the wall is unit-testable
 * (tests/gate.test.ts); wired in src/middleware.ts BEFORE the KV page-cache
 * read, so gate responses never enter (or leak from) the shared cache.
 */

const LOC = '(?:nl|en|de|ro|it)';
/** `/{locale}/` → rewritten in place to the welcome page (URL stays the home). */
const HOME = new RegExp(`^/${LOC}/?$`);
const WELCOME = new RegExp(`^/${LOC}/welcome/?$`);
/** Anonymous humans keep: legal (the age gate + register flow link here),
 *  support, and the agency pitch page (B2B recruiting — index only, rosters
 *  are product). */
const ALLOWED = new RegExp(`^/${LOC}/(?:privacy|terms|support|agencies)/?$`);
/** The editorial shelf the welcome page links to — real reading, corridor
 *  precedent; articles render with the wall's focus on registering intact. */
const BLOG = new RegExp(`^/${LOC}/blog(?:/[^/]+)?/?$`);
/** Locale-prefixed auth pages (reset/expired); locale-less /auth is BYPASS. */
const AUTH = new RegExp(`^/${LOC}/auth(?:/|$)`);
/** Contact-invite links (a professional shares /c/<token> with a client) — the
 *  page carries its own join prompt; bouncing a warm lead to the generic gate
 *  would lose the invite context. */
const INVITE = new RegExp(`^/${LOC}/c/[^/]+/?$`);
/** ProfileSheet teaser fetch (X-Sheet: 1) — the welcome rail opens profiles in
 *  a sheet: the same taste-of-the-product the corridor allowed. */
const SHEET_PROFILE = new RegExp(`^/${LOC}/profile/[^/]+/(?:avail\\.json)?$`);
/** Non-page infrastructure that must keep working for everyone. Mostly
 *  duplicates middleware BYPASS (which returns earlier) — kept here so the
 *  pure function is safe on its own, plus /sitemap + island endpoints that
 *  BYPASS does not cover. */
const PASS = /^\/(?:admin|auth|api|_actions|_server-islands|_image|media|sitemap)/;

/**
 * Crawlers, AI assistants, link-preview fetchers and perf tooling that bypass
 * the wall. The named set mirrors public/robots.txt (SEO.md §1.2) + the
 * social/chat preview fetchers (shared profile links must unfurl); the generic
 * `bot\b|crawl|spider` tokens catch the long tail (Googlebot, Bingbot, GPTBot,
 * ClaudeBot, Amazonbot, TelegramBot, Slackbot, Discordbot, LinkedInBot,
 * DuckDuckBot, Pinterestbot… all carry a "bot" word-end). Deliberately NO bare
 * brand tokens that real consumer browsers/webviews carry — "DuckDuckGo/5",
 * "[Pinterest/iOS]", "LinkedInApp" are humans and must hit the wall
 * (tests/gate.test.ts pins both directions). google-inspectiontool = Search
 * Console live tests, so the owner can verify the crawler exception. Keep in
 * sync with robots.txt when that list changes. UA spoofing is accepted: the
 * wall is a conversion device, not a security boundary — everything behind it
 * is public HTML that crawlers see anyway.
 */
export const BOT_RE =
  /bot\b|crawl|spider|slurp|bingpreview|gptbot|oai-searchbot|chatgpt|claude|anthropic|perplexity|brave|yandex|baiduspider|applebot|facebookexternalhit|meta-externalagent|twitterbot|whatsapp|google-inspectiontool|bytespider|petalbot|lighthouse|pagespeed|gtmetrix/i;

export type Gate = { kind: 'pass' } | { kind: 'redirect' } | { kind: 'rewrite'; to: string };

export interface Visitor {
  /** No sb-* auth cookie (lib/page-cache isAnonymousRequest). */
  anonymous: boolean;
  /** User-agent matches BOT_RE. */
  bot: boolean;
  /** Valid X-Warm secret (the cache-warming cron). */
  warm: boolean;
  /** X-Sheet: 1 — the ProfileSheet modal fetch. */
  xSheet: boolean;
}

export function gate(url: URL, v: Visitor): Gate {
  if (!v.anonymous || v.bot || v.warm) return { kind: 'pass' };
  const p = url.pathname;
  // Keep the query on the rewrite (corridor lesson: dropping it swallows
  // param-driven flows, e.g. ?source=pwa).
  if (HOME.test(p)) return { kind: 'rewrite', to: `${p.replace(/\/$/, '')}/welcome/${url.search}` };
  if (
    WELCOME.test(p) ||
    ALLOWED.test(p) ||
    BLOG.test(p) ||
    AUTH.test(p) ||
    INVITE.test(p) ||
    PASS.test(p)
  ) {
    return { kind: 'pass' };
  }
  if (v.xSheet && SHEET_PROFILE.test(p)) return { kind: 'pass' };
  return { kind: 'redirect' };
}

/**
 * Advertiser focus-mode (ONBOARDING.md): with a draft (unsubmitted) profile the
 * ONLY surface is the setup flow — every product page redirects into it. Pure
 * path classifier; the caller (middleware) owns the session/role/state checks.
 * Returns the redirect target, or null when the path may render (the flow
 * itself, legal/support reading, auth, invites, infra).
 */
export function focusRedirect(url: URL, locale: string): string | null {
  const p = url.pathname;
  if (new RegExp(`^/${LOC}/account/setup(?:/|$)`).test(p)) return null;
  if (ALLOWED.test(p) || BLOG.test(p) || AUTH.test(p) || INVITE.test(p) || PASS.test(p)) return null;
  return `/${locale}/account/setup/`;
}
