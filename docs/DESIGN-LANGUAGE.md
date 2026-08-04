# Intimate — Design Language Brief

A **portable** design brief. Hand this whole file to a design-generating model
(or a human designer) with no access to the codebase and they can produce
screens that look like they belong to Intimate. It is distilled from the in-repo
source of truth (`DESIGN.md` + the token layer); where they ever disagree, the
repo wins.

> **What Intimate is:** a verified marketplace/directory for legal adult services
> (independent sex workers + agencies) in the Netherlands. The competitor is
> kinky.nl. The whole point is to make the incumbents feel *ancient*: ridiculously
> fast, live, app-like, clean, verified-only, discreet. It is an **editorial
> gallery**, not a sleaze-classifieds and not a sterile template.

---

## 0. The five non-negotiables

Everything below serves these. If a choice violates one, it's wrong.

1. **Mobile-first, iOS-native feel.** Design the **390×844** screen first, desktop
   second. It should feel like a native iOS 26 app, not a website: glass chrome,
   spring motion, safe-area aware, bottom tab bar, thumb-reachable.
2. **Calm, then a spark.** ~95% of every screen is quiet Swiss print. The brand
   "glitch" appears only where there is energy. If everything shouts, nothing does.
3. **One accent.** Crimson is the *only* color. It marks action, active state,
   "verified", presence, and the trailing "." — nothing else. All structure is
   monochrome (ink on paper).
4. **The language never touches people.** Glitch/skew/ink-slabs are **brand chrome
   only**. Anything that *is* a person — profile photos, names in listings — stays
   completely straight: clean card, honest photography, calm type. A chromatic
   fringe on someone's photo isn't punk, it's disrespectful.
5. **Zero layout shift (CLS = 0)** and **both themes first-class** (dark is the
   default — much traffic is at night). Every image has fixed dimensions.

---

## 1. The design language: **Misprint**

**Misprint = clean monochrome print whose ink slips when things move.** The page is
a perfectly printed poster — paper, ink, one spot color — and interaction is a
printing error: plates misregister, pink/cyan fringes appear, a sticker shivers.

Lineage (for tone, not literal copying): risograph / misregistered offset print ·
anaglyph 3D (red/cyan) · restrained glitch / chromatic aberration (à la NieR,
Cyberpunk — a *state*, not decoration) · Persona 5 punk-collage (hard-cut angled
slabs, italic condensed uppercase) · Swiss/International Style as the calm base ·
constructivist diagonal red/black/white confidence.

### The grammar — nine rules, in priority order

1. **Paper and ink.** Canvas is paper (near-white / near-black). Content surfaces
   are paper. The brand layer is ink (pure foreground). 95% of any screen is calm.
2. **Ink is binary — no grays.** Print has no gray pigment, only ink coverage.
   Text hierarchy = *ink opacity* (`foreground` at 55–85%), never a third gray tone.
   Surfaces are: paper, an **ink flip** (`bg-foreground` + `text-background`), or a
   **keyline** (thin low-opacity ink border) on bare canvas. Mid-gray *filled*
   chrome (gray pills, gray icon circles, gray panels) is the "default software"
   look we escape — **banned** in the brand layer.
3. **The slip is earned.** Pink/cyan misregistration appears **only** where there
   is energy: the primary Button (always), hover/tap motion, live/realtime moments.
   Never at rest, never on body text, never on two things in one view.
4. **Cut, not rounded — radius is binary.** Print objects are cut sharp → **square
   corners**: buttons, inputs, tags, banners, chips, active states. Paper surfaces
   that *hold* content → **soft large radius**: cards, sheets, modals, photos.
   Circles (dots, avatars, icon seals) are die-cuts, always allowed. The **banned
   middle** is 6–12px rounding on small chrome — that's the generic look. Pick one:
   sharp, or soft-large, or circle.
5. **Crimson is a mark, not a paint.** Periods, seals, dots, a heart, a wand,
   underlines — never large fills, never text blocks, never backgrounds.
6. **Speed text.** Display + action labels are Barlow Condensed, bold, UPPERCASE;
   action labels may italicize (a sportswear voice). Body stays quiet Barlow.
7. **Motion is the medium, on a budget.** The language *lives* in transitions —
   glitch shiver on click, chroma shadow on hover, view transitions — but
   **150–250ms, transform/opacity only, `prefers-reduced-motion` safe.**
8. **Mobile-first simplicity overrides all of it.** Every effect is a few lines of
   CSS — no images, no canvas, no JS animation loops. When a Misprint idea fights
   clean/fast/native on a 390px screen, **print calm wins.**
9. **The language never touches people** (see non-negotiable #4). Airbnb-calm cards
   inside a Misprint frame.

---

## 2. Color tokens

Canonical values are **OKLCH** (the repo uses them); approximate hex is given for
tools that need it. Never hardcode a color outside this palette — one accent.

### Light theme
| Token | OKLCH | ~Hex | Use |
|---|---|---|---|
| `background` | `0.975 0 0` | `#f7f7f7` | page canvas (paper) |
| `foreground` | `0.145 0 0` | `#1c1c1c` | text + ink |
| `card` | `1 0 0` | `#ffffff` | resting content surface |
| `brand` (crimson) | `0.55 0.222 25` | `#d61f35` | the one accent |
| `online` | `0.72 0.19 150` | `#22c05f` | presence "online now" |
| `border` | `0.922 0 0` | `#e5e5e5` | keylines |
| `muted-foreground` | `foreground @ 62%` | — | secondary text (ink opacity, not gray) |

### Dark theme (default)
| Token | OKLCH | ~Hex | Use |
|---|---|---|---|
| `background` | `0.145 0 0` | `#1c1c1c` | page canvas |
| `foreground` | `0.985 0 0` | `#fafafa` | text + ink |
| `card` | `0.19 0 0` | `#242424` | resting surface (a shade off canvas) |
| `popover` | `0.235 0 0` | `#2b2b2b` | sheets/menus |
| `brand` (crimson) | `0.62 0.225 22` | `#f5314a` | lifted for dark-bg contrast |
| `online` | `0.72 0.19 150` | `#22c05f` | presence |
| `border` | `0.275 0 0` | `#3a3a3a` | keylines |

### Fixed / non-theme accents
- **Anaglyph pair:** brand crimson **+ cyan `#00e5ff`** — the only place cyan appears,
  and only as a *motion*/focus fringe, never a fill.
- **Telegram brand:** `#229ed9` · **WhatsApp:** use the `online` green.
- **CTA gradient (primary button fill):** crimson→crimson, `from oklch(0.58 0.225 18)`
  `to oklch(0.52 0.223 30)` (light).

**Rule:** structural chrome is neutral (paper/ink/keyline). Crimson only for primary
action · active state · verified · presence · the trailing ".". Text hierarchy is
foreground opacity (`/55`, `/62`, `/75`, `/85`), never a picked gray.

---

## 3. Typography

**Two families, strict roles.** Static weights only (perf).

- **Barlow** — *everything*: body, labels, chips, forms. Weights 400/500/600/700
  (+ 600-italic for the action label).
- **Barlow Condensed** — *titles and names only*: display headings, page/section
  titles, profile names, category tabs. Weights 500/600/700. **Body copy never uses
  condensed.**

| Role | Spec |
|---|---|
| Display (hero) | `.display`, `text-4xl`→`text-6xl` — condensed bold UPPERCASE + trailing crimson `.` |
| H1 / page title | `.display` or condensed `text-2xl`–`3xl`, semibold, tight tracking |
| H2 / section | condensed `text-xl` semibold |
| Profile name | condensed semibold, one size up from surrounding body |
| Category tab | condensed `text-sm` bold UPPERCASE, wide tracking |
| Eyebrow (micro-label) | `text-xs` (or `text-2xs` = 11px) medium UPPERCASE, tracking `0.14em`, muted |
| Body | `text-base leading-relaxed` (`text-sm` in dense chrome) |
| Meta / caption | `text-sm` muted |

- **`.display`** = condensed + uppercase + tight tracking + a trailing crimson period
  via `::after`. It is the signature brand device — use it for hero/section titles.
- **Eyebrows** are everywhere as the quiet label above a block: uppercase, tracked,
  muted, tiny.
- **Special sizes are tokens, not arbitrary values.** The only sanctioned "small"
  is `text-2xs` (11px) and the only sanctioned wide tracking is the eyebrow's
  `0.14em`. Don't invent `13px`/`15px`/random tracking.

---

## 4. Spacing, radius, elevation

### Spacing — Tailwind's 4px scale, used semantically (this is the anti-drift cure)
- Component inner padding: **16px** mobile / **24px** desktop.
- Grid gap between cards: **16px**.
- Section vertical rhythm: **48/64px** mobile, **80/96px** desktop.
- Page gutter: **16px** mobile, **24–32px** desktop; content max-width ~**1280px**.
- Touch targets **≥ 44px**. Stack spacing inside a card: **8–12px**.
- Never hand-tune spacing per screen; the same token means the same thing everywhere.

### Radius — **binary** (grammar rule 4)
| Use | Radius |
|---|---|
| Print objects: inputs, selects, tags, chips, banners, active states, segmented controls | **square (0)** |
| Paper surfaces: cards, tiles, sheets, modals, photos/media | **soft-large (~12–16px, `rounded-xl`/`2xl`)** |
| Die-cuts: dots, avatars, icon seals, count pills | **full circle** |
| 6–12px on small chrome | **banned** |

### Elevation — light, not heavy
- Prefer **glass** (§6) for floating chrome; reserve real shadows for *resting cards*.
- Soft diffuse card shadows (the only shadows to reach for):
  - rest: `0 2px 6px rgb(0 0 0 /.03), 0 12px 32px rgb(0 0 0 /.07)` (light) — deeper in dark.
  - hover: a slightly larger soft shadow. **Nothing deeper than this.** No hard Material drop shadows.

---

## 5. The controls (how each element looks)

### The anaglyph **Button** — unique, do not replicate elsewhere
The primary CTA is the brand seal: a **skewed** face, chromatic **pink/cyan offset**
layers, **italic condensed UPPERCASE** label, square/angle-clipped corners, and a
**glitch shiver on tap**. This treatment belongs to the Button and *nothing else*.
Never apply it (or approximations — chunky rounded pills, skewed text, offset
shadows) to tabs, chips, nav, toggles.

The three-type button family:
- **Primary** — the anaglyph crimson seal (above). One per view, the main action.
- **Secondary** — a plain flat slab (ink flip or solid), square corners, no glitch.
- **Tertiary** — a quiet outline: foreground keyline, transparent fill, square
  corners; hover fills a whisper of ink; active scales to `0.98`.

### Everything that is not a Button stays flat monochrome
Active states are marked with a short **underline bar** or a plain
**foreground/background flip** — never the anaglyph at rest. Pink/cyan may appear
only as a *motion* accent (a hover/tap `text-shadow`, e.g. `-1px 0 crimson, 1px 0 #00e5ff`).

### Chips / tags (filters, services)
Not a component — a **keyline text treatment**: square, thin ink border, condensed
or plain label, optional mini-checkbox glyph for multi-select. **Selected** =
ink-fill (bg-foreground / text-background) **+ a slight `skewX(-4deg)` shear**. That
shear is the "nice selected" feel; kill it under reduced-motion.

### Inputs
- **Workaday** (filters, dashboards): plain square field, ink keyline on canvas,
  condensed label above. Straight, calm.
- **Marketing / auth** ("slab field"): a **cut ink frame around a paper face** — two
  slightly-mismatched clip-paths so the frame thickness varies like a hand-cut
  sticker; **focus = the anaglyph pink/cyan drop-shadow split** (like the Button).
  Use sparingly, on auth/hero surfaces only.

### Switch / checkbox / radio (print primitives)
- **Switch:** pill track + round thumb; **ON slides to the `online` green**.
- **Checkbox:** keyline square; checked = ink fill with a paper gap (inset ring).
- **Radio:** keyline circle; checked = ink dot (inset ring).

### Small ink slabs (hearts, carousel arrows, info slabs)
Tiny square ink chips get a **hand-cut clip** (a 3px corner shear) and a **sub-degree
tilt** (±1–2.5°), varied per item so a grid never repeats. The favorite **heart
fills crimson** when active (the tap is rewarded, not walled).

---

## 6. Glass / material system (iOS 26)

The signature for **floating/sticky chrome over content** — never for resting cards
(those stay opaque; legibility first). Four materials = a translucency token +
`backdrop-blur`, always with a hairline border so edges read on both themes:

| Material | Blur | Where |
|---|---|---|
| Ultra-thin | `blur-sm` | overlays on photos (badges, gallery buttons, count pills) |
| Thin | `blur-md` | bottom tab bar, sticky mobile action bar |
| Regular | `blur-lg` | header, sheets, sticky action cards |
| (opaque) | — | resting content cards |

- Overlays directly on photos use a fixed dark scrim + white text (theme-independent).
- Respect `prefers-reduced-transparency` → fall back to a near-opaque surface, no blur.
- Text on glass always gets enough backing to clear 4.5:1 contrast over photography.

---

## 7. Motion

- **View Transitions** on all navigation; card→profile is a **shared-element morph**;
  header + bottom bar persist across navigation (no flash).
- **iOS spring easing** for sheets/toggles: `cubic-bezier(0.2, 0.8, 0.2, 1)` (or the
  snappier `cubic-bezier(0.32, 0.72, 0, 1)` for slides), ~**200–300ms**. Fast and
  physical, never decorative slowness.
- **Optimistic UI** on every action (favorite, safe-mode, pause) — instant, reconcile
  after.
- The **button shiver** on tap is the loudest motion allowed. Chroma text-shadow on
  hover is the second.
- Skeletons only for genuinely async islands, never for content that's already there.
- Always honor `prefers-reduced-motion` (kill morphs/springs/shears) and
  `prefers-reduced-transparency` (kill glass).

---

## 8. Imagery

- **Photography-first**, but every photo has fixed `width`/`height` or `aspect-ratio`
  → CLS 0. Blur placeholder → sharp. Lazy-load below the fold.
- Aspect ratios: **card media 3:4** (portrait) · **gallery hero 4:3 / 16:10** ·
  avatars square→circle.
- Cards are OpenSea-grade uniform: identical dimensions, quiet hover
  (`scale-[1.01]` + soft shadow), crimson only on the active heart + verified tick.
- **EXIF is always stripped** (privacy — GPS leaks endanger advertisers).

---

## 9. Safe mode (a privacy feature, design it in)

A control so anyone can browse/work in public without explicit imagery on screen.
**Three-valued**, cycles `off → neutral → dev`:
- **neutral** — muted abstract gallery-wall placeholders (the **default for
  visitors**); a wall of these draws no glance.
- **dev** — a stand-in image set (operator's build-in-public skin).
- **off** — real photos (deliberate opt-in).

Text is unaffected. It **fails closed** (default + no-JS shows neutral). The primary
control is a floating glass pill (mobile) / corner button (desktop), panic-reachable
on every screen; a mirror toggle lives in the footer + account settings. While on,
the tab title goes generic and the favicon monochrome. When you design any surface
with profile imagery, assume every image can be swapped by safe mode without shifting
layout.

---

## 10. Layout patterns

**Mobile header** — minimal glass bar: a region/locale trigger left, wordmark
centered, auth/avatar right. Auto-hides on scroll-down, returns on scroll-up. A
second row carries gender radio + category tabs (condensed uppercase). The **sun/moon
theme toggle** sits in the header (left of the avatar when logged in).

**Mobile bottom tab bar** — glass, `backdrop-blur`, safe-area inset, **role-driven
tab sets** (max 4), active tab = crimson icon + label. Glued to the screen edge with
generous bottom padding (mobile Safari swallows first-taps in the bottom ~50px).

**Desktop header** — one glass bar: wordmark left, quiet center, icon cluster right
(theme, language nl/en/de, favorites, avatar, a solid crimson "Adverteren" CTA).

**Profile page** (Airbnb-listing DNA) — big confident photo gallery, two-column body
(content left, **sticky glass action/contact card** right with presence + rate table
+ a reveal-contact CTA). Mobile collapses the card into a sticky bottom glass action
bar (primary CTA + price).

**Listing grid** — uniform ProfileCards, a quiet filter rail (desktop) / bottom sheet
(mobile), quick-filter chips above the grid, calm chrome that never shouts.

**Footer** — always dark. Claim + wordmark, link columns (Information / Help / Legal),
a "Questions?" contact card, a "NOT AN ESCORT AGENCY" clarifier, a labeled **Safe
mode** row, and a bottom bar (18+ badge · copyright · Back-to-top).

---

## 11. Product honesty (design ethics — permanent)

- The **client** wants zero friction to make contact; the **professional** wants
  enough friction to filter. The best controls do both at once — convenience on one
  screen, screening on the other.
- **Only claims you can prove.** No fake liveness (an availability state is
  timestamped or it isn't shown). No fused claims ("NEW & ONLINE"). Dated proof over
  badges. **No reviews of people.** No dark patterns.
- **Discretion is a feature for both roles** — the professional's (location/identity
  never leak) and the client's (safe mode, neutral chrome, panic toggle).
- **Roles, not genders.** Copy says `client` / `professional`; never assume a gender
  for a role.

---

## 12. Do / Don't cheat-sheet

**Do**
- Keep 95% of the screen calm Swiss print; spend the crimson like it's expensive.
- Square corners on controls, soft-large on content surfaces, circles on die-cuts.
- Express hierarchy with ink opacity + Barlow Condensed titles + the `.display` period.
- Put the glitch only on the Button, on motion, and on live moments.
- Design 390px first; keep every image dimensioned (CLS 0); support both themes.

**Don't**
- ❌ Add a second accent color, or fill big areas with crimson.
- ❌ Use gray fills / gray pills / gray icon circles (the "default software" look).
- ❌ Round small chrome to 6–12px.
- ❌ Put skew, chroma fringe, or ink-slabs on a person's photo/name/card.
- ❌ Copy the anaglyph Button style onto tabs, chips, toggles, or nav.
- ❌ Use Barlow Condensed for body copy, or invent off-scale sizes/tracking.
- ❌ Use heavy Material drop shadows, or glass on resting content cards.

---

*The consistency contract: if two elements disagree on spacing, radius, weight, or
material, they're both wrong — the system is right. Every screen is assembled from
the same small set of parts, on the same scale, with the same materials.*
