/**
 * Agency auto-import (ADMIN.md §8, src/lib/crawl.ts is the caller) — the
 * generic-site variants of the self-service import:
 *  · discoverProfileUrls(listUrl): agency roster/homepage → individual profile
 *    page URLs (Firecrawl render → one LLM pass over markdown + links).
 *  · agencyImportFromUrl(url): one profile page → the SAME normalized fields as
 *    self-service PLUS identity (name/age) and photo URLs — nobody types those
 *    in for an agency profile, so the crawl must carry them. Self-service never
 *    extracts identity (normalize.ts header) — that rule holds there.
 * No detectSite gate here: agency sites are arbitrary; Firecrawl renders them
 * generically. Everything the LLM returns stays UNTRUSTED until it passes
 * normalizeImported() + the pure pickers in normalize.ts (hard rule 7).
 */
import { firecrawlScrape } from './firecrawl';
import { llmExtract } from './extract';
import { buildExtractPrompt } from './prompt';
import { normalizeImported, pickAgencyExtras, pickPaginationUrls, pickProfileUrls, type ImportResult } from './normalize';

export interface AgencyImportOutcome extends ImportResult {
  name?: string;
  age?: number;
  photoUrls: string[];
  /** Raw LLM object — admin test tool only. */
  raw: unknown;
  cost: number;
}

const DISCOVER_PROMPT = `You are given the scraped markdown and the link list of ONE page from a Dutch escort-agency website (its homepage or roster/"our ladies" page). Return ONLY a JSON object: {"profileUrls": [...], "nextPageUrls": [...]}.
"profileUrls": the absolute URLs of the INDIVIDUAL profile/detail pages of the people advertised on this site. Rules: one URL per person; exclude navigation, category, booking, contact, blog, rates and legal pages; exclude external sites; if the same person has several links keep the canonical detail page. Empty array if none found.
"nextPageUrls": pagination URLs of THIS SAME roster listing (the "next" / numbered page links, e.g. ?page=2 or /models/page/2/) that show MORE people. Only real pagination of this listing — never other sections. Empty array if single-page.`;

/** Roster pages allowed per discovery run — one Firecrawl + one LLM call each.
 *  ponytail: 8 pages ≈ 300+ profiles, far past any real NL agency; raise if one
 *  ever paginates deeper. */
const MAX_ROSTER_PAGES = 8;

/** Roster/homepage → profile-page URLs, following the listing's pagination. */
export async function discoverProfileUrls(
  listUrl: string,
): Promise<{ urls: string[]; cost: number; pages: number }> {
  const urls: string[] = [];
  const queue = [listUrl];
  const visited = new Set<string>();
  let cost = 0;
  let pages = 0;
  while (queue.length && pages < MAX_ROSTER_PAGES) {
    const pageUrl = queue.shift()!;
    if (visited.has(pageUrl)) continue;
    visited.add(pageUrl);
    pages++;
    const { markdown, links } = await firecrawlScrape({ url: pageUrl, onlyMainContent: false, waitFor: 2500 });
    const user = `${markdown.slice(0, 30_000)}\n\nLINKS ON PAGE:\n${links.slice(0, 500).join('\n')}`;
    const { raw, cost: c } = await llmExtract(user, DISCOVER_PROMPT);
    cost += c;
    for (const u of pickProfileUrls(raw, pageUrl)) if (!urls.includes(u)) urls.push(u);
    for (const p of pickPaginationUrls(raw, pageUrl)) if (!visited.has(p) && !queue.includes(p)) queue.push(p);
  }
  return { urls, cost, pages };
}

/** One agency profile page → normalized fields + identity + photo URLs. */
export async function agencyImportFromUrl(url: string): Promise<AgencyImportOutcome> {
  const { markdown } = await firecrawlScrape({ url, onlyMainContent: false, waitFor: 2500 });
  const { raw, cost } = await llmExtract(markdown, buildExtractPrompt({ agency: true }));
  const { fields, warnings } = normalizeImported(raw);
  return { fields, warnings, ...pickAgencyExtras(raw), raw, cost };
}
