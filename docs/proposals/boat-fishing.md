# Boat fishing

**Status: phases 1 to 3 are built (2026-10-27): the Keel Mk 1 with her first-person seat, `boat anchor`, the fish sim (`client/shared/fish.js`), the reel (`boatfish.js`, `boatfish-rules.js`), rod mode and the cast in both views, the server loop (`plugins/fishing/boat.js`) and the fish box (`boat_hold`). The shadows, the logbook, the forecast broadcast and the passenger are design.** It's a cozy fishing sim on top of the boat system. You buy a basic two-seat skiff with a small fish box, drive her in first or third person to a spot, anchor, and cast at any bearing and distance into fish that are simulated swimming. Each water has its own species and difficulty. It works only from a boat. Shore fishing ([systems-fishing.md](../systems-fishing.md)) stays exactly as it is.

Decided with David on 2026-10-26:

- fish are visible shadows under the surface;
- catches go into the boat's fish box, which is capped by weight;
- the second seat is a later phase.

And on 2026-10-27:

- the hull is the **Keel Mk 1**, built in the Shed by the man who sells it;
- a bite is struck on the dip: the float dips and you have about a second;
- there's a daily fishing forecast on the radio, worked out from fish.js and read by ORACLE (§7).

## What it reuses

| Need | Exists | Where |
|---|---|---|
| Owned boats: buy, hire, service, berths | three Vaskin speedboats | `plugins/powerboat/`. Hull rows are in `client/game/js/panels/flight-model.js` `TYPES`. Geometry rows are in `content/vehicle_models/boat_*.json`, built by `client/shared/boat-house.js`. |
| First and third person | `st.external`; V/F and ◎ EXT switch it; the chase orbit zooms 0.55–3.2 | `client/game/js/panels/boat-view.js` (`setExternal`, `boatFrame`) |
| Text helm | `conn` bells; `stepBoat` once a second | `plugins/powerboat/texthelm.js` |
| Live position | the client sends `boatsync` every 250 ms and the server trusts its x/y. RAM `rigs`; the row is flushed every 10 s | `helm.js` `cmdBoatSync`, `flushRig`. `adrift.js` `livePosition`, `zoneUnder`, `STEP_OFF_MPH = 2`. |
| Depth | `seabedDepth(x, y, isLand)` in metres. The shelf approaches 42 m (`SHELF_K` is 7 tiles) and drops off from 28 tiles. Also `seabedMaterial` and `wrecksNear` (14-tile cells). | `client/shared/seabed.js`. The server already calls it (`plugins/submersible`). |
| Animals that need no storage | a flock is a pure function of its anchor tile and the wall clock. The species table is in the same file, and the server's prose and the client's drawing call one module. | `client/shared/birds.js` (`flockAt`, `flocksNear(…, isHabitat)`, `flockState`) |
| A hash JS and GLSL agree on | `hn2h`, an integer mix with no `Math.sin` | `client/shared/landform.js` |
| The reel minigame | phases `aim → charging → await → fight`; `generateFight(skill, difficulty, castPower)`; `armFishFight` | `client/game/js/panels/fishing.js`, `textfishing.js`, `minigame-common.js` |
| Shore fishing on the server | the token handshake, the rod and bait gates, `maybeSnapRod`, `awardSkillUse(margin)`, `fish.caught` (quests count it), `settleLogBite` | `plugins/fishing/index.js` |
| Time and weather at sea | `getEnvironmentState()`, `getZoneWeatherType()`, `getZoneSeverity()`, `getMoonPhase()`, `seasonForDate()` | `server/engine/environment.js` |
| A market | seven `raw_fish` items, ₵4 to ₵75. The fishmonger `npc_cod_fawle` pays 0.7× for them. | `server/engine/vendor.js` `computeSellUnitPrice` |
| Tablet apps | `registerTabletApp` | for example `plugins/bounty/tablet-app.js` |
| Accolades | one object per entry, keyed on an event | `plugins/accolades/catalog.js` `ENTRIES` |

**Verb names.** `cast` belongs to surveillance and `haul` to trucking. Boat fishing goes under `fish` (the fishing plugin) and `boat …` (the powerboat plugin).

**What doesn't exist yet:**

- an anchor;
- seat or cargo fields on a hull;
- any link from fishing to boats (`fishingTableFor` refuses water tiles);
- a weight on each fish;
- a fish journal;
- a way for the client to know the server's time.

## 1. The boat (powerboat plugin)

**The hull** is a fourth `TYPES` row, the **Keel Mk 1**: a 16 ft riveted aluminium open skiff with a 15 hp tiller outboard. Keel builds her in the Shed and sells her across his own desk.

- She's slow, about 18 mph flat out, but steady in a swell, with a wide `hullBeam` and a low `driftTau`.
- She costs ₵3,900. Keel sells and hires her at the Eastern Marina, the cheap yard. Both marinas service her.
- "He'll fix it if it breaks. He says it won't."

**New hull fields.** A missing field means none, so the three speedboats don't change.

| Field | Skiff | Read by |
|---|---|---|
| `seats` | 2 | boarding (phase 5) |
| `hold_kg` | 40 | the fish box |
| `rodHolders` | 2 | how many lines can be out (phase 4 trolling) |
| `rode_m` | 30 | how deep the anchor reaches |
| `lamp` | true | night fishing |

**The seat.** In first person you sit on the stern thwart with the tiller under your right hand. She's an open boat, so `pushInteriorShell` needs an open-boat shell: gunwales, thwarts and the fish box, and no pilothouse.

Every control you can see works and is lettered in the legend face, to the Drake standard ([cockpit-lettering.md](../reference/cockpit-lettering.md)):

- the twist-grip throttle;
- the kill cord;
- the choke;
- the fuel primer bulb;
- the anchor cleat;
- the lamp switch;
- the fish box lid;
- the rod holder.

The chase view doesn't change. She uses the existing berths, so there are no buildings to make.

**The tiller.** She steers by the tiller, which turns her slowly and stern first. That's a `turnLock`/`turnFade` tune, not new physics.

## 2. Anchoring (powerboat plugin)

**The verb.** `boat anchor` drops the anchor. So do the A key and the cleat. `boat anchor up` weighs it.

- She has to be under `STEP_OFF_MPH` with the engine in neutral.
- She can't anchor on a berth tile.

**The bottom decides.** If `seabedDepth()` under her is deeper than `rode_m`, the anchor doesn't hold: "The anchor goes down and keeps going. Nothing at the bottom of thirty metres of rope."

- With the 30 m rode, that's roughly the first 9 tiles off a shore, plus shallow banks where the floor's relief comes up. Working: 42·(1−e^(−d/7)) = 30 gives d ≈ 9.
- The chandlery sells a 60 m rode, which reaches the whole shelf floor and puts the shelf edge in range.
- The Deep past the drop-off never takes an anchor.
- The rode, rod and lure are the upgrade ladder.

**At anchor.** The rig carries `anchored: { x, y, at }` in RAM, and in `custom_data` when it's flushed. The engine is cut.

- **The client** holds her to a swing circle round that point, about 0.3 tiles across, and turns her head to the wind and the swell.
- **The server** clamps any report from outside the circle back onto it in `cmdBoatSync`, straight after the parse. The anchor point is the server's.

**Weather.** Above a severity threshold the anchor drags, and the circle widens over a few minutes. A storm pushes you towards shore rather than killing you outright. In rough water the fish go deep.

**Leaving her.** A boat left at anchor stays where she is. `adrift.js` already keeps a water tile in `berth_zone`; the anchor adds the exact point. Towing doesn't change.

## 3. The fish (new `client/shared/fish.js`, built like birds.js)

### Species

The `SPECIES` table is in the same file, as in birds.js. Each row has:

- `item`, the catch's item id;
- `depth`, a band in metres;
- `shore`, a band in tiles from shore;
- `floor`, the seabed materials it likes;
- `wreck`, how much it likes a wreck;
- `hours`, when it's active;
- `light`, whether a lamp draws it;
- `weather`, what weather it likes and dislikes;
- `school`, the smallest and largest school;
- `speed`, its cruising speed in m/s;
- `cruise`, the depth it prefers at each hour (most come up at dusk);
- `difficulty`;
- `kg`, its smallest, commonest and largest weight;
- `fight`, its fighting style;
- `wary`, how close you can get before it spooks.

The seven shore catches each get a home water, and there are five new species you can only catch from a boat. The new names are placeholders for the content pass.

| Species | Water | When | School | kg | Difficulty | Fight |
|---|---|---|---|---|---|---|
| sludge carp | silt, under 6 m, near shore | any time | 4–9 | 0.5–2 | 2 | steady |
| carp (`item_fresh_catch`) | sand or silt, 2–10 m | day | 3–7 | 1–4 | 3 | steady |
| razorgill | rock, 8–20 m | dawn, dusk | 6–14 | 0.4–1.2 | 4 | runner |
| irontooth bass | rock and wrecks, 6–18 m | day | 2–5 | 1.5–5 | 6 | jumper |
| ashen pike | wrecks, 10–30 m | dusk, night | 1 | 3–9 | 8 | runner |
| glass eel | anywhere; rises after dark | night, under a lamp | 8–20 | 0.1–0.3 | 7 | wriggler (needs bait, as now) |
| coldwater sturgeon | the shelf floor, 35 m and deeper, silt | night | 1–2 | 8–25 | 10 | sulker |
| *new* lamp herring | mid-water, 5–25 m | night, under a lamp | 20–40 | 0.2–0.4 | 2 | steady |
| *new* chrome mackerel | open water, 10–30 m | day | 12–25 | 0.6–1.5 | 5 | runner |
| *new* sand skate | sand flats, 8–20 m | any time | 1 | 2–8 | 6 | sulker (a wide flat shadow) |
| *new* wreck grouper | wrecks only, 15–40 m | day | 1 | 6–20 | 9 | sulker |
| *new* slate cod | rock and silt, 20–42 m, cold | winter, night | 3–8 | 2–10 | 7 | steady |

The new catches are `raw_fish` items in `content/items/`. A gate fails if a species' `item` is missing or doesn't have the `raw_fish` tag; without it the fishmonger pays the ordinary rate ([fish-works.md](fish-works.md)).

### Schools

A school is worked out, never stored.

- **The grid.** Water is cut into cells of 4×4 tiles (`SCHOOL_CELL`, 28 m). `schoolAt(cx, cy, habitat)` hashes the cell to decide whether it holds a school and which species. The habitat at the cell centre weights the choice.
- **The hash** is `hn2h`, not `frac(sin)`, so Node and every browser agree to the bit.
- **Habitat is handed in.** fish.js never looks anything up on the map. The caller passes `habitat(x, y)`, which wraps `seabedDepth`, `shoreDistance` and `seabedMaterial` with its own `isLand`, as seabed.js requires.
- **Listing them.** `schoolsNear(x, y, R, now, env, habitat)` lists the schools in range.
  - `env = { hour, doy, weather, severity, moon }` comes from the server's environment and is sent to the client when you anchor.
  - A school of a species that isn't active at this hour isn't there at all.
- **Movement.** `schoolState(s, now)` gives a school's centre, heading, depth and speed.
  - Each school swims a loop round its cell centre, made of two ellipses whose periods never line up, and it stays inside the cell's habitat.
  - It bobs up and down, and its depth follows the hour.
- **Single fish.** `schoolFish(s, i, now)` gives each fish's position in the school and its weight, both from the hash. The big shadow really is the big fish, so you can wait for it.
- **Time.** Every function takes `now`; none reads `Date.now()` itself, and a gate checks that.
  - The client runs on the server's clock. The anchor push carries `serverNow`, the client keeps `skew = serverNow − Date.now()`, and it passes `Date.now() + skew`.
  - The fish cruise at 0.3–1 m/s, so a client clock a few seconds off would put the shadows metres from where the server thinks they are.
- **Fishing a school down.** The server keeps a RAM map, `schoolId → { taken, at }`, that recovers over about a game day.
  - A school that's been fished has fewer fish (`schoolFish` gets `n − taken`) and spooks more easily.
  - The anchor and cast replies carry `thinned: { id: n }` for schools in range, so the shadows agree.
  - Nothing is saved, so a restart refills the sea.
- **Residents.** Every wreck on the shelf is somebody's home. A cell school only finds a wreck when its anchor happens to fall within 2.5 tiles of one, which on the real coast was about one wreck in three, so the wreck grouper (which lives nowhere else) never turned up at all. `wreckResident` anchors a school on the wreck itself, drawn from the species that love wrecks, and gives it the wreck's id. A wreck is a place you can go back to.
  - Round Coldwater there are three wrecks on the shelf: a pike on the container stack at 878,887 after dusk, bass on the skiff at 930,888, and the only grouper in the bay on the container stack at 944,884.
- **Cost.** The server reads no tables. It runs hashes and `seabedDepth` over at most (2R/4)² cells, about 25 at R = 10. It only does that on anchoring, on a cast, and on the once-a-second bite check for players with a line in the water.

## 4. Shadows (GLASS)

**A new layer,** `client/game/js/panels/gl/fish-shadows.js`: an instanced, soft-edged silhouette on the water, drawn after the water mesh. Each instance has an x, y, heading, length, species shape and alpha.

- It's separate from `gl/fauna.js`, which is built round levels of detail for bird meshes. A shadow is a flat sprite, and its own layer keeps the birds' budget out of it.

**What you see:**

- A heavier fish has a longer shadow.
- A deeper fish has a fainter shadow, using the same per-channel fade `gl/seabed.js` already has.
  - Shallower than 4 m, the shadow is sharp.
  - At 4–10 m, it's soft.
  - Deeper than that, it's a faint smudge that moves. A sturgeon on the shelf floor is just something long, down there.
- Shadows only show in daylight. At night you only see them in the lamp's light, about 1.5 tiles across, which is where the species that like light gather.

**When they're drawn:** within 10 tiles (70 m), while you're anchored or doing under 2 mph, and only where there's daylight or lamplight. Nothing is drawn while you're under way.

**GLASS 1** draws one flat ellipse per school, or nothing. GLASS 2 comes first.

**Signs on the surface** come from the same state for almost nothing:

- rings where a school is shallower than 2 m;
- a swirl when a runner turns;
- gulls working the water over herring (in phase 4, from a `fishBias` on the gull flocks in birds.js).

The same signs feed the room prose and `look water` through `describe.js`, as the flocks do.

## 5. Casting (fishing plugin, new `plugins/fishing/boat.js`)

### Starting

You type `fish` while you're aboard an anchored boat with a rod.

- `fishingTableFor` doesn't change. A new check runs before it: are you `aboard` a boat (imported from the powerboat plugin, as `adrift.js` imports `yard.js`), what's her `livePosition`, and is she `anchored`.
- If she isn't anchored: "You'd drift off your own line. Drop the anchor first."

**The fishing state.** `registerActivity` (`server/engine/activity-tick.js`) allows one registration per posture and throws on a second, and the powerboat plugin sets no posture. So boat fishing uses the shore registration: posture `'fishing'`, stateKey `fishState`, with `fishState.mode = 'boat'`.

- `onTick` and `onAbandon` check the mode. The boat's `onAbandon` line is "You reel in and stow the rod."
- The engine already ends it on combat, death or a change of room.
- The powerboat plugin ends it when you weigh anchor, take the throttle or go ashore.
- No second tick and no new scheduler entry are needed.

### Rod mode in the seat (`boat-view.js`)

- **Rod mode.** The R key, or the rod holder, puts you in rod mode. The throttle stops working, and the HUD shows the line instead: how deep the lure is, how much line is out, and the drag.
- **Both views work.** In first person you look out from the thwart over the rod tip. In chase view the camera moves in over your shoulder, with a new `boatFrame('rod')`.
- **Direction.** Moving the pointer or the stick swings the direction. It moves by how far you move it and stays where you leave it; it never follows the pointer's position on the screen.
- **Distance.** Hold Space or the button to set the distance. It goes up and comes back down, like the shore power meter.
- **The landing ring.** A ring on the water shows where the lure will land. It wobbles less the better your skill.
- **The cast.** Let go to cast. The line runs from the rod tip to the float, and the float rides `seaHeight()`.
- **Range** is a new rod field, `cast_m`: about 25 m on the first rod and 40 m on better ones.
  - That's 3.5–6 tiles, inside the 10 tiles of shadows, so you can always see further than you can cast.
  - Skill makes the cast more accurate, not longer.

### The wait

- **The lure sinks** at its own rate, from a new lure field, `sink_mps`. The HUD counts the depth down: "8 m… 9 m…".
  - A tap twitches it: a short pull that brings the lure 1–2 m back towards the boat and lifts it.
  - Holding reels it in.
  - You can just let it sit.
- **Interest.** Every server tick, each fish close enough to the lure to notice it (`attract`, counting depth as well as distance) rolls for interest. The roll is weighted by:
  - whether the bait or lure suits it;
  - how active it is at this hour;
  - the weather;
  - how much its school has been fished;
  - whether the lure has just twitched (runners like it moving, sulkers like it still).
- **The bite.** The first fish that passes takes the bite.
  - The server sends `fishing_bite { school, idx, deadline }`.
  - The client turns that exact shadow towards the lure. The two agree because both work out the same fish from the server's clock.
- **The strike.**
  - The float dips and a sound plays.
  - You strike with Space within about 1.2 s, which sends `fishstrike <token>`.
  - The server accepts a strike up to `deadline` plus 400 ms, to allow for latency.
  - The bigger the fish, the shorter the window.
- **A missed strike** frightens the school: its shadows scatter for about 20 s and the line comes back empty.

### The fight

The fight uses the reel stage in `fishing.js` through a new entry point: `openFishing({ startAt: 'fight', skill, difficulty, kg, fight })`. It starts the state at `phase: 'fight'` and calls `generateFight` directly, skipping the shore cast stage.

- `kg` sets the size of the silhouette (`menace`) and how full the creel starts.
- `fight` changes how the fish moves in `stepFish`:

| Style | How it fights |
|---|---|
| `steady` | the random walk the fish uses today |
| `runner` | darts more often, to the ends of the column |
| `sulker` | stays low and slow, and drains the creel faster |
| `jumper` | breaks the surface every so often (the target goes to 0.08, with a splash), and slack line then loses it |
| `wriggler` | short, fast jerks |

The style is passed in, so `textfishing.js` gets it with no extra work.

### Landing

`fishresolve boat 1|0 <token>` goes through a boat branch of `cmdFishResolve`.

- **Landed:**
  - The fish goes into the box with `{ kg, species, caught_at, x, y, depth_m }`.
  - The skill award is `awardSkillUse(pid, 'fishing', margin)`. The margin is skill minus difficulty, so a hard fish pays more.
  - `emit('fish.caught', { boat: true, kg, species })` fires, so quests keep counting and accolades can listen.
- **Lost:** `maybeSnapRod` runs, as it does now.
- **Either way,** the line comes back in and you cast again when you're ready. Nothing repeats on its own.

### Typed and text versions

- **Typed commands.**
  - `fish <bearing> <metres>` casts, such as `fish 40 25`. The bearing is degrees off the bow; port is negative.
  - `fish twitch`, `fish wait` and `fish reel` work the lure.
- **`look water`** describes up to three things you can see, nearest first: "A slow dark shape holds about twenty metres off the starboard bow, deep."
- **The text rung** (textgames) plays the textfishing reel with the fish's fight style.
- **The log rung** settles the strike and the fight with one fishing check against the fish's difficulty, as `settleLogBite` does.

### Cheating

- Each cast gets its own token.
- The server works out where the lure lands from the anchor point, never from the client's reported x/y. It clamps the bearing and the range to `cast_m`.
- The server picks the fish that bites.
- A strike or a resolve without a live token does nothing.

## 5b. The reel and its wire (the contract, 2026-10-27)

This replaces "The wait", "The fight" and "Landing" above. David chose it on 2026-10-27: twitch to a rhythm, strike on pulses, lean against the fish. The rules live in one pure module, `client/shared/boatfish-rules.js`, which the server and the seat both import, so the beat the client draws is the beat the server judges.

**The loop:**

1. **Cast.** Bearing and range from the anchor point. The lure lands and sinks at `SINK_MPS`.
2. **Twitch.** Each tap draws the lure `TWITCH_M` (1 m) closer and lifts it a little. Taps closer than `TWITCH_MIN_MS` count as one. Fish within `NOTICE_M` (7 m, in 3D) of the lure gain interest, more when the gaps between taps keep their species' tempo (`tempoOf`: about 380 ms for a runner, 1.5 s for a sulker). Interest fades between taps. At `REEL_IN_M` (0.5 m) of line the reel winds in by itself and you cast again; Reel in (`fish reel`) winds it in sooner.
3. **Strike.** A fish whose interest reaches `BITE_AT` takes the lure. The float knocks in pulses: `beatCount(kg, difficulty)` beats, one for a carp up to four for a sturgeon, at `beatTimes(n)`, each gap shorter than the last. Hit each inside `BEAT_WINDOW_MS`. Miss one and it spits the hook.
4. **Fight.** The fish runs left or right and changes side every `switchMs`. Lean the other way (A/D, the arrows, a relative mouse drag, or two thumb buttons on a phone). Leaning right drains its stamina, eases the tension and wins line. Leaning wrong, or not at all, loses line and builds tension. Tension at 1 snaps the line. Stamina gone and line inside `LAND_M` (6 m), and the reel winds it in by itself, into the fish box. The client plays the fight; the server refuses a win faster than `minFightMs`.

**Server to client:** one message type, `boatfish`, with a `phase`. Coordinates on the wire are in the boat's convention (a tile's centre on the integer); a caller adds half a tile before asking fish.js or seabed.js.

| phase | when | fields |
|---|---|---|
| `open` | `fish` aboard an anchored boat | `token, ax, ay, serverNow, env {hour, doy, weather, rough}, castM, skill, holdKg, holdCap, thinned` |
| `lure` | the cast is accepted | `token, lx, ly, lineM, depthM` |
| `twitch` | each accepted tap | `token, lx, ly, lineM, depthM, follow: [{ school, i }]` (the fish now following, for the shadows) |
| `reeled` | line reaches `REEL_IN_M` with no bite | `token` |
| `bite` | a fish takes it | `token, school, i, species, beats, biteAt` (server ms) |
| `fight` | every beat hit | `token, species, name, kg, difficulty, fight, lineM, skill` |
| `spat` | a beat missed or late | `token, reason` |
| `landed` | a won fight | `token, species, name, kg, holdKg, holdCap` |
| `full` | a won fight with no room | `token, species, name, kg` |
| `lost` | a lost fight | `token, snapped` |
| `close` | fishing ends | none |

**Client to server**, every one a verb a player could type:

| verb | does |
|---|---|
| `fish` | aboard an anchored boat with a rod, opens the reel (`open`) |
| `fishcast boat <bearingDeg> <rangeM> <token>` | casts; the server clamps both to the rod's reach from the anchor point |
| `fishtwitch <token>` | one tap |
| `fishstrike <beat> <hitServerMs> <token>` | one beat hit, in server time (the client's clock plus the skew from `open`) |
| `fishresolve boat <1|0> <token>` | the fight's result |

Typed, `fish <bearing> <metres>` casts, `fish twitch` taps, and `fish strike` hits the next beat. The log rung settles the strike and the fight with one fishing check, as `settleLogBite` does. A text-rung board for the boat reel is a follow-up; until it exists, textgames gets the log rung's settle.

**The seams between the four parts:**

- `client/game/js/panels/boatfish.js` is the reel: its HUD over the seat, its state machine, and the routing of `boatfish` messages. It exports `boatFishState()`, read every frame by the seat for the rod's bend, the line and the lure.
- `boat-view.js` owns rod mode: the aim, the landing ring, the cast, and drawing the rod, line, lure and splash in both views.
- The first-person shell is the skiff's open-boat interior in `client/shared/interior-*.js`.
- `plugins/fishing/boat.js` is the server, and the fish box is the `boat_hold` table (§6).

## 6. The fish box, selling and records

**The box is its own table.** Containers ([items.md](../items.md)) are `player_inventory` rows with a `container_id`, and a row inside a container keeps its `player_id`. A box row would sit in the owner's inventory and count against what they can carry, so a boat can't own one.

- The hold is `boat_hold (id, boat_id, item_id, kg, species, caught_at, x, y, depth_m)` in `SCHEMA_SQL`, capped at the hull's `hold_kg`.
- It's read when you board and when you unload, and at no other time. The live rig keeps a running total of the box's weight, so checking whether a fish fits costs no query.
- **Freshness** is worked out from `caught_at` when you unload or sell, so nothing ticks on the table. The ice box (phase 4) sets a flag that stops the clock while the fish is aboard.

**When the box is full:** "No room in the box. You ease it off the hook and it's gone." The fish is let go, and you still get half the skill award.

**Selling:**

- at the Codfather Fish Quay berth, which already has `marina_berths`, `boat sell catch` sells the box to Fawle;
- `boat unload` at any berth moves the box into your inventory.

**Price by weight.** A small engine change in `vendor.js` `computeSellUnitPrice`: a `raw_fish` item with `custom_data.kg` sells for `value × kg / the species' usual kg`, kept between 0.5× and 3×. Shore catches have no kg and sell as they do now.

**The logbook** is a tablet app (`plugins/fishing/tablet-app.js`, using `registerTabletApp`). It shows the species you've seen and caught, the heaviest of each with where, when and in what weather, and a running total.

- Each landing writes one row to a `fish_log` table (`player_id, species, kg, at, x, y`). It never goes on `players`.
- Opening the app costs one indexed query, and the records are a `GROUP BY` over it.

**Accolades:**

- the first of each species;
- a fish over 20 kg;
- a full box;
- a first catch at night.

Each is one `ENTRIES` literal on `fish.caught`.

## 7. Feel

**Sound.** The seat at anchor gets its own background sound:

- water slapping the aluminium;
- the anchor rope creaking at the bow;
- gulls in the distance;
- no engine.

The line has its own cues: the swish of the cast, the reel's click, the plop of the float and a tone when it dips. They're SIREN cues in `sfx-catalog.js`, not recordings.

**Time.** A session can be a long one.

- The best fish come at dawn and dusk.
- At night you fish by the lamp, for herring.
- Fog shrinks how far you can see shadows.

**Prose** follows [house-voice.md](../reference/house-voice.md): short, practical and dry, with the water a little wrong.

**The fishing forecast.** KSAB Marine reads a short bulletin at 0600, in ORACLE's voice, on the marine channel. `forecastLines(area, env, habitat)` in fish.js writes it from the same schools the water holds, so it's true by construction: it can't promise a fish the sim doesn't have.

- Each area gets up to three lines, one a watch (dawn, noon, dusk, after dark). Each names the species most worth going out for (schools weighted by difficulty, so a few pike beat a lot of carp), where it holds and how many: thick, plenty, moderate or thin.
- Tomorrow's weather goes in through `env`, so fog brings the herring up in the forecast as it does in the water.
- What the real coast gives today, for a clear spring day:

> KSAB MARINE, 0600.
> Fairweather: Sand skate on the sand at dawn, moderate. Carp in the shallows by noon, moderate. Lamp herring mid-water at dusk, moderate.
> The Eastern Marina: Sludge carp in the shallows at dawn, plenty. Irontooth bass on the rock by noon, moderate. Sand skate on the sand at dusk, moderate.

- Wiring it to a broadcast (a `.bsm` script or a scheduled host line) and the radio channel is phase 4.

**Tuning.** `node scripts/fish/map.mjs` paints the real coast from content/zones, one panel a watch, with every school drawn over the seabed's depth and the forecast underneath. `--doy`, `--weather` and `--rough` change the day, and `--x0 --y0 --w --h` the window.

## Phases

1. **The skiff and the anchor.**
   - The `TYPES` row; `content/vehicle_models/boat_skiff.json` and `npm run vehicles:bake`; `VEHICLE_IDS` and `LIVERY_MODELS`; Keel's dialogue nodes; the open-boat shell in `client/shared/interior-*.js`; the legend lettering.
   - `boat anchor` in `yard.js` and `helm.js`, the swing clamp in `cmdBoatSync`, and the anchor key in `boat-view.js` and `texthelm.js` (`conn anchor`).
   - Regress checks that the anchor is refused in deep water, under way and on a berth, and that the swing clamp holds. Shapes and seat smoke run as usual.
2. **The fish and their shadows.** The sim, its gate, the tuning map and the five boat-only catch items are built; the shadows and the anchor push aren't.
   - `client/shared/fish.js`, `gl/fish-shadows.js` wired into windshield.js, `serverNow` on the anchor push, and the `look water` prose.
   - A dev view (a Modelshop tab, or the dev panel map) that paints schools by hour, depth and species, for tuning.
   - A gate, `scripts/fish/smoke.mjs` in the `shapes:smoke` group, checks that:
     - fish.js is pure (the same input gives the same output, and nothing calls `Date.now`);
     - every species' item exists and has the `raw_fish` tag;
     - every habitat band fits inside the seabed's depths;
     - there are at least N schools within 9 tiles of each marina at some hour.
3. **Casting, the fight and the box.**
   - `plugins/fishing/boat.js`; `fishcast boat`, `fishstrike` and `fishresolve boat`; rod mode in `boat-view.js`.
   - `openFishing({ startAt: 'fight' })` and the fight styles, in `fishing.js` and `textfishing.js`.
   - The `boat_hold` table in `SCHEMA_SQL` (then `npm run db:schema`), `boat sell catch`, `boat unload` and the weight price in `vendor.js`.
   - Regress takes a fake anchored rig through `fish`, `fishcast`, `fishstrike` and `fishresolve`. It checks the range clamp, the strike window and the box cap. It also checks that an unanchored player and a shore player get exactly what they get today.
4. **The logbook, the boat-only species, the rode, ice box and lures at the chandlery, the sounds, the accolades and the gulls.**
5. **A passenger.**
   - `boat board <owner>` takes the second seat.
   - The server passes the helm's rig on to the passenger at the sync rate. That's new: today only the helm's own client knows where the boat is.
   - The passenger casts from the same anchor point, and the two share the box.
6. **Later, not promised:**
   - drift fishing over the Deep, with no anchor, the boat moving and the line out mattering;
   - trolling with both rod holders while under way;
   - a monster at the shelf edge, along the lines of the cable eel.

## Docs to update when it's built

- [systems-fishing.md](../systems-fishing.md): a "From a boat" section.
- [The powerboat README](../../plugins/powerboat/README.md): the hull fields, the anchor and the hold.
- [plugins.md](../plugins.md): the new subverbs.
- [server.md](../server.md): the `fish.caught` payload.
- [items.md](../items.md): `cast_m`, `sink_mps` and `custom_data.kg`.
- [flags-keys.md](../flags-keys.md): any new flag.
- [depot-shell.md](../reference/depot-shell.md) doesn't change, because the skiff uses the marina's depot.

## Open questions

These were settled while the design was written: the fishing state shares the shore registration (§5), and the fish box is a `boat_hold` table (§6). Still open:

1. **Two tile conventions meet at the lure.** A boat's x/y puts a tile's centre on the integer (`zoneUnder` rounds it), and seabed.js and fish.js have tile i spanning [i, i+1). `plugins/powerboat/anchor.js` `depthUnder` adds half a tile before it asks the seabed; phase 3's lure point and `fishNear` call must do the same, or every cast lands half a tile off the shadows.
2. **The anchor clamp and the recentre.** `cmdBoatSync` streams a new map window when she's 8 tiles from the last one. An anchored boat never gets that far, so this should need nothing, but check it once the clamp exists.
3. **Where the weight price gets its number.** `vendor.js` is an engine file and mustn't import `client/shared/fish.js` for one figure. Either the item row stores the species' usual weight as `price_kg_ref`, or the price multiplier is worked out when the fish is landed and kept on `boat_hold`.
4. **Whether a shadow can be seen in the chase view.** The chase view draws the boat at 0.2 tiles a unit, so a 1 m fish is a sixth of the skiff. Check that it can be seen at chase zoom, and scale the sprite with the camera if not.
5. **Shore fishing.** Should fish.js ever drive shore fishing? Not in this design: shore fishing stays on its stock tables.
