import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

/**
 * Server-side data path: Drizzle → Hyperdrive → Postgres.
 * Call per-request with the HYPERDRIVE binding from Astro.locals.runtime.env.
 */
export function createDb(hyperdrive: Hyperdrive) {
  const client = postgres(hyperdrive.connectionString, {
    // Workers guidance: small pool, no type fetching round-trip.
    max: 5,
    fetch_types: false,
    prepare: false,
  });
  return drizzle(client, { schema });
}

export type Db = ReturnType<typeof createDb>;
