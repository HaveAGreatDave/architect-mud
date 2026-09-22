# Fauna — the birds over the Basin

**STATUS: BUILT** (`client/shared/birds.js`, `client/game/js/panels/windshield.js`,
`client/game/js/panels/murmur.js`, `client/game/js/panels/fauna3d.js`, `content/fauna_models/`).
Six species, the flock cycle, perching, the hawk's hunt, the murmuration, the voices and the room
prose all ship. Everything that is not a bird — dogs, rats, anything on four legs — is not built and
nothing here is written for it.

## One rule holds the whole system up

**A flock is arithmetic, not an entity.** There is no table, no row, no id and nothing to spawn or
despawn. Where a flock is, how many birds are in it, whether it is up, where its centre is, which
way it is pointing and whether one of them has just been killed are all pure functions of two
things: the flock's ANCHOR TILE and the WALL CLOCK.

That is not a shortcut, it is the only design that works here, because **two completely separate
programs have to agree about the same birds**. The renderer draws them out of a cockpit or a truck
cab; [describe.js](../server/engine/commands/describe.js) prints a sentence about them into a room
for somebody who is reading rather than looking. Both call the same functions in
[birds.js](../client/shared/birds.js) and get the same answer, with nothing crossing the wire and
nothing stored on either side.

⚠ **THE CLOCK IS WALL TIME, NEVER THE FRAME'S.** Every other animation in the renderer runs on
`performance.now()`, which is milliseconds since the page loaded. That is fine for a wingbeat and
wrong twice over here: it resets on every reload, so a refresh would teleport every flock in the
world to a new point in its cycle, and the text game asks the same question with `Date.now()`.

⚠ **AND `birds.js` KNOWS NOTHING ABOUT THE MAP.** It takes callbacks — `flocksNear(…, isHabitat)`,
`hawkStoop(…, near)`, `flockClearance(f, isBlocked)` — because only the caller has the terrain. The
renderer reads its own map window and the text game reads its own grid index; the RULE lives in one
file so the two cannot drift apart.

## The six

The rows live in `SPECIES` in [birds.js](../client/shared/birds.js) and are the source of truth;
this table is a reading of them, not a second copy to keep in step.

| | goose | gull | pigeon | songbird | hawk | vulture |
|---|---|---|---|---|---|---|
| wingspan (model units) | 0.85 | 1.1 | 0.5 | 0.155 | 1.02 | 1.3 |
| birds in a flock | 3–6 | 4–12 | 4–10 | 24–60 | 1 | 3–7 |
| cycle | 100 s | 55 s | 27 s | 34 s | 150 s | 210 s |
| share of it on the ground | 40% | 25% | 78% | 55% | 18% | 42% |
| ceiling / circuit radius | 2.2 / 3.4 | 1.6 / 5.0 | 0.9 / 1.6 | 1.4 / 2.4 | 3.6 / 1.9 | 4.4 / 3.2 |
| drawn out to | 14 tiles | 13 | 7 | 6 | 16 | 18 |
| about between | 06–20 | 05–21 | 06–20 | 05–21 | 08–18 | 08–18 |
| perches | never | 42% | 55% | 50% | 70%, highest | 30%, highest |
| a hawk will take one | no | yes | yes | yes | — | no |

A few of those are load-bearing rather than flavour. **A goose never perches** — it is a ground and
water bird and the gate asserts it. **A hawk is one bird**, which is a real case the skein arithmetic
has to survive rather than a degenerate one. **A songbird is heard much further than it is seen**: it
has the shortest draw range in the table and its call range is deliberately not shortened to match,
so at first light you hear them across the park and never see one. And **the hawk does not take a
goose**, because a hawk does not take a bird several times its own weight.

## The cycle

A flock is either on the ground or flying a circuit, decided by where `u` — its phase — sits against
its own `uGround`. The circuit climbs out from the anchor, turns, and comes home to the same tile at
exactly zero altitude, which is what lets a take-off and a landing be continuous without anything
being stored.

**The heading is the velocity and not the tangent to the circle.** The circuit has two moving terms —
the angle round it and the radius — and through the climb and descent the radial term is the bigger
one, so a flock taking the tangent flies visibly sideways for about 40% of every flight.

**The touchdown is eased out of the formation rather than cut to the mill.** The flock lands
perfectly, but the skein slot and the milling position are unrelated arithmetic, so at the instant
the state flipped every bird jumped — measured at 0.37 tiles mean on birds that mill inside a
0.34-tile radius. `settle` blends the two over `GOOSE_SETTLE_MS`.

⚠ **THE SETTLE WINDOW IS THE FLOCK'S OWN GROUND SHARE, NEVER `U_GROUND`.** That constant is the
GOOSE's share and was written when a goose was the only bird there was. Read for any other species it
does not merely mistune the window: past `U_GROUND` the take-off term goes negative, clamps to zero,
and `settle` pins at 1 for the whole rest of the phase. Measured before this was fixed, **a pigeon
stood frozen in the formation it landed in for 50.2% of its time on the ground and a songbird for
28.9%**, while the goose was correct at 0.7%. It reads as a flock that lands and then stops being
alive.

**The startle is a fan, not a flush.** `alarmAt` measures from the player to the flock anchor over
`STARTLE_R` (5 tiles) and widens the milling radius and the shuffle rate. The birds do not take off
because you approached — take-off is on the flock's own cycle. That is deliberate, and the pigeon row
is tuned for it: a short period with most of it on the ground is what makes a passing truck look like
the cause of something the birds were going to do anyway.

## Where a flock can be

`speciesAt(place, wx, wy)` collects every species whose habitat table claims that ground and hashes
the tile to pick one. **Co-tenants are hashed, never ranked** — geese and gulls both use open water,
and ordering them would put every bay bird in the world into whichever came first in the list. So one
tile holds one species, and neighbouring tiles genuinely hold different ones.

⚠ **THE PLACE, NOT THE PAINT.** `flags.terrain` says what the ground is made of and says nothing
about whether anybody lives on it. Coldwater's streets are painted `redrock`, which is in no species'
habitat table, so asking the terrain directly puts a pigeon on about one tile in the world.
`placeOf(biome, buildingNeighbours, shore)` — shared by both surfaces — turns the map facts into a
PLACE: green ground and water keep their own answer, and anything with buildings round it becomes
`citycore` or `docks`.

⚠ **AND BOTH ENDS OF THE RENDERER HAVE TO ASK IT.** `drawGeese` chose its anchors through `placeOf`
and then filtered them on the raw painted terrain, so a pigeon, gull or songbird was anchored on a
street and silently dropped before it drew — on **699 of the roughly 1,600 standable tiles in the
built city** — while the room description said the birds were there. describe.js hit this and fixed
it on its own side months ago; the renderer did not get the other half until the perch work went
looking for a pigeon on a street and could not find one anywhere.

## Perching

A bird on the ground and a bird on a parapet are the **same state** — stationary, milling, startled by
what comes near, takeable by a hawk — at two different heights. So this is not a third branch of the
cycle, it is the ground phase with somewhere else to stand, and `flockState` was not touched.

**A ledge is derived from mass that is already there.** It is the top of a captured mass segment minus
whatever sits on it, read out of `shapeForModel` — the same list CFIT collision, ground shadows,
occluder hulls and the cold open already use. So **a bird cannot stand on a ledge an aeroplane would
fly through**, no content file was touched, and no building model knows the feature exists. On a
setback tower each tier's top ring is exactly the part the tier above does not cover, which is why a
ziggurat works for free: **The Meridian offers 21 perches** — four big setback tiers, its seven
gargoyles, and the finials above them. The highest thing to stand on in the city is **The Spire, 17.6
tiles up**. 364 of the city's 375 building tiles offer at least one.

**It is the perimeter, never the plane.** A bird stands on the EDGE of a flat roof — that is what a
ledge is — so the sample ring is the inset boundary. Scattered over the top face instead they read as
birds standing about on a roof, which is a thing that happens and is not what anybody pictures.

**A ledge has to hold the flock.** The Meridian alone offers 21 perches and seven of them are
gargoyles, so an unweighted pick sends most flocks onto a finial. A ledge is a candidate only if it is
long enough for the birds standing on it, and among the candidates a longer one is likelier. ⚠ It is a
preference and not a hard floor — if nothing is big enough the flock takes the longest there is and
stands closer together, because a flock that refuses to perch anywhere on a street full of ledges is
the worse outcome.

**The answer is in two parts, and that split is the whole design.** `perchedNow` is SHARED — the room
description makes the same call and gets the same answer — and finding an actual ledge is LOCAL,
because a ledge is GLASS geometry the server has never had. This is the line
[murmur.js](../client/game/js/panels/murmur.js) already drew and defended: derived and identical
everywhere is the flock's tile, cycle, centre and size; local is the arrangement inside it. A flock
that wants a ledge where there is nothing to stand on falls through to the ground exactly as before,
which is what makes the whole thing inert over a field, a bay or the open waste.

⚠ **THE ANCHOR IS NEVER A BUILDING**, because the habitat gate refuses a building tile outright. So
the ledge always belongs to a NEIGHBOUR, and which neighbour has to be a fixed walk rather than a
search, or two readers pick different buildings for the same flock and it hops the street.

⚠ **THE LEDGE ARRIVES ON THE SETTLE CURVE**, which is what makes it a landing rather than a teleport.
The circuit is the flock's and it comes home to the anchor — a street tile — at zero altitude, so a
perched flock cannot appear on the roof next door at the instant the state flips. Fading the ledge in
as the skein fades out flies the birds up onto it over the same 2.6 s the touchdown already takes,
which is what a pigeon coming in low off the road and pulling up onto a cornice does. Take-off gets it
in reverse for free.

**A hunter takes the highest ledge in reach.** That is the whole of what `perch.high` buys, and it is
what puts a hawk on the top setback of a tower looking down on a street the pigeons are working rather
than on the awning beside them.

## The hunt

`hawkStoop` is resolved once per frame, before anything draws, because two things read the answer —
the flock that loses a bird and the cloud that panics — and asking twice is how they end up
disagreeing about whether it happened. It is a pure function of the two anchors and the clock, so the
server can make the same call.

The numbers are measured rather than chosen. **A stoop kills one time in five** (Cooper's hawks,
observed over 179 attacks with 35 kills), and **only 16% of flights carry a hunt at all**, because a
hawk's cycle is two and a half minutes and hunting every flight works out at about 450 attacks a day
from one bird.

**A perched hawk hunts from the perch, and that is the commoner mode rather than a flourish.** An
accipiter is a still-hunter: it sits somewhere with a view over ground that holds prey, waits, and
goes in one short hard burst — soaring is mostly how it gets from one of those places to the next. So
on a perched cycle the stoop is scheduled inside the PERCH phase and the odds go up to 38%, because a
bird that has picked a vantage point over a street full of pigeons is there on purpose.

⚠ **A KILL HAS NO ENTITY TO DELETE**, which is what makes it expressible at all. The flock comes back
one bird short for the rest of its flight and whole again next time out. A kill that stayed killed
would need a record of which bird in which flock, and this system has nowhere to put one.

## The murmuration

[murmur.js](../client/game/js/panels/murmur.js) is the one place in the fauna system that keeps
state, and the exception is deliberate and narrow: only the ARRANGEMENT of birds inside a songbird
cloud is simulated, and the flock's tile, cycle, centre, altitude and size stay derived.

**Neighbours are topological, not metric** — each bird attends to its seven nearest neighbours
whatever the distance (Ballerini et al., PNAS 2008). A metric rule loses cohesion the moment the flock
stretches, because a thinned-out bird ends up with nobody in range and flies off alone.

**The dark bands are birds banking, not birds bunching up**, and the wave is a closed form rather than
a simulation: turning waves propagate through a real murmuration with negligible attenuation, which is
to say a clean travelling wave, which is exact arithmetic. It costs no state and is identical on every
machine even though the cloud under it is not. Its origin and its moment are the hawk's.

⚠ **TWO PLAYERS SEE DIFFERENT CLOUDS**, and a reload pops one back to its seed. Both are accepted:
fine for texture, and not fine for anything a player could be wrong about, which is why the derived
half stays derived.

### The starling has a year now — and it is OFF (`BIRD_TUNE.season`)

**BUILT, SWITCHED OFF.** `BIRD_TUNE.season = 0` in [birds.js](../client/shared/birds.js) is the
module exactly as it shipped, so a murmuration is still unconditional until somebody sets it to 1.
`npm run gl:fauna` includes `birdseason.mjs`, whose first and largest claim is that the off state is
the old roll to the bit — for every species, at every hour of every day — because a partial revert
looks exactly like the renderer that shipped.

A murmuration used to be unconditional, and nothing anywhere said so: `flockSize` is a hash of the
anchor tile, so every starling flock in the world was 450–1,700 birds in February and in July, at
dawn and at noon. The real bird has **two** cycles and they are independent:

- **The year.** The roosts are full from November to January, swollen by continental migrants; from
  April to July the same starlings are territorial pairs at a nest hole. A `season` row gives the
  species a cosine over the year raised to a power — ⚠ **the exponent is the whole point**, because a
  plain cosine says the year has as much high season as low, and a starling's does not: the peak is
  narrow and the lean season is broad.
- **The evening.** ⚠ **A MURMURATION IS A PRE-ROOST DISPLAY AND NOT A THING BIRDS DO ALL DAY** — the
  last half-hour of light, over the roost, and for the rest of the day the same birds are small
  parties working the turf and lining the wires. This is the half a player meets *every day* rather
  than for three months a year, and it is what turns finding one from something you stumble on into
  something with a time and a place.

⚠ **THE TWO CURVES MULTIPLY AND ONE THING CHANGES.** They land on the flock's SIZE and nowhere else,
and everything downstream inherits the feature without knowing it exists: the face budget, the
thinning, the perch shares, the prose, and `MURMUR_AUDIO_MIN` (120), which has been standing in
windshield.js since the bed shipped and turns out to be exactly the right question asked the right
way round — a summer party of sixty goes back to the ordinary burst schedule on its own. **There is
deliberately no second gate saying "this flock murmurates"**: the murmuration IS the size, and a
second reader is how two answers to one question start disagreeing.

| | midwinter | midsummer |
|---|---|---|
| dusk (20:18) | **1,045** birds — the display | 63 — a small gathering |
| afternoon | 21 — a feeding party | 6–16 — a family party |

⚠ **IT NEVER REACHES ZERO, AND THAT IS THE DECISION THE FEATURE WAS BUILT AROUND.** An honest
breeding season means no murmuration for a quarter of the game year, and at `timeScale` 1 a game year
is a real year — so a player could keep this game for three months and find the feature simply
absent, with nothing anywhere to say it had existed. `floor` keeps small parties in the sky all
summer, which is also what the bird does.

⚠ **THE FLOOR IS A BAND AND NOT A NUMBER.** Clamped to one value, the curves take 450–1,700 down to
half a bird on a July afternoon and every one of them rounds to the same figure — so **every starling
party in the world was exactly six, everywhere, for four months.** A field of identical flocks reads
as a bug rather than as a quiet season, and it is invisible to every other check: the magnitude, the
direction and the floor are all correct while it happens. `PARTY_SPREAD` carries the anchor's own
variation through.

⚠ **THE PEAK RIDES `dayEnd` RATHER THAN BEING A SECOND COPY OF DUSK.** `birdDaylight` stops drawing
the species at `dayEnd`, so a gathering pinned to a literal hour drifts out of the window the moment
the day moves — a flock assembling an hour after it has stopped being drawn, which reads as the
feature doing nothing at all.

⚠ **THE CURVES ONLY EVER TAKE AWAY.** The bird-strike radius in
[hazards.js](../plugins/flight/hazards.js) is derived from the declared `maxFlock`, so a size that
could exceed the roll would let a flock outgrow the thing that flies into it. Multiplying down cannot,
at any setting, for any species.

⚠ **AND THE CLIENT HAD NO CALENDAR AT ALL.** `env.date` arrived, was formatted into a HUD string and
discarded, so the raw value was unrecoverable. It is kept now and **pushed** to the renderer —
windshield.js may not import environment.js back, because the cold open paints that file before there
is a session and every `scripts/shapes/*` gate loads it against a DOM stub. ⚠ Deliberately **not
threaded through the view**: a seat legitimately wants its own hour, weather and wind, and nothing
wants its own month — threaded, this would be another eight `hour:`-shaped hand-offs across four view
files plus every bench in glbench.js, which is the trap `gl:snow` exists for. `RENDER_TUNE.doyForce`
pins the calendar the way `hourForce` pins the clock. ⚠ **`null` is a renderer that has not been
told** — the cold open, the Modelshop and every headless harness are all in it — and a missing day
resolves to the *unseasoned* roll, which is the PEAK, the safe direction for a face budget.

⚠ **ONE SPECIES HAS A YEAR, AND THAT IS THE DESIGN RATHER THAN A FIRST INSTALMENT.** The other five
are resident and go about in the same small parties all year; the starling is the one whose flock size
swings by two orders of magnitude. Giving the goose a `season` row would be authoring a phenomenon it
does not have, and it would move the number the bird strike reads.

The gate is `node scripts/shapes/birdseason.mjs` (in `shapes:smoke`, in `gl:fauna` AND in the
`pretest:regress` chain — three lists, per the warning in CLAUDE.md about two of them), **mutation-tested
18 of 18**. ⚠ Two of its claims were testing themselves first: the no-opts check compared two no-opts
calls with each other, so a `seasonalSize` that quietly defaulted a missing season gave both the same
wrong answer and passed — the unseasoned baseline has to be taken while the flag is still off. And the
push check matched `_setBirdSeason(envDoy)` anywhere, which also finds the catch-up call inside the
dynamic import, so deleting the real push left the other one and it stayed green. ⚠ **A third mutant
was testing nothing**: it defaulted the missing season to *midwinter dusk*, where the seasoned answer
IS the unseasoned roll by design.

## Voice

Calls are scheduled off the same clock, per burst rather than per cry, and a burst is admitted or
dropped whole — a limiter that let single cries through would turn every burst into one evenly-spaced
cry, which is the metronome the rarity exists to avoid. Audible to `BIRD_CALL_RANGE` (13 tiles),
falling off with distance and sitting under the mix, because a bird is weather and not an event. The
songbird's dawn chorus **peaks about an hour before sunrise**, not at it.

### A murmuration is a bed, not a burst

⚠ **THE BURST SCHEDULE COUNTS FLOCKS AND NOT BIRDS**, so a murmuration of four hundred to seventeen
hundred starlings was voiced as ONE CALL every seventy seconds — the same cue a pair of geese gets.
[murmur-audio.js](../client/game/js/panels/murmur-audio.js) generates the cloud instead: a
continuous, never-repeating bed on the ambient bus through `engineNodes()`, the seam the flight
engine and the yacht's harbour already build on.

⚠ **A FLOCK IS NOT A LOUDER BIRD, WHICH IS WHY IT IS A SEPARATE FILE.** `birdCall` in
[procedural-sfx.js](../client/shared/procedural-sfx.js) builds one call from one throat — a formant
bank driven hard, right for an event you notice — and a thousand copies of one throat is a chorus
rather than a flock. What makes a murmuration recognisable is that no two voices line up, and that
under all of them sits the MURMUR the word is named after, which is wings and not voices at all.
Four layers: overlapping FM chirps (15–30 a second, five pitch contours, an index envelope on every
one because a static index is a whistle), the wings (band-passed noise amplitude-modulated at
12–15 Hz, the rate drifting continuously so it reads as "fffrrrr" rather than as a tremolo),
individual wingbursts scattered across the field, and a nearly subliminal low-mid pad so the flock
has a size instead of being all whistles.

⚠ **NOTHING IN IT REPEATS AND NOTHING IN IT IS A LOOP.** The density is a smoothed random walk
between 0.25 and 1 over 4–14 s, so the flock breathes; every 5–15 s it changes direction, which
raises the density, the wings and the spread for a second or two and then falls back over a slower
curve than it came on. Measured live: density 0.33–0.98 (mean 0.60), 17.8 chirps and 6 flutters a
second at density 0.89, manoeuvres up for about 14% of the time.

⚠ **LOOKAHEAD SCHEDULING, NOT A TIMER PER EVENT.** At thirty events a second a `setTimeout` per
chirp is thirty timers a second whose accuracy is whatever the main thread is doing, and events
landing on frame boundaries is audible as a pulse straight away. One 120 ms interval books the next
window against the audio clock, with exponential gaps — evenly spaced events at any rate are a
machine, and they never overlap the way a real flock's do.

⚠ **THE BED TAKES THAT FLOCK'S VOICE WITH IT**, and only the nearest one runs: two beds at once is
two flocks nobody can tell apart, and a discrete cry on top of the bed is the same animal heard
twice at two scales. ⚠ **AND IT HAS A FLOOR THE PICTURE DOES NOT** — `thin` lets a murmuration be
DRAWN as few as fifteen birds when the face budget is tight, which is fine for a cloud and not for
a sound that asserts there are hundreds; under `MURMUR_AUDIO_MIN` (120) the flock keeps the ordinary
burst schedule. A hawk's stoop arms the longest manoeuvre the bed has, ⚠ **edge-triggered on the
stoop's own timestamp** rather than on "a stoop is live", because `hawkStoop` is derived and answers
the same stoop on every frame. `RENDER_TUNE.murmurAudio = 0` puts it back on bursts.

## What it costs

One face budget, spent nearest-flock-first, with at most 10 flocks a frame. ⚠ **A flock is charged
WHOLE and only once it is known to draw** — half a skein reads as a rendering fault rather than as a
budget. ⚠ **`budgetShare` is a share of the one total and never a budget of its own**: a murmuration
would otherwise take the whole allowance and a park with geese in it would go empty whenever a
starling cloud was up nearby. Five species each independently "bounded" is five bounds and no bound.

⚠ **THE SPECIES HAS TO REACH THE DRAW.** `pushFauna` took a literal `'goose'` for months, so every
pigeon, gull, songbird, hawk and vulture in the world was built out of the goose mesh while the budget
was charged per species and the prose named the right bird.

## The flash

A murmuration is famous for two things and the renderer only had one of them. The density waves were
free -- the boids step produces them, measured at 1.29 times its own mean occupancy with 87 of 216
cells empty -- and the flash was missing, because past a species' `dotPx` a bird is one sprite sized
off `faunaSpanTiles`, which is the FULL wingspan. A starling coming straight at you was drawn exactly
as big as one crossing your view, so every bird was the same dot forever.

`pushFauna` dims a dot by how much wing it is presenting: one dot product between the bird's heading,
which was already on the wire, and the camera's own forward. No new state, nothing per-frame that was
not already computed, and `framecost` does not move, because it adds no canvas call.

⚠ THE FLASH IS NOT THAT IT VARIES -- IT IS THAT NEIGHBOURS AGREE. Six hundred independent headings
vary too, and that is sprites twinkling, which is worse than the flat cloud it replaces. It bands
because the boids step aligns LOCALLY (local alignment 0.601 against a global coherence of 0.088,
which is a rotating flock rather than a milling one), so a patch turns together. Measured on a real
400-bird cloud: the brightness spreads **0.188 across the flock at any instant** and neighbouring
birds agree **3.6 times better than chance**.

⚠ AND THE FLOCK MUST NOT PULSE AS A WHOLE, which is the control on the same measurement: the mean
brightness moves only 0.029 over 210 frames. A murmuration brightening and darkening in unison would
be a flock all facing one way, and that is a skein.

⚠ IT DIMS RATHER THAN SHRINKS. The dot is floored at 0.45 px because below that it starts dropping
out of the raster, so taking the SIZE down for an edge-on bird deletes birds instead of dimming them.
Alpha carries it, over a floor (`FLASH_FLOOR`, 0.42), because a starling seen head-on is still a
starling and not a hole. `RENDER_TUNE.faunaFlash` is the A/B and 0 is provably the old renderer --
the gate asserts the multiplier is exactly 1 there rather than near it.

## The shape, and the hawk

A murmuration is famous for three things and the renderer had one of them. The density waves came
free from the boids step. The other two did not, and both were one decision each.

**It was a ball, because the attractor was a point.** `wHome` is 4.5, far the strongest of the four
weights, and it pulled every bird toward the single derived centre -- so the equilibrium shape is a
sphere that travels, measured at **1.55-2.03x elongation** at the game's own flock-centre speed of
0.71 tiles/s. The attractor is the flock's own recent **path** now: the centre records a point every
`TRAIL_STEP` of travel, and each bird holds a fixed **station** along that path. The head is where
the centre is, the tail is where it was, and when the head turns the tail keeps the old line and
the whole thing rolls over. Measured: **5.77x elongation with half the birds in the leading third**,
for **0.45 ms on a 1200-bird cloud** (3.28 -> 3.73, stable over two runs of 250 steps).

⚠ STATIONS ARE FIXED PER BIRD, NEVER NEAREST-POINT. Pulling each bird to the closest point on the
path is the obvious version and it collapses: birds bunch wherever the curve doubles back, so a
flock that turns tightly folds into a knot. A station is stable, so a bird keeps its place in the
ribbon and the formation survives a turn. It is rolled once at seed time, because it is a property
of the bird and a `Math.pow` per bird per frame is not free.

⚠ AND THE PATH GIVES THE SHAPE WHILE THE DERIVED CENTRE STILL GIVES THE PLACE. Hung straight off
the path, the ribbon trails **behind** the centre -- 2.5 tiles, against 0.58 for the point
attractor -- and that is a correctness regression rather than a matter of taste, because `murmur`'s
own note calls that pull the bridge that keeps a simulated cloud honest about the one fact
[describe.js](../server/engine/commands/describe.js) is also telling the player. The whole ribbon is
translated until its own centre of mass lands on the tile the shared model named, which brings the
drift to **0.32 tiles -- better than the ball it replaced**. The gate fails on this, not only on
elongation.

**The hawk banked the flock and never moved it.** `agitation()` is a closed-form pulse travelling
out from a stoop, damping on angle rather than on how many birds copy it, and it returns a **roll**.
So a dive changed how the birds caught the light and the cloud never got out of the way. It pushes
now: a soft bubble at the stoop that the birds steer around, damped on age exactly as the banking
wave is, so both halves of one dive fade together. Measured **34% fewer birds inside 1.15 tiles**,
at no cost the bench can separate from its own noise.

⚠ MEASURED AT THE SAME FRAME, NEVER ACROSS TIME. The flock flies past a stoop that stays where it
happened, so the count near that point swings on its own -- 134, 252, 47 over four seconds with no
predator in the model at all. The only sound reading is the same instant with the push and without.

⚠ AND THE BANKING WAVE ONLY BECAME VISIBLE WHEN THE FLASH LEARNED TO READ `roll`. It rides
through `drawGooseAir` into `pushFauna`'s own payload, and the first cut of the flash read
`o.heading` and nothing else -- the one effect the dot LOD would be most useful for was sitting
unread in its own argument. Both terms scale with `broad`, which is not a coincidence: model the
bird as a flat plate and its normal dotted with a horizontal view leaves `|sin roll|` times exactly
the perpendicular component `broad` already is. So a bird coming at you stays dim however hard it
banks, and a bird crossing your view darkens as it rolls.

## How many

A starling flock is **450-1700**, thinned to 15 on the canvas fallback. Three numbers have to agree
or the biggest one does nothing:

| | |
|---|---|
| `maxFlock` 1700 | what the row asks for |
| face budget 1800 | `birdFacesGL` 165000 x `budgetShare` 0.6 / 55 faces a bird |
| simulation ceiling 1800 | what the boids step was measured to afford |

⚠ RAISING `maxFlock` ON ITS OWN DOES NOTHING, which is the trap: the cap was 1221 against a
`maxFlock` of 1200, two per cent apart, so the thinner clamped anything bigger straight back and
the flock looked identical. The budget has to move with it.

⚠ AND THE COST IS THE SIMULATION, NOT THE DRAWING. Past `dotPx` a starling is one sprite and very
nearly free; what scales is the neighbour search. Measured, one flock, median ms for a single step:
600 birds 1.5 ms, 1200 4.1, 1800 7.1, 2400 9.9, 3200 16.3. A frame is 16.7 ms at 60 and a cab frame
is already 2.8-3.6 ms of it.

⚠ THE GATE CEILING IS A MEASURED COST AND NOT A PAIR COUNT ANY MORE. It was `maxFlock` squared
against a pair budget, which was right when every bird compared itself with every other; the spatial
grid made the curve about n^1.35 and the old model over-states the top end badly -- n squared
predicts 88 ms for 4000 birds against a real 22.7. A ceiling that wrong is arbitrary rather than
conservative.

The unspent lever is **integration rate**: the boids do not need to step at frame rate, and stepping
at ~30 Hz is 40% cheaper (3.25 -> 1.97 ms at 1200). ⚠ IT MUST BE A TIME ACCUMULATOR WITH
SUB-STEPPING, NEVER a step every Nth frame, because `DT_MAX` is 0.05 s: stepping every third frame
at 60 fps lands exactly on that clamp, the sim falls behind its own centre, and centroid drift goes
0.19 -> **2.10 tiles** while the birds bunch up (nearest-neighbour spacing 0.159 -> 0.078). Even at
every other frame the shape changes (elongation 4.2x -> 6.5x), so it is cheaper rather than free.

## The numbers came from the birds

The murmuration is tuned against measurements of real starlings rather than against taste, because
"does that look right" is the question this renderer is worst at answering and the field has good
data. Sources:

- **Ballerini et al. 2008**, *An empirical study of large, naturally occurring starling flocks*
  (STARFLAG) — [arxiv.org/abs/0802.1667](https://arxiv.org/abs/0802.1667)
- **Hemelrijk & Hildenbrandt 2011**, *Some Causes of the Variable Shape of Flocks of Birds*
  (StarDisplay) — [PLOS ONE](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0022479)

What they measured, and what we do with it:

| measured | value | ours |
|---|---|---|
| principal axes I1 : I2 : I3 | **1 : 2.8 : 5.6**, stable across flock sizes | 1 : 3.1 : 5.3 |
| nearest-neighbour distance | 0.7–1.5 m, about a wingspan | 0.67 m (`sepR`0.15) |
| topological neighbours | 6.5 (StarDisplay), 6–7 (Ballerini) | `K_NEIGHBOURS` 7 |
| flock sizes reconstructed | up to 2,700 birds | 450–1,700 |

⚠ THE BIG RATIO IS VERTICAL FLATTENING, NOT LENGTH, and getting that backwards is what a first
attempt did. I1 — the SHORT axis — is parallel to gravity and orthogonal to the velocity: a starling
flock is a pancake sliding parallel to the ground, and in PLAN it is only about 2:1 (5.6/2.8). Tuned
for elongation instead, ours measured **1 : 1.3 : 7.0** — barely flattened and stretched more than
twice as far as a real flock. It reads as a smear rather than as one mass, which is exactly how it
was reported. `FLAT_Z` in murmur.js is the vertical stiffness that fixes it; nothing else in the
four boids rules can produce an anisotropic shape, because an isotropic attractor cannot.

⚠ AND THE SHAPE IS MEANT TO VARY. Hemelrijk & Hildenbrandt find variability rises with flock size,
with fewer interaction partners, and with sharper turns — "before a sharp turn the flock shape is
wide and after the turn it is oblong". So the target is a distribution, not a number: ours runs
2.78 in plan on gentle turns against 2.02 on sharp ones. A model pinned at the average would match
the mean and miss the phenomenon, and the photographs everyone knows are the tails of it.

⚠ THE AXIS FINDING WAS ALREADY SATISFIED, AND CHECKING IT COST A FALSE ALARM WORTH RECORDING.
Ballerini reports the angle between the flock's longest axis and its direction of travel as diverse
and changing through a turn. Measured on a SYNTHETIC course it looked welded: median 7.3 degrees.
Measured on the flock's OWN circuit it is median 40, spread 34-82, nothing under 30 -- exactly what
the paper describes. The synthetic course turned at 1-5 deg/s; the real one turns at **25 deg/s
median and peaks near 100**, and the sweep shows the axis only decorrelates above about 5. A test
flock that flies straighter than the real thing invents a defect in a model that is fine.

⚠ AND THE BORDER-DENSITY FINDING IS REAL, WAS ATTEMPTED THREE WAYS, AND DOES NOT SHIP. Real
flocks are packed more tightly at the border than at the centre; ours runs 2.80 at the middle to
0.38 at the rim, in shells of equal volume where 1.0 is uniform. A shell-shaped attractor was built
and measured three times: targeting a radius on the bird's own home term moved it 2.80 -> 2.79 (the
term acts on the distance to a bird's STATION, not to the flock centre, so it builds a tube of
little shells along the course); a centre-relative push moved it to 3.01, the wrong way; the same
push in whitened coordinates -- each axis over its own spread, because a sphere is not the interior
of a 1 : 3.1 : 5.3 cloud -- reached 2.65, about 5% of the distance.

The reason is structural rather than a tuning failure. With `wHome` at 4.5 pulling every bird to a
point-like station and separation acting only at 0.09 tiles, the equilibrium is a tight cloud around
each station, so the density profile is the STATION DISTRIBUTION and a force term cannot outvote it.
Getting a genuine border would mean a real emergent flock -- much stronger neighbour cohesion, a
much weaker home pull -- which puts both the measured proportions and the centroid-honesty property
back in play. That is a rewrite of the force balance, not a term, and it has not been done.

## What it costs to simulate

Measured in a real browser frame, one truck seat, adaptive dials left free, 1,013 birds:

| | fauna phase | frame median | frame p90 |
|---|---|---|---|
| before | 9.04 ms | 11.8 | 25.0 |
| neighbour cache + skein skip | 6.06 | 9.3 | 24.5 |
| + reused snapshot | 4.76 | 7.9 | 17.8 |
| + no per-bird closure | **4.56** | **8.2** | **17.8** |

The birds’ own contribution to frame p90 went from about **20.7 ms to 8.6** over that, measured as
a within-run delta across three interleaved passes — the machine’s baseline drifts between runs, so
absolute p90s from different sittings are not comparable and the delta is the honest figure.

⚠ THE COST IS THE SIMULATION AND THE SPIKES WERE THE ALLOCATION, which are two different
problems and were fixed by two different changes. Finding a bird's seven neighbours is 80% of the
boids step (2.51 ms of 3.14 at 1,013 birds, against 0.36 for the forces and the integration
together), so the SET is cached and re-scanned every other frame, staggered per bird; distances are
always recomputed, because a stale distance would change the flock rather than only its cost. That
cut the steady state and left the p90 alone. The p90 was `pts.map(p => ({...}))` -- a fresh object per
bird per frame -- and six reused Float64 arrays took the birds' p90 contribution from about 20.7 ms
to 10.5.

⚠ WHERE THE REST OF IT GOES, PROFILED RATHER THAN GUESSED. Of the 4.56 ms, `murmur()` is 2.66 and
the per-bird loop and draw is 2.04. Inside the sim, with the set cached, the search is STILL 71% of
the work (`buildGrid` is 3% and not worth touching). Three things were tried against it and none
shipped: the grid cell size is already near its optimum — doubling it is 0.58x and halving it is
1.06x, inside the noise, and the positions hash identically either way so the traversal is exact;
hoisting the per-species lookups out of the loop is 0.027 ms because the JIT already inlines them;
and the flash arithmetic is 0.038 ms. The one that did land was the closure: `emitScatterFace`
is `if (SCATTER_SINK) { fn(); return; }`, so with GLASS 2 on the arrow function was allocated,
passed and invoked immediately — a thousand allocations a frame for a deferral that never happens.

⚠ AND A FLOCK BEHIND YOU IS FROZEN, NOT SKIPPED. Flocks are gathered by `flocksNear` on a RADIUS
and the only visibility test is per bird, after `murmur()` has already run -- so a murmuration out
of shot used to pay its entire boids step. A frozen step costs **0.059 ms against 1.294, twenty-two
times cheaper**.

The distinction is the whole design. The flock’s centre is pure arithmetic off the cycle and keeps
moving whether or not anyone draws it, so a cloud that simply STOPPED would come back a long way
behind where it belongs, and the home pull would haul a thousand birds across the sky in front of
whoever just turned round. The cloud is translated with its centre instead, which preserves its
internal structure exactly. Measured over two seconds frozen: the centroid holds the same 0.715
tiles off its centre as when live, and the first live frame afterwards moves the furthest bird
**0.027 tiles -- identical to an ordinary frame**. The path is still recorded while frozen, because
the ribbon’s shape comes from where the flock has been.

⚠ THE MARGIN HAS TO FIT INSIDE `drawRange` OR THE CULL IS DEAD CODE, and the first cut did not.
It allowed `st.r * 2 + 2` = 6.8 tiles against a songbird `drawRange` of 6, so a flock close enough
to be simulated could never be far enough behind to qualify and it never fired once. The furthest a
bird actually gets from its centre is 1.97 tiles, inside `st.r` itself, so the margin is `st.r + 0.5`.
A lateral cull is deliberately not done: the projection is wide and a flock just off the edge of the
frame is one head-turn from being on it.

⚠ AND IT CANNOT BE A/B’d BY TURNING THE CAMERA IN THE BENCH SCENE, which cost an afternoon of
confusing numbers. That map is wall-to-wall citycore with 118 songbird anchors, so turning round
does not leave the flock behind -- it brings a different one into view, and the frame cost is
unchanged for a reason that has nothing to do with the cull. The freeze is tested at the `murmur()`
level, where cost, tracking and thaw are all separable.

⚠ AND THE CACHE IS NOT FREE IN FIDELITY. A bird whose nearest neighbour changed between scans does
not separate from the newcomer, so the flock packs slightly flatter: proportions 1 : 3.1 : 5.3 with
no cache, 1 : 3.5 : 5.5 at every 2, 1 : 3.6 : 5.3 at every 4, against real starlings at 1 : 2.8 :
5.6. The MEAN spacing is untouched at every interval; only the closest pair tightens. `FLAT_Z`
cannot buy it back -- lowering it restores the flat ratio and costs the plan ratio instead.

⚠ ONE VERSION OF THE CACHE MEASURED 3.3x AND WAS THE BOIDS DOING NOTHING. `const k = cnt`
sat above the restore and read the count the SEARCH left behind, which on a cached frame is zero
-- so the force loop iterated no neighbours at all on three frames in four. It is below the
restore now, and the honest figure is the one in the table. 
cannot buy it back -- lowering it restores the flat ratio and costs the plan ratio instead.

⚠ ONE VERSION OF THE CACHE MEASURED 3.3x AND WAS THE BOIDS DOING NOTHING.  sat
above the restore and read the count the SEARCH left behind, which on a cached frame is zero -- so
the force loop iterated no neighbours at all on three frames in four. It is below the restore now.

## Four things that were open, and how each closed

**Spacing was too tight, and fixing it improved the shape too.** Ballerini puts a starling’s
nearest-neighbour distance at 0.7–1.5 m and ours sat at 0.50, so `sepR` went 0.09 → **0.15**
(about 1.05 m, between what shipped and StarDisplay’s 2.2 m). ⚠ NOTHING DOMINATES — THE MODEL
TRADES SPACING AGAINST ELONGATION: 0.09 gives 0.50 m and 1 : 3.5 : 5.5, 0.12 gives 0.57 and
1 : 2.9 : 4.6, 0.15 gives 0.67 and 1 : 2.4 : 4.0, 0.20 gives 0.74 and 1 : 2.3 : 3.2. An anisotropic
push was built first, on the theory that separation should carry the same vertical stiffness
`FLAT_Z` asserts — measured, it was not needed and was worse, so the knob was not kept.

**Border density does not close, and now there is evidence rather than an assertion.** Four
approaches were built and measured: a shell-shaped attractor on the bird’s own home term (2.80 →
2.79), a centre-relative push (→ 3.01, the wrong way), the same push in whitened coordinates (→
2.65), and a **border detector** — the resultant of the unit vectors to a bird’s neighbours, which
is near zero inside and points inward at the rim, and is the mechanism the literature actually
describes. None moved the profile. Sweeping the whole force balance moved it no further: across
`wHome` 4.5 → 0.6 and `wCoh` 0.55 → 3.0 the centre bin never left 2.07–2.42 while the pancake
collapsed from 3.41 to 1.12 and centroid drift quadrupled.

⚠ AND THE EXPLANATION GIVEN FOR IT WAS WRONG, WHICH IS WORTH MORE THAN THE FAILURE. It was
blamed on the station-based ribbon — that the density profile IS the station distribution, so no
force could outvote it. Turning the stations off entirely (`trail: 0`, a plain boids ball) gives
the same profile: 2.36 against 2.21. The centre-heaviness is inherent to this boids formulation,
not to the ribbon, because separation is short-range while cohesion and the home pull are
long-range and both centre-seeking. Nothing in the model knows where the edge is.

**Starlings read as birds up close now.** `dotPx` went 10 → **3**, which takes the mesh out to 2.1
tiles — past the 1.28 a ground eye is from a murmuration at `z` 1.4, so it is reachable at last.
The tail is bounded by `faunaMeshMax` (120 birds a frame) rather than by the threshold, with
`MESH_ALWAYS` above it so the nearest bird never loses the budget to the far edge of a flock
visited first. ⚠ MESHING COSTS 16.6 us A BIRD, NOT 4.4: the first figure timed
`faunaWorldFacesInto` alone, and a meshed bird also runs the whole of drawGooseAir and has its
faces uploaded every frame. Measured at one camera with only the cap varying, the fauna phase runs
9.46 → 15.43 ms across 360 meshes.

**And the fourth was never a bug.** "Nothing draws inside about a tile" was a harness artefact:
`mapCenter` is a TILE and integer by contract — cockpit.js rounds it explicitly and the window
indexes as `map[wy - wcy + R]`— and the test was passing 0.6 and 1.4. Every integer distance
draws birds and every fractional one draws none, at 5.5 tiles exactly as at 0.6, which is what says
it was never about distance.

## Flying into one, and what it costs

A murmuration is the most expensive thing the fauna system can put on screen, and the case that
matters is the cockpit seat a couple of tiles from a flock. Measured there, warm, median of three,
with 2,606 birds in view:

| | fps | `world:fauna` | `world:gl` |
|---|---|---|---|
| before | 34 | 13.0 ms | 13.4 ms |
| after | **81** | 7.1 ms | 3.2 ms |
| every bird a dot (the ceiling) | 138 | 4.7 ms | 0.6 ms |

⚠ **THE BUDGET WAS NEVER IN BIRD COUNT.** Two seats with an identical 2,606 birds measured 49 fps
and 21: more flocks and more birds ran twice as fast as fewer. What separates them is how big the
birds are on screen, because a bird as a DOT is close to free — a whole flock of them is 0.5 ms —
and a bird as a MESH is not. The bird count is bounded by `birdFacesGL` at about 3,000; what
actually needed bounding was the mesh count.

⚠ **AND `MESH_ALWAYS` WAS AN UNBOUNDED EXEMPTION RATHER THAN A PRIORITY.** Anything bigger than it
meshes whatever else is on the frame, which is the right instinct — the bird in front of you should
not be a speck because a flock behind you spent the allowance — but as written it meant
`faunaMeshMax` bounded nothing in exactly the case it exists for. Fly at a flock and every bird
clears the bar. Measured, that one condition was 21 fps against 53. It is a ceiling now
(`faunaNearMul`, a multiple of the budget); 0 restores the old behaviour.

⚠ **AND A STARLING FOUR PIXELS ACROSS DOES NOT NEED 55 FACES.** `lod` is a fourth key in a
fauna model file — a SPARSE OVERRIDE, never a second model, so everything it does not name is still
the near row and the two cannot drift when somebody repaints one. The starling drops its primaries,
wing patches, eye and half its body sides: **55 faces to 34**. Held against the near model at 1.6
tiles — closer than its own threshold would ever allow — the two pictures are indistinguishable,
so `faunaFar` at 14 px is conservative and could go higher if it is ever needed. 0 is the
near model at every distance, which is what shipped.

### What is left, and why it is not worth doing

The only real item remaining is **GPU instancing**. Each bird's 165 vertices are handled twice a
frame: transformed into arrays-of-arrays by `faunaWorldFacesInto`, then flattened into the GL
buffer. Instancing would upload one static buffer per (species, beat, tier) plus about twelve floats
a bird — 360 x 12 against 360 x 165 x 3.

It is not worth building. The worst case already clears 60 fps; the entire remaining mesh cost is
about 6 ms, and deleting every bird mesh — a strictly worse-looking game, and the ceiling instancing
could approach but not reach — buys 81 to 138. Against that it is a refactor of `pushFauna`, the
sink format, the 2-D fallback and a new shader path, because `FAUNA_SINK` is a flat list of
faces with no pose identity to instance ON.

⚠ **AND TWO THINGS THAT LOOKED LIKE THE ANSWER AND WERE NOT, both measured before building them.**
Sharing an orientation between birds so they can share a transform saves at most **14%** of the
rotation arithmetic, and the rotation arithmetic is **0.39 ms of an 11.2 ms** mesh build — the cost
is per-face object plumbing, not maths. And the per-bird bookkeeping suspects — two species-row
lookups, the payload allocation — measured **0.049 ms and 0.002 ms** at 2,606 birds. Both were
written, measured, and reverted.

### Measuring it at all

⚠ **THE PROFILER READS `performance.now` AND EVERY BENCH IN THE REPO PINS IT.** That is why
`perfSnapshot` comes back with `frames: 0` inside one and looked broken. `runFlightFauna`
leaves that clock alone and advances `Date.now` by hand instead — which it must, because
`flockState` reads THAT one, and a songbird is on the ground 55% of its cycle: a first cut that
left both clocks real measured an empty sky in two runs out of three and reported it as a fauna cost.

⚠ **AND COLD V8 IS A 2.5x LIE.** The same configuration measured 34 fps cold and 81 warm, and a
whole-frame number taken straight after a page reload is worthless. Warm with a throwaway run, then
take a median; repeats then sit within a few per cent (78/81/83/78). Every absolute figure in this
section is warm. Phase times are trustworthy in a hidden pane and whole-frame fps is not, so prefer
the phase.

## The written half

[describe.js](../server/engine/commands/describe.js) carries a line pool per species per state —
walking, rafting, airborne, inland, perched, and the songbird's dawn pool, which outranks the flock's
own state because at first light the point is that you cannot see them. Lines are picked
deterministically off the tile, so a field keeps its own sentence instead of rerolling one every time
somebody walks back into it.

⚠ **NOTHING IN THE PROSE ANNOUNCES A KILL.** The stoop is derived on both surfaces and either it is
happening at this instant or it is not; a room description that announced one every time you walked in
would be claiming an event that did not occur. What a room may say is that the bird is up there with a
view.

⚠ **AND THE ROOM'S PERCH TEST IS WEAKER THAN THE RENDERER'S, ON PURPOSE.** The room asks whether there
is a building against this tile; the window asks whether that building actually yielded a ledge. They
part company only on a building carrying no ledge anywhere — 11 of the city's 375 — and closing that
would mean shipping the shape capture to the server.

## Flags and gates

| flag | what 0 does |
|---|---|
| `RENDER_TUNE.geese` | no flocks at all; it also scales the density roll |
| `RENDER_TUNE.birdPerch` | every flock back on the deck (the shared RULE still answers, so the room is unchanged) |
| `RENDER_TUNE.birdCalls` | silence |
| `RENDER_TUNE.birdFaces` / `birdFacesGL` | the canvas and mesh budgets |
| `RENDER_TUNE.faunaDot` | no sprite LOD — every bird is a mesh at every range |
| `RENDER_TUNE.faunaFlash` | no orientation flash; a murmuration is a cloud of identical dots again |
| `RENDER_TUNE.murmurTrail` | the point attractor again — a murmuration balls up instead of taking its shape from its path (0.3 ships) |

`npm run shapes:smoke` runs both gates, and both are in the push chain:

- **[scripts/shapes/fauna.mjs](../scripts/shapes/fauna.mjs)** — the flock cycle, the skein, the
  wingbeat, the gear, the calls, the budget, the startle, determinism across a recentre, the orientation
  flash banding rather than flickering per bird, the ribbon shape AND its centroid staying on the
  tile the room names, the hawk's wave reaching the eye as a band, and that nothing hangs below a
  bird's feet.
- **[scripts/shapes/perch.mjs](../scripts/shapes/perch.mjs)** (`npm run gl:perch`) — sweeps every
  building tile in the baked city and asserts every standing point is on mass `modelTopAt` agrees is
  there, then renders a real street and checks birds are actually up on a building. Mutation-tested
  against eight separate breakages. ⚠ It sweeps the REAL city rather than the model registry, because
  a ledge is a function of the model AND the tile — the entrance facing rotates it, the floor count
  scales it, and the per-tile seed picks the variant.

## Not built

Ground fauna of any kind. Nesting, feeding, or anything that remembers a player. Birds reacting to
weather beyond the gull coming ashore before a blow. A bird a player can interact with at all — the
one animal in the game you can touch is the cat, which is a plugin and a different thing entirely
(see [systems-strays.md](systems-strays.md)).
