import { createBrowserClient, createServerClient, parseCookieHeader } from '@supabase/ssr';
import type { AuthCtx } from '@/app/models/session';

const SUPABASE_URL = import.meta.env.PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.PUBLIC_SUPABASE_KEY;

/**
 * SSR client — cookie-based session, per request (never cached in module
 * scope). Reads the raw Cookie header (session cookies are chunked); writes
 * through the jar so refreshed tokens reach the response.
 */
type CookieOpts = Parameters<AuthCtx['cookies']['set']>[2];

/** The SDK's cookie options are wider than our jar's (sameSite can be boolean). */
function toJarOptions(o: Record<string, unknown> | undefined): CookieOpts {
  if (!o) return undefined;
  const sameSite = o.sameSite;
  return {
    path: typeof o.path === 'string' ? o.path : undefined,
    maxAge: typeof o.maxAge === 'number' ? o.maxAge : undefined,
    httpOnly: typeof o.httpOnly === 'boolean' ? o.httpOnly : undefined,
    sameSite:
      sameSite === 'lax' || sameSite === 'strict' || sameSite === 'none' ? sameSite : undefined,
  };
}

export function supabaseServer({ request, cookies }: AuthCtx) {
  return createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    // Force the runtime's own fetch: under vite-SSR the SDK can otherwise
    // resolve its Node build (node:http), which dies in workerd with
    // "Network connection lost".
    global: { fetch: globalThis.fetch.bind(globalThis) },
    cookies: {
      getAll() {
        return parseCookieHeader(request.headers.get('Cookie') ?? '').map(
          ({ name, value }) => ({ name, value: value ?? '' }),
        );
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          cookies.set(name, value, toJarOptions(options as Record<string, unknown>));
        }
      },
    },
  });
}

/** Browser client — Auth, Realtime, RLS-guarded dashboard mutations ONLY. */
export function supabaseBrowser() {
  return createBrowserClient(SUPABASE_URL, SUPABASE_KEY);
}
