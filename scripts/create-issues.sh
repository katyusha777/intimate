#!/usr/bin/env bash
# One-shot: create the GitHub issues for the UX-PLAN tracker + standing work.
# Prereq: `brew install gh && gh auth login`. Safe to re-run only once — it
# does not dedupe. Delete this script after running (it's a tracker artifact).
set -euo pipefail

i() { gh issue create --title "$1" --body "$2

Spec: \`docs/UX-PLAN.md\` — session scoped to this item only (CLAUDE.md)."; }

# Phase 1 — the honest shelf
i "UX 1.1 — Fold rework: live local shelf above the fold" "Signed-out mobile fold = compact search, city+count line, first card row at 390×844. Pitch collapses to one line; START ADVERTISING → menu/footer."
i "UX 1.2 — Ask the city once (sheet + cookie, no geolocation)" "First-visit ActionSheet: six city buttons + ALL OF NL, cookie-remembered, header switcher."
i "UX 1.3 — Three honest card states + availabilityState() helper" "● Online now / ◐ Today until HH:MM / ○ Back {day} from presence + openingHours + lastActiveAt (new field). State in dot+text, photos calm."
i "UX 1.4 — Split NEW shelf from ONLINE sort" "Default sort ONLINE NOW; NEW THIS WEEK is its own shelf (cold-start boost). No fused claims."
i "UX 1.5 — Server-rendered link-chips [City][Now·Tonight][≤€150]" "Thumb-height link-chips to canonical URLs; filter sheet keeps the long tail."
i "UX 1.6 — Verified mark on every card name" "Per-profile assertion, not marquee slogan."

# Phase 2 — rates & the money screen
i "UX 2.1 — Rates model: duration × price table, priceFrom derived" "rates[] on the profile model (RATE_DURATIONS taxonomy), editor section, seeds. 'The listed price is the price.' CLEAR PRICING mark for full tables."
i "UX 2.2 — Rates table above ABOUT on mobile profile" "Duration × price, incall/outcall columns where relevant."
i "UX 2.3 — AvailabilityLine molecule (one truth line)" "Merge presence + hours into one sentence; consumed by cards, profile, deal card."
i "UX 2.4 — Desktop sticky card becomes the deal card" "Compact rates, availability line, contact CTA, trust-receipt link; metadata demotes."
i "UX 2.5 — Good-to-know rows (structured facts via taxonomy)" "Languages, place, parking, shower, payment, deposit — filled once, two-column list after SERVICES."
i "UX 2.6 — Respectful offline fallback" "Only when paused/away: 'N similar profiles online in {city} now' at page bottom. Never on live profiles."

# Phase 3 — trust receipts
i "UX 3.1 — Trust-receipt sheet from every verified mark" "Dated facts: ID+selfie check date, photo-verification date, honest bounded-retention line (UX-PLAN §0.2), photo-protection line."
i "UX 3.2 — Measured reply speed" "Median first-reply (30d rolling), shown only at ≥5-reply sample. Mock now, SQL view at the Supabase swap."
i "UX 3.3 — Demote member-since into the receipt" "Weakest signal last; off the headline metadata."

# Phase 4 — request sheet (flagship; amends MESSAGING.md in the same PR)
i "UX 4.1 — MESSAGING spec delta: request kind, pending threads, screening question" "messages.kind 'request', thread state pending→open/declined, conversation_settings.screening_question, no-free-compose-until-accept throttle. Deny tests."
i "UX 4.2 — RequestSheet organism (three taps from her data)" "Service → duration-with-price → when (Now/Tonight/slot), optional note + her screening question. Price snapshot immutable."
i "UX 4.3 — Professional-side request card: accept/decline" "Inbox/thread card; accept opens chat + system card; silent unpunished decline; screening-question editor in settings."
i "UX 4.4 — Private photo set, granted per accept" "Public set + 'N more shared when she accepts' — per-thread unlock riding the grant machinery."

# Phase 5 — discretion kit
i "UX 5.1 — Neutral placeholder set; safe mode three-valued (off/neutral/dev)" "Boring neutral set default for visitors; anime becomes the dev skin. Fail-closed plumbing unchanged."
i "UX 5.2 — Safe-mode toggle on the floating bar (+ desktop glass button)" "One-thumb reachable on every screen; footer keeps a mirror."
i "UX 5.3 — Neutral tab title + favicon under safe mode" "Browser chrome is part of the glance test."
i "UX 5.4 — Boss key: Esc·Esc flips safe mode instantly (desktop island)" "Both directions, includes tab title/favicon."

# Phase 6 — finders' QoL
i "UX 6.1 — AI search sheet on mobile with example queries" "Search icon opens sheet, three tappable examples, parses into taxonomy+presence filters."
i "UX 6.2 — Saved-compare rail on desktop" "Thin SAVED(n) rail from synced hearts; compact ProfileCard variant."

# Standing work outside UX-PLAN
i "Wire Twilio Verify into startSms/checkSms" "docs/VERIFICATION.md §6 steps 1–2: Verify Service SID, fetch-based actions, KV rate limits, SmsVerify molecule extraction."
i "Owner homework (off-repo, standing)" "- Bing Webmaster + Brave + Google Search Console: register CURRENT site now (SEO.md §8 — indexation lag makes this urgent)
- 2FA on Cloudflare / Supabase / GitHub / Twilio / PostHog operator accounts (SECURITY.md §2)
- Create Twilio Verify Service; confirm API key scope covers Verify (VERIFICATION.md §1)
- Rotate all third-party keys before launch (SECURITY.md §7)
- Real-device pass every milestone (MOBILE.md §1) — put a recurring calendar slot on it"

echo "All issues created."
