/**
 * Imports queue (docs/ADMIN.md §3): the self-service import job monitor —
 * failures, retries, throughput. Rides on the real import pipeline build
 * (Firecrawl + LLM extraction, ARCHITECTURE); the `import_jobs` table is the
 * durable home (the pipeline writes rows, this reads/retries them). Seeds a few
 * demo rows once so the surface is demoable until the pipeline lands.
 */
import { env } from 'cloudflare:workers';
import { and, desc, eq } from 'drizzle-orm';
import { createDb } from '@/db/client';
import { importJobs } from '@/db/schema';
import type { ImportJobState } from '@/lib/taxonomy';

const adb = () => createDb((env as unknown as { HYPERDRIVE: Hyperdrive }).HYPERDRIVE);

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

/** Seed demo rows once (guarded by row presence, not a KV flag). */
async function seedImports(): Promise<void> {
  const d = adb();
  if ((await d.select({ id: importJobs.id }).from(importJobs).limit(1)).length) return;
  const min = (n: number) => new Date(Date.now() - n * 60_000);
  await d.insert(importJobs).values([
    { sourceUrl: 'https://kinky.nl/profile/roos-023', state: 'scraping', createdAt: min(3) },
    { sourceUrl: 'https://example-agency.nl/girls/mila', state: 'extracting', createdAt: min(8) },
    { sourceUrl: 'https://escort-directory.nl/p/8841', state: 'ready_for_review', createdAt: min(24), profileName: 'Imported: Nadia' },
    { sourceUrl: 'https://broken-source.nl/x', state: 'failed', createdAt: min(40), error: 'Scrape timeout (source blocked crawler)' },
    { sourceUrl: 'https://old-listing.nl/anna', state: 'failed', createdAt: min(120), error: 'No photos found on page' },
    { sourceUrl: 'https://partner-site.nl/lena', state: 'confirmed', createdAt: min(300), profileName: 'Imported: Lena' },
  ]);
}

export async function listImports(): Promise<ImportJob[]> {
  await seedImports();
  return (await adb().select().from(importJobs).orderBy(desc(importJobs.createdAt))).map(toJob);
}

/** Retry a failed job → back to queued (the real pipeline re-enqueues the URL). */
export async function retryImport(id: string): Promise<void> {
  await adb()
    .update(importJobs)
    .set({ state: 'queued', error: null })
    .where(and(eq(importJobs.id, id), eq(importJobs.state, 'failed')));
}
