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
 *    advertiser edits. The agency's site wins over manual edits by design.
 *  · Age gate (hard rule 4) runs on EVERY crawl, create AND re-crawl: a page
 *    now listing under-21 fails the job and touches nothing.
 *  · Photos are re-encoded through the Images binding (metadata incl. EXIF GPS
 *    stripped — hard rule 2) before they touch R2; no binding → no photo import.
 *  · Nothing is silently dropped: gate failures and dead URLs become `failed`
 *    jobs (with the extracted name when we got one); a created profile whose
 *    photos ALL failed carries a note on its confirmed job; a job whose runner
 *    died mid-scrape is reaped to `failed` by the next cron tick (claimed_at).
 */
import { env } from 'cloudflare:workers';
import { and, count, eq, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import { requestDb, type Db } from '@/db/client';
import { importJobs, media, orgs, profiles } from '@/db/schema';
import { agencyImportFromUrl, discoverProfileUrls } from '@/lib/import/agency';
import { originalImageUrl } from '@/lib/import/normalize';
import { profileUpdate, uniqueSlug } from './account';
import { birthDateForAge } from '@/app/models/profile';
import { fetchExternalImage, transformImage } from '@/lib/fetch-image';
import { mediaBucket } from '@/lib/media-keys';
import { POLICY_MIN_AGE } from '@/lib/taxonomy';

const db = (): Db => requestDb((env as unknown as { HYPERDRIVE: Hyperdrive }).HYPERDRIVE);

/** The real machine is queued → scraping → confirmed|failed ('extracting' &
 *  'processing_images' exist in the enum but nothing sets them). */
const OPEN_STATES = ['queued', 'scraping'] as const;
const MAX_PHOTOS = 8;
/** A legit scrape+extract runs ~1–2 min; past this the runner is dead. */
const STALE_CLAIM_MINUTES = 15;

/** Import failure that still knows WHO the page was about — the job row keeps
 *  the name so the admin can tell who was rejected without re-scraping. */
class AgencyImportError extends Error {
  constructor(
    message: string,
    public profileName?: string,
  ) {
    super(message);
  }
}

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

  const { urls, pages } = await discoverProfileUrls(listUrl, org.crawlNotes ?? undefined);

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

  const rows = urls
    .filter((url) => !openSet.has(url))
    .map((url) => ({ sourceUrl: url, orgId, profileId: byUrl.get(url) }));
  if (rows.length) await d.insert(importJobs).values(rows);
  const queuedUpdates = rows.filter((r) => r.profileId).length;
  const queuedNew = rows.length - queuedUpdates;

  const note = `discovered ${urls.length} across ${pages} page(s) · queued ${queuedNew} new + ${queuedUpdates} update(s)`;
  await d.update(orgs).set({ lastCrawledAt: sql`now()`, lastCrawlNote: note }).where(eq(orgs.id, orgId));
  return { discovered: urls.length, queuedNew, queuedUpdates };
}

export interface CrawlProcessResult {
  processed: number;
  failed: number;
  remaining: number;
}

/** Work the queue: scrape+extract+persist up to `limit` agency jobs.
 *  `orgId` scopes claiming AND the remaining count — the admin drain loop
 *  works one agency; the cron tick (no orgId) works the whole queue. */
export async function processImportJobs(limit = 2, orgId?: string): Promise<CrawlProcessResult> {
  const d = db();
  const jobScope = (state: (typeof OPEN_STATES)[number]) =>
    and(
      eq(importJobs.state, state),
      isNotNull(importJobs.orgId),
      orgId === undefined ? undefined : eq(importJobs.orgId, orgId),
    );
  let processed = 0;
  let failed = 0;
  for (let i = 0; i < limit; i++) {
    // Claim: flip queued → scraping guarded by the state check, so a concurrent
    // tick re-evaluating the same row loses the race (its UPDATE matches 0
    // rows) — and the loser just tries the NEXT row, it doesn't give up.
    // ponytail: single-claimer via WHERE state='queued'; move to
    // FOR UPDATE SKIP LOCKED if we ever run many ticks in parallel.
    const [job] = await d
      .update(importJobs)
      .set({ state: 'scraping', error: null, claimedAt: sql`now()` })
      .where(
        and(
          eq(importJobs.state, 'queued'),
          inArray(
            importJobs.id,
            d.select({ id: importJobs.id }).from(importJobs).where(jobScope('queued')).orderBy(importJobs.createdAt).limit(1),
          ),
        ),
      )
      .returning();
    if (!job) {
      // Nothing claimed: either the queue is empty (stop) or a concurrent
      // claimer stole this row (try the next).
      const [q] = await d.select({ n: count() }).from(importJobs).where(jobScope('queued'));
      if (!q?.n) break;
      continue;
    }
    try {
      const r = await importAgencyProfile(job.orgId!, job.sourceUrl, {
        existingProfileId: job.profileId ?? undefined,
      });
      // A created profile with zero stored photos is legal but worth a note —
      // hotlink protection / dead CDN would otherwise be invisible.
      const note = r.created && r.photosAttempted > 0 && r.photosStored === 0 ? `0/${r.photosAttempted} photos imported` : null;
      await d
        .update(importJobs)
        .set({ state: 'confirmed', profileName: r.name ?? null, error: note })
        .where(eq(importJobs.id, job.id));
      processed++;
    } catch (e) {
      await d
        .update(importJobs)
        .set({
          state: 'failed',
          error: String((e as Error).message ?? e).slice(0, 500),
          profileName: e instanceof AgencyImportError ? (e.profileName ?? null) : null,
        })
        .where(eq(importJobs.id, job.id));
      failed++;
    }
  }
  const [agg] = await d.select({ n: count() }).from(importJobs).where(jobScope('queued'));
  return { processed, failed, remaining: agg?.n ?? 0 };
}

export interface AgencyImportApplied {
  profileId: string;
  created: boolean;
  name?: string;
  photosAttempted: number;
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
  const [org] = await d.select().from(orgs).where(eq(orgs.id, orgId)).limit(1);
  if (!org) throw new Error('unknown agency');
  const { fields, name, age, photoUrls } = await agencyImportFromUrl(url, org.crawlNotes ?? undefined);

  // The 21+ floor (hard rule 4) holds on EVERY crawl — agencies reuse URLs, so
  // a re-crawled page may now show a different, younger person.
  if (age !== undefined && age < POLICY_MIN_AGE) {
    throw new AgencyImportError(`listed age ${age} is below the policy minimum ${POLICY_MIN_AGE}`, name);
  }

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
    // patch mapped fields (+ name, + refreshed DOB so the displayed age tracks
    // the listed age instead of drifting +1 every year) in place.
    const update = {
      ...profileUpdate(fields),
      ...(name ? { name } : {}),
      ...(age !== undefined ? { birthDate: birthDateForAge(age) } : {}),
    };
    if (Object.keys(update).length) {
      await d.update(profiles).set(update).where(eq(profiles.id, profileId));
    }
    return { profileId, created: false, name, photosAttempted: 0, photosStored: 0 };
  }

  // New profile — identity + the 21+ policy floor are non-negotiable.
  if (!name) throw new AgencyImportError('no name found on the page');
  if (!age) throw new AgencyImportError('no age listed on the page — cannot verify the 21+ policy', name);

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
  if (!created) throw new AgencyImportError('profile insert returned no row', name);

  const photosStored = photoUrls.length ? await importPhotos(d, created.id, photoUrls) : 0;
  // ponytail: re-crawls never refresh photos (initial import only) — add
  // source-URL tracking on media rows when agencies rotate galleries.
  return { profileId: created.id, created: true, name, photosAttempted: photoUrls.length, photosStored };
}

/** Fetch → re-encode (EXIF stripped) → R2 → `media` row (pending_review).
 *  Fetch+transform+store run concurrently (bounded by MAX_PHOTOS); rows are
 *  inserted in original order so the gallery matches the source page. */
async function importPhotos(d: Db, profileId: string, urls: string[]): Promise<number> {
  const bucket = mediaBucket();
  // Agency galleries hand us WordPress thumbnails (`foo-400x517.jpg`) that would
  // upscale to mush at width 1600. Deterministically map each to its full
  // original (`foo.jpg`) — this also dedups several sizes of the same source
  // down to one row. Keep the resized URL as the fallback for the rare miss.
  const deduped = [...new Map(urls.map((u) => [originalImageUrl(u) ?? u, u])).values()];
  const keys = await Promise.all(
    deduped.slice(0, MAX_PHOTOS).map(async (u): Promise<string | null> => {
      const orig = originalImageUrl(u);
      const img = (orig ? await fetchExternalImage(orig) : null) ?? (await fetchExternalImage(u));
      if (!img || img.bytes.byteLength < 10_000) return null; // icons/trackers
      // No transform binding → no metadata strip → no photo import (hard rule 2).
      const bytes = await transformImage(img.bytes, { width: 1600, format: 'image/jpeg', quality: 85 });
      if (!bytes) return null;
      const key = `pub/${profileId}/${crypto.randomUUID()}`;
      try {
        await bucket.put(key, bytes, { httpMetadata: { contentType: 'image/jpeg' } });
        return key;
      } catch {
        return null; // one broken upload never kills the crawl
      }
    }),
  );
  const stored = keys.filter((k): k is string => k !== null);
  if (stored.length) {
    await d.insert(media).values(stored.map((imageKey, i) => ({ profileId, imageKey, position: i, state: 'pending_review' as const })));
  }
  return stored.length;
}

export interface CrawlTickResult extends CrawlProcessResult {
  enqueuedFor?: string;
  enqueued?: CrawlEnqueueResult;
  reaped: number;
}

/** The cron entry: reap dead runners, re-crawl at most ONE stale org, then
 *  work the queue. */
export async function crawlTick(): Promise<CrawlTickResult> {
  const d = db();
  // Reap jobs whose runner died mid-scrape (deploy, eviction, CPU k/o): a row
  // stuck in 'scraping' would otherwise never be re-claimed AND block its URL
  // from re-enqueue forever (openSet). Failed jobs are retryable + re-crawlable.
  const dead = await d
    .update(importJobs)
    .set({ state: 'failed', error: 'stalled — runner died mid-import; will re-queue on the next crawl' })
    .where(
      and(
        eq(importJobs.state, 'scraping'),
        lt(importJobs.claimedAt, sql`now() - interval '${sql.raw(String(STALE_CLAIM_MINUTES))} minutes'`),
      ),
    )
    .returning({ id: importJobs.id });

  // One org per tick — a discovery run is one Firecrawl + one LLM call per
  // roster page, and the 5-min cadence spreads a fleet over the day on its own.
  const [due] = await d
    .select({ id: orgs.id, name: orgs.name })
    .from(orgs)
    .where(
      and(
        eq(orgs.crawlEnabled, true),
        isNotNull(orgs.crawlListUrl),
        // Per-org cadence (orgs.crawl_interval_hours): schedule-bearing sites
        // (rolling date calendars) need daily; static rosters can go slower.
        sql`(${orgs.lastCrawledAt} is null or ${orgs.lastCrawledAt} < now() - make_interval(hours => ${orgs.crawlIntervalHours}))`,
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
  return { ...p, enqueuedFor: due?.name, enqueued, reaped: dead.length };
}
