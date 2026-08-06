/** THE SEAM (docs/API.md): live on Postgres — the KV mock is gone. */
import { env } from 'cloudflare:workers';
import { requestDb } from '@/db/client';
import { makeReportsApi } from '@/app/data/db/reports';

export const reportsApi = makeReportsApi(() =>
  requestDb((env as unknown as { HYPERDRIVE: Hyperdrive }).HYPERDRIVE),
);
