import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    // Direct Postgres URL (staging branch first, always) — never the Hyperdrive one.
    url: process.env.DATABASE_URL!,
  },
});
