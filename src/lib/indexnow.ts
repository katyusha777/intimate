/**
 * IndexNow (SEO.md §1.5/§1.6) — instant Bing/Brave (re)crawl on publish, edit
 * and takedown. Freshness is our edge; on takedown the ping makes engines
 * re-crawl and see the 410 (hard rule 8) instead of a stale live page.
 *
 * Ownership is proved by a key file served at the site root — see
 * `public/7ded564a30734bf689eff437b6b416ab.txt` (its name IS the key).
 *
 * Fire-and-forget: this never rejects, so a caller can drop the promise (or
 * hand it to ctx.waitUntil) without a floating-promise hazard. IndexNow is a
 * best-effort hint — a failed ping must never break publish/takedown.
 */
export const INDEXNOW_KEY = '7ded564a30734bf689eff437b6b416ab';

/**
 * POST a URL batch to IndexNow. Errors are swallowed and logged.
 * @param urls      absolute URLs that changed (published, edited, or now 410)
 * @param host      bare hostname, e.g. 'intimate.nl'
 * @param keyLocation absolute URL of the key file, e.g.
 *                  'https://intimate.nl/7ded564a30734bf689eff437b6b416ab.txt'
 */
export async function submitIndexNow(
  urls: string[],
  host: string,
  keyLocation: string,
): Promise<void> {
  if (urls.length === 0) return;
  try {
    const res = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host, key: INDEXNOW_KEY, keyLocation, urlList: urls }),
      // Bound the wait — this is a best-effort hint; a hung endpoint must never
      // stall the caller (e.g. an admin takedown click).
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) console.error(`IndexNow ${res.status} for ${urls.length} url(s)`);
  } catch (err) {
    console.error('IndexNow ping failed', err);
  }
}
