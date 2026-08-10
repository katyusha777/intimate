# SUPABASE.md — How We Use Supabase (and Keep It Locked Down)

The Supabase reference for this codebase: exact APIs, config, hardening, and the
decisions already made. Read before any auth / RLS / realtime / migration work.
Companions: `ARCHITECTURE.md` §3 (the two access paths — this doc is its
detailed spec), `API.md` (the seam this backend lands behind), `SECURITY.md`
(threat model + deny-test law), `MESSAGING.md` §4 (the first big RLS surface),
`ADMIN.md` §1 (the aal2 wall), `INFRASTRUCTURE.md` §1/§7 (tiers + provisioning).

Researched against supabase.com/docs (2026-08). If Supabase's docs and this file
ever disagree, the live docs win — and fixing the drift here is part of the
change that discovers it.

---

## 0. Decisions (locked — changing one updates this doc + affected code in one PR)

| # | Decision | Why |
|---|---|---|
| 1 | **New API keys only** (`sb_publishable_` / `sb_secret_`), never legacy anon/service_role JWTs | Legacy keys deprecated end of 2026; secret keys return 401 from browsers (a real safety net); rotation decoupled from JWT signing. `.env.example` already matches. |
| 2 | **Asymmetric JWT signing keys (ES256) from day one** | Enables `getClaims()` local verification — no Auth-server round trip per SSR request. With our <100 ms TTFB budget, a network `getUser()` in middleware is unaffordable. |
| 3 | **Authorization claims live in `app_metadata`** (set server-side via `auth.admin.updateUserById`) | Users can edit `user_metadata` — never authz there (advisor ERROR 0015). The custom-access-token-hook + roles-table pattern is the upgrade path if roles ever need runtime granularity; not built now. |
| 4 | **Server data path = Drizzle → Hyperdrive → direct Postgres (port 5432)**, not Supavisor | Cloudflare's documented recommendation: Hyperdrive does the pooling; Supavisor transaction mode under Hyperdrive = double pooling + prepared-statement breakage. |
| 5 | **Hyperdrive connects as a dedicated `app_server` role with `bypassrls`** — not `postgres`, not the service key | The server path is deliberately RLS-exempt (API.md §3: code is the guard there); a dedicated login role scopes the blast radius (no superuser, no auth/storage schema access, revocable independently). |
| 6 | **Realtime = Broadcast, private channels, RLS-authorized. `postgres_changes` is banned** | Supabase's own guidance: postgres_changes runs an authorization check per subscriber per event and collapses under load; broadcast sends once and fans out. |
| 7 | **Drizzle owns all DDL for `public`** — schema, RLS policies, grants, triggers all live in `supabase/`-independent Drizzle migrations | One migration tool, one flow (`bun run db:migrate`; tiered `local → staging → prod` when the split returns). Supabase Branching / declarative schemas assume `supabase/migrations/` and are not used. |
| 8 | **Data API stays on but minimal**: expose `public` only, drop `graphql_public`, `max_rows` lowered | Browser RLS-guarded mutations ride PostgREST, so it can't be disabled — but everything not needed gets unexposed (advisor 0026/0027). |
| 9 | **Supabase Storage has exactly one planned use**: private chat video (MESSAGING.md §7) | Photos = Cloudflare Images; verification docs = dedicated R2 bucket (hard rule 3). Supabase doesn't back up Storage objects — one more reason media lives elsewhere. |
| 10 | **Turnstile is wired into Supabase Auth itself** (Bot and Abuse Protection → Cloudflare Turnstile) | We already run Turnstile; Auth-level CAPTCHA is the documented SMS-pumping defense and needs no extra middleware. |

## 1. Projects, keys & clients

**Projects:** SINGLE-TIER for now (INFRASTRUCTURE §1, decided 2026-08-03):
`jqrfzqbuvekhcptqcpda` (Frankfurt) is THE database for dev, Workers, tests and
seeds. A dedicated prod project + local stack return before first real data —
at that point, never point two tiers at one project again.

**Keys** (`.env.example` is the catalog):

| Key | Env var | Where it may live |
|---|---|---|
| Publishable `sb_publishable_…` | `PUBLIC_SUPABASE_KEY` | Browser bundles, islands — public by design; RLS is the wall |
| Secret `sb_secret_…` | `SUPABASE_SECRET_KEY` | Server only. Constructed into a client ONLY in `src/actions/admin/**` (CLAUDE.md admin boundary, CI-grepped) |
| DB password (`app_server` role) | Hyperdrive config / `DATABASE_URL` | Wrangler/Hyperdrive config + drizzle-kit; never in client code |

- Secret keys support **multiple named keys per project** — mint one per backend
  component (admin actions vs cron jobs) so each rotates independently. Rotation:
  create new → deploy → delete old. Log at most the first 6 chars, ever.
- A secret key used from a browser gets an automatic 401 from the platform.
- Disable the legacy anon/service_role JWT keys in the dashboard once nothing
  uses them (check "last used" indicators).

**Three client constructions, and only these three:**

```ts
// 1. Browser (islands): singleton — Auth, Realtime, RLS-guarded mutations ONLY
import { createBrowserClient } from '@supabase/ssr'
export const supabase = createBrowserClient(
  import.meta.env.PUBLIC_SUPABASE_URL, import.meta.env.PUBLIC_SUPABASE_KEY)

// 2. SSR (middleware/pages): per-request — session cookies, never cached in module scope
import { createServerClient, parseCookieHeader } from '@supabase/ssr'
const supabase = createServerClient(url, publishableKey, {
  cookies: {
    getAll: () => parseCookieHeader(context.request.headers.get('Cookie') ?? ''),
    setAll: (cookies) => cookies.forEach(({ name, value, options }) =>
      context.cookies.set(name, value, options)),
  },
})

// 3. Server data path: src/db/client.ts — Drizzle over Hyperdrive (no supabase-js)
```

`@supabase/ssr`'s `setAll` also hands over anti-caching headers (`Cache-Control`
etc.) whenever it writes refreshed tokens — set them on the response. This is the
same law as SECURITY.md §5: **a response that sets session cookies is never
cacheable.** supabase-js itself runs fine on workerd (fetch-based) — except the
realtime WebSocket transport, which is browser-only (§5).

## 2. Auth

### 2.1 Sessions & verification on the server

The one law: **never authorize from `getSession()`** — it echoes the cookie
without validating. The middleware pattern:

```ts
// src/middleware — per request
const { data, error } = await supabase.auth.getClaims()
// data.claims: { sub, role, aal, session_id, app_metadata, phone, ... }
```

`getClaims()` verifies the JWT **locally** against the project's JWKS
(`https://<ref>.supabase.co/auth/v1/.well-known/jwks.json`, edge-cached 10 min) —
zero network per request. This only holds after migrating the project to
asymmetric signing keys (decision 2); on a legacy shared secret it silently
degrades to a network call per request. Migration is zero-downtime via the
dashboard (standby key → rotate → revoke after ≥ token expiry); do it before any
real users exist and it's a non-event.

Role checks read `claims.app_metadata` (decision 3):

```ts
const accountType = data?.claims?.app_metadata?.account_type  // taxonomy ACCOUNT_TYPES
// set at registration/verification time, server-side only:
await adminClient.auth.admin.updateUserById(id, {
  app_metadata: { account_type: 'professional' } })
```

Claims go stale until token refresh — keep `jwt_expiry` at 3600 (the default,
already in config.toml) and treat role changes as effective-on-next-refresh.

### 2.2 Sign-in flows

Supabase Auth supports both flows we care about; exact calls:

```ts
// Email + password
await supabase.auth.signUp({ email, password, options: { captchaToken } })
await supabase.auth.signInWithPassword({ email, password, options: { captchaToken } })

// Phone OTP (SMS)
await supabase.auth.signInWithOtp({ phone: '+31612345678',
  options: { captchaToken, shouldCreateUser: true } })
const { data } = await supabase.auth.verifyOtp({ phone, token: code, type: 'sms' })
```

- SMS provider config lives per-tier: dashboard for hosted, `[auth.sms.*]` in
  config.toml locally (secrets via `env(...)` substitution, never committed).
  Twilio Verify is a supported provider — the same vendor as our standalone
  phone-verification flow (VERIFICATION.md §1), which stays a separate server
  action regardless of sign-in method. The **Send SMS Hook** exists if we ever
  need an EU-local SMS provider or cost routing.
- **Test OTPs** (`[auth.sms.test_otp]` locally, `SMS_TEST_OTP` env hosted) let
  CI and staging log in without sending SMS — remove from prod config.
- OTP cadence: one request per 60 s per user, code valid 1 h, project-wide send
  cap defaults to 30 SMS/hour — raise deliberately for launch (§9), because the
  default assumes email-primary auth.
- **Decided (2026-08-04): email + password for everyone.** Both clients and
  professionals (the girls) sign up/in with **email + password** (one AuthModal, no
  method toggle). Email confirmation (`enable_confirmations`) needs custom SMTP hosted
  per §9 — the built-in sender's ~2/h cap is the "email rate limit exceeded" wall; it
  is **currently disabled** in the dashboard so registration works until SendGrid (or
  another adult-tolerant SMTP) is wired. **Phone is NOT a login method** — it is a
  professional-only *verification attribute*: after email signup she proves she owns a
  number via **Twilio Verify** (`VA` service, `account.startSms`/`checkSms` → `lib/twilio.ts`,
  API-key auth). Phone input defaults to NL (+31; `06…`/bare → E.164) but accepts any
  country code. Turnstile rides `options.captchaToken` on the email flows.

### 2.3 MFA / aal2 (the admin wall)

Admin accounts enroll TOTP; middleware asserts aal2 on `/admin` (ADMIN.md §1):

```ts
// enroll (once): returns QR svg + secret
await supabase.auth.mfa.enroll({ factorType: 'totp' })
// per session: challenge + verify upgrades the session to aal2
const { id: challengeId } = (await supabase.auth.mfa.challenge({ factorId })).data
await supabase.auth.mfa.verify({ factorId, challengeId, code })
```

Server-side assertion = read `claims.aal` from `getClaims()`. When
`aal !== 'aal2'` for an enrolled admin, redirect to the challenge screen (don't
403 — the docs' guidance and better UX).

**Status (2026-08-10 audit): the assertion is implemented in code but STAGED OFF.**
`requireAdmin`/`getAdmin` read `claims.aal` and gate on it, but only when
`ADMIN_REQUIRE_AAL2=true` — currently unset so an un-enrolled admin isn't locked
out. Enrolling TOTP + flipping that flag is the owner task (ADMIN.md §1, launch gate).
The `mfa.enroll`/`challenge`/`verify` calls above are wired up client-side in
`src/app/mfa.ts`, surfaced by `MfaCard` (/admin/settings) and the `AdminLogin`
step-up.

**The belt-and-braces DB policy below is NOT yet applied** (no migration defines
a restrictive `aal2` policy — verified against `drizzle/`). Admin access to toxic
tables is currently gated by Cloudflare Access + the app-layer `requireAdmin`
check only, NOT at the DB. Add this restrictive policy (and its RLS deny test)
when the aal2 wall goes live — it needs testing against the hosted DB first:

```sql
create policy "admin tables require aal2" on sensitive_table
  as restrictive to authenticated
  using ((select auth.jwt()->>'aal') = 'aal2');
```

`as restrictive` matters — permissive policies OR together; a restrictive one
cannot be overridden by them.

### 2.4 Rate limits & abuse

Configured under Authentication → Rate Limits (hosted) / `[auth.rate_limit]`
(local). The ones that bite: OTP sends 30/h project-wide (customizable) ·
verification attempts 360/h per IP (fixed) · MFA challenge+verify 15/h per IP
(fixed — an admin fat-fingering TOTP repeatedly can lock themselves out; fine) ·
token refresh 1800/h per IP (fixed). Auth-level Turnstile (decision 10) is the
first wall in front of all of it. These stack with our own Turnstile + KV
budgets on actions (SECURITY.md §5) — defense in depth, not redundancy.

## 3. RLS — the wall (every table, before it holds data)

The law is SECURITY.md §3: RLS on every table, **every policy ships with its
deny test**. This section is the how.

**Canonical shapes** — separate policy per operation, always `to` a role, always
the wrapped `(select auth.uid())`:

```sql
alter table profiles enable row level security;

-- accounts.id = auth.users.id, so profiles.account_id compares to auth.uid()
create policy "own rows: select" on profiles for select
  to authenticated using ((select auth.uid()) = account_id);
create policy "own rows: insert" on profiles for insert
  to authenticated with check ((select auth.uid()) = account_id);
create policy "own rows: update" on profiles for update
  to authenticated using ((select auth.uid()) = account_id)
                    with check ((select auth.uid()) = account_id);
-- public read of live profiles (the lifecycle rule, in SQL):
create policy "public: live only" on profiles for select
  to anon, authenticated using (state = 'live');
```

**The six performance rules** (Supabase's own benchmarks; API.md §3 summarizes):

1. Wrap auth functions: `(select auth.uid())` — initPlan caches it per statement,
   not per row (~95–99% faster). Advisor WARN 0003 catches the unwrapped form.
2. **Index every column a policy references** (171 ms → sub-ms in their bench).
3. Add `to authenticated` / `to anon` so the wrong role never evaluates the policy.
4. Duplicate the policy's filter in the query (`.eq('account_id', …)`) — the
   planner can't use the policy as an index hint; the explicit filter can.
5. No joins inside policies. Rewrite as `IN (select …)` against the *other*
   table, or use a security-definer helper.
6. Helpers live in a **`private` schema** (never an exposed one), as
   `security definer set search_path = ''`, with execute revoked from
   `anon`/`public` — grant only the role that needs it.

```sql
create schema if not exists private;
create function private.is_thread_participant(p_thread_id uuid)
returns boolean language sql security definer set search_path = '' as $$
  select exists (select 1 from public.threads t
    where t.id = p_thread_id
      and ((select auth.uid()) = t.client_account_id
        or (select auth.uid()) = (select p.account_id from public.profiles p
                                   where p.id = t.profile_id)));
$$;
revoke execute on function private.is_thread_participant from public, anon;
```

**Semantics that bite:** `using` filters existing rows; `with check` validates
incoming ones; UPDATE needs both AND a matching SELECT policy or the update
returns zero rows silently. `auth.uid()` is NULL for anon — write
`auth.uid() is not null and …` where the distinction matters. Views default to
owner privileges: any view over RLS'd tables is created
`with (security_invoker = true)` (advisor ERROR 0010 otherwise).

**Claims in policies:** `auth.jwt() -> 'app_metadata' ->> '…'` is safe (server-
controlled); anything under `user_metadata` in a policy is an automatic ERROR
(0015) and a real vulnerability — users edit that object freely.

**Grants are the gate before RLS.** New tables in `public` are auto-granted to
anon/authenticated by default — revoke the defaults once, in an early migration,
then grant deliberately per table:

```sql
alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke usage, select on sequences from anon, authenticated;
```

A table nothing browser-side touches (audit_log, verification metadata) simply
gets **no grants** to anon/authenticated at all — PostgREST then can't reach it
regardless of policies, and the server path (`app_server`) still can.

## 4. Server data path (Drizzle → Hyperdrive → Postgres)

- Hyperdrive origin = the **direct** connection string
  (`db.<ref>.supabase.co:5432`), not Supavisor `:6543` (decision 4). IPv6 by
  default; Hyperdrive handles that. `src/db/client.ts` is the one constructor;
  its `prepare: false` is only *required* for Supavisor transaction mode —
  harmless here, keep or drop.
- The connecting role is `app_server` (decision 5): `login`, `bypassrls`,
  explicit grants on `public` tables, nothing else — created in an early
  migration, password only in Hyperdrive config + CI migration secrets. It is
  NOT `postgres` and has no reach into `auth`/`storage` schemas.
- Because this path bypasses RLS, **backend code is the guard** (API.md §3):
  every public read filters `state = 'live'`, every input is Zod-parsed, admin
  operations live behind the admin boundary.
- The audit-log append-only trigger guard (SECURITY.md §3) binds even here —
  trigger-enforced, so no role short of superuser can rewrite history.
- Migrations run over `DATABASE_URL` (`bun run db:migrate`; per-tier scripts
  return with the multi-tier split), never through Hyperdrive.

## 5. Realtime

Broadcast-first, private-always (decision 6). API.md §4 holds the architecture;
these are the exact mechanics.

### 5.1 Sending

**From the database (the default)** — a trigger per table that broadcasts,
`security definer`, empty search_path:

```sql
create function public.broadcast_thread_changes()
returns trigger language plpgsql
security definer set search_path = '' as $$
begin
  perform realtime.broadcast_changes(
    'thread:' || coalesce(NEW.thread_id, OLD.thread_id)::text,  -- topic
    TG_OP, TG_OP, TG_TABLE_NAME, TG_TABLE_SCHEMA, NEW, OLD);
  return null;
end; $$;

create trigger thread_changes after insert or update or delete
  on public.messages for each row
  execute function public.broadcast_thread_changes();
```

`realtime.broadcast_changes()` emits a CDC-shaped payload (operation, table,
record) on a **private** topic. For custom minimal payloads (IDs + state — our
preferred shape) use `realtime.send(payload jsonb, event, topic, false)`
directly; note its 4th arg `private` must be `true` for our channels.

**From the server (workerd)** — no WebSocket needed:
`channel.httpSend(event, payload)` (supabase-js ≥ 2.107) or the REST endpoint
`POST /realtime/v1/api/broadcast`. Use for action-driven pings that have no
table write; anything row-backed should broadcast from its trigger instead.

### 5.2 Authorization — policies on `realtime.messages`

Private channels are authorized by RLS on `realtime.messages`: SELECT policy =
may listen, INSERT policy = may send; `realtime.topic()` is the topic being
joined; `extension` ∈ `broadcast` | `presence` scopes per feature. Keep these
policies *simple* — they run at join time and complex ones raise join latency:

```sql
create policy "participants receive thread broadcasts"
on realtime.messages for select to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and (select private.is_thread_participant(
        split_part((select realtime.topic()), ':', 2)::uuid))
);
-- mirror `for insert … with check` for client-sent events (typing);
-- same pair with extension = 'presence' for presence surfaces
```

Policies are evaluated at subscribe and **cached for the connection**; fresh
JWTs arrive via `supabase.realtime.setAuth()` — call it after every token
refresh or the socket dies at JWT expiry. "Allow public access" gets disabled in
Realtime settings so nothing can accidentally join public.

### 5.3 Subscribing (browser islands, after hydration — never in the Worker)

```ts
await supabase.realtime.setAuth()          // required before private channels
const ch = supabase.channel(`thread:${id}`, { config: { private: true } })
  .on('broadcast', { event: 'INSERT' }, ({ payload }) => apply(payload))
  .subscribe((status, err) => {
    // SUBSCRIBED | TIMED_OUT | CLOSED | CHANNEL_ERROR — on error: log err, fall back to SSR state
  })
// cleanup on island unmount:
supabase.removeChannel(ch)
```

workerd cannot hold realtime WebSockets (request-scoped isolates, no native WS
client) — subscriptions are a browser concern, period. That's our SSR-first
pattern anyway: cached HTML paints, the island subscribes, liveness layers on.
`{ config: { broadcast: { ack: true } } }` + `await ch.send(...)` where delivery
certainty matters (call signaling). Reconnection/backoff/heartbeat are
supabase-js's job; our job is the graceful-fallback render.

### 5.4 Presence

```ts
const room = supabase.channel(`presence:city:${slug}`,
  { config: { private: true, presence: { key: accountId } } })
room.on('presence', { event: 'sync' }, () => render(room.presenceState()))
    .subscribe(async (s) => { if (s === 'SUBSCRIBED') await room.track({ online_at }) })
```

Presence is the *expensive* primitive — docs: slow-changing state only, throttle
`track()` (hard limit 5 track calls / 30 s / client, 10 keys per presence
object). Professionals tracking availability: perfect fit.

> **Security (2026-08-10 audit): the presence realtime is DORMANT and the DB
> policies are over-broad.** No client currently joins a `presence:*` channel —
> "online" is derived entirely from `profiles.last_active_at` (below), so there
> is no presence state to read today. But the `presence listen`/`presence track`
> policies in `0001_security.sql` gate only on `topic LIKE 'presence:%'`, so ANY
> authenticated user could join `presence:city:*` and, once presence carries a
> stable `accountId` key, read who-is-online-where — a deanonymisation vector for
> this platform. **Before any presence feature ships, scope the policies to the
> caller's own city/role AND stop keying presence by a stable `accountId` (use an
> ephemeral per-session token).** Ship the scoped policy + its RLS deny test in
> the same change; leaving these broad policies live with real presence data is a
> launch blocker.

**How presence reaches SSR** (decided 2026-08-03): `profiles.last_active_at` is
written by the professional's own island — a throttled, RLS-guarded own-row
update (`update profiles set last_active_at = now() where account_id =
auth.uid()`, at most once per few minutes) alongside `track()`. SSR sorts
`recently_online` and renders availability from that column; live "online now"
badges layer on via presence after hydration. No server-side presence
subscriber exists or is needed. **Anonymous public
pages are not presence clients**: "X online in Amsterdam" on a cached city page
comes from SSR (count query / KV micro-cache), optionally refreshed by a single
broadcast event — not from giving every visitor a socket into a presence channel.
Quota math forces this (below), and it matches zero-JS public pages.

### 5.5 Quotas (plan-level, the capacity-planning facts)

Concurrent connections: Free 200 / Pro 500 / Pro-no-cap+Team 10,000 · messages
per second: 100 / 500 / 2,500 · channel joins/sec: 500 / 500 / 2,500 · 100
channels per connection · broadcast payload 256 KB Free, 3 MB paid. DB-sourced
broadcasts persist 3 days in `realtime.messages` (private-channel replay is
available if we ever want catch-up on reconnect). supabase-js auto-reconnects
when a throughput breach clears. Every authed realtime surface = one connection
per open tab — the Messages island + presence ride the same socket (one client,
many channels), which is why islands share the §1 browser singleton.

## 6. Schema, migrations & types

- **Drizzle owns `public`** (decision 7): tables in `src/db/schema.ts`
  (enums/CHECKs from `src/lib/taxonomy.ts` — taxonomy is law), and everything
  drizzle-kit can't express — RLS policies, grants, triggers, `private.*`
  helpers, roles — lives in hand-written SQL inside the same generated
  migration files (`drizzle-kit generate` then edit, or `--custom` migrations).
  One flow: `db:generate` → `db:migrate` (single-tier, INFRASTRUCTURE §1);
  destructive-migration discipline per SECURITY.md §3.
- The Supabase-managed schemas (`auth`, `storage`, `realtime`) are theirs — we
  never migrate them; we only reference (`auth.users` FKs) and attach policies
  where designed for it (`realtime.messages`, `storage.objects`).
- **`supabase gen types` is optional and cheap:** browser islands that call
  PostgREST directly benefit from
  `bunx supabase gen types typescript --local > src/db/database.types.ts` after
  each migration; the Drizzle path has its own inferred types. Adopt when the
  first typed browser mutation lands, not before.
- Supabase Branching, declarative schemas, and `supabase db push` are unused —
  they assume `supabase/migrations/` owns DDL. Local `supabase migration` and
  `db diff` tooling stays available for *inspecting* drift, never for applying.

## 7. Dev setup & config authority (single-tier)

- No local stack (INFRASTRUCTURE §1): dev, tests and seeds hit the hosted
  project over `.env` (`DATABASE_URL` +
  `WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` — use the **Session
  pooler** string; the direct host is IPv6-only).
- **The project dashboard is the config authority.** Settings the code assumes
  (mirror of the dormant `supabase/config.toml`, which is version-controlled
  intent): `api.schemas = ["public"]` (decision 8) · `api.max_rows = 100` ·
  `auth.site_url` + redirect URLs (localhost:4321 for dev) · email
  confirmations ON (§2.2) · min password 8 · rate limits · Turnstile + SMTP
  when they land. Hosted settings do NOT sync from the repo — change both.
- Email testing without SMTP: Supabase's built-in email has tight rate limits
  (2/hour) — fine for solo dev; SMTP is the real fix (§9).
- When the multi-tier split returns, `bunx supabase start` + config.toml become
  the local tier again (git history pre-2026-08-03 has the wiring), and
  dashboard parity across tiers becomes a launch-gate check.

## 8. Storage (one narrow, future use)

Everything media already has a home outside Supabase (decision 9). When chat
video lands (MESSAGING.md §7, Phase B): a **private bucket** (private buckets
deny all by default), per-operation RLS on `storage.objects` scoped to thread
participants via the same `private.is_thread_participant` helper, uploads
through a server action (EXIF/caps enforced), delivery via
`createSignedUrl(path, expirySeconds)` with short expiry. Signed URLs use a
dedicated internal signing key independent of the Auth JWT keys — rotating auth
keys never invalidates them (mirror this property in the R2 presigned-GET design
for verification docs). The 90-day purge deletes storage objects, not just rows.

## 9. Production hardening (the Supabase slice of SECURITY.md §11)

Do at prod-project creation, verify at launch gate:

- **Plan & compute:** Pro from day one (Free pauses inactive projects and has no
  downloadable backups). **PITR on from first real data** (WAL every 2 min →
  worst-case RPO 2 min; needs ≥ Small compute) — PITR *replaces* daily backups.
  One restore drill to a scratch project before launch (SECURITY.md §3).
- **SSL enforcement ON** (covers direct + poolers; brief DB reboot when
  toggled). Drizzle-kit connections use `sslmode=verify-full` with the Supabase
  CA cert.
- **Network restrictions:** honest assessment — they only guard the Postgres
  wire, not the HTTP APIs, and Workers/Hyperdrive have no stable egress CIDR to
  allowlist. Skip unless Supabase publishes Hyperdrive-compatible ranges; the
  defense on the wire is the dedicated role + strong password + SSL.
- **Org security:** TOTP MFA on every dashboard account **plus org-wide MFA
  enforcement** (Pro+); ≥ 2 org owners; register a backup TOTP factor (Supabase
  has no recovery codes and will not restore access).
- **Auth config:** Turnstile enabled (Bot and Abuse Protection) · custom SMTP on
  a trusted domain (provider pending the adult-policy check, INFRASTRUCTURE §7)
  with link tracking off — **critical path, not hardening**: email+password is
  primary with confirmation required (§2.2), so staging/prod sign-ups are dead
  until SMTP works · OTP send limit raised to real traffic · test OTPs absent ·
  legacy API keys disabled.
- **Advisors as ritual:** after every staging migration, open Dashboard →
  Advisors; **zero ERROR-level security findings is a merge gate**. The rules
  map straight onto our laws: 0013 RLS disabled · 0002 `auth.users` exposed ·
  0010 security-definer view · 0015 user_metadata in policy · 0024
  `using (true)` policy · 0011 mutable function search_path · 0003 unwrapped
  auth functions · unindexed-FK/duplicate-index perf lints.
- **Observability:** `pg_stat_statements` is on by default — Studio's Query
  Performance + `index_advisor` for slow queries. Log retention is 7 days on
  Pro; if logs must be exported, use a **log drain to an EU destination only**
  (platform log residency is not promised in-region — the one Frankfurt caveat).
  Prometheus metrics endpoint (`/customer/v1/privileged/metrics`, secret-key
  auth) + the supabase-grafana dashboards when we want real alerting.
- **Paperwork:** DPA signed self-serve (org → Legal Documents; SCCs included) ·
  written adult-content confirmation (ARCHITECTURE §8.10) · Supabase entry in
  the SECURITY.md §8 processor inventory stays current.

## 10. GDPR & the auth/data lifecycle

- **Residency:** project data — Postgres, Auth, Storage — stays in the chosen
  region (Frankfurt / eu-central-1). Platform logs are the exception (§9).
- **The soft-delete trap:** our lifecycle is `deleted(soft)` with no hard
  deletes (hard rule 6) — but an app-level soft delete leaves the `auth.users`
  row alive and *able to log in and refresh tokens*. Account deletion therefore
  pairs: app rows → `deleted` state + PII scrubbed per the retention table,
  **and** the auth user neutralized — `auth.admin.deleteUser(id)` for erasure
  requests, or ban (`auth.admin.updateUserById(id, { ban_duration })`) for
  suspensions where the identity must survive for audit.
- FKs into `auth.users` are chosen per table, deliberately: cascade would vaporize
  audit trails on user deletion — audit/verification-state rows keep the user id
  as a plain UUID (no FK) or `on delete set null`, per the defensibility
  exception documented in ADMIN.md §12. Data-subject export/delete flows are
  server actions (SECURITY.md §8), reading through the same models as everything
  else.
- Auth data (phone numbers in `auth.users`) is part of the SECURITY.md §8 data
  map; Supabase is the processor holding it, under the signed DPA.

## 11. Phase 0 build order (details in MESSAGING.md §12 / SECURITY.md §11)

1. Prod project + staging alignment: new keys, ES256 signing keys, Turnstile,
   SMTP, rate limits, advisors clean (§9).
2. ✅ First migration wave (2026-08-03): `drizzle/0000_*.sql` (14 tables, DB
   constraints) + `drizzle/0001_security.sql` (`app_server` role ·
   default-privilege revokes · `private` schema · RLS everywhere · realtime
   policies · audit/broadcast/stamp triggers) · deny tests `tests/rls.test.ts`.
   Apply to the hosted project via `bun run db:migrate` (advisors are the gate).
3. ✅ Auth swap (2026-08-03, TOTP pending): `data/supabase/session.ts` +
   `getClaims()` replaced the mock (deleted); email+password live, role claims
   stamped into `app_metadata` by the `drizzle/0002` auth triggers (no service
   key in the signup path); `/auth/confirm` route ready (needs the dashboard
   email-template change in its doc comment). Admin promotion:
   `bun scripts/make-admin.ts <email> [role]`. **Still open:** admin TOTP
   enrollment + the aal2 wall · Turnstile captchaToken · phone+password (needs
   the SMS provider).
4. ✅ Realtime seam (2026-08-03): `src/app/realtime.ts` — `subscribe(poll, {
   channel })` layers a private broadcast channel (topic `thread:{id}`, fed by
   the 0001 `broadcast_message` trigger) over the poll, which stays as graceful
   fallback; `startHeartbeat()` is the RLS-guarded `last_active_at` self-update
   (E2E-verified from the browser). Live cross-client delivery depends on the
   project's `realtime.messages` partitions being provisioned — the fallback
   poll covers it until then.
5. Messaging/admin productionization rides on top (their own docs' phases).
