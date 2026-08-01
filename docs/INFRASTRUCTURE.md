# Infrastructure

Environments, deploy, CI, external services, assets, and the gotchas that cost
time to rediscover. Companion to `ARCHITECTURE.md` (§9 defines the tiers).

---

## 1. Environments (dev / staging / prod)

| Tier | App | Database | Notes |
|---|---|---|---|
| **dev** | `bun run dev` (localhost:4321) | local Supabase: `bunx supabase start` (Docker required) | all daily work; config in `supabase/config.toml` |
| **staging** | Worker `intimate-staging` → `intimate-staging.patrickdeamorim.workers.dev` | Supabase project `jqrfzqbuvekhcptqcpda` (Frankfurt) | verification before prod |
| **prod** | Worker `intimate` | **dedicated Supabase project — not yet created** (see §7) | Supabase MCP is read-only vs prod |

**Migrations flow strictly dev → staging → prod:**

```bash
bun run db:generate           # drizzle-kit generate (from src/db/schema.ts)
bun run db:migrate:local      # local supabase (127.0.0.1:54322)
bun run db:migrate:staging    # staging project — after local passes
bun run db:migrate:prod       # prod — ONLY after staging verification (wired when prod exists)
```

Local Supabase: `bunx supabase start` / `stop` / `status`. Studio at
`127.0.0.1:54323`; local Postgres at `127.0.0.1:54322` (user/pass `postgres`).

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
# prod: bun run build && bunx wrangler deploy   (only after staging verification)
```

On deploy the adapter auto-provisions a `SESSION` KV namespace and an `IMAGES`
binding. Hyperdrive `intimate-staging` (id `c56d9b6e947a4841baa30f8b6a6b9e55`)
is bound in both wrangler envs until the prod Supabase project exists
(`ponytail:` note in `wrangler.jsonc`).

## 3. CI (GitHub Actions)

`.github/workflows/ci.yml`: PRs run `bun install → bun test → build`; pushes to
`main` additionally build with `CLOUDFLARE_ENV=staging` and deploy the staging
Worker. Repo secrets (set): `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
(account `9ab693202883d3767f3ad5f4ce266053`).

## 4. Assets & third-party

- **Font Awesome 8 Pro** — self-hosted at `public/fa/` from the kit
  `kit-52886650b2-web`. Contains **thin + brands families ONLY** — `fa-solid`
  / `fa-regular` classes silently render nothing. Use `atoms/Icon.astro`.
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

- [ ] **Prod Supabase project** (Frankfurt) — then: prod Hyperdrive config,
      fill prod `vars` in `wrangler.jsonc`, wire `db:migrate:prod`, keep MCP
      read-only.
- [ ] Cloudflare Images (paid — ToS requirement for media), KV, Queues, Cron,
      Turnstile.
- [ ] coturn VPS (EU, e.g. Hetzner) for video-call TURN fallback
      (ARCHITECTURE §10) — `TURN_URLS`/`TURN_SECRET` env.
- [ ] Twilio Verify service (SMS verification, ARCHITECTURE §11) — account +
      Verify service SID; secrets server-side only.
- [ ] Dedicated R2 bucket for verification documents (ARCHITECTURE §11):
      jurisdiction EU, public access OFF, no r2.dev/custom domain, lifecycle
      sweeper as deletion backstop.
- [ ] Email provider — check adult-content policy first (Resend/Postmark).
- [ ] Supabase written confirmation for adult content (ToS posture,
      ARCHITECTURE §8.10).
- [ ] Custom domain + AI-crawler allowlist (GPTBot, OAI-SearchBot, ClaudeBot,
      PerplexityBot) once the zone exists.
