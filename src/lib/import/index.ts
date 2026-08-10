/**
 * Self-service profile import: a supported profile URL → filled-in fields for
 * review. detectSite → Firecrawl render (with the site's reveal actions) →
 * one LLM pass to our schema → strict taxonomy validation. No images (she
 * uploads her own), no persistence here — the caller previews then saves.
 * Self-service consent: she imports HER OWN profile (ARCHITECTURE §6).
 */
import { detectSite, knownSites } from './sites';
import { firecrawlScrape } from './firecrawl';
import { llmExtract } from './extract';
import { normalizeImported, type ImportResult } from './normalize';

export { knownSites, detectSite };

export interface ImportOutcome extends ImportResult {
  site: { key: string; label: string };
  /** The raw LLM object — surfaced to the admin test tool only (never the UI). */
  raw: unknown;
  cost: number;
}

export async function importFromUrl(url: string): Promise<ImportOutcome> {
  const site = detectSite(url);
  if (!site) {
    const names = knownSites().map((s) => s.label).join(', ');
    throw new Error(`We can only import from ${names} right now.`);
  }
  const { markdown } = await firecrawlScrape({
    url,
    actions: site.actions,
    waitFor: site.waitFor,
    onlyMainContent: site.onlyMainContent,
  });
  const { raw, cost } = await llmExtract(markdown);
  const { fields, warnings } = normalizeImported(raw);
  return { site: { key: site.key, label: site.label }, fields, warnings, raw, cost };
}
