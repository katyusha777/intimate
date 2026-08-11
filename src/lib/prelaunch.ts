/**
 * Pre-launch corridor (PRE-LAUNCH-GRANT-CARDONE.md §12.2): during the campaign
 * window the apex host serves ONLY the pre-launch landing (rewritten onto
 * /{locale}/), the /agencies closer page, and — for a signed-in advertiser —
 * her own account dashboard + onboarding under /{locale}/account (so a founding
 * advertiser builds her profile NOW and goes live the instant we launch). Every
 * other path 302s to `/`. The public marketplace still lives on beta.intimate.nl.
 * Pure function so the host logic is unit-testable (tests/prelaunch.test.ts) —
 * it can't be exercised on localhost.
 *
 * Delete this module (and its middleware wiring) at launch — the flip-back
 * checklist lives in INFRASTRUCTURE.md §2.
 */

export const PRELAUNCH_HOST = 'intimate.nl';

const LOC = '(?:nl|en|de|ro|it)';
/** `/{locale}/` → rewritten to the prelaunch page (index.astro stays beta's). */
const HOME = new RegExp(`^/${LOC}/?$`);
/** The closer page + the legal pages the age gate links to. */
const ALLOWED_PAGES = new RegExp(`^/${LOC}/(?:agencies|privacy|terms)/?$`);
/** The signed-in advertiser's private surface — dashboard, onboarding (the real
 *  profile builder: photos, ID, details), profile editor, settings. These pages
 *  SELF-gate (anon → login, non-advertiser → bounce), so opening the PATH is
 *  safe: it exposes only the private builder, never the public marketplace. The
 *  pre-launch signup drops a new advertiser straight into /account/setup. */
const ACCOUNT = new RegExp(`^/${LOC}/account(?:/|$)`);
/** ProfileSheet's fetches (X-Sheet: 1) — the §12.2 demo modal + its avail poll.
 *  Header-gated only: it's public HTML beta serves anyway; corridor = UX seal. */
const SHEET_PROFILE = new RegExp(`^/${LOC}/profile/[^/]+/(?:avail\\.json)?$`);
/** Non-page infrastructure that must keep working on the apex: admin console
 *  (Cloudflare Access is scoped to intimate.nl/admin), auth callbacks, API,
 *  action POSTs, media, sitemaps (robots.txt points at the apex sitemap). */
const PASS = /^\/(?:admin|auth|api|_actions|media|sitemap)/;

export type Corridor = { kind: 'pass' } | { kind: 'redirect' } | { kind: 'rewrite'; to: string };

export function corridor(url: URL, xSheet: boolean): Corridor {
  const p = url.pathname;
  // Keep the query: the landing's form POSTs back to /{locale}/ and Astro's
  // action lookup rides the ?_astroAction= param — dropping it on rewrite
  // would swallow the submission.
  if (HOME.test(p)) return { kind: 'rewrite', to: `${p.replace(/\/$/, '')}/prelaunch/${url.search}` };
  if (ALLOWED_PAGES.test(p) || ACCOUNT.test(p) || PASS.test(p)) return { kind: 'pass' };
  if (xSheet && SHEET_PROFILE.test(p)) return { kind: 'pass' };
  return { kind: 'redirect' };
}
