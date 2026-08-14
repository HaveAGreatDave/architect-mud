# Log-vs-Dialog Audit — surfaces that print where they should ask

**Seam:** *player decision ↔ the surface it is made on.*

**Failure mode it hides:** a command answers with a block of text in `#output` that is not a record
but an **interface** — a numbered list you are expected to answer, a shelf you are expected to buy
from, a ledger you are expected to act on. Nothing is broken and nothing errors. The cost is paid
entirely by the player who cannot see it: the text scrolls away, nothing marks it as a decision,
there is no control to focus, and a screen reader hears it as one more paragraph among the
footsteps and the weather.

This is the mirror image of the [Display Mode](../systems-display-mode.md) ladder. That ladder asks
*how much of the game should be drawn rather than written*. This audit asks the opposite question of
each individual surface: **is this text a record, or is it a control wearing a record's clothes?**

---

## The test

For each thing a command prints, ask in order:

1. **Does the next thing the player types mean something different because this was printed?**
   If yes it is *modal state* and it must have a dialog. This is the strongest signal in the audit
   and it has almost no false positives. (SIFT pickers, quantity prompts, confirmations.)
2. **Is the player expected to pick one of N?** If yes it is a list control, not prose.
3. **Does acting on it spend money, drop an item, or end a life?** Then it needs a focusable,
   labelled control, whatever else is true of it.
4. **Would deleting the text leave the player stuck?** That is `prefersTextMinigames`'s question,
   and it separates a surface you *act through* from one you only *read*.

A **no** to all four means leave it in the log. Prose, ambience, combat lines, `examine`, a balance —
these are records, and a dialog would be worse for everybody.

## The rules that go with it

- **Additive, never a move.** The text keeps printing. The ARIA contract says the record must reach
  the log at every rung; a dialog is a second surface over the same facts, never a replacement for
  them. Every finding below is "add a control", not "stop printing".
- **Every control is a command the player could have typed.** The payload ships literal verb
  strings, so the dialog holds no gameplay logic and the server cannot tell a click from typing.
  Same rule as the [preparation workspace](../proposals/preparation-workspace.md) HUD.
- **No drag-and-drop as a sole path.** A drag is unreachable by keyboard, by switch, and by voice.
  Anything draggable needs a keyboard twin that performs the same *action*, not merely the same
  selection.
- **Name the panel `*-panel` / `*-overlay` / `*-modal`, or opt in with `data-a11y-modal`.**
  [a11y-focus.js](../../client/game/js/a11y-focus.js) then traps focus and wires Escape by itself.
  A window outside that shortlist gets neither, and nothing on screen shows the difference.

---

## Findings — 2026-08-13

### Fixed in this pass

| # | Surface | What it was |
|---|---|---|
| 1 | **SIFT disambiguation picker** (~68 call sites) | `formatSelectionPage()` printed "Which one? [1]… [2]…" into the log and nowhere else, with modal state behind it. Now also `sift_select` → [panels/sift-select.js](../../client/game/js/panels/sift-select.js). The payload is stamped on the outgoing reply from ONE site (`takePendingSelection` in [sift.js](../../server/engine/sift.js), consumed in `server/index.js`) rather than at 68 call sites — the same argument as `stampToLog` beside it. |
| 2 | **`.confirm-window` × 5** | confirm / danger / prompt / select / amount matched none of the focus manager's names, so none of them trapped focus or answered Escape — including the poker bet dialog and the sign-out gate. Now opt in via `asDialog()` in [confirm.js](../../client/game/js/panels/confirm.js), pinned by `scripts/a11y/focus-smoke.mjs`. |

### Not a finding, contrary to first appearances

**`who`.** The server handler appends to the log, but `sendCmd()` in
[net.js](../../client/game/js/net.js) intercepts the word before it is ever sent and opens
[panels/who.js](../../client/game/js/panels/who.js). The server path is only reachable from places
that bypass the command box. Worth knowing before "fixing" it.

### Outstanding — browsable lists with no dialog at all

Each is log-only today and is a list control by test 2. None is urgent on its own; together they are
most of what a player does outside combat.

| Surface | Verb | Where |
|---|---|---|
| Bounty board | `bounty`, `bounties` | [plugins/bounty/index.js](../../plugins/bounty/index.js) — padded box art; add a dialog, keep the sheet |
| Job board | `gigs`, `postings` | [plugins/jobboard/index.js](../../plugins/jobboard/index.js) |
| Card collection | `cards` | [plugins/cards/index.js](../../plugins/cards/index.js) |
| Player storefront | `wares`, `stock`, `buyorders` | [plugins/storefront/index.js](../../plugins/storefront/index.js) |
| Cookbook / shopping list | `cookbook`, `recipe`, `shoplist` | [plugins/cooking/](../../plugins/cooking/) |
| Video rentals | `rentals`, `borrow` | [plugins/videostore/index.js](../../plugins/videostore/index.js) |
| Reputation | `ideologies`, `rep` | [plugins/ideologies/index.js](../../plugins/ideologies/index.js) |
| Mutations | `mutations` | [plugins/mutations/index.js](../../plugins/mutations/index.js) |
| Mastery | `mastery` | [plugins/mastery/index.js](../../plugins/mastery/index.js) |
| Insurance | `policies` | [plugins/insurance/index.js](../../plugins/insurance/index.js) |
| Accolades | `accolades` | [plugins/accolades/index.js](../../plugins/accolades/index.js) |
| Library | `library`, `books` | [plugins/library/index.js](../../plugins/library/index.js) |
| Help index | `help` | [commands/world.js](../../server/engine/commands/world.js) |
| Corp info/roster/territory | `corp info` etc. | [plugins/corps/](../../plugins/corps/) — inconsistent: `corp console` and `corp map` are panels, these are not |

**The way to close these is not fourteen panels.** It is one generic list dialog — the server sends
`{ title, rows: [{ label, detail, commands: [] }] }`, the client renders one focusable listbox —
and then one plugin at a time is converted to emit it. Same shape as the SIFT payload above.

### Outstanding — drag with no verified keyboard twin

[container.js](../../client/game/js/panels/container.js),
[loot.js](../../client/game/js/panels/loot.js) and
[wardrobe.js](../../client/game/js/panels/wardrobe.js) all set `draggable` on item cards. Each also
has click handlers, but whether the click path performs the same *move* (rather than only selecting)
has not been checked by hand. Whatever those three settle on becomes the house pattern.
[sidebar-order.js](../../client/game/js/panels/sidebar-order.js) and
[list-reorder.js](../../client/game/js/panels/list-reorder.js) are reorder-by-drag with, as far as
static reading shows, no keyboard alternative at all.

### An open design question, not a bug

`shop` at the bottom Display Mode rung deliberately drops to `renderShopText()`
([commerce/index.js](../../plugins/commerce/index.js)) instead of opening the shop panel — the
`prefersLoggedPanelsOrDefault` branch. That was written when "log rung" meant "this player wants
text". If a focus-trapped dialog is now the *more* accessible surface, that branch is inverted for
exactly the player it was written for. Decide it explicitly; don't let it drift.

---

## The reusable prompt

> Sweep every player-facing command surface for text that is a **control wearing a record's
> clothes**. For each command that returns multi-line output, apply the four tests above. Report:
> (a) surfaces that create modal state in the log — the next input means something different, and
> nothing says so; (b) surfaces that ask the player to pick one of N with no focusable control;
> (c) any panel whose class/id is outside the `a11y-focus.js` shortlist and carries no
> `data-a11y-modal`, so it silently has no focus trap and no Escape; (d) any interaction whose only
> path is a drag. For each finding say whether the fix is *add a dialog over the existing text* or
> *the text is already correct and this is prose*. Never propose removing a log line — the record
> must reach `#output` at every Display Mode rung.
