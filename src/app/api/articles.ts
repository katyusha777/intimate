/** Articles API — data-source seam (docs/API.md). Live on Postgres. */
import { env } from 'cloudflare:workers';
import { createDb } from '@/db/client';
import { makeArticlesApi } from '@/app/data/db/articles';

export const articlesApi = makeArticlesApi(() =>
  createDb((env as unknown as { HYPERDRIVE: Hyperdrive }).HYPERDRIVE),
);
