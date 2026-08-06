/** THE SEAM (docs/API.md): calls — live on Postgres (docs/VIDEO-CALLING.md). */
import { env } from 'cloudflare:workers';
import { requestDb } from '@/db/client';
import { makeCallsApi } from '@/app/data/db/calls';

export const callsApi = makeCallsApi(() =>
  requestDb((env as unknown as { HYPERDRIVE: Hyperdrive }).HYPERDRIVE),
);
