/// <reference path="../.astro/types.d.ts" />

interface ImportMetaEnv {
  readonly PUBLIC_SUPABASE_URL: string;
  readonly PUBLIC_SUPABASE_KEY: string;
  // Turnstile site key (public). Empty → the register widget is not rendered
  // and server-side verification is skipped (the secret gates enforcement).
  readonly PUBLIC_TURNSTILE_SITE_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Bindings (HYPERDRIVE, ASSETS, …) are accessed via `import { env } from 'cloudflare:workers'`;
// their types come from worker-configuration.d.ts (`bun run cf-typegen`).
