# Design System

The visual + component foundation for Intimate. This is **priority 3** in the
Foundation (`PLAN.md`) but it is the layer the user actually feels, and its one
non-negotiable is **cohesion**: every screen is assembled from the same small
set of components, on the same spacing scale, with the same materials. If a
screen needs something the library doesn't have, we add it to the library — we
never one-off it.

Companion to `PLAN.md` (the what) and `taxonomy.ts` (the vocabulary). This is
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

### 2.2 Radius

iOS-generous. Fulldev ships `--radius: 0.625rem`; we scale up for cards/sheets.

```css
--radius: 0.75rem;      /* 12px base (inputs, small controls) */
```
| Token | px | Use |
|---|---|---|
| `rounded-md` (`--radius`) | 12 | inputs, chips, small buttons |
| `rounded-lg` | 16 | buttons, list rows |
| `rounded-xl` | 20 | cards, tiles |
| `rounded-2xl` | 28 | sheets, modals, hero media, glass bars |
| `rounded-full` | — | pills, avatars, icon buttons, tabs |

### 2.3 Spacing

Tailwind's 4px scale, used **semantically and without exception** — the cure
for the WordPress drift:

- Component inner padding: `4` (16px) mobile, `6` (24px) desktop.
- Gap between cards in a grid: `4` (16px).
- Section vertical rhythm: `12`/`16` (48/64px) mobile, `20`/`24` desktop.
- Page gutter: `4` (16px) mobile, `6`–`8` desktop, content max-width `max-w-7xl`.
- Touch targets ≥ 44px (iOS). Stack spacing inside a card: `2`–`3`.

### 2.4 Typography

**One variable font** (perf budget: one font, `font-display: optional`,
preloaded). A grotesk with a wide weight range (e.g. Geist / Inter / Hanken) —
display feel comes from **weight + tracking + uppercase**, not a second family.
The intimate.nl "big bold uppercase headline with a crimson period" is a
utility class, not a font.

| Role | Spec |
|---|---|
| Display (hero) | `text-4xl`→`text-6xl`, `font-bold`, `tracking-tight`, optional `uppercase` + crimson `.` |
| H1 / page title | `text-2xl`–`text-3xl` `font-semibold tracking-tight` |
| H2 / section | `text-xl font-semibold` |
| Eyebrow | `text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground` |
| Body | `text-base leading-relaxed` (`text-sm` in dense chrome) |
| Meta / caption | `text-sm text-muted-foreground` |

Helper: `.display` = uppercase + tight tracking + trailing crimson period via
`::after`. One class, brand-consistent everywhere.

### 2.5 Elevation

iOS 26 leans on **translucency + light**, not Material drop shadows. Use glass
(§5) for floating chrome; reserve real shadows for resting cards only:
`shadow-sm` at rest, `shadow-md` on hover. No shadow deeper than `md` anywhere.

---

## 3. Component library

Closed set. Astro components for anything static (zero JS); **React islands**
(shadcn/ui) only where interaction is real. Fulldev blocks/components are the
base; `npx shadcn@latest add @fulldev/<item>`.

Structure: `src/components/ui/` (primitives, mostly Fulldev/shadcn) ·
`src/components/` (composed app components) · `src/layouts/`.

### 3.1 Primitives (`ui/`)
Button (solid/gradient · outline · ghost · pill · icon), Input, Select, Badge,
Chip/Tag, Avatar (with verified tick + presence dot), Card, Sheet (bottom on
mobile), Dialog, Dropdown, Tabs, Tooltip, Toast, Skeleton, Switch, Segmented
control, GlassBar (§5), Icon (lucide). All theme-aware, all on the token scale.

### 3.2 App components — the load-bearing ones

**ProfileCard** — *one component, three variants* (per PLAN):
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

**SearchControl** (Airbnb Image #3) — the one clean search affordance. Segmented
pill: **City · Availability · Filters**. Desktop: inline in the header, expands
to a popover. Mobile: a single pill that opens a full sheet. Nothing else
competes with it.

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
- **Center:** `SearchControl` — City · Availability · Filters. The one control.
- **Right:** icon cluster — theme toggle, language (nl/en/de), Favorites,
  Account/avatar, and a solid crimson **Adverteren** CTA.
Quiet, translucent, blurs the content scrolling under it. Purple Fly's density
without its noise.

### Mobile
- **Top:** minimal glass bar — wordmark + search icon (opens SearchControl
  sheet). Nothing else up top.
- **Bottom:** `BottomTabBar` (exists in `Layout.astro`, to be upgraded) — glass,
  `backdrop-blur`, safe-area inset, 3 tabs per PLAN: **Search · Favorites ·
  Account**. Active tab = crimson icon + label. iOS-style: floats over content,
  translucent, never a hard opaque slab. (Spaces can graduate to a 4th tab if it
  earns its place.)

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

**What:** a toggle so the operator can browse/work in public without explicit
imagery on screen. When **ON**, every profile/card/gallery image renders a
neutral placeholder from `public/safeimg/` instead of the real photo. Text is
unaffected.

**Default: ON.** Toggle lives in the **footer** (and mirrored in Account
settings). Off is a deliberate opt-in.

**Design decisions:**
- **Deterministic, not random-per-render.** Pick the safe image by hashing a
  stable key (profile id / media id) modulo the `safeimg` file list. Same
  profile → same placeholder every time. This keeps SSR + edge cache clean, kills
  layout shift, and looks intentional rather than glitchy. (The requirement said
  "random"; deterministic-per-profile *is* the shuffled-looking result without
  the cache/CLS cost. Flag if you want true per-load randomness instead.)
- **Cache-safe & no-JS-safe.** Public HTML is edge-cached and identical for
  everyone, so safe mode can't be baked per-request into the cached page.
  Approach: the image component renders the **safe placeholder as the default
  `src`**, carrying the real URL in `data-real-src`. A tiny inline script
  (runs before paint, like the theme script) reads the `safe_mode` cookie and,
  only when it's OFF, swaps to the real source. Result: default state, uncached
  responses, and no-JS all show safe images — **fail-closed**, which is the
  correct posture for this feature.
- **One image component owns it.** A single `<ProfileImage>` (Astro) enforces
  the swap, the aspect ratio, the blur placeholder, and the Cloudflare Images
  variant. Nothing renders a profile photo except through it — same discipline
  as everything else here.
- Toggle sets the cookie (1yr) + flips images live (optimistic, no reload).
  Also respects a first-visit default of ON.

`ponytail:` fail-closed default + deterministic pick; revisit only if the
operator explicitly wants per-load shuffling.

---

## 7. Imagery

- All photos via **Cloudflare Images** (PLAN non-negotiable), EXIF stripped.
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
2. **Primitives** — Button, Card, Badge, Avatar, Chip, GlassBar, Sheet, Tabs
   from Fulldev/shadcn, retuned to tokens.
3. **ProfileImage** + **safe mode** plumbing (§6) — before any card/gallery, so
   the privacy default exists from the first image rendered.
4. **ProfileCard** (all three variants) + **PhotoCarousel**.
5. **Header + SearchControl + BottomTabBar + footer (SafeModeToggle)**.
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
</content>
