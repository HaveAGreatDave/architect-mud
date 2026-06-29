# Audit Prompt — UI / Presentation Standardization

A reusable prompt for keeping **presentation (CSS, markup, glyphs) out of the way of game-design work**.
This audit is different from the others: it's not hunting a silent runtime bug, it's enforcing a
**coding-practice standard** whose payoff is *readability and token cost*. When CSS is inlined into
`style=` attributes and `cssText` strings scattered through HTML and JS, every time an agent (or a human)
opens a file to do **game-design** work, it pays to read hundreds of lines of styling that have nothing
to do with the mechanic in hand. The styling should live in `styles.css`, where design work never has to
load it.

## The current state (why this matters here)

Measured on the game client:

- [client/game/index.html](../../client/game/index.html) — **1867 lines**, with **134 inline `style=`
  attributes**, one `<style>` block, and 3 inline `<script>` blocks — against a **4138-line**
  `client/game/styles.css` sibling that already exists for exactly this.
- [client/devpanel/index.html](../../client/devpanel/index.html) — **75 inline `style=`** attributes.
- Even logic files inline CSS: [net.js:288](../../client/game/js/net.js#L288) builds a cold-start notice
  with a 200-char `el.style.cssText = '...'` and an `innerHTML` full of inline styles.

CLAUDE.md states the client model as "**one HTML/JS file per client plus a sibling `styles.css`**." The
game client has since modularized into `client/game/js/*` — fine — but the *presentation* half of that
contract (styling belongs in `styles.css`, not inline) has eroded. This audit re-imposes it.

## The standard

1. **Visual styling lives in `styles.css`.** Use a class, not a `style=` attribute or a `cssText` string.
   The exception is a value that is *genuinely dynamic and computed at runtime* (e.g. a width set from a
   live HP percentage) — that may be set via JS `element.style.width`, but the *static* rules around it
   still belong to a class.
2. **Markup files stay readable for design.** An HTML file an agent opens to tweak a room layout, a
   panel, or copy should not force it to scroll past a wall of styling.
3. **Theme via CSS variables.** Colors come from `var(--accent)`, `var(--red)`, etc. — never hardcoded
   hex inline. (Inline `color: var(--red)` is still better as a class, but hardcoded `#d4c44a` inline is
   the worst case.)
4. **UTF-8 glyph integrity (CLAUDE.md).** Box-drawing and symbol glyphs (`₵ ⚙ ⏻ ╱ █ ☢`) must survive
   edits without mojibake (`â•±â•²`). Any tool pass over these files must preserve UTF-8-no-BOM.

## How to run

Scope to **one file or one panel at a time** (`index.html`, OR the ATM panel, OR the devpanel). This is a
mechanical, high-volume audit; a focused pass produces a clean, reviewable diff. Migrating styling is a
real code change — treat it with the same surgical discipline as any other (CLAUDE.md): move the rule,
don't redesign the look. **Verify the page looks pixel-identical after** (this is the one audit where the
preview tools earn their keep — screenshot before/after).

---

## Prompt

> You are auditing the Architect MUD **presentation layer** for inline styling that belongs in
> `styles.css`. The standard: visual styling lives in the sibling `styles.css` as classes; markup and
> logic files carry structure and behavior, not appearance. The payoff is that game-design work never
> has to read styling. Background: CLAUDE.md's client model and **UTF-8 glyph rule** (preserve box-
> drawing/symbol glyphs, never let an edit produce `â•±â•²` mojibake).
>
> Audit scope: **<NAME THE FILE OR PANEL, e.g. "client/game/index.html header + vitals bar">**. Do this:
>
> 1. **Inventory the inline styling in scope.** Find every `style="..."` attribute, every
>    `element.style.cssText = '...'`, every `innerHTML` string carrying inline styles, and every
>    hardcoded color literal (`#rrggbb`, `rgb(...)`) outside `styles.css`. List them with line numbers.
>
> 2. **Classify each.** For each inline style decide:
>    - **Static** (the same every render) → must move to a `styles.css` class. The large majority.
>    - **Dynamic** (computed from runtime state — a width, a transform from live data) → may stay in JS
>      as `element.style.<prop> = value`, but extract any *static* rules bundled with it into a class.
>    - **Toggle** (`display:none`/`block` flips) → prefer a class (`.hidden`) toggled with
>      `classList`, over writing `style.display` — but flag, don't force, if the existing pattern is
>      pervasive (consistency beats a half-migration).
>
> 3. **Propose the migration.** For each static one: name the class, give the CSS rule, and show the
>    markup/JS edit that replaces the inline style with the class. Reuse existing classes and CSS
>    variables where one already fits — don't mint a near-duplicate. Hardcoded colors become
>    `var(--token)`; if no token exists, flag it rather than inventing one silently.
>
> 4. **Preserve glyphs.** Before and after, confirm the UTF-8 glyphs in the file are byte-identical
>    (`₵ ⚙ ⏻ ╱ █ ☢` and box-drawing). If your edit tool risks re-encoding, say so and stop.
>
> 5. **Verify visually.** Use the preview tools: screenshot the page/panel before, apply the migration,
>    screenshot after, and confirm pixel-identical rendering. A styling migration that changes the look
>    is a failed migration. Report the before/after.
>
> 6. **Report**, per finding: location · static/dynamic/toggle · the class + rule it moves to · whether
>    an existing class/variable was reused · glyph integrity confirmed · visual diff result. Keep the
>    change surgical — move styling verbatim; do **not** "improve" the visual design while you're in there
>    (CLAUDE.md "Don't improve adjacent code").

---

## Standardization this audit should push toward

- **A markup file's job is structure; a CSS file's job is appearance.** After this audit, opening
  `index.html` to do game/UX work should not cost hundreds of lines of styling tokens.
- **No hardcoded colors anywhere but `styles.css` variable definitions.** Everything else references a
  `var(--token)`.
- **`classList` over `style.display` for show/hide**, applied consistently (migrate a whole pattern or
  none of it — don't leave it half-and-half).
- **Re-affirm the CLAUDE.md contract** in reality: presentation in `styles.css`, structure in the HTML,
  behavior in `js/`. If the "one HTML/JS file per client" wording in CLAUDE.md is now stale (the game
  client is a `js/` directory), note it for a doc fix — don't let the doc and the code disagree.

## Checklist (quick manual version)

- [ ] Pick one file/panel. Read it plus the sibling `styles.css`.
- [ ] List every `style=`, `cssText`, inline-styled `innerHTML`, and hardcoded color in scope.
- [ ] Classify each: static (→ class), dynamic (→ JS `.style.prop`), toggle (→ `classList`).
- [ ] Reuse existing classes/`var(--token)`s before minting new ones.
- [ ] Confirm UTF-8 glyphs survive the edit (no mojibake).
- [ ] Screenshot before/after — pixel-identical, or it's not a clean migration.
- [ ] Move styling verbatim; do not redesign the look in the same pass.
