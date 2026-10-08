# The depot shell (as built)

Three places sell, store and service vehicles: the truck depot ([truck-depot.js](../../client/game/js/panels/truck-depot.js)), the marina ([marina-panel.js](../../client/game/js/panels/marina-panel.js)) and the hangar ([hangar-bay.js](../../client/game/js/panels/hangar-bay.js)). They share one shell, [depot-shell.js](../../client/game/js/panels/depot-shell.js), so they look and work the same. What is inside a tab (a truck's dials, a boat's swatches, an aircraft's colour wheel) stays in the depot's own file.

## The two screens

- **The counter**, in the room pane (`.ds-counter`). The head is the place, the screens, the balance, ⊟ (hide the log), ⛶ (fullscreen) and ✕. Under it, your vehicles as a hand of cards ([vehicle-card.js](../../client/game/js/panels/vehicle-card.js)), then a card to buy and a card to hire. **A card seats you in the vehicle**: `drive <id>`, `boat take <id>`, `hangaract service <id>`. A pilot without a licence can't take the seat, so for them the hangar's card opens the bench in the pane.
- **The bay**, an overlay on the seat's own glass while the vehicle stands in the real shed (`.ds-bay`): the place and the balance, the way out (**Drive out**, **Cast off**, **Taxi out**), the job tiles, and the tile's page. Folded, it is one chip in the corner. The server decides when it is up: `pushBayService` (trucking), `svcTick` (powerboat) and `servicedCraft` (flight) send the depot's payload with `service` set.

## The rules every depot keeps

- **Every button is a verb a player could type.** A key carries `data-cmd` with the exact command. The log rung is the same verbs without the panel.
- **What can't be undone is held.** Selling, handing a hire back and a tow bill carry `data-hold`, and `armHolds` turns them into `holdToConfirm` keys ([confirm.js](../../client/game/js/panels/confirm.js)). A screen reader's click arms the key and a second click fires it.
- **One money format**: `money()`, the glyph first, `₵1,234`.
- **The view toggles are body classes** `ds-fullscreen` and `ds-hidepanel`, styled in [styles.css](../../client/game/styles.css). `clearViewModes()` drops both when a counter closes, or the room look that follows has no log.
- **The client computes nothing a verb charges.** The one thing the shell derives is that a push carries fewer credits than the last, which is a purchase.

## The job tiles

`jobsHtml` draws a tab as a tile with an icon, a name and one line saying what is waiting behind it: `2 due`, `unsaved`, `3 of 8`. The tone is `ok`, `warn`, `bad`, or `hot` for something unsaved on the bench. Each depot's `jobState` (truck, marina) or `benchParts` (hangar) works the line out from the facts the tab itself draws.

## The garage feel

- **The camera follows the tab.** [camera-tween.js](../../client/game/js/panels/camera-tween.js) holds the named shots (`quarter`, `side`, `rear`, `front`, `low`, `high`) and eases the chase camera between them. Each seat exposes the move as `cabFrame`, `boatFrame` and `cockpitFrame`. The camera only moves on a change of tab, so a re-push after a purchase leaves it where the player put it, and a drag or a wheel mid-move takes the camera back.
- **The bars show a change before it is bought.** `statsHtml(rows, now, prev)` draws what a change adds in green and what it costs as a red ghost. The truck's kits tab previews the kit under the pointer (`kitStats`); its tuning tab moves the bars with the sliders (`tuneEnds`, interpolated, corrected by the push after a commit). The marina's dealer bars come from the hull's own physics in flight-model.js `TYPES`. The hangar keeps its radar and dial bars.
- **The purchase moment.** `notePush(root, before, after)` compares each push's credits with the last. A drop plays the `ui-purchase` cue ([sfx-catalog.js](../../client/shared/sfx-catalog.js)), sweeps a sheen across the panel, stamps the price over it with the label of the key that was pressed (`noteAct`), and counts the balance down.
- **The engine revs.** `cabRev` and `boatRev` blip the engine's voice for the ear only; the sim's rpm is untouched. The truck revs when you open its tuning tab and when a kit or a tune goes on; the boat revs as she pulls into the slot. Neither does anything with the engine off.
- **The room has a sound.** [garage-ambience.js](../../client/game/js/panels/garage-ambience.js) plays one bed while a bay is up, on the ambient bus: the truck shed (compressor hum, an impact wrench, spanners), the covered slip (water on the hull, a line taking up) and the hangar. The fuel float and a field without a hangar get none.

## Adding a depot

Build its counter with `headHtml` inside a `.ds-root.ds-counter`, and its bay with `mountBay`, `setBayOpen` and `bayHtml` in the seat's service host. Route clicks through `shellClick` first, call `armHolds` after each render, `noteAct` before sending a verb, and `notePush` with the old and new credits when a push lands. If the seat has a chase camera, give it a `…Frame(shot)` that calls `tweenOrbit`.
