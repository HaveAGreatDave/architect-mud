# The Reach rebuilt: timber and neon

> **Status: phases 0 and 2 started.** Built: the neon kit, the Coyote's Rest badge, and the
> Coyote's Rest's new GLASS model, four storeys with the badge on its false front
> (building-styles.md §2.8), with its rooms fitted to it: the Stash under the bar, the Saloon Floor,
> the Gallery, and a landing and two rooms on each of the top two floors, stairs between them all
> (`scripts/content/coyotes-rest-rooms.mjs`). Marla Kest, Doc Teller and Del Roan live upstairs now, and
> their Layover cabins are numbered and empty. The day bartender, the shifts, and everything else here, are design. It plans a new GLASS model and a full set of
> walkable rooms for every building in the Reach, two new businesses in place of two old ones, the
> people who run them round the clock and live over the shop, and the street between them.

## The brief

David, 2026-11-23: more detailed buildings with interiors in the Reach, every one of them
reimagined. A western, dusty feeling, still some neon, and buildings that look like the future.

His answers and additions, the same day:

- **Timber and neon.** That's the look of the whole town. Two pieces of concept art set the
  direction (below); they're a starting point, not the law. The aim is to be creative and make it
  good, at a high standard.
- **Some new businesses.** The Assay and the Quiet Trade make way for a gunsmith, **Trigger
  Happy**, and a garage, **Mike's**. Their old keepers are recast into the new trades. The other
  seven keep their trade and name.
- **No new lore** to explain the town.
- **The Dynamo shows the town's power state** on lamps over its door.
- **Every business is at least two storeys**, and the people who work in it live upstairs. The
  motel is for anyone left over, and for players.
- **Long hours.** The bar and the garage are open 24 hours, everything else 18. Two people split
  each business's hours.
- **Nobody talks about their schedule.** Not in dialogue, not in banter, not when they're off.
- **The motel takes a second tile.**
- **It's 2077 in the game.** The Coyote's Rest was established in 2065.

The Reach today is nine buildings on a dirt street at the far end of the Coldwater Road. Each has a
bespoke GLASS arm in [the-reach.js](../../client/game/js/panels/glass/models/the-reach.js), timber
walls and shake roofs ([world-rendering.md](../reference/world-rendering.md#the-reach--timber-as-built-2026-08-20)),
and the porch, hanging sign, gable and clutter helpers that make the nine read as one town. What it
doesn't have:

- **Anything from the 2070s.** It's board-and-batten, rust and corrugated sheet, with one neon sign
  that's mostly dead. A town in 1877 would look the same.
- **Rooms you can walk.** Of its 18 rooms, four have a `flags.room` spec (the Hangar Bay, the
  Saloon Floor and the Last Load's shed and bunkroom), and the Saloon's is only a box size. The
  other fourteen open nothing on the Stage and nothing in GLASS.
- **A town that lives there.** Five of its people sleep in motel cabins and walk to work. Most
  businesses have one person and shut when they go home. The Last Load has nobody at all.
- **Dust you can see.** The region's colour grade (`REGION_GRADE` in windshield.js) warms and
  hazes the whole picture, but no building has dust on it, against it or blowing off it.

## The concept art

**The Coyote's Rest sign** ([img/reach-coyote-sign.webp](img/reach-coyote-sign.webp)): a round
badge. A rope ring held by riveted iron plates at the quarters, with cyan circuit traces running
round inside it. COYOTE'S arched across the top and REST down the right, in a slab-serif western
face, the tubes running amber at the bottom of each letter to cyan at the top. A coyote howling,
outlined in amber tube, with circuit lines through its body instead of fur. A saguaro, a star and
two gears in small tube. SALOON & OUTPOST under it, and EST. 2065 (the mock says 2077; it's 2077
now, so the bar is twelve years old).

**The region** (David's second image, not in the repo): Main Street from above at dusk, mesas on
the horizon and dust in the air. What it says, piece by piece:

- **Timber everywhere**: weathered board fronts, false fronts, porches on posts, upper galleries,
  an outside stair up the side of the motel. Corrugated tin roofs, rusted.
- **Neon everywhere, and big**: a lit name box on every front, in orange, cyan and magenta. The
  saloon has the coyote standing on its false front over a cyan-framed name box. The weapons shop
  has WEAPONS in orange box letters with ARMORY in cyan under it. The motel has MOTEL on a box on
  its roof. Small tube lettering and colour in the upper windows.
- **Holo screens**: cyan display panels beside doors showing what's inside (a rifle, a drink).
- **Tech clutter bolted on**: satellite dishes, antennas, air conditioners in the windows, security
  cameras on the eaves, a few small solar panels on a corner of a roof, power poles with sagging
  cables, a charging post for bikes.
- **Hover vehicles in the street**: a hover car, hover bikes and a quad parked at the rails.
- **The airstrip** off to one side: low corrugated hangars, approach lights, two craft.

## The look

The register from the 2026-08 pass stays: **a frontier that rhymes with the old west, never
pastiche.** No sheriff, no spurs, no "pardner".

**Timber and neon.** The buildings are timber, and the future is the light on them and the kit
bolted to them. By day the Reach is a dusty wooden town with too many dishes on its roofs. At dusk
it lights up, and that's when it looks like 2077.

### Timber

Board-and-batten walls (`TIMBER_WALL`) and shake roofs (`SHAKE_ROOF`) stay, and get more of the
things that make a frontier town read:

- **Two storeys, lived in.** Every business has its trade on the ground floor and somebody's home
  above it: a lit window upstairs at night, washing on a line off the back, a chair on the upper
  gallery, a water tank on the roof. A false front used to hide a one-storey shed; now the upper
  storey is real, and the false front only squares it off.
- **Upper galleries and outside stairs.** A balcony across the front on posts that carry on down
  to the porch, and a timber stair up the outside of the motel and of any building whose flat has
  its own door.
- **Corrugated tin** as the second roof, rusted, for the sheds and lean-tos and anywhere a roof has
  been patched (`METAL_WALL`'s ribbed steel, in a rust colour). The main roofs stay shake.
- **Wear.** Boards silvered at the top and dark at the foot, a few replaced in a different tone,
  paint on the false fronts faded and peeling, porch boards worn pale down the middle.

### Neon

Neon is the town's futurism, so there's a lot of it, and it's the thing to get best.

- **Every business is lit.** A name in neon on every front, as box letters, a tube script or a
  badge. Most add a second, smaller piece: the trade word, a lit window frame, a tube along the
  porch eave.
- **Three colours**: orange-amber, cyan and magenta. Amber is the warm western one; cyan is the
  future (circuit traces, holo screens, frames); magenta is the accent in windows and under eaves.
  A sign can run one colour into another along a tube, as the coyote's lettering does.
- **The western and the circuit board in the same tube.** The best idea in the sign mock: a coyote
  drawn in circuit traces, a rope ring with cyan traces inside it. Every badge in town gets one
  western shape (a cactus, a horseshoe, a star, a wrench, a bottle) and one piece of circuit.
- **The Coyote's Rest is the beacon**: the badge is the biggest and brightest sign in the town, the
  one you see from the air before you see the strip.
- **Real tube, not a texture.** A neon sign is bent tube on a backing, with the dark gaps where a
  tube turns behind the board, standoffs, a transformer box, and a cable down the wall. Off, by
  day, it's pale glass. On, it lights the boards round it and its colour falls on the boardwalk.
- **Something is always failing.** One letter flickering somewhere on the street, one tube dead,
  never the same one twice. The Coyote's keeps one flicker, in memory of its dead letters.
- **On when the business is open.** A shop's neon goes dark from midnight to six, the only sign
  from the street that it's shut. The bar's and the garage's never go off.
- **Dust in front of it.** Each tube gets a halo that the region's dust term thickens, so neon in
  the Reach blooms softer than neon in Coldwater.
- **One building, one name** ([building-styles.md](../reference/building-styles.md#41-one-building-one-name)).
  The name appears once; a second sign says the trade (`$trade`), never the name again.

### Holo screens

A cyan display panel in a timber frame beside the door, showing the trade: a turning rifle at
Trigger Happy, a pint at the Coyote's, a wrench and a part at Mike's, a room key at the motel. Thin
scan lines, a little tearing, dust on the glass. No more than one per building, and none on the
Quiet-style fronts that wouldn't have one.

### The kit bolted on

Small things, lots of them, and each one bolted to timber with a bracket and a cable:

- satellite dishes and antennas on the roofs, one dish pointed the wrong way
- air conditioners in the upper windows, dripping
- security cameras on the eaves
- a few small solar panels propped on a corner of a roof
- power poles with sagging cables, all running back to the Dynamo
- junction boxes, extension cables along the boardwalk, a charging post for bikes at the rail

They're cheap to draw and they're what makes timber look like 2077 by day, when the neon is off.

### Dust

Dust gets three layers, each cheap:

- **Drifts.** A low wedge of dust against the windward foot of every wall, door sill and boardwalk
  step, in the ground colour. The wind is from the west (the Last Load already stands "with its back
  to the wind"), so drifts are on west faces and spill round the corners.
- **Staining.** Every material gets a dust term in its texture: paler toward the ground, packed
  into board seams, on top of every dish and AC unit, wiped clean on handrails and door pushes.
- **Moving dust.** A thin dust devil or two crossing Main Street by day, and grit blowing off the
  roof ridges, drawn as decals off the wall clock the way the clone facility's gut runs. Movement is
  the exception ([building-styles.md §4.5](../reference/building-styles.md#45-the-clone-facility-is-the-bar-for-a-small-building)),
  so this is one effect for the whole street, never one per building.

Inside, dust comes through the door: a fan of grit on the floor inside every street door, dust in
the corners, and a sunbeam with motes in it where a room has a high window.

## The town, as it stands

```
         868        869       870        871       872          873
1953              (range)                                      (Layover's 2nd tile)
1954    Mike's   Trig.Happy Dry Goods   Dynamo   Coyote's Rest  Layover     (all face south)
1955  ═══════════════════ Main Street ════════════════════════════════════
1956   West Lots  Back Trk  Long Soak  Field Rd                             (Long Soak faces north)
1957   West Lots  Back Trk  Bath Yard  Field Rd
1958   West Lots  Back Trk  Buzzard F. Field Rd  Last Load                  (both face west)
1959   ═══════ Boot Ground ═══════════════════ Scarletwastes Road ════════
```

Grid numbers are the zone ids' (the tiles moved south and the ids didn't; the real grid is
908..913 by 1037..1042). Only the motel grows. Moving a tile resizes its building, since `fh`/`h`
are seeded from the tile, so no building moves.

## Who works where, and who lives there

Two people per business, each with a room upstairs. A shop open 18 hours runs 06:00 to 24:00 in
two shifts of nine hours, early (06 to 15) and late (15 to 24). The bar and the garage run two
shifts of twelve, days (06 to 18) and nights (18 to 06). A night shift crosses midnight, so it's
written as two blocks, `{18,24}` filed under the day and `{0,6}` under the next, as
[ai-behaviour.md](../ai-behaviour.md#a-schedule-block-and-the-night-shift) says, or it's no shift at all.

| Business | Hours | Shift A | Shift B | Lives upstairs |
|---|---|---|---|---|
| The Coyote's Rest (bar) | 24 | new day bartender, 06 to 18 | Marla Kest, 18 to 06 (was 16 to 04) | both, plus Doc Teller and Del Roan |
| Mike's (garage) | 24 | Mike, new, the owner, 06 to 18 | Hollis Tam, recast, 18 to 06 | both |
| The Dry Goods | 18 | Jethro Peake, early | new clerk, late | both |
| Trigger Happy (gunsmith) | 18 | Isla Calder, recast, early | new gunsmith, late | both |
| The Long Soak | 18 | Tullia Mercado, early | new attendant, late | both |
| The Dynamo | 18 | Bram Odell, early (was 08 to 20) | new grid hand, late | both |
| Buzzard Field | 18 | Cass Renner, early | new pilot, late | both, in the crew loft |
| The Last Load | 18 | new depot hand, early | new depot hand, late | both |
| The Layover | 24 | Amos Dune, no schedule, as now | none | Amos's Room |

That's nine new people. Isla Calder and Hollis Tam come with their old plots: an assayer knows
metal, and Hollis has the hands for a night shift under a car. Mike owns the garage and works days;
his full name is chosen when he's written, and no NPC is called Mike today. Every new name is unique
(content:lint checks), and each gets bespoke `clothing_layers`, banter in threads and a
`first`/`known` greeting. Isla's and Hollis's descriptions, clothes, banter and greetings are
rewritten for the new trades.

**Exceptions, and why:**

- **The poker table stays nocturnal.** Doc Teller deals 18 to 03 and Del Roan plays 19 to 02, as
  David chose in July. They work the table, not the bar, so the bar's 24 hours don't touch them. They
  move from the motel to rooms over the saloon.
- **Amos keeps no schedule.** He's always at his counter, as now, because the raws trade and the
  dead drops start with talking to him, and putting him to bed would lock the smuggling chain
  behind the clock. That's the motel's 24 hours, with no partner. He keeps Amos's Room.
- **Windy Marsh** is the bar's regular, not its staff. His home is the saloon floor today; he moves
  into a motel room, which is what the motel is now for.

**The motel after the move.** Cass, Marla, Bram, Doc and Del leave their cabins for their
workplaces. Amos keeps his room and Windy takes one, which leaves the rest for players:
`flags.is_apartment` and a `flags.rent_cost` on each, rented with the ordinary `rent` verb
([systems-economy.md](../systems-economy.md#housing--apartments)). The rooms over the businesses are
never apartments, so a player can't rent the room somebody sleeps in. Every NPC's home gets an
`npc_residences` file, since `home_zone` alone doesn't mark a room as lived in.

### The handover: the counter is never empty

With the home upstairs the commute is one flight of stairs, but on the default vendor graph the
outgoing person still walks off at the hour and the relief only sets out once their shift has
started. The marina already solved this for its two desk clerks
([plugins/powerboat/README.md](../../plugins/powerboat/README.md#the-desk)) with two conditions in
`plugins/powerboat/desk.js`:

- `DESK_SHIFT_DUE`: off duty and the next shift starts within the walk, so they come down early.
- `DESK_RELIEVED`: at the end of a shift they stay until the other one is standing there on shift.

This plan lifts those two into one shared place keyed on a partner (`flags.shift_partner`, the
other person's id), moves the marina onto it, and gives every Reach business the same graph. Which
side of the engine/plugin line it lands on is decided by the tests in
[engine-plugin-boundary.md](engine-plugin-boundary.md); it sits beside `CHECK_VENDOR_WORK`, which
is engine.

### Nobody talks about their schedule

The game already has two lines that quote a shopkeeper's hours, and the charter desk has a third:

- `vendorClosedLine` ("I'm off the clock right now. I open again in about 3 hours.")
- `vendorOffHoursLine` ("Not now. I'm off the clock. Back in about 3 hours.")
- the charter desk ("Cass Renner flies the 0800–1600 shift and isn't here.")

For anyone with a shift partner, none of them is said. Instead:

- **The trade goes to whoever's on.** `shop`, `buy`, `sell` and the counter's Shop pick the
  on-shift partner. The one who's off is an ordinary person in the room: no `Vendors here:` listing,
  and talking to them opens their greeting and chat with the trade options left out, and no line
  about why.
- **When both are off** (a shop between midnight and six), the door says it in narration with no
  time: the shutter's down and the neon's off. No "opens again in".
- **The charter desk** sends you to whichever pilot is on, and when neither is, says the desk is
  shut and nothing more. Its 8-hour shift is a constant (`SHIFT_HOURS` in `plugins/flight/charter.js`);
  it becomes a per-pilot `shift_hours`, so two pilots cover 18.
- **Every line written for these people** (greetings, banter, barks, dialogue, the bartender
  plugin's coworker lines for Marla and the new day bartender) is kept off hours, shifts, being
  relieved, the other person's shift and being tired from nights. Same for the existing Reach
  people's lines, which get read through for it.

## The buildings

Each entry says what the building becomes from the street, its neon, and which rooms it has on
each floor. The names, the poker table, the job board, the raws counter and every system already
wired to the seven kept buildings stay as they are. These are the plan's first ideas for each;
the arm is where they get better.

Room sizes are first guesses in metres. A tile is 17.9 m and a storey 3.5 m. **Rooms fit the
model**: the arm is drawn first and each room is laid out to fit inside it, the way the Embassy
and the Yards were fitted. Stairs are `flags.room.stair` on the room below
([building-stage.md](building-stage.md#stairs-built)).

**The upstairs, by default.** Unless an entry says otherwise, a business's upper floor is a flat
for its two people: a landing off the stair, a kitchen-living room with a cooker (so it's a kitchen
on the Stage and in GLASS), and two small bedrooms, one each. Lived in: a bed made or not, clothes
on a chair, a mug, one thing that says who they are. Each bedroom is its person's `home_zone`.

**Inside, the neon comes in too**: a sign behind a counter, a tube round a mirror, the glow of the
front's sign through the window. Wall signs use the `neon`, `channel` and `lightbox` styles that
already exist ([wall-signs.md](../reference/wall-signs.md)).

### The Coyote's Rest (bar, 872,1954): the bar for the rest

The town's saloon and its parlour, open all day and all night, and the building most players walk
into first. It sets the standard the other eight are held to, as Screw It does for shops and the
clone facility does for a small building.

- **From the street.** Two full storeys of timber behind a tall false front, the upper storey with
  a gallery across the width of the building on posts that carry down to the porch. Batwing doors
  under the porch roof, and a lit window either side. Corrugated tin over the porch, shake on the
  main roof, a satellite dish and two cameras on the eaves, an air conditioner in one upstairs
  window. A hitching rail with bikes chained to it and a charging post.
- **Neon.** The badge from the mock, standing on the false front: the howling coyote in circuit
  traces, the rope ring, the cactus and gears, COYOTE'S REST, SALOON & OUTPOST, EST. 2065. It's
  the biggest and brightest sign in the Reach and it never goes off; one letter flickers. Under the
  gallery, a round beer lightbox either side of the door, and a holo screen with a pint on it. Inside,
  a smaller tube coyote over the back bar.
- **Ground floor.**
  - *The Saloon Floor* (lobby, about 14 by 11): the bar along the right with a timber top and a
    brass rail, the poker table, the job board on a dusty screen, a player piano that plays a
    punched roll, the stair. The poker table stays `gametable_coyote` and keeps its furniture ids.
  - *The Stash* (cellar): a trapdoor behind the bar, down a ladder to a vault with racks of sealed
    crates. It already exists; it gets a spec.
- **Upstairs.** Not the default flat, since four people live here.
  - *The Gallery* (new): a balcony over the floor, looking down on it through a rail, with two
    booths. Public. A door onto the outside gallery over the street.
  - *The back passage* (new): a door off the gallery marked private, and four small rooms off it:
    Marla's, the day bartender's, Doc's and Del's. A shared washroom.

### The Layover (motel, 873,1954 and 873,1953)

Amos Dune's motel and the raws counter. Now for Amos, Windy Marsh and players.

- **From the street.** A two-storey timber motel in an L over both tiles: the office on Main Street,
  the rooms running back along the second tile. Every room's door opens onto a walkway, on the ground
  and on an upper gallery reached by a timber stair up the outside. Corrugated roof, an air
  conditioner in every window, a water tank on legs at the back. A dish on the office roof.
- **Neon.** MOTEL in orange box letters on the roof, and a VACANCY sign under it still missing its
  C. A magenta tube round each room's window, and a cyan number over each door; a room that's taken
  shows its number lit.
- **Rooms.**
  - *Front Office* (lobby): Amos's counter, which stays the raws counter (`flags.raws_counter`), a
    key board, a fan, a holo screen with a room key turning on it.
  - *Amos's Room* (upstairs over the office).
  - *The Walkway* and *the Upper Gallery*: the covered walks along the rooms. Two rooms today because
    it was two tiles of corridor; it becomes one per floor.
  - *Eight rooms*, four down and four up: Windy's and seven to rent. Each about 3.5 by 5, a bed, a
    chair, an air conditioner rattling in the window, a washroom behind a door. The old named cabins
    (Cass's, Marla's and the rest) become numbered rooms.
- **The second tile.** 873,1953 is "The Town Flats", open scrub. Run `scripts/content/sitecheck.mjs`
  on it before anything else: an open tile is usually somebody's way through. The building spreads
  over both tiles as in [multi-tile-buildings.md](multi-tile-buildings.md), whose general system is
  still design, so the motel either waits for it or is done the Solenne's way, each tile drawing its
  own half.

### The Dynamo (power, 871,1954)

Every wire in the Reach runs back here. Today a scorched genset shack.

- **From the street.** A two-storey timber house in front, scorched up one wall, with the grid
  hands' flat upstairs. Behind it, a corrugated battery shed, a small wind turbine on a lattice
  mast, the one roof in town that's all solar panel, and the old diesel genset still bolted to the
  side, kept for the storms. Every power pole in town starts here, so the cables fan out from its
  roof like spokes.
- **Neon.** No name: the Dynamo doesn't advertise. A row of three big lamps over the door, green,
  amber and red, that show the town's real power state from the power sim. When the Reach browns
  out, the street can see it, and every other sign in town flickers with it.
- **Ground floor.**
  - *The Switch Room* (lobby): a wall of breakers, a hand-lettered board of who's on which circuit,
    a chair, the stair.
  - *The Battery Hall* (was the Turbine Floor): battery cabinets in rows with their status lights,
    and the genset's end in the far wall behind a mesh guard.
- **Upstairs.** The default flat, for Bram and the new grid hand.

### The Dry Goods (mercantile, 870,1954)

The widest front on the street and the town's only general store.

- **From the street.** The widest false front, squared off and kept true, over a long porch, with
  a real upper storey behind it: two sash windows and a door onto a balcony over the porch roof.
  Bins and barrels on the boardwalk. On the roof, a drone cage: a mesh landing box where deliveries
  come in by air, with a drone parked in it.
- **Neon.** The name painted white on the false front, as now, lit from below by a row of
  gooseneck lamps; SUPPLY in cyan tube in the window, and an OPEN sign that's honest about it.
- **Ground floor.** Follows [shop-interiors.md](shop-interiors.md) step for step.
  - *The Dry Goods Floor* (lobby): a long counter with `serves`, shelving with `look.stock`, a
    ladder on a rail to the top shelf, a barrel, a vending column of water.
  - *The Stockroom* (new): racking, the stair, and the drone lift coming down through the ceiling.
- **Upstairs.** The default flat, for Jethro Peake and the new clerk. Both carry the same stock
  list.

### Trigger Happy (gunsmith, new, 869,1954, in place of the Assay)

A lawless town that flies its own cargo needs somebody who can fix a gun. Isla Calder, who weighed
the town's metal at the Assay, now works it.

- **From the street.** A narrow two-storey timber front, boarded tight, with heavy double doors
  strapped in iron and a steel shutter over the shop window. A fume extractor on the roof and the
  flat's window over the sign. Out back on the open scrub (869,1953), a short range behind an earth
  bank, so you hear shots from the street now and then.
- **Neon.** TRIGGER HAPPY in orange box letters across the front, GUNSMITH in cyan under it, and a
  holo screen either side of the door with a rifle turning on it.
- **Ground floor.**
  - *The Counter* (lobby): long guns on a wall rack behind steel mesh, a glass case of pistols, a
    vise on the bench.
  - *The Workshop* (new): a lathe, a parts printer, cleaning tanks, barrels in a rack, the stair.
  - *The Range* (new, optional): a long narrow room out back with two lanes.
- **Upstairs.** The default flat.
- **Trade.** Both gunsmiths are flagged `repairman`, so the workshop is a repair bench under
  [systems-durability.md](../systems-durability.md), and both sell weapons and ammunition. The back
  room at the Layover already sells contraband guns; this is the honest counter for the same trade.

### Mike's (garage, new, 868,1954, in place of the Quiet Trade)

The first building you reach walking in off the Coldwater Road, so it's the one that fixes what the
road broke. Open all day and all night. Mike owns it and works days; Hollis Tam, who ran the Quiet
Trade, works nights.

- **From the street.** A timber false front over a ground floor that's nearly all door: a roller
  shutter onto a double-height bay with a hydraulic lift in it, and beside the bay a two-storey wing
  with the parts counter below and the flat above. A charging post and a fuel pump on the boardwalk
  edge, tyres stacked against the west wall in the drift, a hover car on blocks with its fan housings
  off.
- **Neon.** One sign over the shutter, all of it tube: "Mike's" in big script, a wrench under it,
  and "Mechanic & Garage" in smaller letters below, in blue-white, the colour of a welding arc. It
  never goes off. The name is on the building once, here.
- **Ground floor.**
  - *The Bay* (lobby, entered through the shutter): the lift, a workbench, a parts wall, an
    inspection pit with a plank over it.
  - *The Parts Counter* (new): a counter, bins of salvage, a till, the stair.
- **Upstairs.** The default flat, over the parts counter only, since the bay is open to the roof.
- **Trade.** Both mechanics sell parts and tools. Servicing a vehicle here (a hover car or bike
  brought into the bay) would be the depot shell's maintenance bay
  ([depot-shell.md](../reference/depot-shell.md)) away from a depot, which nothing does yet; it's a
  later phase, and the garage opens as a parts shop first.

### What happens to the Assay and the Quiet Trade

Both go in the [stored-buildings register](stored-buildings.md) with a row each, as every building
taken off the map does. Their arms (`assay`, `undertaker`), rooms and furniture are kept, not
deleted, so either can stand somewhere else later. Nothing else in the game reads them: neither
keeper is a vendor and no plugin names their rooms. Their keepers, Isla Calder and Hollis Tam, stay
in town in the new trades.

### The Long Soak (bathhouse, 870,1956)

A long low bathhouse on the south side of Main Street with a boiler stack and a thread of steam.

- **From the street.** A two-storey timber front block on the street, with the desk below and the
  flat above. Behind it, the long low bath hall stays one storey, with its boiler stack and a row of
  steamed-up skylights along the ridge. A water condenser beside it and header tanks on the roof.
  It's the one building in the Reach that's wet, and the ground round its drain is darker.
- **Neon.** The name in mismatched tube letters, one in each colour, the A upside down as it's
  painted now. Steam from the stack drifts through the glow.
- **Ground floor.**
  - *The Front* (new lobby): the desk, towels, a price list on a dusty screen, the stair.
  - *The Soaking Room* (today's lobby): timber tubs in a row under the skylights, steam, tile.
  - *The Boiler Room* (new): the boiler, the condenser's tank, a wall of gauges.
- **Upstairs.** The default flat, for Tullia Mercado and the new attendant, over the front block.

### Buzzard Field (hangar, 870,1958)

The airfield, and the easy way in.

- **From the street.** A big timber-framed hangar clad in corrugated tin, its doors on rails, with
  a two-storey timber lean-to along one side and the spotter's tower rising out of its far end: a
  lookout on stilts with a turning radar dish and a cluster of antennas. The limp windsock, and the
  buzzard on the ridge.
- **Neon.** BUZZARD FIELD in orange over the hangar doors, and the strip's approach lights, a line
  of red and amber posts. The board stays: "No manifests. No questions."
- **Rooms.**
  - *The Hangar Bay* (lobby): already specced. Refit to the new model. The stair it already draws on
    its back wall leads into the lean-to.
  - *The Crew Loft* (new, the lean-to's upper floor): the default flat, for Cass and the new pilot.
  - *The Spotter's Tower* (new, above the loft): the charter desk, the radio, a window all round over
    the strip, departures on a screen.

### The Last Load (truck depot, 872,1958)

The rig depot at the head of the Scarletwastes Road. It has nobody today.

- **From the street.** A long timber drive-through shed with a roller door at each end, so a rig
  drives in one side and out the other. A charging gantry for hover rigs over the apron
  ([hover-rigs.md](hover-rigs.md)). On the side, a two-storey timber office block with a window onto
  the bay below and the flat above.
- **Neon.** The name across the lintel stays painted. By the road, a tall pole sign with the trade
  word in amber and an arrow in cyan pointing into the yard.
- **Rooms.**
  - *The shed* and *the bunkroom*: already specced. Refit to the new shed. The bunkroom stays for
    drivers passing through.
  - *The office* (new): the bunkroom's description already says it's "the room behind the office",
    and there isn't one. The stair.
  - *Upstairs*: the default flat, for the two depot hands.

## The street between them

Main Street is where the town is seen from, so it gets its own pass after the buildings:

- **Boardwalks that join.** Today each porch stops at its own plot. Joined, the six fronts on the
  north side become one covered walk, broken only at the Field Road crossing, with the upper
  galleries above it.
- **Power poles** from the Dynamo along both sides, the cables sagging between them, a transformer
  on every other pole.
- **Street lights**: a tube on each pole, amber, low.
- **Parked vehicles**: a hover bike or two at the rails, a quad, now and then a hover car. Drawn by
  the street life that already parks cars, not as fixed props.
- **Water**: a public tap off the Long Soak's condenser, with a trough.

The Coldwater street kit is Coldwater's and isn't used here. This is dressing on the dirt tiles,
done as a `mark` or a dressing like the park ones in `glass/park-formal.js`. The mesas in the
concept's distance are the wildlands ground's job ([systems-wildlands-ground.md](../systems-wildlands-ground.md)),
not this plan's.

## What's new for the engine

Most of this is content and arms. A few pieces are shared code and need building once.

### What's new for GLASS

- **A neon sign kit.** Today's tube signs are lettering. The Reach needs: box letters with lit faces
  (`channel`), tube script, and **badges**: a sign drawn as a path of tubes (letters, an outline
  animal, a ring), a colour that can run along a tube, a backing board, standoffs, the gaps where a
  tube passes behind, a transformer box and its cable. Off by day it's pale glass; on, it's emissive
  with a glow pool on the boards and the boardwalk. The badge is drawn once as a texture with an
  emissive mask and laid on as a decal, so the coyote costs one quad, not a hundred tubes.
- **Neon that follows the business**: off when its business is shut, one tube failing somewhere on
  the street, and every sign flickering in a brownout.
- **Holo screens**: a cyan panel with a looping picture, scan lines and tearing, as a decal off the
  wall clock. One per building at most.
- **The kit**: dish, antenna, air conditioner, camera, small solar panel, junction box, power pole
  with sagging cable. Helpers beside `westPorch` and the rest, so nine arms don't each build their
  own, affine in `fh`/`h`.
- **Two-storey timber**: an upper gallery on posts, an outside stair, corrugated tin as a rust
  palette for sheds and patches.
- **A dust term** in the Reach palettes and the windward drift as an emitted face, so it's in the
  shape bake and gets LOD and shadow for free.
- **Two new building types**, `gunsmith` and `garage` (neither exists today), each with an icon in
  `client/game/assets/zone-icons/`, a `BUILDING_TYPE_ICON` row and a type model, in the same build.
- After every arm: `npm run shapes:smoke`, `npm run shapes:bake`, `npm run lite:bake`, and a new
  map icon for any building whose silhouette changed.

### What's new for ROOM

- **Neon inside**: the existing `neon`, `channel` and `lightbox` wall signs, and the front's sign
  lighting the room through the window.
- **Dust in the room**: the fan at the door, the corners, motes in the light. Decals and a light
  shaft, no new system.
- Every room is walked in GLASS ([one-world-interiors.md](one-world-interiors.md)) and on the Stage,
  stairs included. `npm run oneworld:coverage` counts it.

### What's new for people

- **The shared handover**: `DESK_SHIFT_DUE` and `DESK_RELIEVED` lifted out of the powerboat plugin,
  keyed on `flags.shift_partner`, the marina moved onto them, and regress holding both.
- **Partnered vendors don't talk about hours**: trade verbs pick the on-shift partner, the off one
  isn't listed as a vendor and their talk leaves out the trade options without a line, and a shut
  shop says so with no time. `vendorClosedLine`, `vendorOffHoursLine` and commerce's door gate check
  for a partner first.
- **Charter pilots by the shift length they're given**: `shift_hours` per pilot in place of the
  fixed `SHIFT_HOURS`, and the closed desk's line without the hours.
- **A second bartender voice** in the bartender plugin's `VOICES`, paired with Marla as her coworker,
  as Doc is now.
- **Check how stock is held.** If a vendor's stock runs down per NPC, two partners with one shop
  need one pool, or the shop holds different stock depending on who's on.

## Rules every building is held to

- [The clone facility bar](../reference/building-styles.md#45-the-clone-facility-is-the-bar-for-a-small-building):
  a frontage that tells its story, built parts, a real door, night drawn on purpose, four sides.
- **The concept art is a starting point.** Match its spirit, then do better: a detail the art
  doesn't have is welcome if it's in the same town.
- **At least two storeys, with somebody living upstairs.**
- **Rooms fit the model.** Never move the model to fit a room.
- **The interior's exit is the facade's `flags.entrance`**, never `out`.
- **Every room has `flags.room`**, doors that match the model's openings, a `street_door` on the
  room you enter from the street, and `panes` where the model draws a window.
- **New rooms get lit and powered in the same build**: a junction box on `gen_region_region_the_reach`,
  a fixture, and the lights one-shot.
- **New rooms get a `connections` file**, or `content:lint` fails.
- **Every resident gets an `npc_residences` file**; no business room is an apartment.
- **New people get unique names**, bespoke clothing, threaded banter and a `first`/`known` greeting,
  and nothing they say mentions their hours.
- **No em dashes** in any new prose, and player-facing prose follows [house-voice.md](../reference/house-voice.md).

## Order of work

Each phase is a commit or a few, and the game works after each. Each building phase includes its
two people, their schedules, their rooms upstairs and their residences.

| Phase | What | Done when |
|---|---|---|
| 0 | The style: the neon sign kit with the Coyote's badge as its first sign, holo screens, the bolted-on kit, two-storey timber, the dust term. building-styles.md §2.8 rewritten | The Modelshop shows the badge lit at night and pale by day, and a two-storey front with its kit, next to the mock |
| 1 | The people code: the shared handover, partnered vendors that don't quote hours, per-pilot charter shifts | Regress shows a partnered shop handing over with nobody gone from the counter, and no line from a partnered vendor carries a time |
| 2 | The Coyote's Rest: arm, every room on both floors, the day bartender, Marla's new hours, Doc and Del moved upstairs | It passes the clone-facility checklist, every room is in `oneworld:coverage`, and the bar is staffed at every hour of a game day |
| 3 | The Dynamo (with its lamps) and the Dry Goods | The same, for each |
| 4 | Trigger Happy and Mike's: types, icons, people and stock; the Assay and the Quiet Trade stored | The same, and both counters sell at every open hour |
| 5 | The Long Soak, Buzzard Field, the Last Load | The same, for each |
| 6 | The Layover on two tiles; its rooms to let | Sitecheck passes; every room walked; a player can `rent` one |
| 7 | The street: boardwalks, galleries, poles, lights, parked vehicles, the tap | Main Street read from the Field Road crossing at noon and at 22:00, against the region concept |
| 8 | Dust in motion: the dust devils and roof grit | Seen moving in the browser; costs nothing measurable on `__benchRoute` |
| later | Mike's services vehicles in its bay | A hover car brought in gets the maintenance bay |

Phase 2 goes first among the buildings on purpose: it's one building, it uses every new piece, and
David looks at it before the others copy it. Until a building's phase lands, its people keep the
hours and homes they have now, so moving them out of the motel happens one building at a time.
