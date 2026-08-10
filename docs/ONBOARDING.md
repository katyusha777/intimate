# ONBOARDING.md — The professional's first hour, step by step

**Temporary execution tracker — delete when the phases land** (UX-PLAN precedent). One GitHub Issue per numbered item.

**What this is:** the guided path that takes a professional from "just confirmed my email" to "my profile is submitted" — built for someone who is **not technical, possibly not a strong reader, on a phone, maybe nervous**. She should never wonder what to do next, never lose work, never hit a wall, and feel a little win at every step.

---

## 1. The design laws (every screen obeys all of them)

1. **One question per screen.** Never two jobs on one step. If a screen needs scrolling to find the button, it's too full.
2. **She always knows where she is.** A progress bar that visibly fills + "Step 2 of 6" + the step's name in her language. The bar filling IS the reward.
3. **Big, obvious, single button.** One primary action per screen, thumb-height, bottom of the viewport. Back is always there, small, top-left. Nothing else competes.
4. **Show, don't explain.** Prefer pictures/examples over paragraphs: the rates step shows a tiny example table already filled in ghost-style; the photo step shows a good photo vs a bad one; placeholders carry examples ("Bella", "06 12345678").
5. **Talk like a friend, not a form.** Second person, short sentences, B1 words, one *why* per step ("Clients search by price — this is how they find you"). No jargon, ever: not "taxonomy", not "verification pending", not "draft". Say "we're checking it" and "not visible yet".
6. **Every tap is saved instantly.** Close the app mid-way, come back tomorrow — she lands exactly where she left off, with everything kept. Say it once on the welcome screen: "Everything saves by itself. You can stop and come back whenever."
7. **A checkmark moment per step.** Completing a step gives a brief, visible ✓ (the step's row ticks, the bar fills) before the next step slides in. Small dopamine, six times.
8. **No dead ends, no blame.** Errors say what to do, not what she did wrong ("That code didn't match — try typing it again" beats "Invalid code"). A skippable step always has a visible "later" that costs nothing.
9. **Phone-first literally.** Specced at 390×844. Numeric keyboards for numbers, `tel` for phone, date picker for birth date. No hover-anything.
10. **nl/en/de from day one** — but written in Dutch *first* (the primary audience), then translated, so the tone is native, not translated-English.

---

## 2. The journey, screen by screen

> **Reordered 2026-08-10 — photos-first, approvable-early.** The REQUIRED path is
> now **identity (name/DOB/gender/city) → contact (WhatsApp/Telegram + how you
> meet) → photos → ID** — she gets a photo'd, verified, approvable profile fast,
> without "all that reading". Rates, services, hours and SMS-verify are now
> **optional** (contact too): encouraged in the flow but never blocking, filled
> later from the dashboard editor; a profile is approvable without them.
> **ID verification is ID-only** — the selfie-with-code was dropped (product
> decision). Source of truth: `src/lib/onboarding.ts` (`ORDER`/`OPTIONAL`) and
> `src/pages/[locale]/account/setup/`. The per-step specs below still describe
> the fuller original flow and are being trimmed to match.

### Entry
Register (role tile PROFESSIONAL) → confirm email → she lands **in the flow** (`/account/setup/`), never on the bare dashboard. If she ever navigates away, the dashboard's first card is the same journey as a checklist (§3) — the flow and the checklist are one system, two views.

---

### Step 0 · Welcome — 10 seconds, sets the whole tone
- Her (chosen) name if we have it, warm headline: **"Let's get you online."**
- Three lines, icons, no paragraph:
  - 📝 Fill in your profile — *your profile is your ad here, there's nothing else to place*
  - 📷 Add photos
  - ✅ Verify — then we check everything and you go live
- Reassurance line (small): "Takes about 10 minutes. Everything saves by itself — stop and come back whenever."
- Button: **Start**. Tiny link under it: "I'll look around first" → dashboard (checklist card waits there).

### Step 1 · Who are you? — the profile begins to exist
- Fields, in this order, one column: **Name clients will see** (placeholder "Bella" + line: "not your real name — your work name") · **Birth date** (date picker; if under 21: friendly stop — "You need to be 21 to advertise here" — not a red error) · **Gender** · **City** ("Where do you work? Clients search by city").
- **Visit type** as two big tappable cards (not tiny checkboxes): 🏠 "Clients come to me" / 🚗 "I visit clients" — tap one or both, they visibly fill.
- Button: **Save & continue** → ✓ moment. (This save creates her profile behind the scenes; she never sees the word "draft".)

### Step 2 · Your prices
- One line of why: "Clients search by price. Your lowest price is what they see first."
- The rates table, but opened gently: the common rows (30 min / 1 hour) shown first with ghost example prices ("e.g. €150"); "more durations" folds out the rest. She needs **just one price** to continue — the button enables the moment one row is real.
- Button: **Save & continue** → ✓.

### Step 3 · What do you offer?
- Why-line: "Tick what you offer. Clients filter by this — and requests always name a service, so you're never asked for something you didn't tick."
- The service categories as the existing fold-out groups; ticked count badges. **One tick minimum** to continue.
- Below, visually quieter: "Extra details (languages, payment, your place) — you can also do this later." Collapsed by default. Skipping costs nothing.
- Button: **Save & continue** → ✓.

### Step 4 · Photos
- Why-line: "Profiles with photos get nearly all the clicks. One is enough to start — three or more is better."
- Big tap-target add tile (the existing MediaManager). After the first upload: "Nice. Add more, or continue."
- Two plain rules by the tile: **"Your first photo is what everyone sees first — no nudity on it."** · **"Use your sharpest photos."**
- Tiny reassurance under the tile: "Location data is removed from your photos automatically." (The EXIF rule, in human words.)
- Button: **Continue** (enabled at ≥1 photo).

### Step 5 · When are you available? *(optional — one tap to skip)*
- Why-line: "Set your hours and clients see when you're around — 'back tomorrow at 14:00'. You can skip this and add it later."
- The opening-hours rows (reused editor section). Prominent **Skip for now** alongside **Save & continue**. Never blocks submitting.

### Step 6 · Your phone number
- Why-line: "We send you one code. This proves your number is really yours — clients trust verified profiles."
- Phone field (placeholder "06 12345678", NL default, other countries fine) → **Send code** → the code field slides in, numeric keyboard, auto-submit at 6 digits. Resend link appears after 30s ("Nothing arrived? Send again").
- ✓ moment: "Your number is verified."

### Step 7 · Prove it's you — then the big moment
- Why-line: "Last step. We check every profile by hand — that's why clients trust this site."
- The two uploads (ID photo · selfie with code) as two big tiles that tick as they're filled. Safety line in human words: "Only our team sees these. They're never shown on your profile, and they're deleted on schedule." (Uploads go into the private, EXIF-stripped, audit-logged verification store — decision 3.)
- When both tiles are ticked, the one big button appears: **Submit my profile** ✨
- **The finish screen** — the emotional payoff, full screen: big ✓, **"Done! We're checking your profile."** · "This usually takes **up to 24 hours**. You'll get an email the moment you're live." · One button: "See my profile" (preview of what clients will see). The progress bar is full.

### After: while she waits, and when she's live
- Every account page shows a calm thin banner: **⏳ "We're checking your profile — you'll get an email when it's live."** No countdown anxiety, no jargon.
- First visit after approval: **🎉 "You're live!"** banner (one-time) + the dashboard flips to its normal live state.
- If something is rejected (photo, ID): the checklist row turns amber with the reason *in plain words* + one button "Fix it" that deep-links straight to the fix. Never a dead red wall.

---

## 3. The checklist card — same journey, dashboard view

Until she's live, the dashboard's first card is the journey as six rows (✓/○ + name + tap = jump into that step of the flow). It exists so that leaving the flow never loses the thread — the card *is* the flow, resumed. When all six are ✓ and not yet submitted, the whole card becomes the **Submit my profile** button. This card replaces today's unexplained DRAFT chip.

---

## 4. How it's built (the short version — reuse is law)

- **Progress is derived, never stored.** One pure helper `onboardingProgress(profile, account)` (`src/lib/onboarding.ts`, unit-tested): basics = row exists · rates ≥1 real row · services ≥1 · photos ≥1 · phone = `phoneVerifiedAt` · ID = submitted/approved · submitted = state ≠ draft. Drives the flow's resume point, the checklist, the banner, and the `/account/` redirect. No new tables.
- **Steps reuse the editor, not fork it.** `ProfileEditorForm` is split into per-section components (`dashboard/editor/{Basics,Rates,Services,GoodToKnow,Hours}.astro`); the full editor composes all of them (pixel-identical), the flow renders one per step. Photos = `MediaManager` as-is. Steps 5–6 = `VerificationFlow` split into its two halves. Submit = existing `account.submitProfile` (never auto-publish — hard rule 5 untouched).
- **Shell:** the flow hides the 5-tab account chrome (tabs are escape routes = drop-off) — thin `onboarding/SetupShell.astro`: logo · progress bar · "later" link. Route `/{locale}/account/setup/`, server-rendered per step, islands only where the reused pieces already have them.
- **Redirect:** advertiser + not complete + state draft + hasn't tapped "later" this session (`setup_later` session cookie) → `/account/` sends her to the flow.
- **Banner:** `dashboard/StatusBanner.astro` rendered by `AccountShell` (all tabs get it for free). Approval flip is reload-based first; the realtime broadcast hook upgrades it later.

---

## Phases

**Phase 1 — She can't get lost anymore** ✓ LANDED (checklist card + status banner + derived progress + human-words copy + submit CTA)
1.1 `lib/onboarding.ts` + tests.
1.2 Dashboard checklist card (rows deep-link to the existing tabs until the flow exists).
1.3 `StatusBanner` (checking / you're-live).
1.4 Submit CTA on checklist completion.
1.5 Copy sweep, 3 locales: kill jargon on every advertiser surface (draft/pending/verification-speak → the human words of §2); the "profile is your ad" line lands in the welcome/checklist copy.
*DoD: a fresh professional sees exactly what's left and reaches "we're checking" without help; kitchen-sink for card + banner (both themes + safe mode); tests green.*

**Phase 2 — The guided flow itself** ✓ LANDED (SetupShell + /account/setup/ 7 steps reusing editor sections via `only`/`wizard` variant props + MediaManager + VerificationFlow; derived resume; redirect + "later" cookie; **real private-R2 ID storage** wired; admin **audited signed-URL doc read** now built — `/admin/vdoc/[id]`, so verification is reviewable end-to-end).
2.1 Editor section extraction (pure refactor, editor pixel-identical, architecture tests prove no fork).
2.2 `SetupShell` + `/account/setup/` steps 0–6: progress bar, ✓ moments, save-on-advance, derived resume.
2.3 Redirect + "later" cookie.
2.4 `VerificationFlow` split; step 6 finish screen.
2.5 Mobile pass at 390×844 with design-align (measured, not eyeballed).
*DoD: register→submitted entirely in the flow on a phone, one thumb; abandoning at any step loses nothing; Lighthouse budget holds.*

**Phase 3 — The feeling of being looked after** *(after real users)*
3.1 Approval realtime: banner flips/toast without reload; approval + rejection emails (SMTP is configured).
3.2 Rejection loop: amber row + plain-words reason + "Fix it" deep link.
3.3 Post-approval nudges for the skipped extras ("profiles with opening hours get evening clients").
3.4 Funnel analytics per step (typed wrapper only; no session replay, ever) — find where they drop, fix that step.

## Decisions (settled)

1. **Photos** — **1 to submit**, nudge "3+ for more visibility". Rules shown at the step (and enforced by moderation): **no nudity on the first photo** (it's the public thumbnail), **highest quality possible**.
2. **Hours** — a **light optional step** she can skip in one tap (feeds the availability "back at" derivation, UX-PLAN 1.3).
3. **ID storage** — **build the real private-R2 doc flow now** (hard rule 3: EU private bucket, EXIF-stripped, admin-only signed URLs, every read audit-logged, retention then auto-purge) — not the mock. This is a sensitive PR of its own inside Phase 2; step 6 uploads into it.
4. **Review time** — commit to **"usually within 24 hours"** in the finish + banner copy.
5. **Segment by user type** — the flow is **solo professional only** (`role === 'advertiser'`). It must never appear for agencies (they get their own flow later) or clients. Gate the redirect, the checklist card, and the banner on role.