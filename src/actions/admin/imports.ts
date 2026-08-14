/**
 * Imports queue (docs/ADMIN.md §3): the self-service import job monitor —
 * failures, retries, throughput. The `import_jobs` table is the durable home;
 * the import pipeline (Firecrawl + LLM extraction, ARCHITECTURE) writes rows,
 * this reads/retries them. Empty until the pipeline lands.
 */
import { env } from 'cloudflare:workers';
import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { requestDb } from '@/db/client';
import { importJobs, orgs, profiles } from '@/db/schema';
import type { ImportJobState } from '@/lib/taxonomy';

const adb = () => requestDb((env as unknown as { HYPERDRIVE: Hyperdrive }).HYPERDRIVE);

export interface ImportJob {
  id: string;
  sourceUrl: string;
  state: ImportJobState;
  createdAt: string;
  profileName?: string;
  error?: string;
}

type Row = typeof importJobs.$inferSelect;
const toJob = (r: Row): ImportJob => ({
  id: r.id,
  sourceUrl: r.sourceUrl,
  state: r.state,
  createdAt: r.createdAt.toISOString(),
  profileName: r.profileName ?? undefined,
  error: r.error ?? undefined,
});

export async function listImports(): Promise<ImportJob[]> {
  return (await adb().select().from(importJobs).orderBy(desc(importJobs.createdAt))).map(toJob);
}

export interface OrgImportSummary {
  orgId: string;
  name: string;
  crawlIntervalHours: number;
  lastCrawledAt?: string;
  lastCrawlNote?: string;
  /** Outcome of the LAST run: jobs enqueued with it (enqueue stamps
   *  last_crawled_at moments after inserting the batch — a 10-min window
   *  catches the batch without sweeping in earlier runs). */
  runConfirmed: number;
  runFailed: number;
  /** Still queued/scraping — any age, this is the live backlog. */
  queueOpen: number;
  pendingReview: number;
  live: number;
}

/** Per-agency import health for the /admin/imports dashboard: last run's
 *  outcome, the open backlog, and where the org's profiles sit in moderation. */
export async function importDashboard(): Promise<OrgImportSummary[]> {
  const d = adb();
  const run = (state: ImportJobState) =>
    sql<number>`count(*) filter (where ${importJobs.state} = ${state} and ${importJobs.createdAt} > ${orgs.lastCrawledAt} - interval '10 minutes')::int`;
  const rows = await d
    .select({
      orgId: orgs.id,
      name: orgs.name,
      crawlIntervalHours: orgs.crawlIntervalHours,
      lastCrawledAt: orgs.lastCrawledAt,
      lastCrawlNote: orgs.lastCrawlNote,
      runConfirmed: run('confirmed'),
      runFailed: run('failed'),
      queueOpen: sql<number>`count(*) filter (where ${importJobs.state} in ('queued', 'scraping'))::int`,
    })
    .from(orgs)
    .leftJoin(importJobs, eq(importJobs.orgId, orgs.id))
    .where(eq(orgs.crawlEnabled, true))
    .groupBy(orgs.id)
    .orderBy(orgs.name);
  const counts = await d
    .select({
      orgId: profiles.orgId,
      pendingReview: sql<number>`count(*) filter (where ${profiles.state} = 'pending_review')::int`,
      live: sql<number>`count(*) filter (where ${profiles.state} = 'live')::int`,
    })
    .from(profiles)
    .where(isNotNull(profiles.orgId))
    .groupBy(profiles.orgId);
  const byOrg = new Map(counts.map((c) => [c.orgId, c]));
  return rows.map((r) => ({
    orgId: r.orgId,
    name: r.name,
    crawlIntervalHours: r.crawlIntervalHours,
    lastCrawledAt: r.lastCrawledAt?.toISOString(),
    lastCrawlNote: r.lastCrawlNote ?? undefined,
    runConfirmed: r.runConfirmed,
    runFailed: r.runFailed,
    queueOpen: r.queueOpen,
    pendingReview: byOrg.get(r.orgId)?.pendingReview ?? 0,
    live: byOrg.get(r.orgId)?.live ?? 0,
  }));
}

/** Retry a failed job → back to queued (the real pipeline re-enqueues the URL). */
export async function retryImport(id: string): Promise<void> {
  await adb()
    .update(importJobs)
    .set({ state: 'queued', error: null })
    .where(and(eq(importJobs.id, id), eq(importJobs.state, 'failed')));
}
