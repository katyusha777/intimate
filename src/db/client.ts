import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

/**
 * Server-side data path: Drizzle → Hyperdrive → Postgres.
 * Pass the HYPERDRIVE binding (cloudflare:workers env) — or any object with a
 * connectionString (tests use the local Supabase Postgres directly).
 */
export function createDb(hyperdrive: Pick<Hyperdrive, 'connectionString'>) {
  const client = postgres(hyperdrive.connectionString, {
    // Workers guidance: small pool, no type fetching round-trip.
    max: 5,
    fetch_types: false,
    prepare: false,
    // Don't echo server NOTICE/WARNING to the console (e.g. realtime.send's
    // "no partition" notice before Realtime first runs) — they're not errors.
    onnotice: () => {},
  });
  return drizzle(client, { schema });
}

export type Db = ReturnType<typeof createDb>;
