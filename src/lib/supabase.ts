import { createBrowserClient, createServerClient, parseCookieHeader } from '@supabase/ssr';
import type { AuthCtx } from '@/app/models/session';

const SUPABASE_URL = import.meta.env.PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.PUBLIC_SUPABASE_KEY;

/**
 * SSR client — cookie-based session, per request (never cached in module
 * scope). Reads the raw Cookie header (session cookies are chunked); writes
 * through the jar so refreshed tokens reach the response.
 */
export function supabaseServer({ request, cookies }: AuthCtx) {
  return createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    // Force the runtime's fetch: under vite-SSR the SDK otherwise resolves its
    // Node build (node-fetch → node:http), which dies in workerd with
    // "Network connection lost".
    global: { fetch: (...args: Parameters<typeof fetch>) => fetch(...args) },
    cookies: {
      getAll() {
        return parseCookieHeader(request.headers.get('Cookie') ?? '').map(
          ({ name, value }) => ({ name, value: value ?? '' }),
        );
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          cookies.set(name, value, options as Parameters<AuthCtx['cookies']['set']>[2]);
        }
      },
    },
  });
}

/** Browser client — Auth, Realtime, RLS-guarded dashboard mutations ONLY. */
export function supabaseBrowser() {
  return createBrowserClient(SUPABASE_URL, SUPABASE_KEY);
}
