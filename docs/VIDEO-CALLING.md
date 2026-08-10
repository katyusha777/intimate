# VIDEO-CALLING.md — voice/video calls + the contact fast-path

**Status 2026-08-06: ALL PHASES BUILT and deployed to staging.** Schema/RLS/
triggers migrated (0009+0010), TURN server live (TURN-SERVER.md), invites +
claim route + direct compose live, CallDock (ring + call screen, voice + video,
relay-only her side) shipped. **What remains is verification, not construction:**
the real-device DoD items below (two-device call passes, forced-relay
webrtc-internals check, kitchen-sink states) — tick them as they're proven,
then fold back into MESSAGING.md §9 and delete this file.

**2026-08-11: WebRTC layer rebuilt on trystero** (`@trystero-p2p/core`) after
the hand-rolled negotiation proved unstable. The library owns offer/answer,
glare, trickle ICE and restarts, signaling through a custom strategy
(`src/app/callroom.ts`) on the private RLS-authorized `call:{id}:rtc` channel
(NOT trystero's stock anon-key public-channel supabase strategy). The
ephemeral `accept`/`offer`/`answer`/`ice`/`restart`/`end` protocol events are
gone; §6 below reflects the reduced protocol. Everything else (schema, RLS,
actions, TURN, UI, gesture law, timers) is unchanged. Real-device DoD passes
must be re-proven on the new layer.

**Temporary execution tracker** (like UX-PLAN.md / ONBOARDING.md): the concrete
build plan for 1:1 calls and the contact flow that feeds them. The **spec of
record stays** `ARCHITECTURE.md` §10 (call architecture, locked) and
`MESSAGING.md` (§3 data, §4 RLS, §5 realtime, §9 calls, §12 DoD) — this file
only sequences the work and pins the decisions those docs left open. Delete
when §9's phases land; fold anything durable back into MESSAGING.md.

Follows: `MOBILE.md` (calls are the most native-feel surface we will ever
build), `SUPABASE.md` (realtime mechanics — broadcast only, private channels),
`DESIGN.md`, `COMPONENTS.md`, `SECURITY.md`, CLAUDE.md hard rules.

---

## 0. The product moment (design target — hold every screen against this)

**Her side:** a client paid her for a video call. She opens his thread — or his
row in Contacts — and taps the camera button. Full-screen "Calling Mark…", he
picks up, they talk. **Two taps from Contacts, zero setup, zero menus.** Voice
call is the same with the phone button. If he can't be reached she sees an
honest "he's not reachable right now", never a fake ring.

**His side:** wherever he is on the site, a full-screen incoming-call overlay
with her name and photo — Accept / Decline. Accept asks for mic (and camera on
video) and connects. He can never call her; his only affordance is the existing
"Request a call" card (`allow_call_requests`).

**The contact fast-path that makes it work:** she already has paying clients on
WhatsApp/Telegram. She shares a one-tap **invite link**; he opens it, signs
in/up, and lands **directly in an open thread with her** — no request card, no
service picker — as a saved contact she can message and call. Contacts is her
address book; **favorites are a client/visitor concept and disappear from
professional surfaces.**

---

## 1. Locked vs. decided-here

Locked in `ARCHITECTURE.md` §10 / `MESSAGING.md` §9 (recap only): **pure P2P
WebRTC, no SFU** — DTLS-SRTP end-to-end, media never touches our
infrastructure, **no recording ever**; signaling over Supabase Realtime
**private channels** (broadcast only — SUPABASE.md bans `postgres_changes`);
STUN + **self-hosted coturn on an EU VPS** with per-call HMAC creds (TTL ≤ 1h);
`call_sessions` stores **metadata only**; **clients can never initiate** (no
code path, enforced in RLS).

New decisions this tracker pins:

1. **Her IP never reaches a client.** P2P exchanges candidate IPs; a
   professional's home IP in a client's `webrtc-internals` is a doxxing
   vector. Once coturn is live, the **professional side connects with
   `iceTransportPolicy: 'relay'`** — her traffic exits via the TURN server,
   the client only ever learns the relay's address (his side may use direct
   candidates; his IP reaching her is the acceptable direction). Until coturn
   exists, calls run STUN-only and the UI carries a "beta" line (§6 phase gate).
2. **Ring = DB write, signal = ephemeral broadcast.** `call_sessions` insert →
   DB trigger `realtime.broadcast_changes()` on `account:{callee}` rings the
   client (survives refresh, feeds the missed-card). SDP offer/answer + trickle
   ICE ride ephemeral broadcast on `call:{sessionId}` and are **never
   persisted**.
3. **Call cards join the one timeline** as `messages.kind = 'call'` with a
   `call_id` FK — outcome/duration render from the joined session row, no
   payload duplication.
4. **Contact ⇒ direct compose.** A thread born from her side (invite claim,
   manual add with a linked account, or her messaging first) starts `open` —
   the request/`pending` gate (UX-PLAN 4.1) applies only to cold client
   approaches. Open thread = free compose, both sides (already the rule).
5. **Invite links** are single-use, 7-day-expiry tokens she mints from
   Contacts; claim = get-or-create the pair thread in `open` + the contact row.
6. **Calls are free platform features in v1** — she arranges payment as she
   already does (Tikkie etc.). `call_sessions` heartbeats keep per-minute
   billing possible later without new plumbing.

---

## 2. Ground truth (what already exists — build on, don't re-create)

- `threads` / `messages` / `contacts` / `conversation_settings` live in
  Postgres with RLS; `contacts.kind` already distinguishes `thread | manual`
  (manual address-book rows with `name`/`handle` exist in schema);
  `conversation_settings.allow_call_requests` column exists.
- `message.startThread` action get-or-creates the pair thread; the request
  card flow gates cold approaches; `Thread.astro` / `Inbox.astro` /
  `ContactList.astro` / `RequestCard.astro` are built (`organisms/messaging/`).
- **`src/app/realtime/` does not exist yet** — messaging renders SSR truth,
  no live delivery. Calls cannot ship before this seam (§4, Phase V0).
- No `call_sessions` table, no call UI, no coturn, no TURN secrets.
- Browser Supabase client exists (`src/lib/supabase.ts`) — auth only so far.

---

## 3. Data & migration (one migration, `DATA.md` discipline)

Taxonomy (`src/lib/taxonomy.ts`): `CALL_MODES = ['voice','video']`,
`CALL_STATES = ['ringing','active','ended','declined','missed','failed']`,
`MESSAGE_KINDS` gains `'call'`. Labels via `taxonomy.*` i18n keys, all three
locales.

```
call_sessions   (id uuid PK, thread_id → threads, mode: call_mode,
                 state: call_state, started_at (ring), answered_at NULL,
                 ended_at NULL, last_beat_at NULL,   -- 30s heartbeat while active
                 end_reason text NULL)               -- hangup|timeout|declined|failed|blocked
                 INDEX (thread_id, started_at)

contact_invites (id uuid PK, profile_id → profiles, token text UNIQUE,
                 name text default '',               -- pre-fills the contact row
                 created_at, expires_at,             -- created_at + 7d
                 claimed_by → accounts NULL, claimed_at NULL)

messages        + call_id uuid NULL → call_sessions  -- kind='call' cards
```

RLS (SECURITY.md review ritual applies — this is a sensitive diff):

- `call_sessions` **select**: thread participants only (same helper as
  threads). **Insert: professional participant ONLY** — rule 0.2 at the DB;
  client insert denied is a tested proof, not a UI absence. **Update**: both
  participants, but only the legal transitions (`ringing→active|declined|missed`,
  `active→ended|failed`) via a `security definer` transition function — no
  free-form state writes.
- `contact_invites`: professional owner full CRUD; claim runs in a server
  action (service-role-free: the action validates token + expiry + unclaimed,
  then inserts thread/contact as the claiming user under their own RLS).
- Trigger: `call_sessions` INSERT/UPDATE → broadcast on topics
  `account:{client_account_id}`, `thread:{thread_id}` **and `call:{id}`**
  (0013 — the signaling channel both parties already hold; how the ringing
  caller learns of a decline and how live UIs learn of a server-side sweep).
  Payload = ids + state, per the payload law.
- Ring timeout is **server-owned**: a `ringing` row older than 30s counts as
  `missed` (transition function enforces; the caller's client also fires the
  transition so the card is immediate).

---

## 4. Phase V0 — the realtime seam (prerequisite; also completes MESSAGING §5)

Build `src/app/realtime/` exactly as MESSAGING.md §2 predicted:
`subscribe(topic, onEvent)` / `publish(topic, event, payload)` over
`supabase.channel(topic, { config: { private: true } })` broadcast, authorized
by RLS on `realtime.messages` (SUPABASE.md §5 policy shapes: thread topics for
participants, `account:{id}` for the owner). No mock/polling variant — realtime
ships real or not at all now that the DB backend is live.

Wire what messaging already needs (same seam the calls ride): new-message
broadcast from the existing message trigger → `Thread` appends live; `Inbox` +
tab-bar unread badge update from `account:{id}`. SSR-first paint stays; the
subscription layers on after hydration; socket drop falls back to
refresh-on-focus (graceful, MOBILE.md).

**DoD V0:** □ non-participant subscription to a thread topic rejected (test) ·
□ message appears in the other party's open thread < 1s, no reload ·
□ unread badge moves without navigation · □ socket-drop → reconnect resubscribes.

---

## 5. Phase V1 — contacts fast-path

- **Invite links:** Contacts gains "＋ Add contact" → `ActionSheet`: *Share
  invite link* (mint token → native share sheet / copy, shows her existing
  links + revoke) · *Manual entry* (name + handle — schema already carries it).
  Claim route `/{locale}/c/{token}`: signed-out → auth modal first (return-to);
  signed-in client → action validates, creates/opens the pair thread **in
  `open`**, upserts the contact row (invite `name` pre-fills), marks the token
  claimed, lands him in the thread. Expired/claimed token → friendly dead-end,
  nothing leaked about her.
- **Direct compose:** profile-page "Message" for a client with an existing
  `open` thread goes straight to the thread (skip the request sheet). Her
  first-touch paths (manual contact with account link, invite claim) create
  `open` threads — the `pending` request gate remains only for cold clients.
- **Favorites are client-only:** remove the Favorites entry from the
  professional's `UserMenu` and any professional surface (dock already has
  Contacts, not Favorites). Card hearts stay for clients/visitors only.
- Contact rows (with a linked thread) get the same call buttons as the thread
  header once V2 lands — Contacts is her speed-dial.

**DoD V1:** □ invite mint/share/revoke round-trip · □ claim → open thread +
contact, single-use enforced, expiry enforced (tests) · □ claimed client
composes freely with no request card · □ cold client still gets the request
gate (regression) · □ professional sees no favorites affordance anywhere ·
□ RLS proof: thread born `open` only via her-side paths.

---

## 6. Phase V2 — voice calls end-to-end (the architecture proves itself here)

Signaling (ephemeral broadcast; events are data, never instructions):

| channel | event | payload | sender |
|---|---|---|---|
| `call:{id}` | `call` | `{ id, state }` | DB trigger 0013 — accept/decline/sweep/terminal truth |
| `call:{id}:rtc` | `signal` | `{ t: topic, m: msg }` | trystero core, both sides — announce + SDP/ICE handshake (`src/app/callroom.ts`) |

Flow: her tap → **`getUserMedia` starts synchronously in the tap** (gesture
law: WebKit auto-denies unprivileged prompts after a past denial, Brave's
autoplay-block clears activation — media and remote-playback priming must
anchor to the tap, never after an await) and `call.start` runs in parallel
(validates professional-owns-profile, thread `open`, pair unblocked, mode ≠
off; **rejects if she already has an active session — busy is server truth**)
→ inserts `ringing` → trigger rings his `account:{id}` → global overlay →
meanwhile her side joins the trystero room and announces (~5s re-announce
loop) during the ring → his Accept tap starts *his* `getUserMedia` (same
gesture law) in parallel with `call.accept` → his room join meets her
announce → trystero connects the peers (data channel; glare/ICE library-
owned). **Media law — the caller owns every offer** (proven live 2026-08-11:
any WebKit RE-offer renumbers RTP extension IDs and Chromium kills the call):
the callee announces media-captured via a `ready` data-channel action → the
caller makes the ONE renegotiation (`addStream`) → the callee attaches its
tracks to the caller's transceivers *inside the answer* (`pc` track event
during setRemoteDescription → `direction='sendrecv'` + `replaceTrack`); the
callee never calls `addStream`. Remote media lands via raw `pc` track events
both sides → hangup either side → `call.end(reason)` action; the trigger's
`call` event plus trystero's instant peer-leave tear the other side down →
`kind='call'` card posted. Decline → card her side ("not now" tone, no
penalty copy) — reaches her ringing UI via the trigger's `call` event. 30s
no-answer → `missed` + card; 25s accept-to-connect budget (also trystero's
handshake timeout) → honest failure toast. 30s heartbeat updates
`last_beat_at` while active (liveness now, billing later). Mid-call drops:
trystero restarts ICE internally; a peer that vanishes without writing
server state → 2s grace → honest local `failed` teardown. Every state edge
logs `[call]` to the console (content-free — never SDP).

UI (reuse law; register everything in COMPONENTS.md + `/kitchen-sink` same
change):

- **`organisms/call/`** — `CallScreen.astro` (full-screen, `bare`-style),
  `IncomingCall.astro` (global overlay), `CallController` (state machine +
  WebRTC in the same vanilla `<script>` discipline as `Thread.astro`; an
  island only if state genuinely outgrows it).
- **Thread header (her side only):** phone + camera icon buttons, right-aligned
  — the two most important buttons on the surface, 44px targets. Hidden when
  blocked/frozen/paused. Client header gets no call buttons; his overflow
  keeps "Request a call" → system card her side with a one-tap **Call now**
  chip.
- **IncomingCall (client, global):** mounted for signed-in clients in Layout
  (same placement pattern as `FavoritesController`), subscribed to
  `account:{id}`: full-screen, `SafeImage` avatar, name, "Voice call ·
  Intimate", Accept/Decline, vibrate + `wakeLock`, 30s auto-dismiss → missed.
- **CallScreen voice mode:** avatar + pulsing ring + timer, mute · speaker ·
  end; camera never activates. Honest state chip: connecting / poor /
  reconnecting. Her overflow: **End & block** (one action, kills session +
  blocks pair).

**DoD V2:** □ RLS proofs: client `call.start` impossible (server test) ·
illegal transition rejected · non-participant sees nothing · □ voice call
connects on real iPhone-Safari ↔ Android-Chrome (STUN path) · □ busy, decline,
timeout, hangup all produce correct cards + states · □ ring survives his page
navigation (account-channel, ClientRouter-safe) · □ heartbeat rows advance ·
□ no media/SDP persisted anywhere (assert on tables + logs) · □ blocked pair:
no ring, no signaling (RLS test).

---

## 7. Phase V3 — video

Camera capture with `facingMode: 'user'` default; remote full-bleed
(`object-cover`, safe-area aware), draggable PiP self-view, controls row adds
camera-toggle + flip; mid-call voice→video upgrade OUT (v1 keeps the mode
fixed — she chose it when she tapped). Autoplay policy (researched + locked
2026-08-07): remote media is SPLIT — a dedicated `<audio>` element carries
remote sound (iOS won't reliably play audio through a hidden `<video>`; one
audio-bearing video element max on iOS) and the remote `<video>` stays
**muted forever** (muted playback is never policy-blocked, so video always
renders). Both are primed with `play()` inside the accept/call tap; if a
browser still refuses audio (Brave autoplay-block), a "tap for sound" pill
recovers with a fresh gesture. Backgrounding pauses video honestly ("camera
off" chip), audio continues; phone-call interruption pauses gracefully
(MOBILE.md device pass covers it).

**DoD V3:** □ video call connects on the same device matrix · □ PiP drag +
flip + camera-toggle work both platforms · □ voice mode provably never
requests camera permission · □ both themes + safe-mode pass on
`/kitchen-sink` mocked states (ringing / voice / video / reconnecting) ·
□ Lighthouse-95-mobile untouched (call code loads only on auth surfaces —
zero-JS public pages stay zero-JS).

---

## 8. Phase V4 — TURN + hardening

**Server: DONE (2026-08-06)** — coturn live on `turn.intimate.nl` (443 TLS +
3478), allocation proven with HMAC creds, logging off, `TURN_SECRET` in Worker
secrets (prod + staging). Full state + owner follow-ups (SSH hardening) in
`TURN-SERVER.md`.

App side: `call.start` mints time-limited HMAC creds (username =
`expiry:sessionId`, TTL 1h, TURN REST API convention) and returns
`iceServers`; **professional's `RTCPeerConnection` flips to
`iceTransportPolicy: 'relay'`** the moment `TURN_HOST` is configured (env
presence is the feature flag — no beta line anymore); client side keeps
`all` (direct or relay, whichever wins).

**DoD V4:** □ forced-relay call succeeds with UDP blocked (`turns:443` path) ·
□ her candidates contain **no host/srflx entries** (webrtc-internals check —
the doxxing test) · □ expired TURN creds rejected · □ full MOBILE.md
real-device pass (permissions, backgrounding, interruption, wakeLock) ·
□ INFRASTRUCTURE.md runbook + secrets documented · □ MESSAGING.md §9 updated
to "built", §12 Phase C boxes ticked · □ **this file deleted.**

---

## 9. Safety, privacy, honesty (user-facing copy commitments — say them)

- "Calls are direct between you two — nothing passes through our servers, and
  nothing can be recorded by Intimate." (P2P/relay is ciphertext; caller-side
  screen recording can't be technically prevented — report/block is the
  answer, no false promises.)
- Her network location is never visible to a client (V4 relay rule).
- A closed app cannot ring — the UI never fakes reachability; presence shows
  "reachable now" and the arranged-call story (she calls when they agreed)
  is the product's honest answer.
- Block mid-call ends the session instantly and silently; blocked pairs have
  no call path (RLS, tested).
- Call metadata (parties, mode, timestamps, duration) is retained for audit —
  the 90-day message purge does not apply to it; privacy copy states this.
- Rate limit `call.start` + invite minting (the existing KV limiter pattern).
- No analytics on call content ever; events per ANALYTICS.md contract only
  (`call_started`, `call_connected`, `call_ended` with mode + duration bucket).

## 10. Out of scope v1 (explicit, so nobody "helpfully" adds them)

Per-minute billing (heartbeat groundwork only) · group calls · screen share ·
mid-call mode upgrade · call scheduling UI (threads carry arrangements) ·
client-initiated calls (never — product law) · recording (never — product law).
