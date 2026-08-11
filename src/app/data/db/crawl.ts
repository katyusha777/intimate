/**
 * Agency crawl engine (ADMIN.md §8): discovery → import_jobs queue → profiles.
 * Two callers, one seam (like lib/purge.ts): the admin actions ("Crawl now" +
 * the browser-driven job loop) and the cron tick (/api/crawl-tick, fired by
 * workers/purge every 5 min) — both run here with the main worker's bindings.
 *
 * Guarantees:
 *  · Never publishes: NEW profiles land `pending_review` (hard rule 5) and
 *    their photos land `pending_review` — the normal moderation queue decides.
 *  · Re-crawl of a profile we already imported (matched by imported_from_url)
 *    patches its mapped fields in place — same publish-immediately rule as
 *    advertiser edits.
 *  · Photos are re-encoded through the Images binding (metadata incl. EXIF GPS
 *    stripped — hard rule 2) before they touch R2; no binding → no photo import.
 *  · Age gate (hard rule 4): no listed age or age < POLICY_MIN_AGE → the job
 *    fails with a reason; no profile row is ever created.
 *  · Under-21/no-name pages, dead URLs etc. surface as `failed` jobs in the
 *    admin panel — nothing is silently dropped.
 */
import { env } from 'cloudflare:workers';
import { and, count, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { requestDb, type Db } from '@/db/client';
import { importJobs, media, orgs, profiles } from '@/db/schema';
import { agencyImportFromUrl, discoverProfileUrls } from '@/lib/import/agency';
import { profileUpdate, uniqueSlug } from './account';
import { birthDateForAge } from '@/app/models/profile';
import { mediaBucket } from '@/lib/media-keys';
import { POLICY_MIN_AGE } from '@/lib/taxonomy';

const db = (): Db => requestDb((env as unknown as { HYPERDRIVE: Hyperdrive }).HYPERDRIVE);
const images = () => (env as unknown as { IMAGES?: ImagesBinding }).IMAGES;

const OPEN_STATES = ['queued', 'scraping', 'extracting', 'processing_images'] as const;
const MAX_PHOTOS = 8;

export interface CrawlEnqueueResult {
  discovered: number;
  queuedNew: number;
  queuedUpdates: number;
}

/** Discover the org's roster and queue one import job per profile URL. */
export async function enqueueOrgCrawl(orgId: string): Promise<CrawlEnqueueResult> {
  const d = db();
  const [org] = await d.select().from(orgs).where(eq(orgs.id, orgId)).limit(1);
  if (!org) throw new Error('unknown agency');
  const listUrl = org.crawlListUrl?.trim();
  if (!listUrl) throw new Error('no crawl URL configured for this agency');

  const { urls, pages } = await discoverProfileUrls(listUrl);

  // URL already ours → update job; unseen → create job; open job → skip.
  const existing = await d
    .select({ id: profiles.id, url: profiles.importedFromUrl })
    .from(profiles)
    .where(eq(profiles.orgId, orgId));
  const byUrl = new Map(existing.filter((r) => r.url).map((r) => [r.url!, r.id]));
  const open = await d
    .select({ url: importJobs.sourceUrl })
    .from(importJobs)
    .where(and(eq(importJobs.orgId, orgId), inArray(importJobs.state, [...OPEN_STATES])));
  const openSet = new Set(open.map((r) => r.url));

  let queuedNew = 0;
  let queuedUpdates = 0;
  for (const url of urls) {
    if (openSet.has(url)) continue;
    const profileId = byUrl.get(url);
    await d.insert(importJobs).values({ sourceUrl: url, orgId, profileId });
    if (profileId) queuedUpdates++;
    else queuedNew++;
  }

  const note = `discovered ${urls.length} across ${pages} page(s) · queued ${queuedNew} new + ${queuedUpdates} update(s)`;
  await d.update(orgs).set({ lastCrawledAt: sql`now()`, lastCrawlNote: note }).where(eq(orgs.id, orgId));
  return { discovered: urls.length, queuedNew, queuedUpdates };
}

export interface CrawlProcessResult {
  processed: number;
  failed: number;
  remaining: number;
}

/** Work the queue: scrape+extract+persist up to `limit` agency jobs. */
export async function processImportJobs(limit = 2): Promise<CrawlProcessResult> {
  const d = db();
  let processed = 0;
  let failed = 0;
  for (let i = 0; i < limit; i++) {
    // Claim: flip queued → scraping guarded by the state check, so a concurrent
    // tick re-evaluating the same row loses the race.
    // ponytail: single-claimer via WHERE state='queued'; move to
    // FOR UPDATE SKIP LOCKED if we ever run many ticks in parallel.
    const [job] = await d
      .update(importJobs)
      .set({ state: 'scraping', error: null })
      .where(
        and(
          eq(importJobs.state, 'queued'),
          inArray(
            importJobs.id,
            d
              .select({ id: importJobs.id })
              .from(importJobs)
              .where(and(eq(importJobs.state, 'queued'), isNotNull(importJobs.orgId)))
              .orderBy(importJobs.createdAt)
              .limit(1),
          ),
        ),
      )
      .returning();
    if (!job) break;
    try {
      await runAgencyJob(d, job);
      await d.update(importJobs).set({ state: 'confirmed' }).where(eq(importJobs.id, job.id));
      processed++;
    } catch (e) {
      await d
        .update(importJobs)
        .set({ state: 'failed', error: String((e as Error).message ?? e).slice(0, 500) })
        .where(eq(importJobs.id, job.id));
      failed++;
    }
  }
  const [agg] = await d
    .select({ n: count() })
    .from(importJobs)
    .where(and(eq(importJobs.state, 'queued'), isNotNull(importJobs.orgId)));
  return { processed, failed, remaining: agg?.n ?? 0 };
}

type Job = typeof importJobs.$inferSelect;

async function runAgencyJob(d: Db, job: Job): Promise<void> {
  const r = await importAgencyProfile(job.orgId!, job.sourceUrl, {
    existingProfileId: job.profileId ?? undefined,
  });
  await d.update(importJobs).set({ profileName: r.name ?? null }).where(eq(importJobs.id, job.id));
}

export interface AgencyImportApplied {
  profileId: string;
  created: boolean;
  name?: string;
  photosStored: number;
}

/**
 * Import ONE agency profile URL: patch the matching profile (by explicit id, or
 * imported_from_url within the org) or create a new `pending_review` one with
 * photos. Shared by the job runner and the admin "Import & create" test action
 * — the test path IS the real path.
 */
export async function importAgencyProfile(
  orgId: string,
  url: string,
  opts: { existingProfileId?: string } = {},
): Promise<AgencyImportApplied> {
  const d = db();
  const { fields, name, age, photoUrls } = await agencyImportFromUrl(url);

  let profileId = opts.existingProfileId;
  if (!profileId) {
    const [hit] = await d
      .select({ id: profiles.id })
      .from(profiles)
      .where(and(eq(profiles.orgId, orgId), eq(profiles.importedFromUrl, url)))
      .limit(1);
    profileId = hit?.id;
  }
  if (profileId) {
    // Re-crawl: the agency's site is the source of truth for its own roster —
    // patch mapped fields (and the working name) in place.
    const update = { ...profileUpdate(fields), ...(name ? { name } : {}) };
    if (Object.keys(update).length) {
      await d.update(profiles).set(update).where(eq(profiles.id, profileId));
    }
    return { profileId, created: false, name, photosStored: 0 };
  }

  // New profile — identity + the 21+ policy floor are non-negotiable.
  if (!name) throw new Error('no name found on the page');
  if (!age) throw new Error('no age listed on the page — cannot verify the 21+ policy');
  if (age < POLICY_MIN_AGE) throw new Error(`listed age ${age} is below the policy minimum ${POLICY_MIN_AGE}`);
  const [org] = await d.select().from(orgs).where(eq(orgs.id, orgId)).limit(1);
  if (!org) throw new Error('agency no longer exists');

  const city = fields.city ?? org.city;
  const [created] = await d
    .insert(profiles)
    .values({
      accountId: org.accountId, // the agency's placeholder account owns the row
      orgId: org.id,
      slug: await uniqueSlug(d, name, city),
      state: 'pending_review', // never auto-publish (hard rule 5)
      ...profileUpdate(fields),
      name,
      // The site lists an age, not a DOB — the derived date keeps the DB 21+
      // CHECK honest (computed age = listed age). Admin reviews pre-publish.
      birthDate: birthDateForAge(age),
      gender: fields.gender ?? 'female',
      city,
      importedFromUrl: url,
    })
    .returning({ id: profiles.id });
  if (!created) throw new Error('profile insert returned no row');

  const photosStored = photoUrls.length ? await importPhotos(d, created.id, photoUrls) : 0;
  // ponytail: re-crawls never refresh photos (initial import only) — add
  // source-URL tracking on media rows when agencies rotate galleries.
  return { profileId: created.id, created: true, name, photosStored };
}

/** Fetch → re-encode (EXIF stripped) → R2 → `media` row (pending_review). */
async function importPhotos(d: Db, profileId: string, urls: string[]): Promise<number> {
  const IMAGES = images();
  // No transform binding → no metadata strip → no photo import (hard rule 2).
  if (!IMAGES) return 0;
  const bucket = mediaBucket();
  let stored = 0;
  for (const u of urls) {
    if (stored >= MAX_PHOTOS) break;
    try {
      const url = new URL(u);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
      // Workers egress can't reach private nets, but keep the guard explicit.
      if (/^(localhost$|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname)) continue;
      const res = await fetch(url.href, { headers: { accept: 'image/*' } });
      if (!res.ok || !(res.headers.get('content-type') ?? '').startsWith('image/')) continue;
      const src = await res.arrayBuffer();
      if (src.byteLength < 10_000 || src.byteLength > 15_000_000) continue; // icons / abuse
      // Re-encode through the Images binding: strips ALL metadata (EXIF GPS —
      // hard rule 2) and normalizes to JPEG like every other upload.
      const out = await IMAGES.input(new Response(src).body!)
        .transform({ width: 1600 })
        .output({ format: 'image/jpeg', quality: 85 });
      const bytes = await out.response().arrayBuffer();
      const key = `pub/${profileId}/${crypto.randomUUID()}`;
      await bucket.put(key, bytes, { httpMetadata: { contentType: 'image/jpeg' } });
      await d.insert(media).values({ profileId, imageKey: key, position: stored, state: 'pending_review' });
      stored++;
    } catch {
      /* one broken image never kills the crawl */
    }
  }
  return stored;
}

export interface CrawlTickResult extends CrawlProcessResult {
  enqueuedFor?: string;
  enqueued?: CrawlEnqueueResult;
}

/** The cron entry: re-crawl at most ONE stale org, then work the queue. */
export async function crawlTick(): Promise<CrawlTickResult> {
  const d = db();
  // One org per tick — a discovery run is one Firecrawl + one LLM call, and the
  // 5-min cadence spreads a multi-agency fleet over the day on its own.
  const [due] = await d
    .select({ id: orgs.id, name: orgs.name })
    .from(orgs)
    .where(
      and(
        eq(orgs.crawlEnabled, true),
        isNotNull(orgs.crawlListUrl),
        sql`(${orgs.lastCrawledAt} is null or ${orgs.lastCrawledAt} < now() - interval '24 hours')`,
      ),
    )
    .limit(1);
  let enqueued: CrawlEnqueueResult | undefined;
  if (due) {
    try {
      enqueued = await enqueueOrgCrawl(due.id);
    } catch (e) {
      // Stamp the failure so the org isn't retried every 5 min all day.
      await d
        .update(orgs)
        .set({ lastCrawledAt: sql`now()`, lastCrawlNote: `crawl failed: ${(e as Error).message}`.slice(0, 300) })
        .where(eq(orgs.id, due.id));
    }
  }
  const p = await processImportJobs(2);
  return { ...p, enqueuedFor: due?.name, enqueued };
}
