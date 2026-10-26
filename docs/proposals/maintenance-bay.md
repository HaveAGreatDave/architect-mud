# One maintenance bay for every vehicle

**Status: phase 1 built (the cutaway and the camera, 2026-10-26); phases 2 to 5 are design.** It's
the plan for bringing the truck, boat, aircraft and racer service bays onto one screen: the same 3/4
camera, the shed's walls cut away completely while the bay is open, and one big, easy menu where
every change shows on the vehicle before you pay for it.

**What phase 1 shipped.** The shed cuts down to a capped sill with work lamps (§4.1, §4.2); both
marinas take the roof off their berth (§4.3, through `berthRoof` and `berthServiceOpen`); every
shot shares one elevation and the hangar's standoff clamp is gone (§3); the bay gate holds it
(§4.5). Not done from §3: the fitted zoom (`frameRadius`). The shots keep each seat's own resting
distance. Not done from §4.4: the neighbour check was only made in the Modelshop, not from a live
seat at every depot.

What ships today is in [depot-shell.md](../reference/depot-shell.md). Read it first; this doc only
says what changes.

## 1. Where it stands

The four bays already share a shell ([depot-shell.js](../../client/game/js/panels/depot-shell.js)):
`bayHtml` draws the head, the job rail, the clear stage and the page, and `camera-tween.js` eases the
chase camera onto named shots. What isn't shared is everything around that:

| | truck | boat | aircraft | racer |
|---|---|---|---|---|
| bay file | truck-depot.js `renderService` | marina-panel.js `drawService` | hangar-bay.js `renderService` | podracer-depot.js `drawBay` |
| jobs | Service, Tuning, Kits, Paint, Fittings, Inside, Horn & plate, Freight, Exchange | Service, Paint, Name | Repair, Fuel, Livery, Hopper, Tuning, Kits, Load | Service, Fit, Paint |
| view sync | `syncView` | `syncPreview` | `syncCockpitView` | inline in `drawBay` |
| shots | 6 shots by tab | 3 shots by tab | 5 shots, zoom forced to 0.01 in a hangar | 3 shots by tab |
| preview before buying | paint, cab trim | scheme | livery | paint, fitted kit |
| shed opens up | roof + camera-side walls | **nothing** (the covered dock's plate stays on) | roof + camera-side walls | roof + camera-side walls |

So the same idea is written four times, with four tab vocabularies, four camera tables and four
answers to "what does the vehicle look like with this on it". The parts menu (`partsHtml`) is used
by the racer only.

The cutaway is `bayServiceUp` / `bayCutaway` in windshield.js. On GL it removes the roof and only
the walls the eye is outside of (the `gone` bits), so from inside the shed every wall stays, and the
hangar clamps the camera to its standoff (`zoom: 0.01`) because a wall would otherwise be in shot.
The marina's covered dock is the waterfront arm's slab plate over the water and doesn't read the
bay state at all.

## 2. What the player gets

1. **One camera.** Every bay opens on the same elevated front-right 3/4, framed to the vehicle's
   size, so a racer and a Twin Otter both fill the stage. Jobs turn the vehicle (yaw) to the part
   they work on but never leave the 3/4 elevation: no nose-on, no top-down, no floor-level shot.
   Drag still orbits; the wheel still dollies.
2. **The shed opens completely.** While the bay is open, the building the vehicle stands in loses
   its roof and all four walls, wherever the eye is. The walls are cut at sill height with a dark
   section cap, so it reads as a cutaway drawing of the shed and not as a building that failed to
   load. The floor, its paint, the lifts, tool chests and work lamps stay. Fold the bay or roll out
   and the shed is whole again.
3. **One menu.** The same jobs, in the same order, with the same names and icons on every vehicle.
   A job the vehicle doesn't have isn't shown. The tiles are big (touch-sized, with a state line
   like `2 due` or `unsaved`), and the keyboard drives the whole thing.
4. **Every change shows on the vehicle.** Pointing at an option puts it on the vehicle and moves the
   stat bars. Buying it plays a short work beat on that part. Repair takes the wear off the model.

## 3. The camera

- Replace the per-depot shot tables with one rule in [camera-tween.js](../../client/game/js/panels/camera-tween.js):
  `SHOTS.bay = { pitch: 0.38, zoom: fit }` plus a yaw per *part area* (`front`, `flank`, `rear`,
  `top`, `inside`). `front` and `rear` are 3/4s (225 and 315 net), `flank` is 270. `top` is the
  same 3/4 with the load in view, not an overhead. Pitch stays fixed across all of them.
- **Zoom is fitted, not tabled.** Each seat already knows its subject's size (the hangar's
  standoff, the boat's hull length, the cab's chase distance). Add a `frameRadius()` to each seat so
  the bay asks for "the vehicle fills 60% of the stage" and gets the right distance on any vehicle.
- **The hangar's `zoom: 0.01` goes.** It exists because the walls were in the way. With them gone
  the eye can stand back like the other three.
- The boat's pitch clamp (0.85) already allows 0.38, so nothing changes there.
- `inside` (the truck's Inside tab, the cab trim, the aircraft's cabin livery) is the one shot that
  isn't the 3/4: it sits you in the seat, as today.
- The player's hand still wins (`tweenOrbit` stops when they drag), and the camera still moves only
  on a change of job.

## 4. The cutaway

All in GLASS 2 first; the canvas fallback can stay as it is (goals.md, GLASS 2 over GLASS 1).

1. **`drawVehicleBay`, every wall.** In service mode `gone` becomes all four sides (`15`) instead of
   the sides the eye is outside of. Walls are rebuilt to a sill (about `0.12 × WALL`) with a cap face
   in a section colour, so the footprint stays legible. `keep` fittings and ground paint are
   untouched. The shell key already includes `'s' + gone`, so the GL cache rebuilds once on open and
   once on fold. This covers the truck sheds, the hangars (`bk: 'air'`) and the racer bay, which all
   draw through this one function.
2. **Lights.** Ceiling fixtures go with the roof, so the open bay gets floor work lamps (two stands
   either side of the vehicle) drawn as `keep` fittings, lit while the bay is open. Otherwise a night
   service is a vehicle in the dark.
3. **The covered dock.** Export a small `serviceSubjectAt(dx, dy)` beside `bayServiceUp` that any
   arm can ask: "is the bay open, and is the subject on my tile?" The waterfront arm skips its plate,
   soffit and hoist spreaders when it answers yes, and keys its GL mesh on that state (the same trick
   the Coliseum roof uses). Any future depot building does the same.
4. **The neighbours.** A higher, further 3/4 can put the eye behind the next building over. Measure
   it first at every depot (truck sheds, Deadleg, the hangars, the Dock Hall). If a building is
   between eye and subject, the cheaper fix is to cap the bay's zoom at that depot, not to cut
   buildings the player isn't in.
5. **Gates.** [scripts/shapes/bay.mjs](../../scripts/shapes/bay.mjs) holds the occluder rule
   (`cut` and the occluder agree); extend it so service mode asserts every wall is gone and the sill
   remains, for both truck and air sheds. Add the waterfront arm's service state to `shapes:smoke`.

## 5. The menu

### The jobs, everywhere

| # | job | truck | boat | aircraft | racer | camera |
|---|---|---|---|---|---|---|
| 1 | **Repair** (body, hull, damage) | Service (body) | Service (hull) | Repair | Service (pod, cables, binder) | front |
| 2 | **Service** (wearing parts, fluids, fuel) | Service | Service, fuel | Fuel | Service (turbines, tank) | front |
| 3 | **Performance** (tuning, engine kits) | Tuning, Kits | (none yet) | Tuning, Kits | Fit (engine rows) | front |
| 4 | **Parts** (what bolts on and shows) | Fittings, Horn & plate | decals | (none yet) | Fit (body rows) | flank / rear |
| 5 | **Paint** (livery, finish, decals, name) | Paint | Paint, Name | Livery | Paint | flank |
| 6 | **Inside** | Inside | (none) | Livery › Cabin | (none) | inside |
| 7 | **Load** | Freight | (none) | Hopper, Load | (none) | top |
| 8 | **Business** | Exchange | (none) | (none) | (none) | front |

Repair and Service are split everywhere: "fix what's broken" and "replace what's worn" are the two
questions a player walks in with. Inside a job, the old tabs become groups (Performance has
Tuning and Kits as its two groups).

### The page

- **Every shop page is `partsHtml`**: groups across the top, the slots as a list saying what's on
  now, the open slot's options as large cards with price, stat change and a tick on what's fitted.
  The truck's kits, fittings and cab, the aircraft's kits and the boat's decals move onto it; the
  racer's Fit tab already is it.
- **Repair and Service are one docket** (`serviceListHtml`) with **Do all of it** in the till.
- **Paint is one page pattern**: scheme swatches, finish, decals, then the name, the same on all
  four. The aircraft's colour wheel stays as its custom row.
- **The till is always there**: what's picked, its price as the server quoted it, and the one key
  that pays. Picking an option no longer needs a second hunt for the buy key.
- **Bigger.** Tiles at least 56px tall with the label at the bay's body size; option cards two
  across on a laptop glass, one across under the phone breakpoint. The rail can still pack tighter
  past six jobs, but no vehicle has more than eight now.

### Keyboard and touch

`1`–`8` pick a job, the arrows move through slots and options, `Enter` picks, `Space` buys (holds
for anything `data-hold`), `Esc` backs out one level and then folds the bay. Focus shows a large
ring. Touch keeps the phone sheet layout from depot-shell.md, with the job tiles as a scrolling
strip across the top of the sheet.

## 6. Making it feel real

1. **Preview everything you can see.** Each seat's preview hook takes a full working look, not just
   paint:
   - truck: a working `fits` string into the cab's `variant` (the model already draws fittings from
     `FITS`; today it only shows them after you buy) and the plate and decals;
   - boat: the decal, as well as the scheme;
   - aircraft: as today, the livery;
   - racer: as today, paint and kit.
   Pointing at a card previews it; leaving the list puts back the working pick.
2. **Stat bars on every option** (`statsHtml` with `prev`). The truck has `kitStats` and the racer
   `podracerStats`; the aircraft needs its kit deltas sent the same way, and the boat gets bars when
   it gets performance parts.
3. **The work beat.** When a push confirms a purchase (`notePush` already knows), the bay plays a
   one-second beat on the part's area: the camera eases in a little, a spark or spray burst on the
   part, the matching sound (impact wrench for parts, compressor hiss for paint, the engine blip
   `cabRev`/`boatRev` for performance), then eases back. Paint sweeps on across the body rather than
   cutting. Respects reduced motion (`motionOff`).
4. **Wear you can see.** Repair should visibly take something off the model: the truck's `grime`
   (plugins/trucking/filth.js) is already drawn, so Service hoses it; dents or scorch for body damage
   and hull fouling for a boat are new, small decal sets driven by the condition numbers the bay
   already gets.
5. **Part anchors (later).** A slot that has a place on the model (exhaust, wheels, roof lights)
   draws a leader line from the open slot to that point. This needs each model to name its anchors,
   so it waits until the rest is in.

## 7. The code

One client module, `client/game/js/panels/maintenance-bay.js`, owns what the four depots each write
today: which job is open, the camera, the preview lifecycle, folding and restoring the seat's view,
the work beat, and the keyboard. A depot hands it data:

```js
openBay({
  seat,        // adapter: { host, frame(shot), view(mode), preview(look), rev(), frameRadius() }
  jobs,        // [{ id: 'repair', state: { sub, tone }, area: 'front', page: () => html }]
  look,        // the working look to preview, or null
  head,        // place, balance, the way out
});
```

Each seat (cab-view, boat-view, cockpit, podracer-view) exports one adapter built from the hooks it
already has (`cabFrame`, `cabView`, `cabPreview`, `cabRev` and so on). The four depot files keep
their pages and lose `syncView`, `syncPreview`, `syncCockpitView`, their `SHOT_FOR` tables and
their fold/restore code.

Unchanged rules: every key is still a verb (`data-cmd`, `data-hold`), the client still computes no
price, the server still decides when a bay is up (`pushBayService`, `svcTick`, `servicedCraft`),
and the log rung prints the same facts with no screen. No server change is needed for phases 1 to 3.

## 8. Phases

1. **Cutaway and camera.** §3 and §4: all four walls and the sill cap, work lamps, the covered dock,
   the fitted 3/4, the hangar standoff fix, the bay gate. Check every depot in the browser at day and
   night.
2. **The bay controller.** §7, with each depot moved onto it one at a time and no visible change
   beyond the camera. Racer first (smallest), then boat, aircraft, truck.
3. **The menu.** §5: the canonical jobs, `partsHtml` everywhere, the till, the keyboard, bigger tiles.
4. **Making it real.** §6.1 to §6.4: previews, bars, the work beat, visible wear. The aircraft's kit
   deltas and the wear decals are the only server-side additions.
5. **Anchors.** §6.5, once models name their anchor points.

After each phase: `client:smoke`, `shapes:smoke`, `bigscreen:smoke`, and `test:regress` for any
phase that touches a plugin. [depot-shell.md](../reference/depot-shell.md) is updated as each lands.

## 9. Open questions

- **"Walls cut away": the shed's or the vehicle's?** This plan reads it as the building the vehicle
  stands in. If it means a cutaway of the vehicle itself (body panels off to show the engine and
  internals), that's a much bigger job: every vehicle model would need an interior layer.
- Is a work order wanted (pick several parts, pay once)? It would need a server-side quote verb per
  plugin to keep "the client computes no price", so it's left out of this plan.
- Should the aircraft keep its counter-side bench in the pane (the 3-D stage beside the floor
  cards), or should maintenance only ever happen in the seat?
