# The depot shell (as built)

Four places sell, store and service vehicles: the truck depot ([truck-depot.js](../../client/game/js/panels/truck-depot.js)), the marina ([marina-panel.js](../../client/game/js/panels/marina-panel.js)), the hangar ([hangar-bay.js](../../client/game/js/panels/hangar-bay.js)) and the racer bay ([podracer-depot.js](../../client/game/js/panels/podracer-depot.js)). They share one shell, [depot-shell.js](../../client/game/js/panels/depot-shell.js), so they look and work the same. What is inside a tab (a truck's dials, a boat's swatches, an aircraft's colour wheel) stays in the depot's own file.

## The two screens

- **The counter**, in the room pane (`.ds-counter`). The head is the place, the screens, the balance, ⊟ (hide the log), ⛶ (fullscreen) and ✕. Under it, your vehicles as a hand of cards ([vehicle-card.js](../../client/game/js/panels/vehicle-card.js)), then a card to buy and a card to hire. **A card seats you in the vehicle**: `drive <id>`, `boat take <id>`, `hangaract service <id>`, `podracer take <id>`. A pilot without a licence can't take the seat, so for them the hangar's card opens the bench in the pane.
- **The bay**, a garage over the seat's whole glass while the vehicle stands in the real shed (`.ds-bay`, laid out by `bayHtml` as `.ds-gx`): the place, the balance and the way out (**Drive out**, **Cast off**, **Taxi out**) across the top; the job tiles as a menu down the left, with `side` under them (the racer's figures); the vehicle in a clear stage in the middle with its `name` cut into the floor; the tile's page in a column on the right, with its `till` (the bill and the key that pays it) pinned under it; the camera's keys along the bottom. Folded, it is one chip in the corner. The server decides when it is up: `pushBayService` (trucking), `svcTick` (powerboat and podracer) and `servicedCraft` (flight) send the depot's payload with `service` set.
  - **Only the page scrolls.** The wheel over the glass is the chase camera's dolly. The stage takes no pointer, so a drag or a wheel over the vehicle reaches the glass. A wheel over the page column scrolls it when it has somewhere to go; anywhere else on the bay it is passed on to whatever is under it (`bayWheel`). A depot's own scroll region inside a bay page is clipped open (`overflow: clip`), so there is one scroller. The page keeps its scroll across a redraw while the same tile is lit. The bay used to float over the vehicle and scale itself down to fit, which put the racer's sixteen fitting rows at half size; nothing scales now.
  - **The vehicle is always in the middle of the glass.** The renderer centres its subject and has no lens shift, so the menu and the page are the same width either side of it, and a narrower glass narrows both. A wide page column covered the vehicle. Under 680px of glass the stage goes and the garage is one sheet up from the bottom, half the glass, with the vehicle above it. The breakpoints are container queries on the bay, not the window.
  - **The seat's chrome steps out.** The bars cover the seat's own chips and gauges; the racer hides its levers and chips outright while the bay is open (`.pod-root:has(> .ds-bay.open)` in podracer-view.js).
  - **While it's open, the shed opens up.** The roof and every wall on the camera's side come off the shed the vehicle stands in, so the chase camera shows her rather than the roof (`bayServiceUp` in windshield.js reads `.ds-bay.open`). Folded or gone, the shed is solid again.

## The rules every depot keeps

- **Every button is a verb a player could type.** A key carries `data-cmd` with the exact command. The log rung is the same verbs without the panel.
- **What can't be undone is held.** Selling, handing a hire back and a tow bill carry `data-hold`, and `armHolds` turns them into `holdToConfirm` keys ([confirm.js](../../client/game/js/panels/confirm.js)). A screen reader's click arms the key and a second click fires it.
- **One money format**: `money()`, the glyph first, `₵1,234`.
- **The view toggles are body classes** `ds-fullscreen` and `ds-hidepanel`, styled in [styles.css](../../client/game/styles.css). `clearViewModes()` drops both when a counter closes, or the room look that follows has no log.
- **The client computes nothing a verb charges.** The one thing the shell derives is that a push carries fewer credits than the last, which is a purchase.
- **A purchase ends with a way in.** A buy or a hire notes the new vehicle with `noteFreshVehicle` ([fresh-vehicle.js](../../server/engine/fresh-vehicle.js)), and the next counter push carries its id as `fresh`. The counter lands on the hand, picks out her card, and `readyHtml` puts one key over it that sends the card's own verb: **Drive it**, **Take the helm**, **Fly her**, **Climb in**. A hull that went onto a cradle gets the crane's hold instead. The push after that has no `fresh`, so the key goes. The note is RAM only and lapses after a minute, so a purchase made in text never surfaces on a later counter.

## The job tiles

`jobsHtml` draws a tab as a tile with an icon, a name and one line saying what is waiting behind it: `2 due`, `unsaved`, `3 of 8`. The tone is `ok`, `warn`, `bad`, or `hot` for something unsaved on the bench. Each depot's `jobState` (truck, marina) or `benchParts` (hangar) works the line out from the facts the tab itself draws. In the bay the tiles are the menu down the left; six or more pack tighter.

## The parts menu

`partsHtml` lays out a set of parts the way a tuning garage does: a row of groups, the open group's slots as a list saying what each has now (a slot the working kit has moved is marked), and the open slot's options as cards under it, each with its price and, if it is what's fitted, a tick. Only one slot is open at a time, so the list stays short however many parts there are. The depot keeps which group and slot are open; `shellClick` passes a click on either to `on.group` / `on.slot`, or the depot handles `data-ds-group` / `data-ds-slot` itself. What a pick does is the depot's: each option carries the depot's own `attrs` (`data-kit="engine:2"`). The racer's Fit tab and the counter's fitting shop are built on it.

## The garage feel

- **The camera follows the tab.** [camera-tween.js](../../client/game/js/panels/camera-tween.js) holds the named shots (`quarter`, `side`, `rear`, `front`, `low`, `high`) and eases the chase camera between them. Each seat exposes the move as `cabFrame`, `boatFrame`, `cockpitFrame` and `podracerFrame`. The racer's takes the near chase while the bay is open and hands back the driver's camera when it folds. The camera only moves on a change of tab, so a re-push after a purchase leaves it where the player put it, and a drag or a wheel mid-move takes the camera back.
- **The bars show a change before it is bought.** `statsHtml(rows, now, prev)` draws what a change adds in green and what it costs as a red ghost. The truck's kits tab previews the kit under the pointer (`kitStats`); its tuning tab moves the bars with the sliders (`tuneEnds`, interpolated, corrected by the push after a commit). The marina's dealer bars come from the hull's own physics in flight-model.js `TYPES`. The hangar keeps its radar and dial bars.
- **The purchase moment.** `notePush(root, before, after)` compares each push's credits with the last. A drop plays the `ui-purchase` cue ([sfx-catalog.js](../../client/shared/sfx-catalog.js)), sweeps a sheen across the panel, stamps the price over it with the label of the key that was pressed (`noteAct`), and counts the balance down.
- **The engine revs.** `cabRev` and `boatRev` blip the engine's voice for the ear only; the sim's rpm is untouched. The truck revs when you open its tuning tab and when a kit or a tune goes on; the boat revs as she pulls into the slot. Neither does anything with the engine off.
- **The room has a sound.** [garage-ambience.js](../../client/game/js/panels/garage-ambience.js) plays one bed while a bay is up, on the ambient bus: the truck shed (compressor hum, an impact wrench, spanners), the covered slip (water on the hull, a line taking up) and the hangar. The fuel float and a field without a hangar get none.

## The depot standard

Every vehicle you can own gets a depot that meets this. It was written down when the racer bay was
brought up to the other three; a fifth vehicle is held to it the same way. Each line names where the
four depots do it.

### The place

1. **The shop is a room you walk into, never a street tile.** The depot's flag goes on an interior
   zone behind a facade: `truck_depot` with its `yard`, `boat_covered` and the marina's rooms,
   `hangar_interior` with its `hangar_ramp`, `podracer_lot` on the racer bay. A shop on an open
   tile blooms its screen over the road as you cross it (systems-trucking.md, "A depot is a building
   you walk into").
2. **The vehicle comes out of the building.** A truck mounts on the shed's `vehicle_bay` facade and
   is driven out; a boat floats in the covered slot; an aircraft is in the hangar; a racer starts on
   the Deadleg's bay door. Bringing it back to that spot and stopping is how it goes back in.
3. **A ground depot keeps any ground vehicle, even one it doesn't sell.** A racer parked in a truck
   shed's door stays in that shed and comes out of it again; only the racer bay sells, services and
   paints one. The truck counter deals what other plugins keep in its shed as cards after its own
   (the `depot.parked` hook in [server.md](../server.md)), each card naming its own verb, so a depot
   needn't know what the vehicle is. A new ground vehicle answers that hook and treats every depot's
   bay room as somewhere it can park ([podracer README](../../plugins/podracer/README.md), "Any truck shed keeps one").
4. **The building is a real one.** A `building_type` with its GLASS model and its map icon made in the
   same pass, a `marker`, and lit rooms (a `power_zones` row and a light fixture for each). A depot
   that moves into an existing building, as the racer bay did into the Deadleg, inherits all of it.

### The counter

5. **Built on the shell**, in a `.ds-root.ds-counter`, with `headHtml`, `shellClick`, `armHolds`,
   `noteAct` and `notePush` (see "Adding a depot" below).
6. **Your vehicles as a hand of cards, then Buy, then Hire** ([vehicle-card.js](../../client/game/js/panels/vehicle-card.js)).
   A vehicle somewhere else is shown faded, not hidden. **A card seats you.** One you have just bought
   or hired also gets the ready key over the hand, so the till leads straight to the seat.
7. **The dealer shows the vehicle as a schematic** (`drawWireframe3D`) with its price on the buy key and
   bars from its own physics row, never a second table of figures.
8. **Opens on arrival, closes on leaving**, on `zone.entered`, and a login standing in the room deals
   it a moment later. The close is only sent to somebody who was in the depot, never on every step.
9. **Dealt again after every change.** Every verb that changes the world re-pushes the counter (or the
   bay overlay, if the player is sitting in the vehicle): `repush`, `repushMarina`,
   `pushHangarBay`, the racer's `repush`. Nothing that changes the world ends in a bare line.
10. **Never drawn over a seat.** A seat opening closes the counter, and a payload with `service` set
   only ever goes onto a seat (client/game/js/dispatch.js).

### The bay

11. **Service in the seat while the vehicle stands in the shed**, with the shell's `mountBay`,
    `bayHtml` and `setBayOpen`, a way out (**Drive out**, **Cast off**, **Taxi out**) and a way back
    in (**Put it away**, **Dock her**). Pushed on a change of state, never on every sync.
12. **A repair made while you sit in it reaches the live vehicle too**, not only the row, or the
    seat's next one-way report writes the old wear back.

### The business

13. **Buy, hire, sell, service, fuel.** A hire is one at a time on a clock, and goes back on its own
    when the clock runs out and nobody is sitting in it. Selling is held (`data-hold`).
14. **Every button is a verb a player could type**, and the counter computes no price.

### The rungs, the docs, the tests

15. **The log rung gets no screen and loses nothing.** `prefersLoggedPanels` true means print the
    same facts as text; every verb works typed.
16. **The seat has a text rung** (`textdrive.js`, `texthelm.js`, `textpilot.js`). The racer has none
    yet and refuses a text-mode player with a line saying so; that is the one open item.
17. **Docs and tests.** The plugin's README or system doc has a depot section; a new flag gets a
    [flags-keys.md](../flags-keys.md) row and a tagCatalog entry; this doc lists the depot; and the
    plugin's `regress.js` asserts the room is a room, its way out exists, the vehicle starts there,
    and the counter is dealt there and nowhere else.

| | truck depot | marina | hangar | racer bay |
|---|---|---|---|---|
| room | `truck_depot` shed | Dock Hall | `hangar_interior` | `podracer_lot` bay off the Deadleg |
| comes out | `vehicle_bay` facade | covered slot | hangar floor | Deadleg `vehicle_bay` |
| counter | truck-depot.js | marina-panel.js | hangar-bay.js | podracer-depot.js |
| bay overlay | `pushBayService` | `svcTick` | `servicedCraft` | `svcTick` (seat.js) |
| dealer | verbs | desk clerk (dialogue actions) | verbs | verbs |
| text rung | textdrive.js | texthelm.js | textpilot.js | not yet |

## Adding a depot

Build its counter with `headHtml` inside a `.ds-root.ds-counter`, and its bay with `mountBay`, `setBayOpen` and `bayHtml` in the seat's service host. Route clicks through `shellClick` first, call `armHolds` after each render, `noteAct` before sending a verb, and `notePush` with the old and new credits when a push lands. If the seat has a chase camera, give it a `…Frame(shot)` that calls `tweenOrbit`.
