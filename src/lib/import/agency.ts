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
import { normalizeImported, pickAgencyExtras, pickProfileUrls, type ImportResult } from './normalize';

export interface AgencyImportOutcome extends ImportResult {
  name?: string;
  age?: number;
  photoUrls: string[];
  /** Raw LLM object — admin test tool only. */
  raw: unknown;
  cost: number;
}

const DISCOVER_PROMPT = `You are given the scraped markdown and the link list of ONE page from a Dutch escort-agency website (its homepage or roster/"our ladies" page). Return ONLY a JSON object: {"profileUrls": [...]} — the absolute URLs of the INDIVIDUAL profile/detail pages of the people advertised on this site. Rules: one URL per person; exclude navigation, category, booking, contact, blog, rates and legal pages; exclude external sites; if the same person has several links keep the canonical detail page. Empty array if none found.`;

/** Roster/homepage → profile-page URLs. One Firecrawl render + one LLM pass. */
export async function discoverProfileUrls(listUrl: string): Promise<{ urls: string[]; cost: number }> {
  const { markdown, links } = await firecrawlScrape({ url: listUrl, onlyMainContent: false, waitFor: 2500 });
  const user = `${markdown.slice(0, 30_000)}\n\nLINKS ON PAGE:\n${links.slice(0, 500).join('\n')}`;
  const { raw, cost } = await llmExtract(user, DISCOVER_PROMPT);
  return { urls: pickProfileUrls(raw, listUrl), cost };
}

/** One agency profile page → normalized fields + identity + photo URLs. */
export async function agencyImportFromUrl(url: string): Promise<AgencyImportOutcome> {
  const { markdown } = await firecrawlScrape({ url, onlyMainContent: false, waitFor: 2500 });
  const { raw, cost } = await llmExtract(markdown, buildExtractPrompt({ agency: true }));
  const { fields, warnings } = normalizeImported(raw);
  return { fields, warnings, ...pickAgencyExtras(raw), raw, cost };
}
