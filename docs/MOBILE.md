# MOBILE.md — The Entry Document

**Read this before everything else.** Then `docs/PLAN.md` (Foundation) and `docs/SEO.md`. Where documents conflict, this one wins.

**The prime directive: this is a mobile app that happens to be a website.** 87% of our real traffic is mobile (iOS ~60% alone). The product must look, feel, and behave like an incredible native iOS app — installed on the home screen, indistinguishable from native in daily use — while remaining a fast, crawlable website. Desktop must also be beautiful, but desktop *adapts from* mobile, never the reverse.

The bar: a professional puts our icon next to WhatsApp and Telegram on her home screen and it does not feel out of place. (The incumbent's PWA icon is a generic "D" with a truncated label — a two-line manifest mistake. We win these details, all of them.)

---

## 1. Development discipline (how every session works)

**Split of responsibility — read this first:** Claude Code runs in a container with no phone, no iOS device, and no Xcode/Simulator. It cannot install a PWA to a home screen, cannot read real safe-area geometry from actual hardware, cannot feel scroll physics or haptics, and cannot give the honest "does this feel like an app" verdict. Playwright MCP gives real, useful iPhone-viewport emulation (touch, dimensions, user agent) and headless mobile-mode Lighthouse — genuinely automatable and required — but it verifies the **code is correct**, not that the **experience is true**. Only a human on a real iPhone can verify the latter. So: Claude Code owns items marked **[automated]** below; the owner (you) owns items marked **[manual — real device]**, and must run that pass at every milestone, not just before launch.

1. **Build at 390×844 first** (iPhone 14/15 class). Every component, every page: mobile layout designed and finished before any desktop styling exists. Desktop is a progressive enhancement via `md:`/`lg:` — never the default that gets squeezed down.
2. **[automated]** Test mobile first, always: Playwright runs with iPhone device emulation (`devices['iPhone 14']`, touch enabled, mobile viewport) as the DEFAULT project; desktop Chromium is the secondary project. Functional flows (search → filter → profile → back), layout, and screenshots at mobile viewport, checked before desktop.
3. **[automated]** CI gates are mobile gates: Lighthouse **mobile** 95+ (headless, simulated throttling — no hardware needed) on home, city, category×city, profile — regression blocks merge (already in SEO.md §7; restated here because it's the law).
4. **[manual — real device]** Install the actual build on a real iPhone (Safari tab AND installed-to-home-screen standalone) at every milestone — not just at the end. This is the only way to catch real safe-area rendering, storage-partition behavior between Safari and the installed app, keyboard/autofill feel, and scroll physics — none of which Playwright's desktop-hosted WebKit can faithfully reproduce.
5. Definition of "a screen is done": passes automated checks at 390px AND passes your real-device pass — correct with iOS keyboard open, correct as installed PWA (safe areas), THEN nice at desktop.

## 2. App shell architecture

- **Fixed bottom tab bar** (mobile only, hidden ≥md): the app's spine.
  - Tabs: **Zoeken (Search) · Favorieten · Account**. Max 4 ever. Icon + small label (11px) — icon-only is ambiguous, label-only is web-like.
  - Height: 56px content + `env(safe-area-inset-bottom)` padding beneath — the bar's background extends to the physical screen edge, content sits above the home indicator. Never let the indicator overlap tappable area.
  - Active tab: filled icon variant + accent color; inactive: outline + muted. State change is instant (<100ms), no transition lag.
  - The bar persists across navigation (Astro View Transitions `transition:persist`) — it must never flicker, reload, or reflow during page changes. This single behavior is half of "feels native."
- **Headers are per-screen, small, and sticky only when useful** (search results: sticky filter chips; profile: collapsing header over the gallery). No global mega-header on mobile.
- **Scroll architecture:** the page scrolls, the chrome doesn't. Tab bar and sticky elements live outside the scroll container. `100dvh` for full-height layouts — never `100vh`, never `height: 100%` (both break with iOS toolbars/viewport-fit).
- In-browser (not installed) mobile Safari: same layout works with Safari's own bottom bar because we pad with `env(safe-area-inset-bottom)` — env() resolves to 0 where there's no inset, so one implementation serves both contexts.

## 3. Web app manifest (exact spec)

```json
{
  "name": "<Brand> – Geverifieerde professionals",
  "short_name": "<Brand>",            // ≤12 chars, NEVER truncates under the icon
  "description": "…",
  "id": "/",
  "start_url": "/?source=pwa",         // track installed usage
  "scope": "/",
  "display": "standalone",
  "display_override": ["standalone"],
  "orientation": "portrait",
  "background_color": "<dark-bg>",     // splash background — match dark theme
  "theme_color": "<dark-bg>",
  "lang": "nl",
  "categories": ["lifestyle"],
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icons/maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

- Real designed icons: full-bleed maskable (safe zone respected: key content within inner 80%), non-maskable with padding, PNG not SVG for the manifest set. This kills the "letter avatar" failure mode.
- Icons look correct on light AND dark home screens — test both.

## 4. Head / iOS meta (every page, in the base layout)

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="<Brand>">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon-180.png">
<meta name="theme-color" media="(prefers-color-scheme: light)" content="<light-bg>">
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="<dark-bg>">
<link rel="manifest" href="/manifest.webmanifest">
```

- `viewport-fit=cover` + `black-translucent` = content draws edge-to-edge behind the Dynamic Island / status bar; WE own that region and must pad it (next section). This is what makes it look like a real app instead of a webpage in a frame.
- apple-touch-icon: 180×180, opaque background (iOS doesn't composite transparency well), visually consistent with manifest icons.

## 5. Safe areas (the notch/island/home-indicator law)

```css
:root {
  --sat: env(safe-area-inset-top, 0px);
  --sab: env(safe-area-inset-bottom, 0px);
  --sal: env(safe-area-inset-left, 0px);
  --sar: env(safe-area-inset-right, 0px);
}
```

- Top chrome (headers, floating buttons): `padding-top: var(--sat)`. Backgrounds extend behind the island; interactive elements never sit under it.
- Bottom tab bar: `padding-bottom: var(--sab)` (per §2). Fixed CTAs above the tab bar stack their offsets.
- Landscape: respect `--sal/--sar` (rounded corners + sensor housing).
- Full-bleed imagery (profile gallery hero) MAY extend into unsafe regions — that's the premium edge-to-edge look — but overlaid controls stay inside safe bounds.
- Test on: iPhone SE (no island), 14/15 (island), in-browser Safari AND installed standalone — the insets differ across all four.

## 6. Native-feel rules (the difference between "website" and "app")

**Touch:**
- `touch-action: manipulation` globally (kills double-tap-zoom delay); `-webkit-tap-highlight-color: transparent` + explicit `:active` states on EVERY tappable element (scale 0.97 or bg shift, <100ms). Silence on tap = broken feel.
- Touch targets ≥44×44pt. Cards are fully tappable, not just their title.
- `user-select: none` on chrome (tab bar, buttons, chips); text content remains selectable.
- No hover-dependent functionality anywhere. Hover states exist only as desktop enhancement.

**Scroll:**
- `overscroll-behavior-y: contain` on the app shell in standalone — no rubber-band past the page, no accidental pull-to-refresh fighting our UI. Inner scrollers (sheets, galleries) get `overscroll-behavior: contain` so they never chain-scroll the page.
- Horizontal carousels (photo galleries, chip rows): `scroll-snap-type: x mandatory`, momentum, no scrollbars on mobile.
- Scroll position restored on back-navigation (View Transitions handles this; verify on search → profile → back — losing scroll position is an instant "cheap website" tell).

**Forms & keyboard:**
- All inputs `font-size: 16px` minimum — prevents iOS auto-zoom-on-focus (the single most jarring web tell).
- Correct `inputmode`/`type`/`autocomplete` on every field (tel, email, numeric for rates) — the right keyboard must appear.
- Fixed bottom elements + keyboard: use `visualViewport` listener or `interactive-widget=resizes-content`; the tab bar may hide while typing (native apps do this) rather than float mid-screen.

**Perceived performance:**
- Optimistic UI on every action (favorite, pause, save) — instant visual response, reconcile in background.
- Images: dimensions always set (CLS 0), blur-up placeholders, gallery preloads adjacent photos.
- View Transitions on all navigation: search→profile animates forward (slide/scale), back animates reverse. Prefetch on touchstart/viewport so the destination HTML is already local. Target: navigation *starts* in <100ms perceived.
- Skeletons only for genuinely async islands; SSR content never skeletons.

**Restraint:**
- No animation slower than 250ms; motion is physical and quick. Respect `prefers-reduced-motion`.
- No web-isms in standalone mode: no cookie-banner-on-every-launch (persist consent), no "open in app" nags, no hover tooltips.

## 7. Navigation model (standalone has no browser chrome)

- Installed PWAs have **no back button and no URL bar.** Every screen below top level renders an explicit back control (top-left, ≥44pt, chevron + optional label). Never rely on OS gestures alone.
- Bottom tabs = top-level sections; tapping the active tab scrolls-to-top/resets its stack (native convention).
- **Sheets, not pages, for transient UI:** filters, sort, report, photo actions = bottom sheets (Fulldev Sheet) sliding over context with a scrim, draggable to dismiss. Full navigations are for real destinations (profile, dashboard screens).
- **Sheets, not browser dialogs:** never `alert()`/`confirm()`; destructive confirms are action sheets.
- External links (WhatsApp/Telegram contact) open correctly from standalone (`target="_blank"` → in-app Safari view or app deep link — verify WhatsApp `wa.me` links launch the app from standalone).
- Deep links: every screen has a real URL (it's still a website) — `start_url` opens Search; auth state must survive the Safari→installed-PWA boundary gracefully (see §9).

## 8. Install promotion ("Add to Home Screen" made effortless)

iOS has NO automatic install prompt — we build the nudge:

- **Component: `InstallCoach`** — a dismissible bottom coach-mark shown when: iOS Safari + NOT standalone (`!matchMedia('(display-mode: standalone)')`) + not dismissed in last 14 days (persisted) + not first pageview (don't ambush).
  - Copy (per locale): "Installeer <Brand> — tik ⬆️ en kies 'Zet op beginscherm'." with the share-icon glyph pointing toward Safari's share button position (bottom bar center on iPhone Safari).
  - One tap opens a 3-step visual sheet (share → scroll → add) with real screenshots.
- **Android:** capture `beforeinstallprompt`, show our own install button in the same coach-mark position; trigger the native prompt on tap.
- **Strongest placement is the professional dashboard** (post-verification approval: "Install the app to hear immediately when clients message you") — her incentive is business-critical notifications, and installed professionals are the retention win. Client-side promotion stays gentle.
- Track installs: `?source=pwa` start_url + display-mode media query → analytics dimension.

## 9. iOS gotchas (known traps — do not rediscover these)

1. `100vh` is broken; `height: 100%` breaks `viewport-fit=cover`. Use `100dvh` / `100svh`. Everywhere.
2. Inputs under 16px font-size trigger auto-zoom (§6).
3. **Standalone storage is SEPARATE from Safari storage** — a user logged in via Safari is logged OUT in the installed app. Mitigate: session survives via server cookie where possible; otherwise make re-login one-tap easy from the installed context. Never assume shared localStorage across the boundary.
4. No `beforeinstallprompt` on iOS — coach-mark only (§8).
5. Push requires installed + explicit user-gesture opt-in (post-MVP feature; architecture must not depend on push existing).
6. `position: fixed` elements jump while the keyboard is open — handle via §6 keyboard rules; test every fixed element with the keyboard up.
7. Status-bar region is ours under `black-translucent` — unpadded headers will collide with the clock/island (§5).
8. Rapid-tap: ensure no ghost-click/double-submit on buttons (disable-on-first-tap for actions).
9. Video/audio autoplay restrictions — any future media features require user gesture.
10. Verify `wa.me` / `t.me` links from standalone open the native apps (they should; test, because contact IS the conversion).

## 10. Desktop (adapts from mobile)

- ≥md: tab bar hides; top navigation appears; filter sheet becomes the sidebar; grid widens (2→3→4 columns). Same components, different arrangement — no desktop-only components that lack a mobile form.
- Desktop gets hover states, wider gallery, keyboard navigation — as enhancement.
- The same performance budgets apply; desktop is not an excuse for weight.

## 11. Definition of done (mobile checklist — every milestone)

**[automated] — Claude Code verifies via code review, CI, and Playwright mobile-viewport emulation:**
- [ ] Manifest exactly per §3; icon files present at correct sizes/purposes
- [ ] Head/meta per §4 in base layout; theme-color media queries present
- [ ] Safe-area CSS rules present on all chrome per §5 (code-level check; real geometry needs §4 below)
- [ ] Tab bar persists across navigation without flicker (Playwright nav test); active-state classes correct
- [ ] `100dvh` audit — zero `100vh` in the codebase (CI grep)
- [ ] Every tappable ≥44pt in layout; `:active` styles defined; tap-highlight disabled
- [ ] Inputs: 16px+ font-size, correct inputmode/autocomplete attributes present
- [ ] `overscroll-behavior` rules present; carousel snap CSS present
- [ ] View Transitions wired on the search↔profile path; prefetch attributes present
- [ ] InstallCoach logic correct (display-mode check, dismissal persistence, platform branching) via unit/Playwright test
- [ ] Lighthouse mobile 95+ on the four key templates (CI, headless, simulated)

**[manual — real device, owner] — verify by installing the actual build on a real iPhone, every milestone:**
- [ ] Icon renders correctly (no letter-avatar, no truncation) on both light and dark home screens
- [ ] Safe-area padding looks correct on your actual hardware, portrait AND landscape, Safari tab AND installed standalone
- [ ] Scroll feel: no rubber-band past content in standalone, momentum feels right, back-navigation restores scroll position
- [ ] Keyboard: fixed elements behave correctly when it opens; autofill/autocomplete actually offers the right keyboard type
- [ ] Auth: does it survive or gracefully re-prompt across the Safari→installed-app boundary (§9.3)
- [ ] wa.me/t.me contact links actually launch WhatsApp/Telegram from the installed app
- [ ] InstallCoach: does the real coach-mark make Add-to-Home-Screen genuinely effortless
- [ ] The gut check: install it, use it for 5 minutes, and honestly ask "does this feel like an app?" — ship only on yes
