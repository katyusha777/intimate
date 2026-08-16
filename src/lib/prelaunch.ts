/**
 * Pre-launch corridor (PRE-LAUNCH-GRANT-CARDONE.md §12.2): during the campaign
 * window the apex host serves the pre-launch landing (rewritten onto /{locale}/),
 * the /agencies closer page, the /blog editorial shelf (indexable articles the
 * landing links to for SEO), and — for a professional who just joined — her own
 * /{locale}/account/* onboarding + profile editor (a real but PASSWORDLESS draft
 * profile she builds now, rendered BARE = no site chrome, so it goes live at
 * launch). Every other path 302s to `/`. The public marketplace still lives on
 * beta.intimate.nl. Pure function so the host logic is unit-testable
 * (tests/prelaunch.test.ts) — it can't be exercised on localhost.
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
/** The editorial shelf: the landing links to /blog + articles for SEO (real
 *  indexable HTML + internal links). Reader pages render BARE (Layout reads
 *  Astro.locals.prelaunch), so a tap opens a clean article with no route back
 *  into the marketplace. */
const BLOG = new RegExp(`^/${LOC}/blog(?:/[^/]+)?/?$`);
/** The pre-signup professional builds her (passwordless) draft profile in the
 *  REAL onboarding + editor under /{locale}/account — reached straight from the
 *  lead form (a real session exists). These pages self-gate (anon → login,
 *  non-advertiser → bounce) AND render BARE on the apex (no site chrome), so
 *  opening the PATH exposes only her private builder, never the marketplace. */
const ACCOUNT = new RegExp(`^/${LOC}/account(?:/|$)`);
/** Profile pages — the §12.2 demo-modal fetch (X-Sheet: 1) OR any authenticated
 *  view (admin god-view, owner preview): both need the real page, not the home
 *  bounce. Anonymous prelaunch visitors stay sealed. Gate is UX only: it's the
 *  same public HTML beta serves, and the page itself surfaces non-live states to
 *  admin/owner alone — a signed-in non-owner still gets a 404 for a draft. */
const SHEET_PROFILE = new RegExp(`^/${LOC}/profile/[^/]+/(?:avail\\.json)?$`);
/** Non-page infrastructure that must keep working on the apex: admin console
 *  (Cloudflare Access is scoped to intimate.nl/admin), auth callbacks, API,
 *  action POSTs, media, sitemaps (robots.txt points at the apex sitemap). */
const PASS = /^\/(?:admin|auth|api|_actions|media|sitemap)/;

export type Corridor = { kind: 'pass' } | { kind: 'redirect' } | { kind: 'rewrite'; to: string };

export function corridor(url: URL, xSheet: boolean, authed = false): Corridor {
  const p = url.pathname;
  // Keep the query: the landing's form POSTs back to /{locale}/ and Astro's
  // action lookup rides the ?_astroAction= param — dropping it on rewrite
  // would swallow the submission.
  if (HOME.test(p)) return { kind: 'rewrite', to: `${p.replace(/\/$/, '')}/prelaunch/${url.search}` };
  if (ALLOWED_PAGES.test(p) || BLOG.test(p) || ACCOUNT.test(p) || PASS.test(p)) return { kind: 'pass' };
  if ((xSheet || authed) && SHEET_PROFILE.test(p)) return { kind: 'pass' };
  return { kind: 'redirect' };
}
