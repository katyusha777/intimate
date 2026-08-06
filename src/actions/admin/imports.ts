/**
 * Imports queue (docs/ADMIN.md §3): the self-service import job monitor —
 * failures, retries, throughput. The `import_jobs` table is the durable home;
 * the import pipeline (Firecrawl + LLM extraction, ARCHITECTURE) writes rows,
 * this reads/retries them. Empty until the pipeline lands.
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

export async function listImports(): Promise<ImportJob[]> {
  return (await adb().select().from(importJobs).orderBy(desc(importJobs.createdAt))).map(toJob);
}

/** Retry a failed job → back to queued (the real pipeline re-enqueues the URL). */
export async function retryImport(id: string): Promise<void> {
  await adb()
    .update(importJobs)
    .set({ state: 'queued', error: null })
    .where(and(eq(importJobs.id, id), eq(importJobs.state, 'failed')));
}
