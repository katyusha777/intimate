/** THE SEAM (docs/API.md): live on Postgres — the KV mock is gone. */
import { env } from 'cloudflare:workers';
import { createDb } from '@/db/client';
import { makeMessagingApi } from '@/app/data/db/messaging';

// Fresh Db per call — workerd forbids sharing I/O across requests; Hyperdrive
// makes per-request connects cheap.
export const messagingApi = makeMessagingApi(() =>
  createDb((env as unknown as { HYPERDRIVE: Hyperdrive }).HYPERDRIVE),
);
