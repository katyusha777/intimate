---
name: design-align
description: Measure spacing, alignment, and centering of rendered UI with real numbers via Playwright — never judge geometry from a screenshot. Use after ANY visual/layout change, when the user reports misalignment ("spacing is off", "not centered", "looks crooked"), or before claiming a layout change is verified.
---

# design-align — geometry is measured, not eyeballed

A screenshot answers "does it look broken?". It cannot answer "is it centered?"
— optical illusions, asymmetric flank widths, and 2×-scaled captures all lie.
Every alignment claim in this project is backed by `getBoundingClientRect()`
numbers from the Playwright MCP browser. No numbers → not verified.

## Procedure

1. Resize to **390×844 first** (mobile is the product), then re-run at 1280×800.
2. Navigate to the changed page on the dev server.
3. Run the audit snippet below with `mcp__playwright__browser_evaluate` against
   the changed region (e.g. `header`). It returns per-element rects + computed
   checks.
4. Judge with tolerances: **≤1px** = pass · 1–2px = subpixel, acceptable ·
   **>2px = a bug you fix now**, in the owning component (never the page).
5. Fix → re-measure → only then screenshot for the human.

## The audit snippet

```js
(sel) => {
  const root = document.querySelector(sel);
  const vw = document.documentElement.clientWidth;
  const rows = [...root.querySelectorAll(':scope > div, :scope > div > div')];
  const info = (el) => {
    const r = el.getBoundingClientRect();
    return { tag: el.tagName, cls: (el.className + '').slice(0, 60),
             x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1),
             h: +r.height.toFixed(1), cx: +(r.x + r.width / 2).toFixed(1),
             cy: +(r.y + r.height / 2).toFixed(1) };
  };
  const audit = rows.map((row) => {
    const kids = [...row.children].filter((k) => k.getBoundingClientRect().width > 0);
    const rr = row.getBoundingClientRect();
    const gaps = kids.slice(1).map((k, i) =>
      +(k.getBoundingClientRect().x - kids[i].getBoundingClientRect().right).toFixed(1));
    return {
      row: info(row),
      overflowX: row.scrollWidth - row.clientWidth,     // >0 = horizontal overflow
      kids: kids.map((k) => ({ ...info(k),
        dCenterX: +((k.getBoundingClientRect().x + k.getBoundingClientRect().width / 2) - vw / 2).toFixed(1),  // 0 = viewport-centered
        dCenterY: +((k.getBoundingClientRect().y + k.getBoundingClientRect().height / 2) - (rr.y + rr.height / 2)).toFixed(1), // 0 = vertically centered in row
      })),
      gaps,                                             // px between siblings
    };
  });
  return JSON.stringify(audit, null, 1);
}
```

Pass the selector as the argument (`browser_evaluate` element/args or wrap in
an IIFE with the selector inlined).

## What to check, per class of complaint

- **"not centered"** — `dCenterX` of the element vs the viewport (or its
  container). Also measure the **flanks**: left-group right edge → element left
  edge, vs element right edge → right-group left edge. Geometric center with
  wildly unequal breathing room reads as off-center — fix the *flanks* (move
  crowding neighbors), don't nudge the centered element off true center.
- **"spacing is off"** — `gaps` array. Sibling gaps in one row must be equal or
  from the spacing scale (4/8/12/16/20/24…). A 7px next to a 19px is a bug.
  Left padding of row N must equal left padding of row N+1 (compare first-child
  `x` across rows).
- **"looks crooked" / baseline** — `dCenterY` of every child in a row: all
  within 1px, or it's mixed line-heights/font-sizes fighting `items-center`.
- **overflow** — `overflowX > 0` on any row at 390px is a failure (unless the
  row is an intentional `overflow-x-auto` scroller — then check the *last*
  item isn't clipped mid-letter at rest… it may peek to signal scrollability).

## Optical corrections (numbers first, then eyes)

Some geometry is correct but optically wrong; only adjust AFTER true measures
pass, and note it in a comment:
- Logos/icons with asymmetric visual mass may need 1–2px optical nudge — do it
  in the logo component with a comment, never ad-hoc per page.
- Uppercase condensed type sits high in its box; `leading-none` + explicit
  vertical centering beats trusting the font's metrics.

## Rules

- Fixes land in the owning component/token (CLAUDE.md "Reuse is law") so every
  usage heals at once.
- Spacing values come ONLY from the scale — a fix that introduces `p-[13px]`
  trades one bug for another (`tests/style.test.ts` will catch it).
- Both themes: run once in dark (default), spot-check light.
- Playwright MCP only — never claude-in-chrome (owner's personal browser).
