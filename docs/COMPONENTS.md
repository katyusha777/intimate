# Component Architecture — Atomic

How components are sourced, organized, named, and wired. Companion to
`DESIGN.md` (how things look). **Read before creating or moving any
component.** Enforced by `tests/architecture.test.ts` — break the rules and
`bun test` fails.

---

## 1. Levels

```
src/components/
├─ ui/          # VENDOR — Fulldev/shadcn CLI output. Never hand-edited
│               # (token alignment only), importable ONLY from atoms/.
├─ atoms/       # one UI element, zero domain knowledge
├─ molecules/   # 2+ atoms composed into one control; still domain-agnostic
└─ organisms/   # domain-aware sections, grouped in domain subfolders
    ├─ layout/  ├─ profile/  ├─ auth/  └─ <new domain>/
```

Templates = `src/layouts/` (chrome + global scripts + slots).
Pages = `src/pages/` (compose organisms; own no reusable markup).

**Level definitions:**
- **Atom** — renders essentially one element; knows nothing about profiles,
  search, or auth. Two kinds:
  - *wrappers* over `ui/` (Button — THE three button types, flat + skews, no
    radii: `default` = the internal AnaglyphButton slab (DESIGN.md §3.1),
    `secondary` = the same cut slab without the pink/cyan layers (AnaglyphButton
    `plain`), `tertiary` = flat foreground outline (white on dark / black on
    light) — Input, Select, Badge, Avatar, Switch, Skeleton) — the app-facing
    API. **Swapping the UI library = re-implementing these files; nothing above
    atoms changes.**
  - *own primitives*: Icon (Font Awesome abstraction — icon lib swap is this
    one file), SafeImage (safe-mode image contract), VerifiedBadge.
- **Molecule** — a self-contained control from atoms + markup, reusable in any
  domain: Modal, ActionSheet, Lightbox, PhotoCarousel,
  Combobox, SlabField, FavoritesController, UserMenu,
  ThemeToggle (sun/moon switch, dark is the site default),
  SafeModeToggle (three-state safe-mode control — labelled switch in the
  footer only; no floating bar, not in the header),
  Section (owns page rhythm + section headings),
  AvailabilityLine (dot + text availability, card/line variants),
  CitySheet (first-visit city picker).
- **Organism** — takes domain data (profile, article, auth state) and composes
  atoms/molecules into a section: ProfileCard, AuthModal, Header, Footer.
  Lives in a domain subfolder; a new folder is created with the domain's first
  organism.

## 2. Import rules (tested)

1. **Strictly downward:** `pages/layouts → organisms → molecules → atoms → ui`.
2. `components/ui/*` importable **only from `atoms/`**. Everywhere else uses
   the atom wrappers — never `@/components/ui/...`.
3. Organisms import organisms **within their own domain folder only**; if two
   domains need it, it's a molecule/atom — promote it.
4. **No loose files in `src/components/` root.**
5. Cross-folder imports always via the `@/` alias (keeps rules greppable).

## 3. Source ladder — where a component comes from

1. **Fulldev component** — `bunx shadcn@latest add @fulldev/<name>` (or the
   shadcn MCP). Lands in `ui/`; wrap it in an atom before use.
2. **Fulldev block** (`ui.full.dev/blocks.md`) — adapt into an organism; never
   used raw.
3. **Compose** existing atoms/molecules.
4. **Write new** — at the lowest level that fits its knowledge (domain
   knowledge → organism; generic control → molecule; single element → atom).

## 4. Domain map (built ✓ · anticipated —)

Folders appear when their first organism lands:

| Domain | Organisms |
|---|---|
| `profile/` | ✓ ProfileCard, ProfileDetail, ProfileHero, ProfileGallery, ProfilePhotoMosaic, ProfileSheet, ProfileFacts (the deal card), RatesTable, GoodToKnow, SimilarProfiles, ReceiptSheet (the trust receipt of dated verification facts opened by any verified mark), RequestSheet (the flagship three-tap pre-qualified request opened by the deal card's SEND MESSAGE), ReportControl — anticipated: ContactCard |
| `search/` | ✓ SearchListing, FilterSidebar |
| `auth/` | ✓ AuthModal — anticipated: PasswordReset, OtpForm |
| `dashboard/` | ✓ AccountShell, SignInPrompt, ProfileEditorForm, MediaManager, VerificationFlow — anticipated: ImportWizard steps, StatsTiles |
| `messaging/` | ✓ Inbox, Thread, RequestCard (the request card + Accept/Decline in the thread), ContactList (MESSAGING.md §2 for the rest) |
| `layout/` | ✓ Header, Footer, BottomTabBar |
| `admin/` | ✓ AdminShell, QueueList, DocViewer — ModerationQueue, ReportQueue, AuditLogTable (ADMIN.md §2) |
| `contacts/` | — ContactDetail (MESSAGING.md) |
| `call/` | — CallWindow (React island), IncomingCallToast, CallControls |
| `marketing/` | — Hero, CTABanner, CityTicker, ArticleRail |
| realtime (molecules) | — OnlineBadge, LiveCounter, NewProfilesToast |
| feedback (molecules) | — Toast, EmptyState, ConfirmDialog, Pagination |

## 5. Naming & API conventions

- `PascalCase.astro`, one component per file.
- **Variants are props, not file forks** (`ProfileCard variant="grid|featured|compact"`).
- Props: typed `interface Props`; accept `class`, merge via `cn()`/`class:list`.
- **No hardcoded UI strings** — Paraglide `m.*`; taxonomy labels via
  `src/lib/labels.ts` (taxonomy = law).
- Icons through `atoms/Icon.astro` (`<Icon name="heart" />`); no raw
  `<i class="fa-…">` or inline SVGs in new code.

## 6. Interactivity policy (zero-JS default)

1. **None** — SSR + CSS. The default.
2. **Vanilla `<script>`** in the component: init on load **and**
   `astro:page-load`, guard re-init with a `dataset` flag, prefer delegation on
   `data-*` hooks (`data-modal-open`, `data-safe-toggle` are precedents).
3. **React island** (`client:*`) only for genuinely stateful UI, colocated in
   its domain folder as `.tsx`. Budget: < 50 KB JS per public page.

## 7. Non-negotiable contracts

- **All sensitive imagery renders through `atoms/SafeImage`** (fail-closed
  safe mode, deterministic placeholder, CLS-zero); videos via the
  `data-safe-video-wrap` pattern. No exceptions.
- **Kitchen sink is the merge gate:** every new component/variant appears on
  `/kitchen-sink` in the same change — light + dark + safe mode on/off.
- Overlays on photos: `.glass-media`; floating chrome: `.glass*`; resting
  surfaces opaque. All colors/spacing/radii from tokens.

## 8. Checklist before adding a component

1. Fulldev has it? → install into `ui/`, wrap in an atom.
2. An existing component does 80%? → add a variant prop.
3. Which level does it belong to? (What does it *know*?)
4. Strings via `m.*`, taxonomy via `labels.ts`, imagery via `SafeImage`,
   icons via `Icon`?
5. JS: none → vanilla pattern → island, in that order.
6. On `/kitchen-sink`, both themes + safe mode checked?
7. Spacing/type from the scale + role utilities (`.display`, `.eyebrow`,
   `text-2xs`) — arbitrary bracket values fail `tests/style.test.ts`; new
   needs become tokens in `global.css`, never inline values.
8. `bun test` green (architecture + style rules are tested).

## Appendix — later additions (append-only)

- **AI search removed** (2026-08-02): WandSheet, AiSearchInput and the
  `aiSearch` action are gone — too slow to be the search affordance. The
  Header's mobile search icon opens the listing's `filters-sheet` when present
  and falls back to a plain link to `/search/` elsewhere.
- **SAVED-compare rail** (UX-PLAN 6.2): NOT a new component — a desktop-only,
  collapsible row inside `organisms/search/SearchListing`, in the
  results column directly above the cards, that reveals saved profiles
  (localStorage `intimate_favs`, synced by `FavoritesController`) as
  `ProfileCard variant="mini"` (small square cards). Pool passed from the page
  via `buildListing().savedPool`.
- **Clean filter chips** (`.filter-chip` / `.filter-chip__box` tokens in
  `global.css`): the listing quick filters. Full even keyline border, FLAT
  corners (the button family carries no radii), an obvious mini-checkbox —
  replaced the old `.slab-cut` chips
  that read as noise. SELECTED = ink-fill + a slight `skewX` shear (suppressed
  under `prefers-reduced-motion`), driven by CSS `.peer:checked + .filter-chip`
  (the input is a sibling `peer sr-only`). Used in `SearchListing` and shown on
  `/kitchen-sink`. The FilterSidebar service/city rows keep the plain `.cbx-box`
  print checkbox (already clean).
- **Mobile filter sheet**: `SearchListing` renders the FilterSidebar TWICE —
  once as the desktop `data-filters-desktop` sidebar (`hidden lg:block`), once
  inside an `ActionSheet id="filters-sheet"` (`data-filters-mobile`, `lg:hidden`)
  opened by the mobile Filters button (`data-sheet-open`). Only the visible set
  submits (the hidden set's inputs are `disabled` per viewport, same trick as
  the gender dupe). Sheet filters DON'T auto-navigate — the user picks freely
  and taps "Show results" (a real submit); visit-nav tab switches still
  navigate immediately. This replaced the inline `<details>` panel that hijacked
  page scroll on mobile.
- **SearchControl removed** (2026-08-02): the home search bar was deleted with
  the AI search — browsing runs on the category pills, the city control and
  the filter sheet; the header search icon is the mobile entry.
- **Home stays national**: the `/{locale}/` middleware no longer 302s to the
  saved city. The `city` cookie is surfaced client-side on the fold as a
  one-tap "Back to <city>" chip (`[data-city-pref]`), keeping the home a single
  cached page.
