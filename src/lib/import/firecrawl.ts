/**
 * Firecrawl scrape wrapper (ported from intimate-scraper, trimmed). Renders the
 * page in Firecrawl's browser — running the site's reveal actions (age-gate,
 * "show number") first — and returns clean markdown for the LLM extractor.
 * Base: https://api.firecrawl.dev · Auth: Bearer FIRECRAWL_API_KEY.
 *
 * SSRF note: the app never fetches the advertiser's pasted URL itself — Firecrawl
 * does, in its own sandbox. We only POST the URL to a known, trusted API.
 */
import { env } from 'cloudflare:workers';

const BASE_URL = 'https://api.firecrawl.dev';

export interface FirecrawlAction {
  type: 'click' | 'wait' | 'scroll' | 'executeJavascript';
  selector?: string;
  milliseconds?: number;
  direction?: 'up' | 'down';
  amount?: number;
  script?: string;
}

export interface ScrapeInput {
  url: string;
  actions?: FirecrawlAction[];
  waitFor?: number;
  onlyMainContent?: boolean;
}

export interface ScrapeResult {
  markdown: string;
  links: string[];
}

/** Scrape one page to markdown. Throws on a Firecrawl error or empty content. */
export async function firecrawlScrape(opts: ScrapeInput): Promise<ScrapeResult> {
  const key = (env as unknown as { FIRECRAWL_API_KEY?: string }).FIRECRAWL_API_KEY;
  if (!key) throw new Error('Import is not configured (missing FIRECRAWL_API_KEY).');

  const body: Record<string, unknown> = {
    url: opts.url,
    formats: ['markdown', 'links'],
    onlyMainContent: opts.onlyMainContent ?? true,
    waitFor: opts.waitFor ?? 2000,
    timeout: 60000,
  };
  if (opts.actions?.length) body.actions = opts.actions;

  const res = await fetch(`${BASE_URL}/v1/scrape`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Scrape failed (${res.status}). Try again in a moment.`);

  const data = (await res.json()) as {
    success?: boolean;
    data?: { markdown?: string; links?: string[] };
  };
  const md = data.data?.markdown?.trim();
  if (!data.success || !md) throw new Error('Could not read that page — check the link is a public profile.');
  return { markdown: md, links: data.data?.links ?? [] };
}
