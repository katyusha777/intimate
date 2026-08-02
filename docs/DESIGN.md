# Design System

The visual + component foundation for Intimate. This is **priority 3** in the
Base architecture (`ARCHITECTURE.md`) but it is the layer the user actually feels, and its one
non-negotiable is **cohesion**: every screen is assembled from the same small
set of components, on the same spacing scale, with the same materials. If a
screen needs something the library doesn't have, we add it to the library — we
never one-off it.

Companion to `ARCHITECTURE.md` (the what) and `taxonomy.ts` (the vocabulary). This is
the how-it-looks. No page is built until the token layer and the primitives it
needs exist.

---

## 1. North star

Make kinky.nl (and our own WordPress site) feel ancient. The current site is
"off" because it's inconsistent — spacing, radii, and weights drift from
section to section. We fix that with a **token-driven system** and a **closed
component set**.

Reference language, in order of influence:

| Source | What we take |
|---|---|
| **iOS 26** | The material system — layered translucent "glass" surfaces, depth via blur + light rather than heavy shadows, generous rounding, spring motion, safe-area awareness. This is the through-line. |
| **Airbnb — listing page** | The profile layout: big confident photo gallery, two-column body (content left, sticky action card right), calm typographic hierarchy, "prices/everything included" honesty. |
| **Airbnb — search header** | The clean segmented search control. One control, three parameters, nothing else competing. |
| **Airbnb — featured card** | The highlighted card with an inline photo carousel (dots), a corner badge, a favorite heart, info to the side. |
| **Purple Fly — header** | The dark, glassy top nav: pill toggle, rounded search, tidy icon cluster, avatar/balance chip. Density done cleanly. |
| **OpenSea — grid** | Grid + filter-rail cleanliness. Uniform cards, quiet chrome, filters that never shout. The benchmark for "calm at scale." |
| **intimate.nl** | Brand only: crimson accent, the trailing-period display device, bold uppercase eyebrows, verified-first trust signalling, Spaces/community energy. We keep the brand, discard the WordPress execution. |

Design principles: generous whitespace · one accent · real typographic
hierarchy · photography-first · zero clutter · zero ads-look · **CLS = 0** ·
390px designed first, desktop second · both themes first-class.

**Product honesty (from the 2026-08 UX review — permanent):** the client wants
zero friction to contact; the professional wants enough friction to filter —
the best controls do both at once, reading as convenience on one screen and as
screening on the other. Every surface makes only claims it can prove: no fake
liveness (an availability state is timestamped or it isn't shown), no fused
claims ("NEW & ONLINE"-style), dated proof over badges, no reviews of people,
no dark patterns. Discretion is a feature for BOTH roles — the professional's
(location/identity never leak) and the client's (safe mode, neutral browser
chrome, panic-reachable toggle).

### 1.1 The design language: **Misprint**

What the anaglyph buttons started has a name and a grammar. **Misprint** =
*clean monochrome print whose ink slips when things move.* The page is a
perfectly printed poster — paper, ink, one spot color — and interaction is a
printing error: plates misregister, pink and cyan fringes appear, the sticker
shivers. The reference images live in `docs/design-refs/`.

**Where it comes from** (the mix the owner senses — "sorta Persona 5, sorta
cyberpunk"):

| Lineage | What it contributes |
|---|---|
| **Risograph / misregistered offset print** | The core visual: flat spot-color layers slightly out of register. Zine and gig-poster culture. Why it must stay *flat* and *simple* — riso can't do gradients or grays. |
| **Anaglyph 3D** (red/cyan glasses) | The exact color pair, and the reading that the element "exists in more dimensions than the screen". Our button's namesake. |
| **Glitch / chromatic aberration** | The cyberpunk half: RGB channel-split as a sign of *live signal* — used by NieR: Automata, Cyberpunk 2077 as a *state*, not decoration. Restraint is the lesson: NieR is calm 95% of the time. |
| **Persona 5 (Soejima UI)** | Punk-collage energy: hard-cut slabs at slight angles, italic condensed uppercase, red/black/white, UI that moves like it's alive. Itself descended from Jamie Reid's ransom-note punk zines. |
| **Swiss / International Style** | The calm base that makes the glitch land: strict grid, one grotesk family (Barlow), monochrome + one accent, whitespace as structure. |
| **Constructivist posters** | Diagonal composition, red/black/white confidence — where the slight rotations and crimson marks come from. |
| **Sportswear / streetwear graphics** | The italic bold condensed uppercase action label ("speed text"). |
| **Zenless Zone Zero, Splatoon, Jet Set Radio** | Proof that street-punk UI can be ergonomic, mobile-native and fun without being noisy. |

**The grammar** — eight rules, in priority order:

1. **Paper and ink.** The canvas is paper (near-white / near-black), content
   surfaces are paper, the brand layer is ink (pure foreground). 95% of any
   screen is calm Swiss print. The language dies if everything shouts.
2. **Ink is binary — no grays.** Print has no gray pigment; it has ink
   coverage. Text hierarchy = *ink opacity* (`text-foreground/55…/80`), never a
   third gray tone. Surfaces are paper, ink (`bg-foreground text-background`
   flip), or a **keyline** (border of ink at low opacity) on bare canvas.
   Mid-gray *filled* chrome (`bg-muted` panels, gray pills, gray icon circles)
   is the "default software" look we are escaping — banned in the brand layer.
   Recessed form fields may sit a whisper off-canvas, never a visible gray slab.
3. **The slip is earned.** Pink/cyan misregistration appears only where there
   is *energy*: the Button (the brand seal, always), hover/tap motion
   (chroma text-shadow), live/realtime moments. Never at rest, never on body
   text, never on two things in the same view. If everything glitches, nothing
   does.
4. **Cut, not rounded — radius is binary.** Print objects are cut sharp:
   buttons, inputs, tags, banners, active states → square corners (the Button
   goes further with its angled clip). Paper surfaces that *hold* content —
   cards, sheets, modals, photos — keep soft large radii for native mobile
   feel. Circles (dots, avatars, icon seals) are die-cuts and always allowed.
   The banned zone is the middle: 6–12px rounding on small chrome is exactly
   the generic look. Sharp or soft-large or circle — pick one.
5. **Crimson is a mark, not a paint.** Periods, seals, dots, the wand — never
   fills, never large areas, never text blocks.
6. **Speed text.** Display and actions are Barlow Condensed bold uppercase;
   action labels may italicize (the sportswear voice). Body stays quiet Barlow.
7. **Motion is the medium, on a budget.** The language *lives* in transitions —
   glitch shiver on click, chroma shadow on hover, view transitions — but
   150–250ms, transform/opacity only, `prefers-reduced-motion` safe. The
   button shiver is the loudest sound allowed.
8. **Mobile-first simplicity overrides all of it.** Every effect is a few
   lines of CSS — no images, no canvas, no JS animation loops. When a Misprint
   idea conflicts with clean/fast/native-feeling on a 390px screen, print calm
   wins.
9. **The language never touches people.** Glitch, chroma, skew, ink slabs —
   brand chrome only. Profile photos, names in listings, anything that *is* a
   person stays completely straight: clean paper card, honest photography,
   calm type. The product is the professionals; the UI is the gallery wall,
   not the exhibit. A chromatic fringe on someone's photo isn't punk, it's
   disrespectful — and it makes the money surface harder to scan. The formula:
   Airbnb-calm cards inside a Misprint frame. (This is also the market
   position: our competitors are either sleaze-classifieds or sterile
   templates; we are the editorial gallery between them.)

**Applying it to inputs** (the P5 sign-up reference, heavily tamed): a form
field is a printed box — sharp corners, ink keyline on bare canvas, condensed
label. A *sub-degree* tilt (−0.3°…−0.5°) may be tried on marketing/auth
surfaces via `/kitchen-sink` first; workaday filters and dashboards stay
straight.

Reference files: `design-refs/misprint-buttons-live.png` (our hero CTAs — the
canonical rendering) · `design-refs/p5-phan-site-mobile.webp` (P5 fan UI:
slab inputs, mobile energy) · `design-refs/p5-storefront-concept.webp`
(P5-style storefront: maximal end of the spectrum — study, don't copy; we sit
much closer to Swiss).

---

## 2. Tokens

All theming is CSS variables in `src/styles/global.css`. Fulldev's `@fulldev/init`
already installed a neutral token layer with light + `.dark` blocks and an
`@theme inline` bridge to Tailwind. We **override the accent and radius** and add
a **material layer**. Nothing hardcodes a hex/oklch outside this file.

### 2.1 Color

Keep Fulldev's neutral ramp (backgrounds, borders, muted, foreground). Replace
the default primary (currently a blue in light / orange in dark — leftover
Fulldev defaults) with **Intimate crimson**, and add surface/material tokens.

```css
:root {
  /* brand accent — crimson */
  --primary: oklch(0.55 0.222 25);          /* ~#d61f35 */
  --primary-foreground: oklch(0.99 0 0);
  --accent-gradient-from: oklch(0.58 0.225 18);
  --accent-gradient-to:   oklch(0.52 0.223 30);   /* primary CTA fill */

  /* semantic status */
  --online: oklch(0.72 0.19 150);           /* presence "online now" green */
  --verified: var(--primary);               /* verified badge = brand */
  --warning: oklch(0.80 0.16 85);

  /* glass materials — see §5. alpha over the current bg */
  --glass-ultrathin: color-mix(in oklch, var(--background) 55%, transparent);
  --glass-thin:      color-mix(in oklch, var(--background) 70%, transparent);
  --glass-regular:   color-mix(in oklch, var(--background) 82%, transparent);
  --glass-border:    color-mix(in oklch, var(--foreground) 12%, transparent);
}
.dark {
  --primary: oklch(0.62 0.225 22);          /* lift for dark-bg contrast */
  --primary-foreground: oklch(0.99 0 0);
  --glass-ultrathin: color-mix(in oklch, var(--background) 50%, transparent);
  --glass-thin:      color-mix(in oklch, var(--background) 62%, transparent);
  --glass-regular:   color-mix(in oklch, var(--background) 74%, transparent);
  --glass-border:    color-mix(in oklch, var(--foreground) 16%, transparent);
}
```

Rule: **one accent.** Crimson is for primary action, active state, verified,
and the trailing "." device — nothing else. Everything structural is neutral.

### 2.2 Radius — binary (Misprint rule 4)

Sharp or soft-large or circle; the 6–12px middle is banned on brand-layer
chrome.

| Token | Use |
|---|---|
| `rounded-none` | **print objects**: inputs, selects, tags, banners, active states, segmented controls (Button goes further with its clip cut) |
| `rounded-xl` / `rounded-2xl` | **paper surfaces**: cards, tiles, sheets, modals, photos/media |
| `rounded-full` | **die-cuts**: dots, avatars, icon seals, count pills |
| `rounded-md` / `rounded-lg` | legacy vendor default — do not use in new work; sweep out when touched |

### 2.3 Spacing

Tailwind's 4px scale, used **semantically and without exception** — the cure
for the WordPress drift:

- Component inner padding: `4` (16px) mobile, `6` (24px) desktop.
- Gap between cards in a grid: `4` (16px).
- Section vertical rhythm: `12`/`16` (48/64px) mobile, `20`/`24` desktop.
- Page gutter: `4` (16px) mobile, `6`–`8` desktop, content max-width `max-w-7xl`.
- Touch targets ≥ 44px (iOS). Stack spacing inside a card: `2`–`3`.

### 2.4 Typography

**Two families, strict roles** (perf budget: static weights only, subset by
usage): **Barlow** (`font-sans`, weights 400/500/600/700 + 600-italic for the
anaglyph label) for everything, and **Barlow Condensed** (`font-condensed`,
500/600/700) for *titles and names only* — display headings, page/section
titles, profile names, category tabs. Body copy, labels, chips, forms never
use condensed.

| Role | Spec |
|---|---|
| Display (hero) | `.display` + `text-4xl`→`text-6xl` (condensed bold uppercase, crimson `.`) |
| H1 / page title | `.display` or `font-condensed text-2xl`–`text-3xl` `font-semibold tracking-tight` |
| H2 / section | `font-condensed text-xl font-semibold` |
| Profile name | `font-condensed font-semibold`, one size up from surrounding body |
| Category tabs | `font-condensed text-sm font-bold uppercase tracking-wide` |
| Eyebrow | `text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground` |
| Body | `text-base leading-relaxed` (`text-sm` in dense chrome) — Barlow |
| Meta / caption | `text-sm text-muted-foreground` |

Helper: `.display` = condensed + uppercase + tight tracking + trailing crimson
period via `::after`. One class, brand-consistent everywhere.

### 2.5 Elevation

iOS 26 leans on **translucency + light**, not Material drop shadows. Use glass
(§5) for floating chrome; reserve real shadows for resting cards only:
`shadow-sm` at rest, `shadow-md` on hover. No shadow deeper than `md` anywhere.

### 2.6 Cohesion enforcement (tested)

`tests/style.test.ts` fails the build on arbitrary rhythm values in class
names — **no** `p-[13px]` / `mt-[7px]` / `gap-[18px]`, **no** `text-[15px]`,
**no** `tracking-[…]` / `leading-[…]`. Dimensions, grid templates, `%` and
`env()` are layout, not rhythm, and stay free.

How to stay inside the rules:
- **Type roles:** `.display` (uppercase display + crimson period), `.eyebrow`
  (micro-label; override color/weight/size with plain utilities per variant),
  and the standard `text-*` scale extended with the `text-2xs` (11px) token.
  Need a new size/tracking? Add a **token** in `global.css` — never a bracket.
- **Section rhythm is owned by `molecules/Section.astro`** (`py-6 md:py-10`,
  heading + meta/actions slots) — pages never hand-roll spacing between blocks
  or heading margins.
- **Component-internal spacing** follows §2.3 (p-4/6 innards, gap-4 grids) and
  lives inside the owning component, so changing it once propagates.

---

## 3. Component library

Closed set. Astro components for anything static (zero JS); **React islands**
(shadcn/ui) only where interaction is real. Fulldev blocks/components are the
base; `npx shadcn@latest add @fulldev/<item>`.

Structure: `src/components/ui/` (primitives, mostly Fulldev/shadcn) ·
`src/components/` (composed app components) · `src/layouts/`.

### 3.1 Primitives (`ui/`)
Button (solid/gradient · outline · ghost · pill · icon), Input, Select, Badge,
Avatar (with verified tick + presence dot), Card, Sheet (bottom on
mobile), Dialog, Dropdown, Tabs, Tooltip, Toast, Skeleton, Switch, Segmented
control, GlassBar (§5), Icon (Font Awesome 8 Pro self-hosted, always via
`atoms/Icon.astro` — INFRASTRUCTURE.md §4). All theme-aware, all on the token scale.

**The anaglyph Button is unique.** Its skewed face, chromatic offset layers and
italic uppercase label belong to the Button atom and nothing else. Never apply
that style — or approximations of it (chunky rounded pills, skewed text, offset
shadows) — to tabs, chips, nav items, toggles or any other control. Everything
that is not a Button stays flat monochrome; active states are marked with a
short underline bar or a plain foreground/background flip, and the pink/cyan
split may appear only as a *motion* accent (hover/tap text-shadow), never at
rest.

### 3.2 App components — the load-bearing ones

**ProfileCard** — *one component, three variants* (CLAUDE.md convention):
- `grid` — the default. Portrait media (`aspect-[3/4]`), name · age · city,
  verified tick, presence dot, price-from, favorite heart. OpenSea-grade
  uniformity: identical dimensions, quiet hover (`scale-[1.01]` + `shadow-md`),
  crimson only on the heart-active + verified.
- `featured` — Airbnb featured card (Image #5): inline **PhotoCarousel** with
  dots + prev/next, corner badge ("Featured"/"Verified"), heart, info beside
  (desktop) or below (mobile). Used in the home "featured" rail and top-of-city.
- `compact` — horizontal row (thumb + text) for favorites, search suggestions,
  "similar profiles."

All three read the **same data shape** and honor **safe mode** (§6) for every
image. This component is the backbone of the whole site — build it first, well.

**PhotoGallery** (profile page, Airbnb Image #1) — desktop: one large hero +
2×2 grid, rounded-2xl, "Show all photos" glass button bottom-right. Mobile:
full-bleed swipeable carousel with dot indicator + count pill. Fixed aspect
ratios → CLS 0. Blur-placeholder → sharp (Cloudflare Images variants). Safe
mode swaps every frame.

**ContactCard** (profile page, Airbnb reserve card, Image #2) — sticky glass
card, desktop right column: presence ("Online now" / "last seen"), rate table
(from `RATE_DURATIONS`), primary CTA to reveal contact (phone/WhatsApp/Telegram
/Signal behind **Turnstile**), amenities/availability summary, quiet "Report"
link. Mobile: collapses into a **sticky bottom glass action bar** with the
primary CTA + price.

**Search affordance** — REMOVED (2026-08-02, with the AI search): browsing runs
on the category pills, the header city control and the filter sheet; the
header search icon is the mobile entry to the filter sheet.

**FilterRail / FilterSheet** (OpenSea Image #8) — desktop left rail, mobile
bottom sheet. Grouped, collapsible, quiet. Quick-filter chips above the grid
(services, verified-only, online-now, incall/outcall). Sort dropdown
(`SORT_OPTIONS`). Filter changes → canonical URL, never a query-string mess in
the UI.

**Header / Nav** (§4). **BottomTabBar** (§4). **ThemeToggle** (exists).
**SafeModeToggle** (§6). **PresenceBadge**, **VerifiedBadge**, **PriceTag**,
**ServiceTagList** (chips from taxonomy), **CityTicker** (the scrolling city
strip from intimate.nl, done cleanly), **SpaceCard/Post** (community feed),
**Toast** (realtime "new in Amsterdam").

Anything not in this list gets designed *into* the library before it ships.

---

## 4. Navigation

### Desktop header (Airbnb Image #3 + Purple Fly Image #4)
A single glass bar (`GlassBar`, sticky, `rounded-b-2xl` or full-width hairline):
- **Left:** wordmark.
- **Center:** (empty — search lives in the category row + filter sheet).
- **Right:** icon cluster — theme toggle, language (nl/en/de), Favorites,
  Account/avatar, and a solid crimson **Adverteren** CTA.
Quiet, translucent, blurs the content scrolling under it. Purple Fly's density
without its noise.

### Mobile
- **Top:** minimal glass bar — wordmark + search icon (opens the filter
  sheet). Nothing else up top.
- **Bottom:** `BottomTabBar` — glass, `backdrop-blur`, safe-area inset,
  **role-driven tab sets** (matrix: MESSAGING.md §10; visitor default
  **Search · Favorites · Account**, max 4 ever per MOBILE.md §2). Active tab =
  crimson icon + label. iOS-style: floats over content, translucent, never a
  hard opaque slab.

View transitions make the bottom bar persist across navigation (no flash), and
card→profile uses a shared-element morph.

---

## 5. Glass / material system (iOS 26)

The signature. Four materials, each a `--glass-*` token + `backdrop-blur`:

| Material | Token | Blur | Where |
|---|---|---|---|
| Ultra-thin | `--glass-ultrathin` | `blur-sm` | overlays on photos (badges, gallery buttons, count pills) |
| Thin | `--glass-thin` | `blur-md` | bottom tab bar, sticky mobile action bar |
| Regular | `--glass-regular` | `blur-lg` | header, sheets, sticky ContactCard |
| (opaque) | `--background` | — | resting content cards (glass is for *floating* chrome only) |

`GlassBar` component = `bg-[--glass-regular] backdrop-blur-lg border-[--glass-border]`
with a subtle top highlight. Rules:
- Glass is for **floating/sticky chrome over content**, never for resting cards
  (those are opaque — legibility first).
- Always a `--glass-border` hairline so edges read on both themes.
- Respect `prefers-reduced-transparency` → fall back to near-opaque token.
- Test legibility over both light and dark photography (profile pages are
  photo-heavy) — text on glass always gets a solid-enough backing.

---

## 6. Safe mode (privacy feature)

**What:** a control so anyone can browse/work in public without explicit
imagery on screen. **Three-valued** (Phase 5 — the discretion kit):
- **`neutral`** — muted, abstract gallery-wall placeholders. **The default for
  visitors**; a wall of these draws no glance. Generated deterministically as
  inline SVG data-URIs in `safe-images.ts` (`neutralImageFor`) — no files, no
  test drift.
- **`dev`** — the anime set from `public/safeimg/` (`safeImageFor`): the
  operator's build-in-public skin (local dev defaults here).
- **`off`** — real photos (deliberate opt-in).

Text is unaffected. Cookie `safe_mode` = `off | neutral | dev` (legacy `on` →
`neutral`). The toggle **cycles** off → neutral → dev; the boss key (Esc·Esc,
desktop) flips off↔neutral instantly.

**Reach (Phase 5.2):** the primary control is the floating glass **SafeModeBar**
(`molecules/SafeModeBar`) — a mobile pill above the tab dock, a desktop corner
button — so the panic switch is one thumb away on every screen. The footer +
Account settings keep a mirror `SafeModeToggle`.

**Neutral tab chrome (Phase 5.3):** while safe mode is on (neutral or dev) the
tab `<title>` goes generic and the favicon goes monochrome; both restore when
off. Part of the glance test.

**Design decisions:**
- **Deterministic, not random-per-render.** Pick the safe image by hashing a
  stable key (profile id / media id) modulo the `safeimg` file list. Same
  profile → same placeholder every time. This keeps SSR + edge cache clean, kills
  layout shift, and looks intentional rather than glitchy. (The requirement said
  "random"; deterministic-per-profile *is* the shuffled-looking result without
  the cache/CLS cost. Flag if you want true per-load randomness instead.)
- **Cache-safe & no-JS-safe.** Public HTML is edge-cached and identical for
  everyone, so safe mode can't be baked per-request into the cached page.
  Approach: `SafeImage` renders the **neutral placeholder as the default
  `src`**, carrying `data-dev` (anime) and `data-real` (photo) alongside. A
  tiny inline script (runs before paint, like the theme script) reads the
  `safe_mode` cookie and swaps to the requested skin. Result: default state,
  uncached responses, and no-JS all show the neutral set — **fail-closed**,
  which is the correct posture for this feature.
- **One image component owns it.** A single `SafeImage` (Astro atom) enforces
  the swap, the aspect ratio, the blur placeholder, and the Cloudflare Images
  variant. Nothing renders a profile photo except through it — same discipline
  as everything else here.
- The controls set the cookie (1yr) + flip images live (optimistic, no reload),
  and respect a first-visit default of `neutral`.

`ponytail:` fail-closed default + deterministic pick; revisit only if the
operator explicitly wants per-load shuffling.

---

## 7. Imagery

- All photos via **Cloudflare Images** (hard rule 2), EXIF stripped.
  Variants: `card` (portrait 3:4), `thumb`, `full`, `blur` (LQIP placeholder).
- Fixed `width`/`height` or `aspect-ratio` on every image → **CLS 0**.
- Blur placeholder → sharp; lazy-load below the fold; `fetchpriority=high` on
  the profile hero + first row of cards.
- Card media aspect `3:4`; gallery hero `4:3`/`16:10`; avatars square→circle.
- Safe-mode placeholders (`public/safeimg/`) served as static assets, same
  aspect handling so ON/OFF never shifts layout.

---

## 8. Motion

- **View Transitions** on all navigation; card→profile shared-element morph;
  persistent bottom bar/header.
- iOS spring easing for sheets/toggles (`cubic-bezier(0.2, 0.8, 0.2, 1)`),
  ~200–300ms. Fast and physical, never decorative slowness.
- **Optimistic UI** on every action (favorite, safe-mode, pause) — instant,
  reconcile after.
- Skeletons only for genuinely async islands, never for SSR content.
- Honor `prefers-reduced-motion` (kill morphs/springs) and
  `prefers-reduced-transparency` (kill glass).

---

## 9. Accessibility & themes

- Both themes first-class; system default; one-tap toggle; persisted; no-flash
  inline script (already in `Layout.astro`). Much traffic is at night → dark is
  not an afterthought.
- Contrast: body text ≥ 4.5:1 on **both** themes and over glass.
- Touch targets ≥ 44px; visible focus rings (`--ring`); full keyboard paths;
  honest labels/ARIA; forms with real `<label>`s.
- Every data point is server-rendered HTML text (SEO + a11y), never image-only.

---

## 10. Build order

1. **Token layer** — apply §2 to `global.css` (crimson, radius, `--glass-*`),
   preload the one variable font. Nothing else starts until this is in.
2. **Primitives** — Button, Card, Badge, Avatar, GlassBar, Sheet, Tabs
   from Fulldev/shadcn, retuned to tokens. (Tags/chips are NOT a component —
   they're the condensed-slab / keyline text treatments, Misprint rule 2.)
3. **ProfileImage** + **safe mode** plumbing (§6) — before any card/gallery, so
   the privacy default exists from the first image rendered.
4. **ProfileCard** (all three variants) + **PhotoCarousel**.
5. **Header + BottomTabBar + footer (SafeModeToggle)**.
6. **PhotoGallery + ContactCard** (profile page shell — no data yet).
7. **FilterRail/Sheet** + listing grid.

Each step ends with the component in a `/kitchen-sink` (dev-only) route showing
every variant in both themes + safe mode on/off. That page **is** the
consistency contract: if two components disagree on spacing or radius there,
they're wrong, not the page.

---

## 11. Consistency rules (the whole point)

1. No hardcoded color/space/radius outside the token layer. Ever.
2. No component built on a page — build it in the library, use it on the page.
3. One accent (crimson). One font. One spacing scale. One radius scale.
4. Glass floats; content is opaque.
5. Every profile image goes through `<ProfileImage>` (safe-mode + CLS + variants).
6. If the kitchen-sink can't render it in both themes with safe mode toggled,
   it's not done.
