# Session handoff — 2026-08-06

Scratch handoff for the next instance. Delete when absorbed. Authored after a long
session covering: performance fixes, the full video/voice calling feature + TURN
server, and the `items.md` feedback batch (14 items). **Nothing is committed** —
the entire working tree (105 files) is staged-in-mind only. Review + commit is
the first real decision for the next session (see "Commit strategy" below).

---

## 1. State of the world

- Branch: `main`. Working tree dirty (~105 files, 24 untracked).
- Deploys go to **staging only** (`bun run deploy:staging` → staging.intimate.nl).
  Everything below is DEPLOYED to staging but UNCOMMITTED.
- DB is the single hosted Supabase project. Migrations **0009–0012 are applied**
  to it already (`bun run db:migrate` was run). Do not re-run generate/migrate
  expecting new files — the schema and DB are in sync.
- Test suite: `bun test` → **140 tests, 0 fail** (121 pass, 19 skip).
- `bun run check` (astro typecheck): **17 errors, ALL pre-existing** in files this
  session never touched (BirthDateField, Lightbox, VerificationFlow, BottomTabBar
  line ~100 `session` `{}` type, the four admin index pages' `Astro.redirect`
  calls, and `scripts/subset-fa.ts`). Don't chase them — they're at HEAD too.

---

## 2. What was built this session (three efforts)

### A. Performance pass (PageSpeed + securityheaders reports) — DONE, deployed
- Recompressed `public/nsfwimg` placeholders 8.2 MB → 3.5 MB (max 1080px q70).
- LCP image preload: shared logic in `realImageFor()` (`src/lib/safe-images.ts`),
  a `preloadImage` prop on `Layout.astro`, wired from home + profile pages.
- Per-request query dedup: `requestMemo()` in `src/db/client.ts`; home's 3
  `profilesApi.list()` calls now share one catalog fetch.
- Security headers + HTTPS redirect live in `src/middleware.ts` (was already there
  from a prior session; verified A-grade on staging).
- Async FontAwesome CSS, `font-display: swap`, logo width/height — all in.

### B. Video/voice calling + contact fast-path — DONE, deployed
Full plan lives in **`docs/VIDEO-CALLING.md`** (temporary tracker) and
**`docs/TURN-SERVER.md`** (the coturn box runbook). Highlights:
- **TURN server LIVE**: coturn on `turn.intimate.nl` (2.28.28.93), TLS on 443 +
  plain 3478, relay allocation proven, logging off. `TURN_SECRET` is in Worker
  secrets (prod + staging). SSH details + remaining owner steps (rotate root pw,
  disable password auth) in `docs/TURN-SERVER.md` and the `turn-server` memory.
- **Schema**: `call_sessions` (metadata only, never media), `contact_invites`,
  `messages.call_id`, `threads.hidden_by`. RLS in `drizzle/0010_calls_security.sql`
  — call_sessions has NO browser write path (client-can't-initiate is enforced by
  absence of a path + a DB CHECK).
- **Realtime seam**: `src/app/realtime.ts` gained `openChannel()` (SDP/ICE over
  private `call:{id}` broadcast) and the account/thread channels are authorized in
  0010. `subscribe()` already existed.
- **UI**: `src/components/organisms/call/CallDock.astro` — ONE global surface
  mounted in `Layout.astro` for signed-in users: live unread dots + incoming-call
  ring overlay (client) + full-screen call screen (both parties), voice + video,
  PiP, flip. Vanilla script, WebRTC P2P. Professional side is relay-only when TURN
  is live (her IP never reaches a client).
- **Contact invites**: she mints a single-use 7-day link in Contacts → client
  opens `/{locale}/c/{token}` → lands in an OPEN thread (no request card). Route:
  `src/pages/[locale]/c/[token].astro`. Data: `mintInvite/listInvites/revokeInvite/
  claimInvite` in `src/app/data/db/messaging.ts`.
- **Favorites removed** from professional surfaces (UserMenu).
- Tests: `tests/calls.test.ts` (TURN HMAC formula vs RFC vector + call state
  machine).
- **NOT verified**: real two-device call (iPhone-Safari ↔ Android-Chrome), the
  forced-relay webrtc-internals check. These are the open DoD boxes in
  `docs/VIDEO-CALLING.md` §6–8. Everything is built; only device verification
  remains.

### C. items.md feedback batch (14 items) — CODE DONE, visual check NOT done
`/Users/katyusha/Desktop/items.md` is the source. All 14 implemented:

| # | Item | Where |
|---|------|-------|
| 1 | Block vs "block & delete" + blocked badge; delete-later; unblock restores | `threads.hidden_by` (mig 0011), `messaging.ts` setBlocked/hideThread, Thread/Inbox/ContactList badges |
| 2 | Settings reachable on mobile | `AccountShell.astro` tabs now show at all sizes; Settings link added to `UserMenu.astro` |
| 3 | Avatar rightmost in mobile bar | already satisfied in a prior session (account tab is rightmost for all roles) |
| 4 | Dark mode from device, remember manual pick | `Layout.astro` no-flash script now reads `prefers-color-scheme` |
| 5 | Language from browser, remember pick | `negotiateLocale()` reads `PARAGLIDE_LOCALE` cookie (`i18n.ts` + `middleware.ts`); Combobox + RegionSheet write it |
| 6 | Remove-account → admin approval | `accounts.deletion_requested_at` (mig 0011); `account.requestGdpr` action; `admin/gdpr.ts` approveDeletion (scrub PII + soft-delete + auth.admin.deleteUser); admin users page banner |
| 7 | Request-all-data → admin | `accounts.data_requested_at`; `admin/gdpr.ts` exportAccountData → JSON download in admin users page |
| 8 | 18+ age gate | `Layout.astro` blurred overlay + `age_ok` cookie, SSR'd, no-flash inline script |
| 9 | Safe-mode images too bright in dark | `data-showing` attr set by safe-mode script + `.dark img[data-showing=...]` dim filter in `global.css` |
| 10 | /docs hub | `src/pages/[locale]/docs/index.astro` aggregating site-pages + blog |
| 11 | Branded 404 | `src/pages/404.astro` |
| 12 | SMS abuse + duplicate numbers | `src/lib/rate-limit.ts` (KV limiter); `accountApi.phoneInUse()`; guards in `startSms`/`checkSms` |
| 13 | Tabbar icon labels | `BottomTabBar.astro` — small `text-2xs` label under each icon |
| 14 | Dark-mode depth (pure black on black) | `global.css` `.dark` tokens: `--card` 0.19→0.21, `--border` 0.275→0.30, muted/secondary/accent lightened |

New i18n keys added to all three locales (`messages/{en,nl,de}.json`, 851 keys each).

---

## 3. What's LEFT / next actions

1. **Visual verification of the items batch — MOSTLY DONE (2026-08-06 PM).**
   Verified live on staging @ 390×844 via Playwright MCP:
   ✓ #2 settings tabs on mobile · #3 Account tab rightmost · #4 theme toggle ·
   #5 language NL/EN/DE · #7 request-data END-TO-END · #8 age gate blur ·
   #9 safe-mode dim in dark · #10 /docs hub · #11 branded 404 · #13 tabbar
   labels · #14 dark-mode depth (subtle but reads as layers).
   **Found + fixed a bug in #7:** the admin GDPR banner never cleared after the
   admin fulfilled a request — `exportAccountData` didn't clear
   `data_requested_at`, and a naive reload showed Hyperdrive-cache-stale data.
   Fix: `clearDataRequest()` at fulfilment + the admin buttons now optimistically
   remove the banner row (robust to the read-cache). Deployed + verified. See the
   new `hyperdrive-read-cache-active` memory — reads lag writes, use optimistic UI.
   **Still unverified visually** (need special setup, not destructive-safe):
   - #1 in-chat "blocked" badge — needs 2 accounts + a thread (block-list UI in
     Settings confirmed present: "You haven't blocked anyone").
   - #6 deletion APPROVAL end-to-end — not run (scrubs a real account; also needs
     the service-role secret, see §3.3). The banner/button mechanism is proven
     via #7 (same code path).
   - #12 SMS rate-limit / duplicate-number — backend only, no visual surface; add
     a test (`rate-limit.ts` + `accountApi.phoneInUse()` guards).
2. **Real-device call test** (video-calling DoD): two phones, one placing a call
   from a thread header, confirm connect + relay-only candidates on her side.
3. **GDPR auth deletion needs `SUPABASE_SERVICE_ROLE_KEY`** in Worker secrets.
   Without it, `approveDeletion` scrubs PII + soft-deletes the profile but can't
   remove the auth.users login (returns `authDeleted: false`). Add the secret,
   then deletion is complete. The service-role client is constructed only in
   `src/actions/admin/gdpr.ts` — inside the admin fence, boundary-compliant.
4. **Commit strategy.** Everything is one giant uncommitted blob spanning several
   features. Per CLAUDE.md, sensitive diffs (auth, RLS, actions, storage,
   migrations) go through a PR carrying the review ritual: `web-perf` →
   `/security-review` → `/code-review`. Suggest splitting into logical commits:
   (a) perf pass, (b) video-calling + TURN, (c) items.md batch. The calling +
   GDPR + RLS migrations are squarely in the sensitive category — run
   `/security-review` before merging to main.
5. **Docs to tick/delete on completion**: `docs/VIDEO-CALLING.md` and
   `docs/TURN-SERVER.md` are temporary trackers — fold into MESSAGING.md §9 /
   INFRASTRUCTURE.md and delete once device-verified. `docs.test.ts` enforces
   cross-refs; keep it green.

---

## 4. Gotchas carried from memory (still true)

- Deploy to staging, they test there; localhost is unreliable for them.
- After redeploy, hard-refresh to beat KV page-cache + browser cache.
- Playwright MCP for visual checks, never claude-in-chrome.
- Bun is the toolchain, workerd is the runtime — no Bun-specific APIs in `src/`.
