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

/** The SDK's cookie options are wider than our jar's (sameSite can be boolean).
 *  We force safe defaults instead of passing `undefined` through: auth cookies
 *  hold a live session, so `Secure` and `HttpOnly` must be ON even if the SDK
 *  ever omits them, and `Secure` was previously DROPPED entirely (never mapped)
 *  — a plain-http request before the https redirect could leak the token. */
function toJarOptions(o: Record<string, unknown> | undefined): CookieOpts {
  if (!o) return undefined;
  const sameSite = o.sameSite;
  return {
    path: typeof o.path === 'string' ? o.path : undefined,
    maxAge: typeof o.maxAge === 'number' ? o.maxAge : undefined,
    // Respect the SDK's explicit httpOnly. Supabase auth cookies are
    // intentionally httpOnly:FALSE (DEFAULT_COOKIE_OPTIONS) — the browser client
    // reads the token from document.cookie for realtime + MFA step-up; forcing
    // httpOnly on would break client-side auth. Fall back to false (not true) so
    // a future SDK that omits it can't silently lock the browser client out.
    httpOnly: typeof o.httpOnly === 'boolean' ? o.httpOnly : false,
    // The SDK does NOT set `secure` (the one flag it omits) — add it: off only on
    // plain-http localhost dev, ON everywhere the runtime is prod. `secure` cookies
    // stay JS-readable on https, so this doesn't affect the browser client.
    secure: typeof o.secure === 'boolean' ? o.secure : import.meta.env.PROD,
    sameSite:
      sameSite === 'lax' || sameSite === 'strict' || sameSite === 'none' ? sameSite : 'lax',
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
