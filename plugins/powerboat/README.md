# powerboat — THE BASIN

**STATUS: BUILT.** The physics, the hull, the wreck, the boatyard, the seat on both Display Mode
rungs, and the yard as a screen.

A blown picklefork race boat you drive on the water. The water half of THE LONG HAUL, and built to
its shape on purpose — with one deliberate exception, which is the interesting part.

## The shape it borrows

| From trucking | Here | Why |
| --- | --- | --- |
| client-sim, server reconciles | same | a boat at 138 mph crosses a tile in two thirds of a second; a server-stepped hull is a slideshow at any tick rate this game can afford |
| the row is the OWNERSHIP, the type is the vehicle | same | `boats` rows against `TYPES` in flight-model.js |
| the client reports WHERE IT IS, not how far it came | same | and it matters more here: there is no corridor on open water, so a self-reported distance would be a number with nothing to check it against |
| an eight-speed box | **no gearbox at all** | a blown boat has one drive and no ratios |

## The seat, on both rungs

A helm is a surface you **act through** — take it away and you cannot move a boat at all — so it
sits on the `prefersTextMinigames` axis, and the two rungs are two ways to make the *same* passage
rather than one of them being a description of the other. `stepBoat` is a pure, DOM-free function,
so it runs in the browser and on the server with **no second physics**.

- **[boat-view.js](../../client/game/js/panels/boat-view.js)** (visual) — `paintWindshield` with
  the pilothouse around you, a lever throttle, the wheel, the tabs on `[` `]`, the bottle on Shift,
  right-drag free look, big screen, and the V8 out of `boat-audio.js`.
- **[texthelm.js](texthelm.js)** (textgames / log) — the same `stepBoat` on a 1s tick, conned by
  order. ⚠ **A boat is CONNED, not driven, and that is why this is not the truck's text rung:**
  `textdrive.js` drives itself because a truck's route *is* the road, and open water is the opposite
  case — the bearing is the only interesting decision in the system, so a text helm that picked its
  own would be deciding it for you.

⚠ **Both rungs fill `rigs`**, which is what the `vehicle.contacts` hook publishes. A driver missing
from it is a boat nobody else on the Basin can see, hear or collide with — and nothing anywhere
would say so.

## The room you sit in

The pilothouse is **not authored twice**. `client/shared/boat-house.js` holds the hull's stations
and the house's curves, `buildBoat` lofts the outside from it and `interior-shell.js` builds the
inside from the same functions — so the sill you look out over and the window somebody on the
pontoon sees you through are one curve. Before that file existed the two were three times apart in
height for their length. `scripts/shapes/shell.mjs` holds them together, including a whole-sphere
sweep that marches every escaping ray on through the exterior and names what it came out of.

## The key

**She had no ignition at all.** `helm` opened the pane and the motor was already running — there
was no `running` anywhere in `stepBoat`, so "how do I start the boat" had no answer and taking the
seat and getting under way, which this file is at pains to keep as two acts, collapsed into one.

**K, because that is the truck's key.** `cab-view.js` has bound it to `toggleIgnition` since the rig
shipped, holding the starter for as long as it is down, so a driver who can start a rig can start a
boat. ⚠ **I was the obvious letter and is the truck's DOME LIGHT** — one letter meaning two things
across two seats is worse than a seat with no key in it.

⚠ **ABSENT MEANS RUNNING, AND THAT IS THE MIGRATION INVARIANT.** Every caller that already existed
hands `stepBoat` a state with no `running` on it, so read as `!s.running` every hull in the game
would be dead in the water and the suite would go red for a feature none of them have heard of.
`s.running !== false` is the one reading under which an untouched state behaves bit-for-bit as it
did. Regress asserts it by seating a hand-built helm without the flag and giving it real orders.

⚠ **AND A DEAD ENGINE IS NOT A STOPPED BOAT.** The lever is cut and the motor stops making revs;
the hull keeps every bit of the way it had, goes on riding the sea and goes on steering for as long
as there is water past the rudder. Written as an early return, turning the key off at forty miles an
hour stops her dead — a worse lie than having no key, because a boat has no brakes.

⚠ **A NEUTRAL START SWITCH, AND IT IS THE BOAT'S RATHER THAN THE MODEL'S.** The HUD lever holds
where you leave it, so somebody who wound it open on a dead motor and then hit the key would have
her leave the pontoon at full chat. Every engine ever built refuses to crank out of neutral.

⚠ **A DRY TANK TURNS OVER AND NEVER CATCHES**, which is a refusal rather than a failure to fire and
is audibly different. It is also why a click-armed starter lets go **on a clock and not on success**
— on an empty tank there is no success to wait for, and the starter would stay engaged for the rest
of the session.

⚠ **AND A STOPPED MOTOR BURNS NOTHING.** That base figure in both rungs is the IDLE burn — what she
drinks sitting at the pontoon doing nothing — so left unconditional a hull left shut down drinks her
own tank, and not doing that is the one thing a key is unambiguously for.

**Both rungs, and the text one spells it `start` / `kill`.** ⚠ **`stop` IS ALREADY THE BOTTOM BELL**
— ring off, lever to the stop — and two meanings for one word on the surface where every order is
typed is the collision this file already records against `helm`, `fuel` and `refit`. A helmsman
rings STOP and kills the engines; they have never been the same instruction. A bell ordered on a
dead motor is **refused rather than accepted and ignored**, because the model cuts the lever and the
log would otherwise print *"you ring for full"* over a boat that does not move.

## The seat, as a set of controls

Everything below is the cab's, taken rather than invented, because a player who has driven the rig
has already learned it.

- **A lever you can grab.** `throttleFaces` has stood a quadrant on the starboard gunwale in the
  depth buffer since the seat shipped and it is the one you LOOK at; the HUD lever is the one you
  can put a hand or a thumb on. ⚠ **One owner**: a drag SETS `st.lever` and the W integration is
  skipped while a finger is down, or a hand dragging it down against a held key watches it climb
  out from under them — the same two-owners bug this panel's own wheel note is a record of.
- **The chase camera on V (and F).** ⚠ **Nothing new draws a boat.** This seat has passed
  `cls: 'hydro'` since day one, so the outside view is `external/extYaw/extPitch/extZoom` on a
  payload `paintWindshield` already reads, and `pushInteriorShell` already returns early on
  `v.external`. ⚠ **The orbit rides the EXISTING look drag** rather than a second set of listeners
  on one element, and the shoulder-check is suppressed out there because the chase camera is
  already showing you what it is for.
- **Q / E / S** snap the head to port, starboard and astern. ⚠ Astern is `LOOK_YAW` and not 180°:
  past the limit this seat shares with the cab there is nothing painted to look at.
- **? for the controls, and it opens itself the first time.** ⚠ **A PLAYER FLAG, NOT
  `localStorage`** — first-time-in-a-boat is a fact about the character, so a browser key would
  re-teach somebody who cleared their site data and stay silent for the same player on a second
  machine. `boat_helm_taught` is written by `boatevent learned`, sent when the card is SEEN rather
  than when it is dismissed: closing the pane without reading it still counts, and a lesson that
  comes back every time is the one nobody reads.
- **ESC opens the way out rather than being it.** Both verbs already existed and neither had an
  affordance — see *Stopping in the middle of the Basin* below — so the flap says which of the two
  is about to happen, warns about way still on, and ESC closes whatever is open before it closes
  the seat.

## The tabs

⚠ **Not a second throttle**, which is the obvious objection: the lever is still the whole
longitudinal decision. Trim is the hull's **attitude** — how much of her is in the water — and the
two are orthogonal, which is why a real race boat has both.

Bow down is more wetted surface: slower, but she climbs her own bow wave sooner and holds on. Bow up
is less: a real turn of speed, on a boat barely holding the water that will fly off anything she
meets. ⚠ **Neutral is exact, not nearly** — every term is `1 + k·trim`, so at 0 each is 1 and every
passage anybody has driven behaves bit-for-bit as it did. That invariant is asserted in `regress.js`.

## The tank

**Fuel was spent from the first commit and there was no way on earth to put any in.** `stepBoat`
burns it in the panel and in the text tick at the same rate, `cmdBoatSync` clamps it one-way so a
client can only ever report it DOWN, and `helm` refuses a dry hull with *"there is a pump on the
fuel pontoon"* — against a world with no pump and no pontoon in it. A 14,500₵ hull was a countdown
about four minutes long.

[fuel.js](fuel.js) is the pump. `boat_fuel` on a tile is one, and Fairweather now has a **fuel
float** — a walkway off the north end of the hardstanding, three finger berths and a card reader
(`zone_district_892_901`). That tile is also the game's first `marina_berths`, a flag the yard has
read since the day it was written and no content had ever carried.

⚠ **Priced PER UNIT off the type's own `tank`, never as a flat fill.** Trucking charges one flat
number because *"diesel is diesel — the interesting variable is the DISTANCE between pumps"*, and
that is true of a road network. There is one pump on the whole Basin, so the interesting variable
here is the HULL: `tank` is already on every type, so a second hull with a bigger one costs more to
fill and nobody authors a second price. Dearer than diesel on purpose — a blown race boat does not
drink it, and the marina is Ascendant and steep by design.

⚠ **The verbs are somebody else's.** `fuel` is trucking's, `refuel` is flight's and generator's,
and a plugin verb silently beats an engine builtin — the trap this README already records against
`helm`. So the answer is `BOAT_FUEL`, dispatched **by name** from both, the `BOAT_HELM` idiom:
neither plugin imports the other and a world booted without this one falls through to its own
refusal instead of printing `Unknown action`.

⚠ **The action re-checks that you are standing at the yard she is lying in**, and that gate is what
makes the router safe to put first: without it, `fuel` typed at Flash Point by a driver who happens
to own a boat tops up a hull four hundred tiles away instead of the truck under their hand.

⚠ **A fill reaches every live copy of her.** The row, the `rigs` record and the text helm's own
state — because the sync's one-way clamp would undo a fill written only to the row, four times a
second, and a fill written only to RAM would be gone at the next flush.

## Stopping in the middle of the Basin

⚠ **`disembark` under way used to leave you standing where you had never stopped standing** — for a
helmsman, the room they embarked from, a mile away and indoors — while the boat simply ceased to
exist: `rigs` dropped, so she vanished from every windscreen on the water, and `berth_zone` still
said she was tied up in a shed she was nowhere near.

[adrift.js](adrift.js) is the other half of the act. **A hull left on the water is `berth_zone`
pointing at an ordinary swimmable tile**, and that is the entire representation — the shape the
schema has described since the line was written (*"null = out on the water"*) against a game in
which nothing could produce it. Everything downstream is then free: `boats` prints where she is,
`embark` climbs back in because she is a boat of yours in the zone you are standing in, `helm` gets
under way because `berthGrid` reads any zone's coordinates, and a restart brings her back exactly
where you left her.

⚠ **She is deliberately NOT a `flags.vessel` zone.** That is the Echelon's arrangement — a boat that
IS a room — and it is content, authored in git, one per hull. A race boat is a cockpit and a row,
there can be any number of them, and minting a zone per boat is a second representation of a boat
to keep in step with the first.

⚠ **And going over the side puts you in the water**, which is the point. The swimming plugin needs
to be told nothing about boats for that: `zone.entered` fires off the teleport and the stamina
drain, the wetness, the cold and the drowning all arrive on their own.

⚠ **What it DOES need telling is the opposite fact.** Swimming decides who is treading water from
what they are **carrying**, which is all it can see on its own — so a player who climbed into a hull
lying off the quay was a body in the water to every rule it owns, and the tick bled their stamina
until they **drowned at the wheel of a working boat**. `swim.afloat` is a sync gather asked inside
`syncSwimmer`; this plugin answers it with one `Map.has` and swimming learns nothing about boats.

⚠ **A berth under her is a mooring, not an abandonment.** Coming alongside the float and typing
`disembark` is tying up — the tile is a deck you stand on — so she is berthed and you step onto it.
Without that branch the one manoeuvre the system is built around ends with a player treading water
on a pontoon.

⚠ **And it is asked BEFORE the ordinary climb-out**, which returns a line about the deck for
everybody. Asked the other way round, going over the side is unreachable.

## The tow

A hull out of fuel in the middle of the Basin is not a hard choice, it is an errand with a known
answer — trucking's own sentence, and the same answer: somebody comes out for her, for a price that
is deliberately worse than getting there yourself. `BOAT_TOW`, off trucking's `tow`, by name.

⚠ **She comes home whether or not you can pay.** The fee rides on the row as `custom_data
.recovery_fee` instead, and `helm` collects it before she goes out again — because the alternative
is a player with no credits, no fuel and no boat within reach of any way to earn either, which is
not a difficulty, it is a dead session.

⚠ **Her address is `home_berth`, not `berth_zone`.** The second is where she is RIGHT NOW and moves
every time anybody touches her, including onto open water; the first only changes when you
deliberately move her in somewhere. Without it a tow has nowhere to take a hull except the water she
is already lying in.

⚠ **And the fee is capped at a third of the boat.** A correctness invariant rather than a kindness,
and trucking's, written there after a measurement bug quoted 10,038₵ to fetch a 1,300₵ truck: the
distance term reads coordinates off content, and content can always grow a row whose coordinates are
not where the thing is. An interior sits at grid 0,0, which is not a position — it is the absence of
one — so `towGrid` asks the building's tile instead.

## Verbs

`boat` `boats` `berth` `refit` — the yard. `helm` — take the seat (a separate act from `embark`:
sitting in her at the pontoon and getting under way are two things). `conn` — the text rung's
orders. `boatsync` / `boatevent` — the client's telemetry and event channel, never typed.

⚠ **`refit`, not `fix` or `repair`**, and ⚠ **`conn`, not `steer`/`throttle`/`ahead`** — every one of
those is somebody else's, and a plugin verb silently beats an engine builtin, so a collision here is
not a load error but two systems quietly ceasing to work.

⚠ **AND `helm` WAS ALREADY TAKEN, WHICH THE PARAGRAPH ABOVE MISSED.** `plugins/yacht` has declared
it since the Echelon shipped and loads after this plugin, so the loader handed it the word outright
and every `helm` a boat owner typed came back *"You can only take the helm from her bridge."* — the
exact failure that warning describes, three lines under the verb list, against the one word in the
list nobody checked. The word stays shared: `helm` off her bridge dispatches **`BOAT_HELM`** by name
(the `CHARGE_CRIME` idiom), so neither plugin imports the other and neither knows the other's boat
exists. ⚠ **The delegation sits ABOVE the yacht's admin gate** — `helm` is admin-only on the
Echelon, so under it the hand-off reaches nobody who owns a boat, which looks identical to the bug.
⚠ **An unregistered action RETURNS an error rather than throwing**, so a world without this plugin
falls back to the Echelon's own refusal instead of answering `Unknown action: BOAT_HELM`.

## The yard, as a screen

[shopfront.js](shopfront.js) and [marina-panel.js](../../client/game/js/panels/marina-panel.js) —
the dock, the fleet, the dealer, the berths and the refit bench on five tabs, opening when you walk
in and closing when you leave.

⚠ **It decides nothing.** Every button sends a verb string a player could have typed, and every
number on it is one the text rung prints. That is what puts it on `prefersLoggedPanels` rather than
beside the helm: delete it and nobody is stuck, they are reading instead of clicking.

⚠ **BEING NEAR A YARD IS NOT BEING IN ONE, AND THE FIRST CUT TESTED THE WRONG ONE.** Open and close
went through `berthsNear`, which is a FIVE-STEP flood fill of the exit graph — exactly right for
`berth`'s "is my boat here" and hopelessly wrong as a test for opening a screen, because five steps
off the Dock Hall reaches the facade, Halcyon Quay and most of the way to the hardstanding. The
marina HUD came up over the street a block before the door. `standingInYard` is the test now, and
it is a much smaller claim the world already carries two ways: you are standing on a berth, or you
are inside the building one of its berths is in. The facade tile carries the building name too and
is harmlessly caught, because a facade is a revolving door nobody can stand in.

## The dock does not lock — and for months it did

⚠ **The covered dock locked every evening and all day Sunday, with your boat inside it**, against a
line in this file asserting the opposite since it was written.

Nothing authored it. A shop is **derived** — an NPC with stock and a timetable whose shift is in
this room — and that derivation is right almost everywhere and has one failure mode: it cannot tell
a shopfront from a room that merely has a trader working in it. Marit Colvane sells chandlery
(`vendor_inventory` of 4) and her `work_zone_id` is the Dock Hall, so commerce indexed the hall as
her shop and `shopClosedFor` shut it Mon–Fri outside 09–18, Sat outside 10–16, and Sunday entirely.

⚠ **Her work zone cannot move, which is what makes this a seam rather than a content fix.** `refit`
wants a `repairman` in the same room as a covered berth, and this README already records that her
zone was moved to the hall for exactly that reason — moving her back to fix the door would make a
proper refit unreachable again.

So the room is asked whether it may be shut at all: **`shop.neverShuts`**, gathered in
`shopClosedFor` and nowhere else, because the move gate's refusal, the shut provider the room
description and minimap paint from, and the closing sweep that puts people out all read that one
function — and a carve-out in any one of them is a door that says open and refuses.

⚠ **It is a property of the ROOM, not of the player**, which is what makes it different from
`livesHere` beside it. That one says "the hours are not about *you*"; this says "this room does not
have hours". A player-scoped exemption would lock strangers out of a public marina whose slot is
open water somebody else's boat is floating in.

⚠ **And the restaurant still shuts**, which is the control the gate is written around: a hook that
answered true for any marina room would quietly take the hours off Anchovies too.

⚠ **The check for it cannot be asked against the live clock.** The shipwright keeps ordinary shop
hours, so for most of a working day the hall is open anyway and an unconditional assertion passes
without the exemption ever firing — mutation-tested exactly that way, and it stayed green. The gate
puts both vendors off shift and compares the pair, because two nulls would only mean the
manipulation did not take.

## The dealer's card

⚠ **A schematic of the actual mesh you will own**, and it is [`drawWireframe3D`](../../client/game/js/panels/wireframe-plane.js) — the same function the aircraft lot and the rig lot already
buy through — rather than anything written here. It strokes `aircraftFaces`, which is the face list
the dock tab, the windscreen and a stranger's contact all draw, so this is a second *presentation*
of one mesh and not a second renderer. A picture beside a price is the only part of *"look at what
you could own"* the text rung genuinely cannot carry, which is why it is the one thing on this
screen that is not a line of prose.

⚠ **It asks for `fill` rather than the stock focal.** That focal was set for airframes, which
measure about ±1.05 across the wing; a hull is authored far smaller, so unfitted she renders as a
doodle in the middle of an empty box — the truck lot's own bug, inherited here for free by asking
for the same thing.

⚠ **No `fitRef`, and that is a decision with a date on it.** `fitRef` is what keeps a *line* of
vehicles a line — fit each mesh to its own frame and the cheapest hull draws exactly as big as the
flagship, so the tier ladder vanishes. There is one hull, so there is no ladder to flatten. It
cannot simply be switched on when a second one ships either: `fitRef` is spent as a **variant**, and
`aircraftFaces` dispatches a boat on its **class** (`boatShape(cls) ? buildBoat(cls)`), so a boat
family needs a reference *class* and `wireframe-plane.js` has nowhere to put one yet.

⚠ **And the card says what she leaves the shed with.** She has always been sold brimmed — the insert
writes `fuel, condition` as `1, 1` — and until fuel could be *spent* that was a detail nobody could
act on. Now a tank is a real running cost, so "the price includes a full one" is part of the price,
and saying it only in the confirmation is saying it to somebody who has already decided.

⚠ **The spin loop is the only one in that file, and it is the opposite case from the dock.**
`paintDock` paints once per redraw and explicitly refuses a loop, because the slot is a still life.
A schematic turns, which is most of what makes a wireframe read as a solid. So it is started and
stopped by **which tab is up** — left running behind the fleet list it is a rAF loop with nothing to
draw, on a screen players leave open — and it re-queries its canvases each frame, because `draw()`
replaces the whole body on every re-push.

⚠ **THE ROOM PICKS THE TAB.** A berth gets the dock screen and everywhere else in the building gets
the paperwork — so walking into the Dock Hall shows you your boats where they are, rather than a
list of cards about hulls twenty feet in front of you.

## The dock screen

The room, with your boats in it: [drawDockBackdrop](../../client/game/js/panels/aircraft3d.js) is a
third venue beside the hangar and the truck depot, and the hulls on it are `aircraftFaces('hydro')`
— the same mesh the flight sim puts in your windscreen, so there is no second preview renderer to
disagree with the water about what she looks like.

⚠ **IT IS NOT THE DEPOT WITH A BLUE FLOOR ON IT**, for the reason `drawDepotBackdrop` sets out at
length about the hangar: what separates these buildings is the work, not the decoration. A boathouse
is a roof on columns over a SLOT OF OPEN WATER — the floor is the thing that moves — and everything
in it follows: no bays painted on anything, because you cannot paint water; a gantry track down the
length rather than a pit across it, because a hull comes out upwards, with the slings hanging off
the crab; a rubbing strake with cleats, fenders and a ladder on it rather than a painted floor edge,
because something heavy comes alongside; and one open end where the roof stops and the Basin carries
on, which is the only wall this room has.

⚠ **THE WATER IS LIT FROM UNDER**, which is the marina's own prose and also the only way a dark
interior over dark water reads as anything: a flat dark quad with a boat on it is a boat on a black
floor.

⚠ **THE SLOT IS MOST OF THE FRAME.** The camera fits the row of hulls to the canvas and the backdrop
cannot argue with it, so a narrow slot with a wide camera puts a boat sitting on the deck planking
with water either side of her — which is what the first cut drew.

⚠ **AN UNKNOWN VENUE IS NOT AN ERROR.** `drawHangarScene` falls through to the aircraft hangar, so a
typo in the venue string draws a perfectly good, well-lit, entirely wrong building. That is what
[scripts/shapes/dockscene.mjs](../../scripts/shapes/dockscene.mjs) exists for — it runs the room at
0–3 hulls at three hours, and tells the three venues apart by the paint they actually lay down.

⚠ **BOARD AND THE HELM ARE GATED ON THE SERVER'S FACTS** (`hereNow`, `aboard`), never offered flat.
Both were unconditional, so a card for a hull under cover two rooms away offered a Board button that
`embark` correctly refuses for not being at the berth — the verb was right and the screen had never
been told, which is the whole of "the buttons don't let me get in my boat". A button that cannot
fire is present and says why rather than absent, which is the truck depot's own rule.

## The building

Fairweather Marina is five rooms and the water. From the street you come into **the Lobby**; **east**
is the Dock Hall, which is the covered berth and the dealer and where your hulls are; **north** is
Anchovies, the restaurant; **west** is the Counter. Off the hall, **north** is the Bench, **up** is
the Gallery, and **east** is the gangway onto the quay. The cradle yard is the Hardstanding, out in
the open a couple of tiles west.

⚠ **THE ONLY THING IN THE BUILDING THAT SHUTS IS THE RESTAURANT.** The desk is staffed round the
clock by two people on twelve hours each (Ninian Quillon days, Odile Sabbatini nights), and the dock
does not lock — there is no lock on it. That is a mechanism rather than a line of prose:
`work_zone_id` plus a `vendor_schedule` is what the default vendor graph reads, so the lobby has
somebody behind it at every hour and never two at once.

⚠ **A `vendor_schedule` BLOCK DID NOT WRAP MIDNIGHT, AND THAT IS WHY THIS EXISTS.** `{ from: 18,
to: 6 }` is how anybody writes a night shift and `h >= 18 && h < 6` is false at every hour of the
day — so Odile's schedule was not a night shift, it was *no* shift, and the desk would have been
empty for exactly the twelve hours the second person exists to cover, silently. It was written as
two blocks to get round that, and the engine can wrap now
([docs/ai-behaviour.md](../../docs/ai-behaviour.md#a-schedule-block-and-the-night-shift)), so it is
one block that says six until six.

## What is not here

- **The refit bench needed the shipwright to be in the right room.** `refit` asks
  `getZoneNpcs(player.current_zone)` for a `repairman` and only finishes the job at a COVERED berth,
  which is the Dock Hall — and Marit Colvane's only zone was the Gallery upstairs, so the two
  conditions could never both be true and a proper refit was unreachable from anywhere in the
  building. Her `work_zone_id` is the hall now. She still lives upstairs.
- **No live end-to-end run yet.** Every rung is gated headlessly and the interior was checked by eye
  in the Modelshop, but nobody has bought a hull and taken her out in a running game.
- **The room only names a hull on OPEN WATER, never at a berth.** A boat tied at the float is a
  14,500₵ object in a public place and the room says nothing about it; `berth` and the marina screen
  both list her, so nobody is stuck, and the gather is kept to the one case where the place has
  nothing else in it to tell you which square of water you left her in.
- **Nothing decays out there.** A hull left adrift for a month is exactly as sound as she was, and
  nobody steals her. The row has no clock on it and this deliberately did not add one — a hull that
  rotted while you were offline would make leaving her the wrong move in every case, which is the
  opposite of the point.
