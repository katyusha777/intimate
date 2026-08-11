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
├─ api/           # THE SEAM — what pages call. One re-export per domain.
│   profiles.ts   #   wires profilesApi to the db backend (Hyperdrive)
├─ data/          # backend implementations
│   └─ db/        #   THE database: Drizzle over hosted Postgres
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

The table-by-table Postgres shape, the enum↔taxonomy map, and the full mock→prod
seam (email→uuid identity, `photos[]`→`media`, override→direct edit) live in
**DATA.md**; the DDL/RLS law is SUPABASE.md.

Conventions: params objects validated with the model's `ParamsSchema`
(`limit` capped, defaults applied); list results are `{ items, total }` (total
before paging — pagination and counts come for free); `byX` returns `T | null`.

## 3. Security model (for the Supabase backend)

Two access paths, different guards (ARCHITECTURE §3):

**Server path (Drizzle → Hyperdrive → Postgres).** The pooled connection is not
subject to end-user RLS — so the backend code is the guard: every public read
filters `state = 'live'`, inputs are
Zod-parsed, and admin-only operations live in `src/actions/` behind auth
checks. Service-role keys never leave the server.

**Browser path (supabase-js: Auth, Realtime, RLS-guarded dashboard mutations
ONLY).** RLS is the wall. The short law: wrapped `(select auth.uid())`, indexed
policy columns, `TO authenticated`/`TO anon`, no joins in policies, authz claims
in `app_metadata` only, every policy with its deny test. Canonical policy
shapes, the performance rules with benchmarks, and the key/client construction
spec live in SUPABASE.md §1–3 — that doc is the detailed spec of this split.

## 4. Realtime (the app is live everywhere)

Per current Supabase guidance: **Broadcast is the primary primitive** —
`postgres_changes` doesn't scale past casual use and is not our pattern.

- **DB-originated events:** triggers call `realtime.broadcast_changes()` (or
  `realtime.send()` for custom payloads) so any write fans out instantly —
  approval moments, new-profile toasts, import progress, admin queues.
- **Topics:** `entity:id` naming (`profile:p01`, `call:abc`, `city:amsterdam`).
- **Private channels by default:** clients join with `private: true`,
  authorized by RLS on `realtime.messages`; "Allow public access" is disabled
  in Realtime settings. Policy shapes, `setAuth` lifecycle, and quotas:
  SUPABASE.md §5.
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
| `api/profiles` | `list(params)` → `{items,total}` · `bySlug(slug)` | **`data/db/profiles.ts` (Drizzle → Hyperdrive → Postgres)**; shared list core `applyProfileListParams` + parity-tested vs the json reference |
| `api/session` | `current(ctx)` · `register` · `signIn` · `signOut` | **`data/supabase/session.ts` (Supabase Auth, @supabase/ssr cookies, getClaims)**; signup wiring = DB triggers (drizzle/0002) |
| `api/account` | `get` · `save` · `myProfile` · `saveProfile` · `submitProfile` · `photos`/`addPhoto`/`removePhoto` · admin `all`/`byEmail`/`saveByEmail` | **`data/db/account.ts`** — accounts row + favorites/media tables; edits write `profiles` columns directly |
| `api/messaging` | threads/messages/contacts/settings (MESSAGING.md §2) | **`data/db/messaging.ts`** (Postgres) — participation from the session, `last_message_at`+broadcast via triggers; `makeMessagingApi(db)` is unit-tested |
| `api/orgs` | `agencyBySlug(slug)` · `listAgencies()` — PUBLIC projection only (no contact/KvK/crawl config) · `createOrg(input)` · `joinFromConsent(input)` (the /agencies consent form: dedupe by site/email, consent stamp) | direct Drizzle on `orgs`; feeds `/{locale}/agencies/…` + the sitemap. Creation lives HERE (public form + admin both call it — the fence is one-directional); admin roster/crawl stays in `actions/admin/orgs.ts` |
| `api/prelaunch` | `addPrelaunchLead(input)` — pre-launch pre-registrations (kind + phone/whatsapp/telegram), idempotent on email · `listPrelaunchLeads()` — admin pre-signups tab, newest first | direct Drizzle on `prelaunch_leads` (zero browser grants); table + module retire at launch |

Editorial **articles are not in this seam** — they're markdown-in-git via an
Astro content collection (`src/content/articles/{locale}/`, config in
`src/content.config.ts`), read through `src/lib/articles.ts`. No DB, no admin
CRUD; add a backend the day non-dev editors need a CMS.

`list` params: `city · gender · service · onlineOnly · featuredOnly ·
verifiedOnly · orgId (agency roster) · sort (taxonomy SORT_OPTIONS) · limit ·
offset`. Counts via `list({ ..., limit: 0 }).total`.

Growing the surface: add fields to the model schema + JSON, extend params —
the homepage's needs drove v1; each new page extends this the same way.
