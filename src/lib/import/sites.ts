/**
 * Per-site scrape config for the self-service import (paste-a-URL → fill your
 * profile). Ported from the standalone scraper (intimate-scraper) so the app has
 * NO external dependency. Trimmed to what the self-service flow needs: how to
 * reveal the phone / clear age-gates before reading, and whether to trim the
 * page. Images are NOT imported (the advertiser uploads her own), so the
 * watermark/crawl/image-pattern fields are gone.
 */
import type { FirecrawlAction } from './firecrawl';

export interface SiteConfig {
  key: string;
  label: string;
  onlyMainContent: boolean;
  waitFor: number;
  actions: FirecrawlAction[];
  /** Regex (string) recognising a real profile URL — a soft check for the UI. */
  profileUrlPattern: string | null;
}

// Tolerant reveal for sexjobs: dismiss the age-gate + cookie modals and click
// "Toon nummer" only if present — JS clicks never throw on a missing element,
// so a phone-less profile doesn't fail the whole scrape.
const SEXJOBS_REVEAL = `(async()=>{const bs=()=>[...document.querySelectorAll('button')];const click=p=>{const b=bs().find(p);if(b){b.click();return true}return false};click(b=>b.classList.contains('agree'));await new Promise(r=>setTimeout(r,1000));click(b=>b.classList.contains('agree'));await new Promise(r=>setTimeout(r,1000));click(b=>/toon nummer/i.test(b.textContent)||b.querySelector('i.icon-Phone'));await new Promise(r=>setTimeout(r,1800));return true})()`;

const SITES: Array<SiteConfig & { match: RegExp }> = [
  {
    key: 'sexjobs.nl',
    label: 'SexJobs',
    match: /(^|\.)sexjobs\.nl$/i,
    onlyMainContent: false,
    waitFor: 2500,
    actions: [{ type: 'executeJavascript', script: SEXJOBS_REVEAL }],
    profileUrlPattern: '^https?://(www\\.)?sexjobs\\.nl/(escort|thuisontvangst|erotische-massage)/[^/]+_\\d+$',
  },
  {
    key: 'redlights.nl',
    label: 'RedLights',
    match: /(^|\.)redlights\.nl$/i,
    onlyMainContent: false,
    waitFor: 2500,
    actions: [{ type: 'wait', milliseconds: 2000 }],
    profileUrlPattern: '^https?://(www\\.)?redlights\\.nl/(escort|thuisontvangst|massage)/dames/[^/]+\\.html$',
  },
  {
    key: 'kinky.nl',
    label: 'Kinky',
    match: /(^|\.)kinky\.nl$/i,
    onlyMainContent: true, // 360KB page — trim so extraction stays fast
    waitFor: 2000,
    actions: [{ type: 'click', selector: '.phone-number' }, { type: 'wait', milliseconds: 1500 }],
    profileUrlPattern: '^https?://(www\\.)?kinky\\.nl/advertenties/\\d+-',
  },
];

export function detectSite(url: string): SiteConfig | null {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  return SITES.find((s) => s.match.test(host)) ?? null;
}

export function knownSites(): Array<{ key: string; label: string }> {
  return SITES.map((s) => ({ key: s.key, label: s.label }));
}
