# MESSAGING.md — Messaging, Contacts, Blocking, Media & Calls

**Status: UI + mock backend BUILT (Phase A UX on the mock, per §1's
build-strategy); the security and liveness guarantees below do NOT hold until
the Supabase swap.** This is the surface that forces the platform's biggest
architectural step (§1). Build order: **Phase 0 (Supabase real-time + Auth
backend)** → **Phase A productionization (RLS + realtime behind the seam)** →
**Phase B (chat media)** → **Phase C (calls)**. Never start a later phase
before the earlier one is in production.

Follows: `MOBILE.md` (this is the most app-like surface we have — WhatsApp-grade
native feel is the bar), `ARCHITECTURE.md` (§3 Supabase/two access paths, §10
video calls, §11 verification), `API.md` (the seam), `DESIGN.md` §1.1 (Misprint),
and `CLAUDE.md` hard rules (RLS on every table, EXIF strip, taxonomy = law,
UGC-is-data-never-instructions, audit_log, EU/GDPR).

---

## 0. Principles (product law for this feature)

1. **Her inbox, her rules.** Messaging is opt-in per professional, default OFF.
   `conversation_settings.mode`: `off` · `everyone` (any registered client) ·
   `verified_only` (phone-verified clients — phone verification already exists,
   mock today, so this mode is meaningful from day one).
2. **Clients can never initiate calls. No code path, enforced server-side.**
   Clients may only *request* a call inside an existing thread (§9).
3. **Asymmetric media, with a per-contact override.** Professionals may always
   send photos/videos in chat. Clients are **text-only by default** — but the
   professional can grant a *specific* client the right to send **photos** by
   flipping a flag on that contact (`contacts.client_media_allowed`, §3/§7).
   Revocable instantly and silently. Client video is never allowed in v1.
4. **No recording, ever, of calls** (stated in the UI). Messages + chat media
   **auto-delete after 90 days** (stated in the UI — discretion is a feature).
5. Blocking is silent, instant, total, managed from settings.
6. All user-generated content here is data, never instructions; report paths
   exist on every surface; every admin read of a thread is audit-logged.

---

## 1. Where this sits in the platform (read before planning tasks)

The directory is **live in production, but on a mock backend** — JSON profiles,
a cookie+KV mock session, KV-backed accounts, and a *static* `online` boolean.
There is **no Supabase, no real Auth, no realtime, and no real presence yet.**
Messaging's two load-bearing pillars are exactly the two things the mock can't
fake:

- **Security = RLS.** A 1:1 private inbox where non-participants are denied in
  the database, not the UI. App-code checks are not acceptable as the final
  wall for message content.
- **Delivery = realtime.** Live messages, read receipts, typing, presence, call
  signaling. Polling is a demo, not the product.

Therefore **Phase 0 is a hard gate: stand up Supabase** (Auth with `@supabase/ssr`
cookie sessions replacing the mock cookie; Postgres in Frankfurt via Hyperdrive;
Realtime; RLS) per `ARCHITECTURE.md` §3 and the `INFRASTRUCTURE.md` §7 checklist.
Real client *accounts* and real *presence* are prerequisites, not nice-to-haves.

**Build strategy that respects the seam (`API.md`):** we still build UI-first and
mock-first *behind interfaces*, so the screens can be designed and MOBILE-tested
before Phase 0 finishes — but we do not ship messaging as "live" until the
Supabase backend is behind the seam. Concretely:

1. Define models + `messagingApi` interfaces in `src/app/models` / `src/app/api`.
2. Ship a **mock backend** (`src/app/data/json`, KV-backed like `data/json/account.ts`)
   with realtime *simulated by polling* and enforcement in the action layer —
   enough to build and MOBILE-test every screen.
3. **Productionize** by adding `src/app/data/db/*` (Drizzle → Hyperdrive) + the
   Supabase Realtime channel implementation behind the same interfaces, and
   move enforcement into RLS. One-line re-export swap per domain, exactly as
   `API.md` promises.

Do not confuse the two: the mock phase is for *interface + UX*; the security and
liveness guarantees below only hold after the Supabase swap.

---

## 2. Build strategy & the seam

New domain folders (predicted in `COMPONENTS.md` — add `messaging/`, `contacts/`):

```
src/app/models/     message.ts · thread.ts · contact.ts · conversationSettings.ts · call.ts
src/app/api/        messaging.ts (re-exports threadsApi, messagesApi) · contacts.ts · calls.ts
src/app/data/json/  mock (KV) — text threads, polling "realtime", app-code enforcement
src/app/data/db/    prod (Drizzle + Supabase) — RLS + realtime, added at productionization
src/app/realtime/   the realtime seam: subscribe(topic, cb) → mock=poll, prod=supabase.channel()
src/actions/        message.send · thread.create · thread.setState · contact.setNote ·
                    contact.setMediaAllowed · block.set · settings.setMode · call.* (Phase C)
src/components/organisms/messaging/   InboxList · Thread · Composer · MessageBubble ·
                    SystemCard · MediaMessage · TypingIndicator · CallScreen (Phase C)
src/components/organisms/contacts/    ContactList · ContactDetail (note editor, media toggle)
```

The `src/app/realtime/` seam is the important new abstraction: a tiny
`subscribe(topic, onEvent)` / `publish(topic, payload)` contract. Mock backend
implements it with an interval poll of the KV thread; the Supabase backend
implements it with private `channel('thread:{id}')` + `broadcast`. Islands
depend only on the seam, so no messaging component knows which backend is live.

**Islands:** messaging is the ONE surface where a React/Preact island owns the
whole screen (it's behind auth, irrelevant to SEO). SSR-first still applies:
inbox and thread server-render their current state; the island subscribes and
keeps it fresh after hydration. Everything else on the site stays zero-JS.

---

## 3. Data model

Zod models in `src/app/models` are the source of truth (validation + TS types +
the eventual Postgres shape), same discipline as `profile.ts`.

```
conversation_settings  (professional_profile_id PK, mode: off|everyone|verified_only,
                        allow_call_requests bool default true,
                        screening_question text (≤140, optional),   -- ★ UX-PLAN 4.1: asked as the last request step
                        updated_at)

threads                (id, profile_id, client_account_id, created_at, last_message_at,
                        professional_unread, client_unread, state: pending|open|frozen|blocked,
                        private_set_unlocked bool default false)   -- ★ UX-PLAN 4.4: her set shown to THIS client on accept
                        UNIQUE(profile_id, client_account_id)   -- one thread per pair = anti-spam bedrock
                        -- pending (UX-PLAN 4.1) = a request awaiting accept/decline;
                        --   accept → open, decline → frozen (silent, no penalty)

messages               (id, thread_id, sender: professional|client,
                        kind: text|media|request|call_request|call_event|system,
                        body text NULL, media_id NULL,
                        request jsonb NULL,   -- ★ UX-PLAN 4.1 request payload (see below)
                        created_at, read_at NULL, expires_at)
                        -- expires_at = created_at + 90d; purge job hard-deletes
                        -- request payload: { service, duration, price_at_request (SNAPSHOT,
                        --   immutable), when: now|tonight|slot, slot?, note? (≤140),
                        --   screening_answer? } — every field a taxonomy value or a frozen
                        --   price, so she reads a card, never "hi"

chat_media             (id, thread_id, sender_account_id, type: photo|video,
                        storage_ref, bytes, duration_s NULL, state: active|reported|removed,
                        created_at)

contacts               (professional_profile_id, client_account_id, pinned bool, note text (≤500, private to her),
                        client_media_allowed bool default false,   -- ★ her per-client photo grant (§7)
                        created_at)   PK(professional_profile_id, client_account_id)
                        -- auto-created on first message exchange

blocks                 (blocker_account_id, blocked_account_id, created_at,
                        source: thread|contact|report)

call_sessions          (id, thread_id, initiated_by: professional ONLY, mode: voice|video,
                        state: ringing|active|ended|declined|timeout, started_at, ended_at)
                        -- metadata only. No media, ever, touches storage.
```

- `contacts.client_media_allowed` is **the** home of the per-contact grant (rule
  0.3). It is her CRM control; the send-rule (§4) and the client's composer
  visibility (§7) both derive from it.
- `messages.kind` folds system cards (call requests, "missed call", "photos
  enabled", pause notices) into the one timeline.
- Purge job (pg_cron in prod / Workers Cron): hard-delete messages + chat_media
  past `expires_at` daily, **including storage objects**. Blocks, contacts,
  call metadata persist.
- FKs into existing tables: `profile_id` → profiles, `client_account_id` →
  accounts (real accounts after Phase 0).

---

## 4. RLS — the security wall (write and test these policies first, in SQL)

Production security lives in RLS (`ARCHITECTURE.md` §3, `API.md` browser-path
rules: wrap `auth.uid()`, index policy columns, `TO authenticated`, no joins in
policies — use `security definer` helpers). During the mock phase the same rules
are enforced in the action layer as a placeholder; they are **not** the wall.

- **threads / messages:** read/write ONLY by the two participants. Professional
  side resolves via profile ownership (incl. agency org members who manage that
  profile — decide + document: default YES, disclosed to the client by a
  "managed profile" note in the thread header).
- **Send-message policy** enforces, in SQL:
  - sender is a participant · thread `state = open` · settings mode permits the
    client (`verified_only` ⇒ client phone-verified) ·
  - **client throttle (UX-PLAN 4.1 — replaces the old "3 messages before first
    reply" for new threads): no free-compose on a NEW thread until an accepted
    request.** A new thread is created by a `request` (state `pending`), and the
    `state = open` gate above already blocks BOTH sides from composing while
    pending — the professional answers with accept/decline, not a bubble.
    Existing `open` threads compose freely (the old behaviour, unchanged).
    Still ≤1 thread per (client, profile) — the UNIQUE row is the anti-spam
    bedrock, and a request reuses that same row. ·
  - **request rule:** a client may insert `kind=request` **iff** the pair is not
    blocked **and** settings mode permits the client; it flips the thread to
    `pending`. `price_at_request` is snapshotted at insert and never rewritten
    (immutable). Decline sets `state = frozen` silently (no card, no penalty);
    accept sets `state = open`, posts a system card, and sets
    `private_set_unlocked = true` (§7 / UX-PLAN 4.4). ·
  - **client media rule:** a client may insert `kind=media` **iff** `type=photo`
    **and** `contacts.client_media_allowed = true` for (thread.profile_id,
    client). Professionals may insert photo or video. (This is rule 0.3 in SQL.)
- **conversation_settings.screening_question** (UX-PLAN 4.1): professional-only
  write, ≤140; PUBLIC-readable (it is the question a prospective client answers
  in the request sheet, so the profile page reads it) — but the *answer* lives
  only inside the request card in the thread (participant-only, like any
  message). Never leaks her mode or inbox contents.
- **private set (UX-PLAN 4.4):** her `privatePhotos` set is revealed to a client
  ONLY when `threads.private_set_unlocked = true` for his thread — the same
  per-contact grant machinery as `client_media_allowed`, reversed direction (her
  media → him), flipped on accept. Public pages expose only the COUNT.
- **conversation_settings / contacts (incl. note + client_media_allowed):**
  professional (or org member) only. A client can never read that a note or a
  grant-state row about him exists. The client learns his *own* media permission
  through a narrow `security definer` function `can_client_send_media(thread_id)`
  returning just the boolean — never the contact row.
- **blocks:** blocker only; enforcement is bidirectional (blocked pair: no send,
  no call, no call-request; thread → `blocked`).
- **call_sessions insert:** professional participant only (rule 0.2, at the DB).
- **Admin:** service-role paths only; every admin read of a thread → `audit_log`.

---

## 5. Realtime

Behind the `src/app/realtime/` seam (§2): mock = poll, prod = Supabase.

- **Per-thread private channel** (`thread:{id}`, RLS-authorized on
  `realtime.messages`): new messages, read receipts, typing (ephemeral
  broadcast), media-grant + pause system cards, call signaling (Phase C).
- **Per-account channel** (`account:{id}`): unread badge counts for the tab bar,
  "new thread" events.
- **Presence** (the existing "online" concept, made real in Phase 0): online
  dots in inbox + thread header + contact list; drives call availability (§9).
  Until Phase 0, presence is the static mock boolean and call availability is
  stubbed.
- **SSR-first:** inbox + thread render current state server-side; the island
  subscribes after hydration; graceful fallback if the socket drops. Payloads =
  IDs + minimal state, never trusted as instructions.

---

## 6. UX specification (build from the existing inventory)

Reuse, don't reinvent (`Reuse is law`): `molecules/ActionSheet` (mobile
sheets — contact detail, block/report confirm, media-grant), `molecules/Lightbox`
(fullscreen chat photo/video view), `molecules/PhotoCarousel`, `atoms/SafeImage`,
`molecules/SlabField` (note editor, composer field), the `switch-track` /
`cbx-box` / `slab-cut` primitives, `AccountShell` tabs, and the Misprint language
throughout. New pieces live in `organisms/messaging` + `organisms/contacts`.

**Inbox (Messages surface):** thread list — avatar (`SafeImage`), display name,
snippet (or `✦ media` / `☎ call` glyph), timestamp, unread ink-dot, presence
dot. Mobile swipe actions: pin (professional), mute, block. Per-role empty
states. Thread search: later, not Phase A.

**Thread view:** WhatsApp-familiar. Bubbles, day separators, read ticks, typing
indicator. Header: name + presence + (professional) call button (Phase C),
contact-card link, overflow → **Allow/Stop photos**, block, report. Composer:
text always; the **photo button shows for the professional always, and for the
client only when `client_media_allowed`** (learned via the system card + the
`can_client_send_media` check). System cards (call request/events, "You can now
send photos", "Messages are paused") render as centered chips.

**Per-contact media grant (rule 0.3) UX:** a `switch-track` toggle
**"Allow photos from this person"** in Contact detail, mirrored as a thread
overflow quick-action. Granting emits a positive system card to the client
("Eva enabled photos in this chat") so the button's appearance is explained;
revoking is **silent** (the button just disappears next load; existing photos
stay). Enforcement is server-side (§4), never trust the hidden button.

**Professional settings (dashboard / `/account/settings/`):** the mode toggle
with plain-language copy; OFF freezes threads read-only (thread banner "Messages
are paused") — nothing deleted; ON unfreezes. Sub-toggle: allow call requests.

**Contacts (professional only):** her mini-CRM — everyone she's exchanged
messages with. Row: name, last contact, pinned star, note preview, a small
"photos on" glyph when granted. Detail (`ActionSheet` on mobile): private note
editor (`SlabField`), the media-grant toggle, thread link, block. Pin sorts to
top. Copy never says "friends."

**Block list:** `Account → Settings → Blocked` for BOTH roles. List + unblock.
Blocking from any surface lands here.

**Reporting:** report action in every thread overflow and on every media message
→ the existing reports queue with thread context attached.

---

## 7. Chat media (Phase B)

- **Professional media = photos + video** (always). **Client media = photos
  only, and only when `contacts.client_media_allowed = true`** (rule 0.3).
- **EXIF is stripped on-device by canvas re-encode before upload** — the exact
  approach already proven in `organisms/dashboard/MediaManager.astro`
  (`createImageBitmap` → downscale → `canvas.toDataURL('image/jpeg')` drops all
  metadata incl. GPS). Non-negotiable for every uploader, client or professional
  (hard rule 2).
- **Photos:** through the Cloudflare Images pipeline with **private delivery**
  (signed URLs, short expiry) — chat media is 1:1 private, never public, and is
  *not* safe-mode-gated (the recipient chose to open the thread).
- **Video (professional only):** cap 60s / 50MB (limits are `bytes`/`duration_s`
  config, not migration). Storage = **Supabase Storage private bucket + signed
  URLs** (Cloudflare Stream's adult-content position is still unconfirmed; this
  sidesteps it — revisit if Stream is ever confirmed). Client-side compress
  where feasible.
- Media messages render as blurred thumbnail → tap → `Lightbox` (photo full /
  video inline). Any media message is reportable → `state: reported` → admin
  queue with thread context.
- Auto-deletion: media follows the 90-day purge — delete storage objects, not
  just rows.
- **No client uploads except granted photos.** Enforced in RLS + the upload
  action, not just the UI.

---

## 8. Notifications (ties into `MOBILE.md` §8)

- **In-app:** realtime badge counts on the Messages surface (both roles) + inbox
  ordering.
- **Email fallback for professionals (Phase A, day one):** "You have a new
  message" — no content, just the fact + a deep link; throttled (≤1 per thread
  per hour). The reliable channel until push exists. (Needs the email provider
  from `INFRASTRUCTURE.md` §7 — adult-policy check first.)
- **Web push (when the push feature ships):** a new message is the flagship push
  for professionals; the dashboard `InstallCoach` copy already sells exactly
  this.

---

## 9. Calls (Phase C — voice & video, 1:1, P2P)

Architecture is locked in `ARCHITECTURE.md` §10 — restated: **WebRTC P2P**,
DTLS-SRTP end-to-end. Signaling = the thread's Supabase Realtime channel (SDP/ICE
as ephemeral broadcast, never persisted). STUN public; **TURN = self-hosted
coturn** on a small EU VPS (HMAC creds minted per-call by a server action,
TTL ≤ 1h; TURN relays ciphertext only). No SFU, no Cloudflare media products,
**no recording** — nothing media touches our storage.

**Initiation:**
- **Professional → client:** "Call" (choose voice/video) in thread header /
  contact detail. Client present (presence green) → full-screen incoming-call UI
  his side, 30s ring → `timeout` + "missed call" card. Client absent → button
  becomes "Send call invite" → system card + notification; when his presence
  flips green she gets a "call now" nudge chip.
- **Client → professional:** ONLY "Request a call" inside an existing thread →
  system card her side. Never rings her. She can disable requests
  (`allow_call_requests`).
- Blocked / frozen / mode=off → no call paths (RLS + action checks).

**In-call screen (MOBILE.md bar):** full-screen, safe-area aware, PiP self-view;
controls: mute · camera · flip · speaker · end; professional also **End & block**
as one action. Voice-only shows avatar + waveform, camera never activates.
Honest connection states (connecting / poor / reconnecting). `wakeLock` on.
iOS Safari specifics handled: `getUserMedia` needs a user gesture (the accept tap
suffices); audio-session interruptions (incoming phone call) pause gracefully.

**Hard limit stated in UX:** a closed PWA cannot ring (no web VoIP push). The
presence-based design is the honest product answer; never fake "ringing them…"
when the peer is provably offline.

---

## 10. Navigation (updates the tab matrix — reconcile with what's shipped)

The current live matrix is **Visitor/Client: Search · Favorites · Account** and
**Professional: Dashboard · My profile · Account** (in `BottomTabBar.astro`,
role-driven, `transition:persist`; desktop uses the `UserMenu` avatar dropdown).
When messaging ships, that matrix changes — the bar only ever swaps at
login/logout, so no one sees it transform mid-browse:

**Mobile bottom dock:**
- Visitor: Search · Favorites · Account (unchanged).
- Client: Search · Favorites · **Messages** · Account (Messages appears only
  logged-in *and* once messaging exists; badge = unread).
- Professional: Dashboard · **Messages** · **Contacts** · Account.
  **"My profile" leaves the dock** → it moves into the Account hub + a prominent
  Dashboard "Edit / View as client" card (the 4-tab max is the constraint).
- Agency (future): Roster · **Messages** (unified inbox across managed profiles;
  thread header shows which profile) · Stats · Account.

**Desktop (≥md):** the dock hides; the existing `UserMenu` gains **Messages ·
Contacts** (+ Blocked) entries per role, and Messages also gets a **persistent
top-bar icon with an unread badge**. Same `BottomTabBar` + `UserMenu`
components, role-driven config — no new nav components.

---

## 11. Safety & moderation

- Report on every thread + every media message → existing reports queue;
  underage/coercion reasons escalate immediately (existing non-negotiable).
- Admin opens reported threads via service role; **every read is audit-logged.**
- Rate limits (KV, the pattern already used for AI search): thread creation,
  messages/min, call invites — generous for humans, hostile to spam.
- Turnstile (invisible) on the first message of a new thread — cheap bot wall.
- The 90-day purge, the no-recording rule, "notes are private to her", and
  "photos are only on when she turns them on" are all stated in user-facing copy
  — discretion commitments are product features; say them.

---

## 12. Definition of done per phase

**Phase 0 (Supabase gate):** `@supabase/ssr` cookie sessions replace the mock
cookie (real client + professional accounts); Postgres via Hyperdrive; Realtime
channels authorized by RLS; presence real. Existing mock account/session data
migration path documented. This unblocks A.

**Phase A (messaging + blocking + contacts):** RLS policy tests *prove*:
non-participant denied · mode=off denied · verified_only denied for unverified ·
throttle enforced (no free-compose on a new thread until an accepted request,
UX-PLAN 4.1) · request denied when mode=off / blocked pair · request price
snapshot immutable · decline leaves no penalty · **client media denied unless
granted** · blocked-pair denied · call_sessions insert by client denied. Inbox/thread pass the `MOBILE.md`
automated checklist. Email fallback fires. Purge job verified. Contacts
auto-create; note + media-grant private to her; the client learns his own grant
via system card + `can_client_send_media` only. Block/unblock round-trips.
Reports land with context.

**Phase B (media):** EXIF-strip test on both professional and granted-client
photos · signed-URL expiry verified · caps enforced server-side · client video
rejected · grant toggle round-trip (grant→client can send, revoke→denied) ·
report→queue flow · purge deletes storage objects.

**Phase C (calls):** client-initiation impossible (server test, not UI absence) ·
P2P connects on real devices incl. TURN-forced path (block UDP to force relay) ·
no media object ever written to storage (assert) · presence gating correct ·
missed-call/timeout cards · End&block mid-call. Full real-device pass per
`MOBILE.md` (mic/camera permissions, backgrounding, interruptions).
