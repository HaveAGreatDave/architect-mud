# Phone layout (as built)

How the player client lays itself out on a phone or tablet, and the contract an app that mounts into the room pane has to follow. The rules live in `client/game/styles.css` and `client/game/js/main.js`; this page says where and why.

## The compact flag

`html[data-density="compact"]` is the phone layout. main.js sets it for any touch device and for any window under 720px wide, and recomputes it on resize and rotation. Phone chrome keys off this flag, never off a width query: a phone held sideways is 750 to 932px wide and a width query misses it. Panel-level layout (the map, the wardrobe, a shop) may still use width queries, because that really is a question about pixels.

- `#main` is one column. `#output-container` must be `grid-column: 1` there, or the desktop's column 2 becomes an implicit track and column 1 an empty gutter (655px on an iPad in landscape).
- The root font is the screen's short side divided by 28, clamped 12 to 18px, unless the player picked a size. The short side doesn't change with rotation or a soft keyboard, so the type holds still.
- Controls that must be thumb-sized get compact rules. Where a header's height is the log's loss (the ⚙ and ⏻ buttons, dialog ✕s), the hit area grows through an invisible `::after` and the glyph doesn't.

## Portrait and landscape

Portrait stacks the header, the vitals strip, the HUD band (minimap, clock, d-pad) and then the game column.

On a short landscape screen (`orientation: landscape` and `max-height: 540px`) the vitals and the HUD move into a rail on the right, and the game gets the full height under the header. When the HUD folds away (below), the rail would be two bars in 150px of width, so the vitals go back to a strip.

## The room pane

The pane is the room: name, prose, exits and every tappable NPC and object. On a phone it starts open. Tapping the handle bar toggles it, and the choice is kept in localStorage `architect_mob_pane_open`.

## Owning the pane

Anything that mounts into `#area-content` in place of the room (a 3-D seat, a character board, the text cockpit, free look) must say so:

- `window.dispatchEvent(new Event('pane:claimed'))` when it opens.
- `window.dispatchEvent(new Event('pane:released'))` when it closes.

While the pane is claimed:

- It opens, whatever the player keeps it at.
- The soft keyboard doesn't collapse it.
- `data-pane-claimed` is set on `<html>`, which folds the HUD band away.
- On a short landscape screen the log and the smart bar step aside and the pane fills to the command line.

The last event wins. That is deliberate: several closers release without having claimed (the depot, the cockpit), so a counter would drift. Character boards don't dispatch by hand; they call `attachBoard` and `detachBoard` from `textui.js`, which also routes their tap chips (see [Building a text minigame](../systems-display-mode.md#building-a-text-minigame)).

Apps that claim today: the flight sim, the cab, the helm, the race boat, the hangar bay, the truck depot, free look, the text cockpit, every character board and the psychometry board.

## The soft keyboard

A touch device whose visual viewport shrinks by more than a quarter has its keyboard up. main.js then:

- pins the body to the visible height so the command line sits on the keyboard
- sets `data-kb="up"`, which folds the HUD band away
- collapses the room pane, unless an app owns it, and reopens it when the keyboard goes

## Doing things without typing

- The smart bar: the room's verbs, the tablet, inventory and quests.
- The d-pad, and every exit, NPC and object in the room pane.
- ↺ beside the command box: the last eight distinct commands. Tap to send again, ✎ to edit first.
- The stack dialog offers one, half and all as buttons, and doesn't raise the keyboard.
- Every character board prints its verbs as tap chips; the text cockpit has a deck of flight verbs pinned to the bottom of its panel.
- A dialogue option's stakes line shows inside the option on touch, because there is no hover to show it before the tap commits.
- The accessibility listing's options are links that work.
- Free look has a movement pad on touch. The Calibration Rig has ▲, ▼ and a hold-to-sync button.

## 3-D on a phone

See [Phones](glass-notes.md#phones-2026-09-28) in the GLASS notes: the reduced GL tier, the retry after a backgrounded tab, and the one-time offer of text views when a device can't keep up.

## Testing it

Nothing in the smoke suite runs the phone layout, because the DOM stubs answer no media query. Check it in Chromium with Playwright's device descriptors (`iPhone 13`, `iPhone 13 landscape`, `iPad (gen 7) landscape`). Two things mislead a harness:

- A tap made with `page.tap` presses and releases at once. A real one holds 80 to 300ms. Send `Input.dispatchTouchEvent` over CDP with a pause between start and end.
- Boards repaint by replacing their HTML up to 30 times a second, so a Playwright element handle can be detached before it's measured. Measure inside `page.evaluate`, and scroll with `behavior: 'instant'`, because `#output` scrolls smoothly.
