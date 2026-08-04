# VERIFICATION.md — SMS verification build plan

Companion to ARCHITECTURE §11 (which owns the security rules — this doc owns the
flow and build order). ID verification (§11, R2 toxic-waste path) is out of
scope here except where it gates the same moments.

## 0. Policy

| Role | SMS | ID | Enforced how |
|---|---|---|---|
| **Advertiser ("girls")** | **Required** | Required (§11) | Profile cannot reach `live` without both. Hard gate, no exceptions — agency-created profiles included (§12: agency never bypasses per-person checks). |
| **Agency** | Required (owner account) | KvK business check (§12) | Same gate on the agency account itself. |
| **Client** | **Optional** | Never | Pure opt-in. Unlocks: messaging professionals whose `conversation_settings.mode = verified_only` (MESSAGING.md §2), "verified" marker on their messages. Nothing else is ever locked behind it — browsing, favorites, `everyone`-mode messaging stay open. |

One phone number verifies **one** account (`UNIQUE` on `phone` where verified, at
DB level when Supabase lands). Prevents a burner number farming accounts; support
handles legit number handovers.

## 1. Provider: Twilio Verify

Per §11 we use **Twilio Verify** — Twilio owns OTP generation, expiry (10 min),
retry pacing, and max-5 check attempts. We never mint our own codes.

- `POST https://verify.twilio.com/v2/Services/{VERIFY_SID}/Verifications` — body `To=<E.164>&Channel=sms` → status `pending`.
- `POST .../VerificationCheck` — body `To=<E.164>&Code=<6 digits>` → status `approved` or not.
- Auth: HTTP Basic with the stored API key (`TWILIO_API_KEY_SID` : `TWILIO_API_KEY_SECRET`). Plain `fetch` from the Worker — **no Twilio SDK** (Node-flavored, dead weight on workerd).

**Credential gap (open item):** the stored key is scoped "SMS sending only" and we
have no `TWILIO_VERIFY_SERVICE_SID` yet. Before build: create a Verify Service in
the Twilio console (name it neutrally — the SMS sender ID users see comes from
Verify's defaults, no adult content transits Twilio, §11), and confirm the API
key can call Verify. If the key turns out to be restricted to Programmable
Messaging only, issue a standard key instead — we do **not** fall back to
hand-rolled OTP over plain SMS. Secrets live in `.dev.vars` / Worker secrets
(staging done, prod pending).

## 2. Flow — advertiser (mandatory)

Existing UI (`VerificationFlow.astro`, step 1) and actions
(`account.startSms` / `account.checkSms`) stay as-is; only the mock inside the
actions is replaced.

1. **Register** → dashboard. Verification card (already on `/account/`) shows
   SMS `—` / ID `—`; profile editor works fully — she can prepare everything
   unverified.
2. **Publish moment is the gate.** "Go live" / submit-for-review requires
   `phoneVerifiedAt` + `idVerification = approved`. Not verified → the publish
   control renders as "Verify first →" linking to `/account/verification/`.
   Server-side the same check lives in the publish action (UI gating is
   convenience, the action is the enforcement — later mirrored by RLS/trigger on
   the lifecycle transition, §8.6).
3. **Verify page:** enter phone (E.164, `+31` pre-filled) → `startSms` → code
   input → `checkSms` → step turns green, ID step follows.
4. **Number change later:** editing the phone clears `phoneVerifiedAt` and
   reruns the same flow. If her profile is `live` it **stays live** — the gate
   is on entering `live`, not on staying there (no rug-pulls for a typo'd
   number; moderation can pause a profile if a number goes bad).

## 3. Flow — client (optional)

Same two actions, no new backend. Two entry points, both lazy:

1. **Account page:** the client card gets a "Verify your number" row
   (benefit copy: "message anyone, including verified-only profiles") → same
   phone → code inline exchange, reusing the SMS half of `VerificationFlow`
   (extract that half into `molecules/SmsVerify.astro` so both surfaces share
   it — reuse law).
2. **Messaging intercept:** client opens a thread with a `verified_only`
   professional → composer is replaced by the same `SmsVerify` block with one
   line of context ("She only accepts messages from verified clients"). Verify
   → composer unlocks in place. This is the moment with real motivation — most
   client verifications will happen here.

Never a modal ambush, never at registration — registration friction is the
enemy of supply *and* demand.

## 4. Server actions (replace the mocks)

`startSms` (exists — swap body):
- Zod: E.164 regex (already there). Normalize `00` prefix → `+`.
- Rate limit in SESSION KV before calling Twilio (hourly KV budget):
  **3 starts/hour per account AND per number AND per IP** — Verify's own velocity
  checks are the backstop, ours keeps the bill sane. 429 → UI shows cooldown.
- Call Verify `Verifications`; on 2xx save `{ phone }` (unverified) and return ok.
- Upstream error → generic failure to the client; log status only, **never the
  number** in error paths that leave our infra (GDPR-minimal).

`checkSms` (exists — swap body):
- Reads the pending `phone` from the account (client never re-sends it — the
  number being checked is the number that was started).
- Call `VerificationCheck`; `status === "approved"` → save
  `{ phoneVerifiedAt: now }` else BAD_REQUEST (UI: "wrong code"). Attempt
  ceiling is Twilio's (5) — no own counter.
- On approve, enforce one-number-one-account: another account already verified
  with this number → reject with a distinct error (support path).

Publish/lifecycle action (when it lands): server-side check per §2.2.

Later (Supabase): `phone`, `phone_verified_at` columns on the accounts table,
RLS owner-only, partial unique index on verified phone. Number never public,
never in any API response except the owner's own account payload (§11).

## 5. Abuse control

- KV rate limits per account/number/IP (§4) — the cost lever; Verify SMS ≈ €0.05
  each, so an unthrottled form is a money faucet aimed at us (SMS pumping).
- **Turnstile on `startSms`** before launch (§11) — not needed while auth is the
  mock, required the day registration is real.
- Twilio Fraud Guard on the Verify Service (console toggle) — free SMS-pumping
  protection.
- ponytail: no VoIP/carrier-type screening (Twilio Lookup) at launch — add if
  burner-number abuse actually shows up in moderation.

## 6. Build order

1. **Wire Twilio** — replace the two mock bodies in `src/actions/index.ts`
   (fetch + KV rate limit), create Verify Service, add `TWILIO_VERIFY_SERVICE_SID`
   to `.dev.vars` + staging/prod secrets. Test on staging with a real phone.
   *Smallest useful step — everything downstream already renders.*
2. **Extract `SmsVerify` molecule** from `VerificationFlow` step 1; add the
   client account-page row. i18n strings (en/nl/de) for the client copy.
3. **Publish gate** — rides on the publish/lifecycle action when profile
   publishing is built (tracked in its own issue; the check itself is ~3 lines
   here).
4. **Messaging intercept** — rides on MESSAGING.md build (`verified_only` is
   already specced there; the composer swap is part of that build, this doc just
   owns the `SmsVerify` block it embeds).
5. **Turnstile + Fraud Guard** — pre-launch hardening, with real registration.

Steps 3–5 are riders on other issues, not standalone sessions. Step 1+2 is one
session.
