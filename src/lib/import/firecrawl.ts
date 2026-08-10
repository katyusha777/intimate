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

type ScrapeResponse = { success?: boolean; data?: { markdown?: string; links?: string[] } };

/** Scrape one page to markdown. Throws on a Firecrawl error or empty content. */
export async function firecrawlScrape(opts: ScrapeInput): Promise<ScrapeResult> {
  const key = (env as unknown as { FIRECRAWL_API_KEY?: string }).FIRECRAWL_API_KEY;
  if (!key) throw new Error('Import is not configured (missing FIRECRAWL_API_KEY).');

  const attempt = async (actions?: FirecrawlAction[]): Promise<{ ok: boolean; status: number; body: ScrapeResponse }> => {
    const body: Record<string, unknown> = {
      url: opts.url,
      formats: ['markdown', 'links'],
      onlyMainContent: opts.onlyMainContent ?? true,
      waitFor: opts.waitFor ?? 2000,
      timeout: 60000,
    };
    if (actions?.length) body.actions = actions;
    const res = await fetch(`${BASE_URL}/v1/scrape`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as ScrapeResponse;
    return { ok: res.ok, status: res.status, body: json };
  };

  // The site's reveal actions (dismiss consent, show phone) are BEST-EFFORT — a
  // missing button must not fail the whole scrape (site markup changes, e.g.
  // beta.kinky.nl). So if the action pass fails, retry once with no actions.
  let r = await attempt(opts.actions);
  if ((!r.ok || !r.body.success) && opts.actions?.length) r = await attempt(undefined);

  if (!r.ok || !r.body.success) {
    if (r.status === 402) throw new Error('Import is temporarily unavailable (out of scraping credits). Try again later.');
    throw new Error('Could not read that page — check the link is a public profile.');
  }
  const md = r.body.data?.markdown?.trim();
  if (!md) throw new Error('Could not read that page — check the link is a public profile.');
  return { markdown: md, links: r.body.data?.links ?? [] };
}
