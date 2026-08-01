# Data Layer & API

How data flows through the app: the `src/app` layer, the swap-ready backend
seam, the Supabase security model it will land on, and the realtime strategy.
Enforced by `tests/architecture.test.ts` (seam rules are tested).

---

## 1. The `src/app` layer

```
src/app/
├─ models/        # Zod schemas = source of truth: validation + TS types + backend contracts
│   profile.ts    #   ProfileSchema, ProfileListParamsSchema, ProfilesApi interface
│   article.ts
├─ api/           # THE SEAM — what pages call. One re-export per domain.
│   profiles.ts   #   export { profilesApi } from '@/app/data/json/profiles'
│   articles.ts
├─ data/          # backend implementations
│   └─ json/      #   current "database": .json files + impls of the Api interfaces
│       profiles.json · profiles.ts · articles.json · articles.ts
└─ services/      # future cross-cutting helpers (TURN creds, images, AI search)
```

**Access rules (tested):**
- `@/app/data/**` is importable **only from `src/app/api/`** — nothing reaches a
  backend directly.
- `@/app/api/**` is importable **only from pages, layouts, and `src/actions/`** —
  components receive data as props; they may import **types** from
  `@/app/models` but never fetch.
- Everything in `app/api` + `app/data` is server-side only (SSR/actions) — never
  imported into islands.

## 2. The swap: JSON now → Drizzle/Supabase later

The data structure is still in flux, so the "database" is JSON files. The
discipline that makes the swap trivial:

1. **`models/*.ts` defines an `XxxApi` interface** — both backends implement it,
   so signatures are compiler-checked identical.
2. **Every function is `async`** even though JSON is sync — call sites never
   change when the DB lands.
3. **Semantics live in the backend**, not the caller: filtering, sorting,
   pagination, and the visibility rule (`state === 'live'` only, mirroring the
   lifecycle non-negotiable) are implemented in `data/json/*` exactly as the
   SQL backend will implement them in queries.
4. Swap = add `data/db/profiles.ts` (Drizzle → Hyperdrive) implementing
   `ProfilesApi`, then change one re-export line in `api/profiles.ts`.

Conventions: params objects validated with the model's `ParamsSchema`
(`limit` capped, defaults applied); list results are `{ items, total }` (total
before paging — pagination and counts come for free); `byX` returns `T | null`.

## 3. Security model (for the Supabase backend)

Two access paths, different guards (ARCHITECTURE §3):

**Server path (Drizzle → Hyperdrive → Postgres).** The pooled connection is not
subject to end-user RLS — so the backend code is the guard: every public read
filters `state = 'live'` (the json backend already enforces this), inputs are
Zod-parsed, and admin-only operations live in `src/actions/` behind auth
checks. Service-role keys never leave the server.

**Browser path (supabase-js: Auth, Realtime, RLS-guarded dashboard mutations
ONLY).** RLS is the wall. Per Supabase's current best practices:

- Wrap auth functions: `(select auth.uid()) = user_id` — cached per statement
  instead of per row (their benchmarks: ~99.9% faster).
- **Index every column referenced in a policy.**
- Always add `TO authenticated` / `TO anon` so policies aren't evaluated for
  ineligible roles.
- Duplicate policy conditions as explicit query filters (`.eq(...)`) — better
  query plans.
- Avoid joins in policies; use `security definer` helper functions for complex
  authorization (and pin their `search_path`).
- Authorization data in `app_metadata`, never `user_metadata` (users can edit
  the latter). JWT claims go stale until refresh — keep expiry short.
- `UPDATE` policies need a matching `SELECT` policy.

## 4. Realtime (the app is live everywhere)

Per current Supabase guidance: **Broadcast is the primary primitive** —
`postgres_changes` doesn't scale past casual use and is not our pattern.

- **DB-originated events:** triggers call `realtime.broadcast_changes()` (or
  `realtime.send()` for custom payloads) so any write fans out instantly —
  approval moments, new-profile toasts, import progress, admin queues.
- **Topics:** `entity:id` naming (`profile:p01`, `call:abc`, `city:amsterdam`).
- **Private channels by default:** RLS policies on `realtime.messages`
  (filtering `extension = 'broadcast'` / `'presence'` + `realtime.topic()`),
  clients join with `private: true`, and "Allow public access" is disabled in
  Realtime settings. Keep these policies *simple* — complex RLS on
  `realtime.messages` raises join latency. Policies are cached per connection;
  short JWT expiry keeps them fresh (`setAuth` on refresh).
- **Presence** for online-now badges and live city counts (its own
  `extension = 'presence'` policy).
- **Payloads are IDs + minimal state, never trusted as instructions** — the
  client re-renders from props/SSR-shaped data, or refetches.
- **SSR-first, always:** cached HTML paints instantly; small islands subscribe
  after hydration and layer liveness on top; everything degrades gracefully to
  plain SSR. `ack: true` where delivery certainty matters (call signaling).
- Client helpers will live in `src/app/realtime/` (browser-side counterpart of
  `app/api`) when the first live feature lands.

## 5. The three dimensions (listing architecture)

The taxonomy defines three ORTHOGONAL dimensions (see the doc block in
`src/lib/taxonomy.ts` — it is the source of truth):

1. **Meeting type** (in-person modes): `incall` = private visit · `outcall` =
   escort. A profile may offer both.
2. **Delivery method**: in-person vs virtual. Virtual availability is
   *derived* from offering services in the `virtual` service category — never
   a separate boolean.
3. **Services** in **categories** (BDSM and massage are categories with
   subcategories).

Listing tabs (`LISTING_CATEGORIES`, each stamped with its `kind`) are saved
filter presets ACROSS these dimensions over one profile pool — never
partitions. UI consequences, all implemented in `SearchListing`/`FilterSidebar`:
tab + city live in the URL path (`/service/escort/amsterdam/`), the rest is
querystring canonicalized to the clean path; the sidebar NEVER changes shape —
route presets arrive as selected state (escort tab → visit radio checked), and
on meeting-type tabs the visit radios navigate between sibling tabs so the tab
and the filter stay one dimension.

## 6. Current API surface

| Module | Functions | Backed by |
|---|---|---|
| `api/profiles` | `list(params)` → `{items,total}` · `bySlug(slug)` | `data/json/profiles.json` (30 mock profiles) |
| `api/articles` | `list({limit})` · `bySlug(slug)` | `data/json/articles.json` (4 dummy articles) |
| `api/session` | `fromCookies` · `register` · `signIn` · `signOut` | mock cookie + KV (Supabase Auth later — same interface) |
| `api/account` | `get` · `save` · `myProfile` | KV-backed mock (`data/json/session.ts`) |
| `api/messaging` | threads/messages/contacts/settings (MESSAGING.md §2) | KV-backed mock; enforcement in the action layer until the RLS swap |

`list` params: `city · gender · service · onlineOnly · featuredOnly ·
verifiedOnly · sort (taxonomy SORT_OPTIONS) · limit · offset`. Counts via
`list({ ..., limit: 0 }).total`.

Growing the surface: add fields to the model schema + JSON, extend params —
the homepage's needs drove v1; each new page extends this the same way.
