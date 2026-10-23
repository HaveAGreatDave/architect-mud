# podracer

The Rasp Twinspool: two salvaged turbines on a binder, towing a cockpit pod on two cables. Sold and
hired in the racer bay at the Deadleg, in the Scarletwastes, and raced over the region.

**Status: Phase 1 built (2026-10-08); text helm built (2026-10-18); the void highway (2026-10-22).** Buy, hire, service, sell, recover, drive, park, break down and wreck, from a depot
to the depot standard, on every Display Mode rung, over the region and down the void highway to the next one. Racing (courses, laps, times) is not built.

## The racers

Three types, one class (`podracer`). Each is a row in `PODRACER_TYPES`
([podracer-model.js](../../client/game/js/panels/podracer-model.js)) whose drag is solved for its own
top speed, and each is drawn from its own mesh: `mesh_podracer.json` names the others in its
`variants` (keyed by type id), and `mesh_podracer_skitter.json` and `mesh_podracer_sledge.json`
are the Twinspool's file cut down and built up to their rows' sizes, with their own factory paint
and parts.

| type | price | docked / launched | handling |
|---|---|---|---|
| `skitter` Skitter Dart | ₵16,000 | 130 / 271 mph | light, turns hardest, a weak binder (80 mph) and light cables |
| `podracer` Rasp Twinspool | ₵31,000 | 146 / 306 mph | the middle of everything |
| `sledge` Sledgehammer Twin | ₵58,000 | 135 / 337 mph | heavy, slow off the line and slow to turn, a binder good to 120 mph |

## How it works

- **The physics** is [podracer-model.js](../../client/game/js/panels/podracer-model.js), pure and
  shared by the client seat and this suite. Three rigid bodies in the plane: the two turbines and the
  pod. Each cable is a one-sided distance constraint solved by position
  (XPBD) in fixed 1/240 s sub-steps, so it pulls, and snaps on a yank of about 110 mph of closing
  speed. Under 70% of its length it pushes back like a soft strut (the cushion), so the pod never
  coasts up into the turbines when they slow; the pod has air brakes of its own as well.
- **It drives like the arcade racer, with the physics underneath.** Hold W for thrust and let go to
  coast; Q and E are one turbine each; A / D steer; S brakes; Shift is a power slide; Space is the
  boost. The chase camera follows the turbines, which are what you steer, not the pod. A / D ask the split
  vanes for a turn rate (about 80 degrees a second slow, half that flat out) and the vanes drive the
  turbines to it and hold it, so a turn starts at once and never winds up; the pod follows on its
  cables. The levers are still real: W pushes both up and they fall back to wherever a hand left
  them, so a lever dragged up is a cruise, and a split between the two still steers.
- **The pod trails, it doesn't swing.** A damper on the tether takes out the pod's sideways swing
  about the tow line in about a quarter of a second (equal and opposite, so it costs no speed), and
  grip redirects most of the sideways speed it takes off along the nose rather than eating it. Before
  both, the pod skidded 55-65 degrees in a held turn and swung two or three times after every one.
- **The turbines stand 6.7 m apart** on a binder that is a truss: across at the nose and tail and
  both diagonals, so it flexes and shimmies but a lever cut on one side can't twist the pair round.
- **Docked and launched (F).** It starts docked: each turbine pinned alongside the pod, the cables
  reeled in and the binder idle, one compact craft good for about 150 mph. F (or the cockpit
  screen's LAUNCH key, or the ⇈ LAUNCH button) kicks the turbines off forward and pays the cables out
  to full length in about a third of a second: the full 300. F again and each turbine flies itself
  back to its place beside the pod (closing no faster than about 30 mph, turning to the pod's
  heading) and the pins lock; the pod is never pulled. Docked, a knock can't tear the binder out.
- **The binder is powered.** Launched, its stiffness follows its power: idle under 25 mph, a loose
  leash with each turbine steered by its own vane; full by 120 mph or 1.5 g of the pair's own
  acceleration, up in a fraction of a second and down over one. The arc follows it, from a stray
  spark at idle to the full crawling bolt, and the cockpit screen reads DOCKED, IDLE or OK.
- **Slow turning can't fold it.** The split vanes need air over them: at a standstill they turn the
  pair at about a third of their rate, full from 80 mph. And the pair may swing at most about 70
  degrees off the line back to the pod (the jackknife limit): past most of it the vanes stop turning
  it further out, past all of it the tow pulls it back. One turbine from rest swings you round with
  the pod in tow; before, it pivoted the turbines round onto the pod.
- **Reverse.** Hold S (or B) at a standstill for about a second and the air brake petals go into the
  exhaust as thrust reversers: S then backs you up at up to 14 mph, the pod pushed back on its
  cables, until you are going forward again. The HUD and the cockpit screen say REVERSE.
- **The slide** loosens the pod's grip (it hangs out wide) and turns the vanes half as hard again.
  The longer the pod hangs out, the more it charges the whip; let Shift go and it snaps back on its
  cables and the turbines take up to 40% more thrust for about a second. The dash's SLIDE lamp goes
  green when the charge is worth having.
- **The boost** is half as much thrust again with both levers near full. Each turbine heats while
  it is lit and cools off it; past the red it burns and loses condition until the boost comes off.
- **The pod swings wide** in a hard turn, because it grips the air less than the turbines.
- **The binder is a stiff spring, not a bar.** Two damped links, nose to nose and tail to tail, keep
  the turbines paired; a hard slalom flexes it about a tenth of the span and a knock shimmies it for
  under a second. The dash's BINDER lamp goes amber while it strains. It is drawn as an electrical
  arc between two emitters, crawling about twenty times a second and wider under strain
  (windshield.js `drawPodracerArc`).
- **A turbine hit at about 95 mph tears the binder out, and that is a breakdown, not a wreck.**
  The links go, the turbines kick apart and cut out, and loose turbines still collide (a clash is a
  hit). You take a jolt in the straps sized by the speed (none under about 45 mph, never as hard as
  a wreck; [seat.js](seat.js) `breakdownPlan`), and the racer is kept, saved torn
  (`custom_data.binder: false`), so it won't light again wherever you leave it and climbing out
  and back in doesn't mend it. The seat puts up a panel in the depot's look: call the flatbed,
  climb out, or stay put. `podracer service` in the bay welds a new binder in. Only a pod beaten to
  zero is still a wreck: the racer is gone.
- **The flatbed** (`podracer recover`, 3% of the racer's price): sitting in it, it takes you and the
  racer back to the racer's bay; standing in a bay, it fetches one of yours from wherever it was
  left, a torn one first. The counter's card for a racer out on the waste has a **Fetch it** button.
- **The dash's screen** is a touchscreen: the speed, both turbines' heat, the craft from above with
  its cables and the binder, the binder's state, pod, fuel, whip and boost, and four soft-keys that
  all work (CAM, HELP, TOW, EXIT). Cold with a torn binder, it says so and points at TOW.
- **The client integrates, the server checks.** `podsync` carries the pod's position and the state
  that can only go down; [seat.js](seat.js) refuses a report that moved further than the racer could
  have and puts the client back, refuses one over no ground at all (`edge`), and clamps the
  turbines' drawn offset to the cables. There is no bounding box.

## The highway

No vehicle is confined by an invisible fence. A racer runs anywhere there is ground, and at a road
mouth on the region's rim the ground goes on: the void highway between regions, the same corridor
the trucks drive ([systems-trucking.md](../../docs/systems-trucking.md)), through the same code.

- **Two legs, one provider.** The live racer carries a `leg` like a rig does. In a region (`city`)
  the ground is the placed world, and near a road mouth the approach composes the highway it leads
  to, so the tarmac is on the seat's map before the rim. On the corridor the ground is the road,
  its verge and the world underneath. `groundFor(rig)` in [seat.js](seat.js) is trucking's
  `providerFor`, and it feeds the envelope, the seat's map window and the text helm's eyes alike.
  The client's `solid()` is unchanged: a tile with no ground is rock, and past the rim there is
  ground where the road is and nowhere else.
- **Leaving the world.** A report off the placed map where a void begins goes through voidwalking's
  `launchCrossing`, as walking off the edge does, and the racer lays its road over the chain that
  produced (`joinCorridor`, with no speed cap: a racer leaves at whatever it was doing, and stays
  exactly where it reported if the road has it there). Anywhere else the map simply ends: the racer
  is stopped on the last tile and the client follows.
- **The drive is the crossing.** On the corridor `reconcileCorridor` derives the odometer and the
  room from the reported position, and `walkToNode` walks the player down the crossing's rooms one at
  a time, however many a report crossed, so `current_zone` steps along them, voidwalking's room
  window keeps up, and its teardown and traces run untouched. The wheels take the fork: steer onto
  the other limb and you are on it, walked back to the shared trunk and up the new limb (the two
  roads share a different length of tarmac than the crossing has shared rooms). Backing to the gate
  once you have been out past it leaves by the gate; the far end lands you in the far region, still
  driving.
- **Stopping out there.** Parking, climbing out or a wreck on the corridor leaves you in the current
  crossing room, with the racer parked in that room; `podracer` from the room puts it back on the
  road where it was left. When the crossing ends with a racer still in it, the racer goes back to the
  rim tile the crossing set out from (`crossing.ended`), and a restart puts one stranded in an
  `xing_…` room in the first racer bay.
- **The text helm** reads the same provider: `pod look` on the corridor names graded road and the
  edge of the waste where the band ends.

## The text helm

On the `textgames` and `log` Display Mode rungs ([systems-display-mode.md](../../docs/systems-display-mode.md))
the seat is [texthelm.js](texthelm.js): the same racer driven by `pod` orders, with no canvas.
The seat is a surface you act through, so it reads `prefersTextMinigames`, latched when you climb
in.

- **One model.** The server steps `stepPodracer` once a second over the real elapsed time, in the
  seat's 1/60 s frames, with the seat's lever travel, vane swing and inside-turbine cut, the same
  fuel burn (`podracerBurn` in the model, which the seat now calls too) and the seat's solid ground
  and surfaces (its map window's rule, through the flight sim's `deriveSurfaceCell`). A torn binder
  goes to `breakdownRacer`, a wrecked pod to `wreckRacer`, climbing out to `parkRacer`, the row to
  `flushRig`. The live racer is written to `rigs`, so a text racer is a contact like any other.
  The yard's service and paint reach it through `textPodCtx`, as `podracer_ctx` reaches the seat.
- **Orders, not keys.** A heading (`pod 270`, `pod west`, `pod left 30`, `pod home` for the shed
  door) is flown through the same steer input A and D drive, so a hard turn at speed is a hard turn.
  Thrust is a lever setting (`pod idle/slow/half/cruise/full`, `pod thrust 70`). `pod brake` holds
  the air brakes until it stops; `pod reverse` backs up from a standstill. `pod launch` and
  `pod dock` are F. `pod boost` holds the boost. `pod slide` arms the power slide for the next turn
  and lets it go when the turn is done, which fires the whip as on the seat.
- **Eyes.** The tick looks along the line of travel and warns when something solid is under three
  seconds or two and a half tiles away. `pod look` names the nearest solid thing each of eight ways
  and the bearing to the shed door. Nothing steers round it for you.
- **Pace.** Events (a hit, a snap, the launch, the whip, the binder) are said as they happen. The
  status line comes every 3 s moving on `textgames`, and every 10 s on `log`, only when it has
  changed, so a screen reader keeps up. Bare `pod` reads it on demand.
- **Not here:** a character board. At `textgames` the helm narrates into the log as `log` does, a
  little faster; a live board through `textui.js` would need a client handler in `dispatch.js`.

## The depot

The racer bay is the fourth depot on the shell, to the standard in
[docs/reference/depot-shell.md](../../docs/reference/depot-shell.md):

- **A room you walk into.** `zone_racerbay_deadleg`, east off the Deadleg's truck shed, carries
  `flags.podracer_lot`. The building, its model, its map icon and its lights are the Deadleg's.
- **Out through the bay door.** A racer kept in the bay starts on the shed's `vehicle_bay` facade,
  facing out of it, and you drive it onto the yard ([seat.js](seat.js) `startOf`). Parked back on
  that door it goes up on the blocks in the bay and you step into the bay room.
- **The counter** ([podracer-depot.js](../../client/game/js/panels/podracer-depot.js)) opens walking
  in and closes walking out (`zone.entered`), and is dealt again after every verb that changes
  anything. Your racers are cards, then Buy and Hire. A card is `podracer take <id>`.
- **The bay overlay.** Stopped in the shed door, the counter's payload goes onto the seat with
  `service: 'bay'`: the pod, the turbines, the cables and the tank, one key to put it all right,
  **Put it away** and **Drive out**.
- **Hire** is one at a time for two hours, and goes back on its own when the time runs out.
- **On the log rung** nothing is pushed: the same verbs print the stock and your racers as text.
- **The inside.** The same booth fits out the pod: leather (oxblood, tan, black, cream, green,
  blue), the light strips (blue, red, green, amber, violet, white) and the dash (carbon, gunmetal,
  cream, billet), as `leather=`, `strip=`, `dash=` on `podracer paint`; stored as the
  livery's `inside`. An inside-only job is 1% of the price. In the bay it shows in the pod as you
  choose ([interior-podracer.js](../../client/shared/interior-podracer.js) `INSIDE`).
- **Paint.** The counter's **Paint shop** screen (and a 🎨 Paint button on each card) is the spray
  booth, shown on the racer's card as you choose; the bay overlay has a **Paint** tab that shows it
  on the racer you are sitting in. Schemes, two colour chips (the shared colour picker) and the
  finishes; nothing is spent until **Spray it**. The livery is `custom_data.livery` in the shape
  every vehicle's renderer takes ({ base, trim, finish }): the mesh's `base` slots (the pod) take
  the base, its `trim` slots (stripe, fins, vanes) the trim, and the metal stays metal. Other
  players see it (`vehicle.contacts` carries it).
- **Its own look.** The counter and the bay overlay carry a racing orange as the shell's accent, a
  chequered band under the head and red-rock dust in the floor of the hand; the bay room has its own
  map colours and the marker RB on the Deadleg's interior map.
- **Parking.** The seat has a **⏏ PARK & CLIMB OUT** button over the air brake, as well as Esc and
  the cockpit screen's EXIT key.

## Player commands

| Verb | What it does |
|---|---|
| `podracer` | Climb into your racer parked here. In the bay with none, lists the stock and yours |
| `podracer take <id>` | Climb into that racer, if it is parked where you stand (the counter's card) |
| `podracer buy [type]` | Buy one (in the bay) |
| `podracer hire [type]` | Hire one for two hours (in the bay) |
| `podracer return [id]` | Hand a hire back (in the bay) |
| `podracer sell [id]` | Sell one in the bay back to the yard for half its price, less repairs |
| `podracer service [id]` | Repair the pod, both turbines and any snapped cable, and fill the tank: in the bay, or sitting in it in the shed door |
| `podracer paint [id] <scheme \| base=#hex trim=#hex finish=...>` | The spray booth: a scheme (factory, deadleg, icewater, hazard, nightshade, gunmetal, bone, verdigris) or your own pod and trim colours and a finish. 4% of the price, half that back to factory. In the bay, or sitting in it in the shed door, where it shows on the racer at once. Not on a hire |
| `podracer recover [id]` | The yard's flatbed: in the seat, takes you and the racer back to its bay; in a bay, fetches one of yours from the waste. 3% of the price |
| `podracer list`, `podracers` | Where your racers are and what shape they are in |
| `pod [order]` | The text helm, on the text Display Mode rungs: `start`, `kill`, thrust (`idle`, `slow`, `half`, `cruise`, `full`, `thrust 0-100`), a heading (`270`, `west`, `left 30`, `right 90`, `straight`, `home`), `brake`, `reverse`, `launch`, `dock`, `boost`, `slide`, `look`, `park`, `help`. Bare, the dials |

`podsync` and `podevent` are the seat's telemetry and event reports. Nobody types them.

## Registered actions

None.

## Events emitted

None.

## Events consumed

- `player.login`, `player.logout`: drop the seat, flushing the racer's row.
- `player.death`: the same, and close the pane.
- `crossing.ended`: a racer parked in one of the crossing's rooms goes back to the rim tile it set out from.

## Tick usage

The text helm's `1s` tick ([texthelm.js](texthelm.js)), which the scheduler skips on an empty
server and which returns at once when nobody is racing by text. No query in it but the ten-second row flush the seat's sync also does.
The seat's own sync flushes the row every ten seconds while a racer is running.

## Dependencies

- `plugins/flight/state.js` for the map window, sky, contacts and `surfaceAt`, as the powerboat does.
- `plugins/trucking/state.js` and `corridor.js` for the corridor leg: `providerFor`, `joinCorridor`,
  `reconcileCorridor`, `crossToNode`, `landOn`, `unbog`, `corridorLocate`, `corridorPos`.
- `plugins/voidwalking/index.js` for the crossing: `launchCrossing`, `voidGateOf`, `crossingInfo`,
  `crossingChain`, `crossingDest`.

## Config

The type row in `PODRACER_TYPES` (podracer-model.js). Its comment block explains each number.

## Data schema

`podracers` (in `SCHEMA_SQL`): `id`, `type_id`, `name`, `owner_id`, `park_zone`, `fuel`, `condition`
(the pod), `custom_data` (`eng` [left, right] turbine condition, `cables` [left, right] intact,
`heading` when parked).

## Extension points

- `zones.flags.podracer_lot`: a room that sells, hires, services and keeps racers. Its
  `world_exit_zone` is the bay door they come out of.

## Not built

- Courses, laps and times.
- A character board for the text helm at `textgames` (see The text helm).
- An NPC at the counter. The verbs do the selling, as the truck depot's and the hangar's do.
