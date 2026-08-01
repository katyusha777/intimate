/**
 * Imports queue (docs/ADMIN.md §3): the self-service import job monitor —
 * failures, retries, throughput. Rides on the real import pipeline build
 * (Firecrawl + LLM extraction, ARCHITECTURE); for now a seeded mock of
 * `import_jobs` so the surface exists and the retry flow is demoable.
 */
import { env } from 'cloudflare:workers';
import type { ImportJobState } from '@/lib/taxonomy';

interface Kv {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}
function kv(): Kv | undefined {
  return (env as unknown as Record<string, unknown>).SESSION as Kv | undefined;
}
const now = () => new Date().toISOString();

export interface ImportJob {
  id: string;
  sourceUrl: string;
  state: ImportJobState;
  createdAt: string;
  profileName?: string;
  error?: string;
}

const KEY = 'admin:imports';
const FLAG = 'admin:imports:seeded';

async function readJobs(): Promise<ImportJob[]> {
  const raw = await kv()?.get(KEY);
  try {
    return raw ? (JSON.parse(raw) as ImportJob[]) : [];
  } catch {
    return [];
  }
}
async function writeJobs(jobs: ImportJob[]): Promise<void> {
  await kv()?.put(KEY, JSON.stringify(jobs));
}

async function seedImports(): Promise<void> {
  if (await kv()?.get(FLAG)) return;
  await kv()?.put(FLAG, '1');
  const min = (n: number) => new Date(Date.now() - n * 60_000).toISOString();
  const jobs: ImportJob[] = [
    { id: 'imp_1', sourceUrl: 'https://kinky.nl/profile/roos-023', state: 'scraping', createdAt: min(3) },
    { id: 'imp_2', sourceUrl: 'https://example-agency.nl/girls/mila', state: 'extracting', createdAt: min(8) },
    { id: 'imp_3', sourceUrl: 'https://escort-directory.nl/p/8841', state: 'ready_for_review', createdAt: min(24), profileName: 'Imported: Nadia' },
    { id: 'imp_4', sourceUrl: 'https://broken-source.nl/x', state: 'failed', createdAt: min(40), error: 'Scrape timeout (source blocked crawler)' },
    { id: 'imp_5', sourceUrl: 'https://old-listing.nl/anna', state: 'failed', createdAt: min(120), error: 'No photos found on page' },
    { id: 'imp_6', sourceUrl: 'https://partner-site.nl/lena', state: 'confirmed', createdAt: min(300), profileName: 'Imported: Lena' },
  ];
  await writeJobs(jobs);
}

export async function listImports(): Promise<ImportJob[]> {
  await seedImports();
  return (await readJobs()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Retry a failed job → back to queued (the real pipeline re-enqueues the URL). */
export async function retryImport(id: string): Promise<void> {
  const jobs = await readJobs();
  const j = jobs.find((x) => x.id === id);
  if (!j || j.state !== 'failed') return;
  j.state = 'queued';
  j.error = undefined;
  j.createdAt = now();
  await writeJobs(jobs);
}
