# Infrastructure

Environments, deploy, CI, external services, assets, and the gotchas that cost
time to rediscover. Companion to `ARCHITECTURE.md` (§9 defines the tiers).

---

## 1. Environments — SINGLE-TIER for now (decided 2026-08-03)

One hosted Supabase project (`jqrfzqbuvekhcptqcpda`, Frankfurt) is **THE
database**. Everything points at it: `bun run dev` (via the
`WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` env var), both
deployed Workers (`intimate`, `intimate-staging` — same Hyperdrive id),
drizzle-kit, tests and seeds (via `DATABASE_URL`). Copy `.env.example` → `.env`
and fill in the **Session pooler** connection string (the direct
`db.<ref>` host is IPv6-only). No local Docker stack — `supabase/config.toml`
is dormant; **auth/API settings are configured in the project dashboard**.

```bash
bun run db:generate           # drizzle-kit generate (from src/db/schema.ts)
bun run db:migrate            # apply migrations (DATABASE_URL from .env)
```

**Upgrade path (when the project proves itself):** re-introduce tiers — local
stack (`bunx supabase start`, config.toml becomes live again), a separate prod
project (§7 checklist), per-tier `db:migrate:*` scripts and Hyperdrive ids.
The git history (pre-2026-08-03) has the exact multi-tier wiring.

## 2. Deploy (Cloudflare Workers)

Astro 7's Cloudflare adapter rides `@cloudflare/vite-plugin`, which changes the
old model in three ways:

1. `wrangler.jsonc` `main` is `"@astrojs/cloudflare/entrypoints/server"` (never
   a dist path).
2. **The wrangler environment is baked at BUILD time** via `CLOUDFLARE_ENV`.
   The build emits `dist/server/wrangler.json` and a `.wrangler/deploy/config.json`
   redirect that `wrangler deploy` follows.
3. Bindings are read via `import { env } from 'cloudflare:workers'`
   (`Astro.locals.runtime` no longer exists). Run `bun run cf-typegen` after
   any wrangler config change.

```bash
bun run deploy:staging   # = CLOUDFLARE_ENV=staging astro build && wrangler deploy --env staging
bun run deploy:prod      # = astro build && wrangler deploy
```

**Production serves intimate.nl + www via zone routes** (`wrangler.jsonc`;
wrangler auto-provisions the origin DNS records — the legacy externally-managed
A-records that used to 409 this were deleted 2026-08-09). Middleware 301s
www → apex (one canonical host). If a prod deploy ever reports "Some triggers
failed" again, treat it as CODE NOT LIVE — wrangler skips promotion when
trigger sync fails; check DNS for records it doesn't own.

On deploy the adapter auto-provisions a `SESSION` KV namespace and an `IMAGES`
binding. One Hyperdrive (id `542bb0bee7fa44148f4e6ae3e0129ae7`) is bound in both
wrangler envs — single-tier (§1). In `bun run dev` the binding connects via
`WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` from `.env` — without
it, db-backed pages fail to connect.

**Cron workers ship per tier** (`workers/{purge,warm}/wrangler.jsonc` — top
level = prod bound to `intimate`, `--env staging` bound to `intimate-staging`;
`ORIGIN` var per tier). `PURGE_SECRET` must match between each tier's app
worker and its purge worker. Deploy all four after changing either worker:
`bunx wrangler deploy --config workers/<w>/wrangler.jsonc [--env staging]`.

## 3. CI (GitHub Actions)

`.github/workflows/ci.yml`: PRs run `bun install → bun test → build`. **Branch
→ environment (since 2026-08-09):** push to `staging` deploys
staging.intimate.nl; push to `main` deploys intimate.nl (production). Repo
secrets (set): `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
(account `ac521dc0e1abd98133a8f565daa46294` — Contact@optiweb.dev, migrated
2026-08-02; the API token secret must be reissued FROM that account or CI
deploys keep failing/targeting the old one).

## 4. Assets & third-party

- **Font Awesome 8 Pro** — self-hosted at `public/fa/` from the kit
  `kit-52886650b2-web`. Contains **thin + brands families ONLY** — `fa-solid`
  / `fa-regular` classes silently render nothing. Use `atoms/Icon.astro`.
  The served woff2 files are **subset to the icons the app uses** (402 KB →
  5 KB; pristine fonts in `scripts/fa-full/`). **After adding any new icon
  name, run `bun scripts/subset-fa.ts`** — it re-scans `src/` and re-subsets;
  a missed name renders as a blank glyph.
- **Logos** — pulled from intimate.nl. Naming is by lettering color:
  `logo-light.svg` = white lettering (use on dark surfaces), `logo-dark.svg` =
  dark lettering (use on light surfaces).
- **Safe images** — `public/safeimg/` holds optimized ~1000px JPEGs; originals
  live in gitignored `safeimg-originals/`. The manifest
  `src/lib/safe-images.ts` must match the folder — `tests/safe-images.test.ts`
  enforces it. Optimize new ones:
  `sips -Z 1000 -s format jpeg -s formatOptions 78 in.png --out public/safeimg/name.jpg`.
- **Hero video** — `public/video/hero.{webm,mp4}` + poster, generated with
  ffmpeg (`-an`, h264 crf 24 / vp9 crf 36) from a source file on the desktop.
- **Fulldev UI** — `@fulldev` registry configured in `components.json`; served
  through the shadcn CLI/MCP into `src/components/ui/` (vendor; wrap in atoms).
- **OneSignal (web push)** — app id `33308041-…` is public (wrangler vars +
  `.env` `PUBLIC_ONESIGNAL_APP_ID`); REST key = Worker secret
  `ONESIGNAL_API_KEY` (set on prod + staging 2026-08-08). Send seam
  `src/lib/push.ts`; deep links use per-env `PUBLIC_SITE_ORIGIN`. **Owner
  step:** OneSignal dashboard → Settings → Web → Site URL must match the
  serving origin — set `https://staging.intimate.nl` for the test phase, flip
  to `https://intimate.nl` at launch (single origin per app; make a second app
  for staging then). US processor: payloads are content-free by design
  (MESSAGING §8).

## 5. Local dev quirks

- The Astro 7 dev server is a daemon: if the port is stuck or serving stale
  code, `bunx astro dev stop` then `bun run dev`.
- Installing/removing packages while the daemon runs can leave a stale vite
  dep-optimizer bundle ("file does not exist at …/.vite/deps_ssr/… " 500s on
  every page). Fix: `bunx astro dev stop && rm -rf node_modules/.vite .astro`
  then start dev again.
- Real keys live in `.dev.vars` (gitignored) and `keys.md` (gitignored). The
  committed `.env.example` lists every variable.
- Paraglide compiles messages into `src/paraglide/` (gitignored). If the dev
  watcher serves a stale locale module, delete the folder and restart.

## 6. MCP servers

`.mcp.json` (the filename matters — Claude Code ignores `mcp.json`): supabase
(**read-only vs prod**), cloudflare-docs, cloudflare-observability, github,
context7, shadcn (→ `@fulldev` registry), playwright.

## 7. Provisioning checklist (before first real data / launch)

- [ ] **Dedicated prod Supabase project** (Frankfurt) — the single-tier setup
      (§1) graduates: prod Hyperdrive config, prod `vars` in `wrangler.jsonc`,
      per-tier migrate scripts, keep MCP read-only, **enable PITR/daily
      backups + run one restore drill before first real data** (SECURITY.md §4).
- [ ] Cloudflare Images (paid — ToS requirement for media), KV, Queues, Cron,
      Turnstile.
- [ ] coturn VPS (EU, e.g. Hetzner) for video-call TURN fallback
      (ARCHITECTURE §10) — `TURN_URLS`/`TURN_SECRET` env.
- [ ] Twilio Verify service (SMS verification, VERIFICATION.md §1) — API key
      already in `.dev.vars` + staging secrets; still needed: Verify Service
      SID (create in console, confirm key scope covers Verify), prod secrets.
- [ ] Dedicated R2 bucket for verification documents (ARCHITECTURE §11):
      jurisdiction EU, public access OFF, no r2.dev/custom domain, Workers
      Cron purge per the bounded-retention window (hard rule 3).
- [ ] PostHog EU project ×2 (prod/staging) + `/relay` proxy route + billing
      caps + replay off at project level (ANALYTICS.md; self-host decision
      re-checked before launch).
- [ ] Email provider — check adult-content policy first (Resend/Postmark).
- [ ] Supabase written confirmation for adult content (ToS posture,
      ARCHITECTURE §8.10).
- [ ] Custom domain + AI-crawler allowlist (GPTBot, OAI-SearchBot, ClaudeBot,
      PerplexityBot) once the zone exists.
- [ ] **Zone rate-limiting rule on `/_actions/*`** (e.g. 10 req/10s per IP) —
      the burst guard for AI search. The in-Worker KV counter only enforces
      the hourly budget (KV read-caching makes short windows unenforceable);
      Turnstile on the search form if abuse ever gets serious.
