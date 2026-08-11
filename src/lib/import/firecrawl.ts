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

type ScrapeResponse = { success?: boolean; error?: string; data?: { markdown?: string; links?: string[] } };

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

  // Two renders max. Pass 1 uses the site's reveal actions when configured
  // (dismiss consent, show phone — BEST-EFFORT: a missing button must not fail
  // the scrape). Pass 2 is a plain retry that clears both broken actions AND
  // transient flakiness (4xx/5xx, empty mid-render captures — e.g. sites with
  // an auto-translate overlay). 402 (out of credits) never retries.
  const failed = (r: Awaited<ReturnType<typeof attempt>>) =>
    !r.ok || !r.body.success || !r.body.data?.markdown?.trim();
  let r = await attempt(opts.actions);
  if (failed(r) && r.status !== 402) r = await attempt(undefined);

  if (!r.ok || !r.body.success) {
    if (r.status === 402) throw new Error('Import is temporarily unavailable (out of scraping credits). Try again later.');
    // Surface the upstream cause (status + Firecrawl's error string, truncated)
    // — "check the link" alone made real outages undiagnosable from the admin.
    const detail = (r.body.error ?? '').slice(0, 140);
    throw new Error(`Could not read that page (scraper ${r.status}${detail ? `: ${detail}` : ''}) — retry, or check the link is public.`);
  }
  const md = r.body.data?.markdown?.trim();
  if (!md) throw new Error('Could not read that page (empty render) — retry, or check the link is public.');
  return { markdown: md, links: r.body.data?.links ?? [] };
}
