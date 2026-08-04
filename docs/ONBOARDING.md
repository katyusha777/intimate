# ONBOARDING.md — Professional (advertiser) onboarding plan

**Temporary execution tracker — not a living spec. Delete when the phases land** (UX-PLAN precedent). Durable rules it produces move into DESIGN.md / COMPONENTS.md / this repo's copy in the building PRs. One GitHub Issue per numbered item; sessions stay scoped to one item.

**The one sentence this whole flow exists to teach:**

> **Your profile IS your ad.** There is no separate "post an ad" step — filling in your profile *is* creating your ad, and when it's approved, it's live.

Competitor sites split "account" from "ad", so professionals arrive expecting to hunt for a "place ad" button. We kill that confusion by never using the word "ad" as a *thing to create*, and by walking her from first login to submitted-for-review in one guided path.

**Audience law (write ALL copy to this):** plain words, short sentences, one idea per screen, B1 language level, always say *why* ("Clients filter by price — profiles without rates don't appear in price searches"). Never assume she knows web jargon. nl/en/de from day one; mobile 390px first.

---

## 0. Current state (what the flow builds on — all live today)

- Register (role tile → email + password) → confirmation email → `/auth/confirm` → lands on `/{locale}/account/` — a bare dashboard with a DRAFT chip and five tabs. **No guidance. This is the gap.**
- `ProfileEditorForm` — one long form: basics (name/DOB/gender/city) · visit type · rates table · good-to-know (languages/place/amenities/payment) · services (categorised) · hours · description. First save creates the `draft` row (name/DOB/gender/city mandatory then).
- `/account/photos` — gated on the profile row existing (shows "create your profile first" otherwise). Photos are `pending_review` individually.
- `VerificationFlow` — step 1 phone (Twilio Verify, live) + step 2 ID upload (mock pending real R2 doc flow).
- `account.submitProfile` — draft/paused → `pending_review` (never auto-publish, hard rule 5). Nothing currently *prompts* her to call it.
- Realtime broadcast infra exists (approval-moment toasts are a wired-ready hook).

## 1. The flow (target experience)

```
Register → confirm email → land in SETUP (not the bare dashboard)
┌─────────────────────────────────────────────────────────────┐
│ 0 WELCOME   "Your profile is your ad." What happens next    │
│             (fill in → photos → verify → we review → live). │
│             One button: Start.  Escape hatch: Later →       │
│             dashboard with the checklist card.              │
│ 1 BASICS    Name shown to clients · birth date · gender ·   │
│             city · visit type. Save = the draft exists.     │
│ 2 RATES     The rates table (min 1 row). "Your price in     │
│             search is the lowest row."                      │
│ 3 SERVICES  Tick what you offer (min 1). "Clients filter    │
│             by these — and requests quote them."            │
│             Good-to-know shown below, clearly optional.     │
│ 4 PHOTOS    Add photos (min 1 to submit). EXIF note.        │
│ 5 PHONE     SMS code (already built — VerificationFlow §1). │
│ 6 ID        Upload ID + selfie (VerificationFlow §2), then  │
│             ONE button: "Submit my profile for review" —    │
│             calls submitProfile. → pending banner.          │
└─────────────────────────────────────────────────────────────┘
After submit: persistent "In review" banner on account pages.
On approval: banner flips to "You're live" (realtime later, reload now).
```

Rules of the wizard:
- **One step, one job, one primary button.** Progress header "Step 2 of 6" + step names. Back always works. Every step saves on advance (the same partial `saveProfile` — abandoning mid-way loses nothing).
- **Resume is derived, never stored.** No onboarding table/column: the current step is computed from data (§3). Close the tab, come back, land on the first incomplete step.
- **Escape hatch on every step** ("I'll finish later") → dashboard, where the checklist card (§2) carries the same completion state. The wizard is a view over the checklist, not a separate system.
- **Requirements to submit** (= the checklist): basics saved · ≥1 rate row · ≥1 service · ≥1 photo · phone verified · ID submitted. Good-to-know, hours, description stay optional (nudged post-approval, §Phase 3).
  - Why services/rates are required: the flagship request sheet (UX-PLAN 4.2) quotes *her* service + rate — a live profile without them breaks the product's core loop.

## 2. Dashboard checklist card (the fallback + the memory)

Until the profile is `live`, the dashboard's first card is **"Get your profile live"** — a 6-row checklist mirroring the wizard steps, each row: ✓/○ + label + deep link into the wizard at that step. Under it, the one-sentence frame ("Your profile is your ad — complete it and submit it for review"). When all rows are ✓ but not yet submitted, the card is one big **Submit for review** button. Replaces today's unexplained DRAFT chip as the primary object on the dashboard.

## 3. Derived progress (no new storage — ponytail)

One helper, `onboardingProgress(profile, account)` in `src/lib/onboarding.ts` (pure; unit-tested):

```
hasBasics   = !!profile.id            (row exists ⇒ the 4 identity fields were saved)
hasRates    = rates.some(r => duration && (incall||outcall))
hasServices = services.length >= 1
hasPhotos   = photos.length >= 1      (any state — pending counts; review handles quality)
phoneOk     = !!account.phoneVerifiedAt
idOk        = idVerification in ('pending','approved')
submitted   = profile.state !== 'draft'
→ steps array + firstIncomplete + complete (all six true)
```

Used by: the wizard (resume + gating "Submit"), the dashboard checklist, the pending banner, and the `/account/` redirect decision.

## 4. Reuse map (reuse is law — nothing forked)

| Wizard step | Reuses | Change needed |
|---|---|---|
| 1 Basics | `ProfileEditorForm` basics + visit-type chips | **Extract editor sections into per-section components** (`dashboard/editor/Basics.astro`, `Rates.astro`, `Services.astro`, `GoodToKnow.astro`, `Hours.astro`) — the full editor becomes a composition of them; the wizard renders one per step. Submit logic stays one shared script (partial patch already supported by the action). |
| 2 Rates | editor `Rates` section | same extraction |
| 3 Services (+optional GTK) | editor `Services` + `GoodToKnow` | same extraction |
| 4 Photos | `MediaManager` | none (already gated on the row; step 1 created it) |
| 5 Phone | `VerificationFlow` step 1 | split its two steps into separately renderable pieces |
| 6 ID + submit | `VerificationFlow` step 2 + `account.submitProfile` | add the submit CTA + success state |
| Shell | `AccountShell`? **No** — the wizard hides the 5-tab chrome (tabs = escape routes = drop-off). Minimal header: logo, "Step n of 6", Later link. | new thin `onboarding/SetupShell.astro` |

New route: `/{locale}/account/setup/` (one page, step from `?step=` or derived; server-rendered per step, zero-JS except the reused islands).
Redirect: `/account/` + advertiser + `!complete && state==='draft'` + not explicitly skipped this session → `/account/setup/`. "Later" sets a session cookie (`setup_later=1`) so the escape is respected until next login.

## 5. The pending banner (after submit)

`state === 'pending_review'` → thin banner on every **account** page (not public pages): "⏳ Your profile is in review. We check every profile by hand — you'll get an email when it's live." On `live` (first visit after approval): one-time "🎉 You're live" banner (dismiss stored client-side). Component: `dashboard/StatusBanner.astro`, rendered by `AccountShell` (so it's on all 5 tabs automatically). Realtime approval-moment toast is a Phase-3 hook (broadcast infra exists); reload-based is fine to ship.

## 6. Copy audit (kill the "post an ad" model)

Sweep all three locales for anything implying a separate ad object; the words are **profile / your profile / live**. START ADVERTISING CTA keeps its name (it's the acquisition hook) but its landing = this flow. Welcome step explicitly says: "On other sites you place an ad. Here, your profile is the ad — one thing to fill in, one place to update."

---

## Phases (ship order)

**Phase 1 — Clarity without new UI** *(small, ships first)*
1.1 `lib/onboarding.ts` derived-progress helper + unit test.
1.2 Dashboard checklist card (§2) with deep links to the existing tabs (wizard doesn't exist yet — links go to `/account/profile/`, `/account/photos/`, `/account/verification/`).
1.3 `StatusBanner` (§5): pending + you're-live states via `AccountShell`.
1.4 Submit CTA: when the checklist completes, the card becomes "Submit for review" → `submitProfile`.
1.5 Copy audit (§6), 3 locales.
*DoD: a fresh advertiser can see exactly what's missing and get to `pending_review` without guessing; kitchen-sink entries for the card + banner (both themes + safe mode); tests green.*

**Phase 2 — The guided wizard**
2.1 Extract editor sections (§4) — pure refactor, editor pixel-identical after (architecture tests + kitchen-sink diff).
2.2 `SetupShell` + `/account/setup/` rendering steps 0–6 from the section components; save-on-advance; resume from derived progress.
2.3 Redirect logic + "Later" cookie.
2.4 Split `VerificationFlow` steps for reuse in 5/6; step 6 carries the submit moment.
*DoD: register→submitted possible entirely inside the wizard on a 390px phone; abandoning at any step loses nothing; Lighthouse budget holds (wizard pages are account-side, but keep islands minimal).*

**Phase 3 — The polish loop** *(after real users touch it)*
3.1 Approval moment: realtime broadcast → banner flips/toast without reload; approval + rejection emails (needs the SMTP already configured).
3.2 Post-approval nudges: "profiles with hours get evening clients" — prompts for the optional sections she skipped.
3.3 Funnel analytics: typed-wrapper events per step (started/completed/abandoned) — where do they drop? (ANALYTICS.md contract; no session replay, ever.)
3.4 Rejection loop: rejected ID / rejected photos → checklist row turns red with the admin's taxonomy reason + "fix and resubmit" deep link.

## Open questions (decide before Phase 2 build)

1. **Photos minimum** — 1 to submit (current plan) or 3 (kinky.nl-grade listings look empty with 1)? Recommend: 1 to submit, nudge "profiles with 3+ photos get more clicks" in the step.
2. **Hours in the wizard?** Currently optional/skipped. The availability system (UX-PLAN 1.3) derives "back at" from hours — worth a light-touch optional step 3½, or keep post-approval nudge only?
3. **ID doc real storage** — step 6 currently rides the mock (discards files). The real R2 private-bucket flow (hard rule 3) is its own sensitive PR; wizard ships against whichever exists when it lands.
4. **Agency accounts** — this plan is solo-professional. Agencies (multi-profile) get their own flow later; the wizard must simply not explode for them (gate on `role === 'advertiser'`).
