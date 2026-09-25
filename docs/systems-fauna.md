# Fauna — the birds over the Basin

**STATUS: BUILT** (`client/shared/birds.js`, `client/game/js/panels/windshield.js`,
`client/game/js/panels/murmur.js`, `client/game/js/panels/fauna3d.js`, `client/game/js/panels/gl/murmur-gpu.js`,
`client/game/js/panels/gl/fauna.js`, `content/fauna_models/`).
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
`falconStoop(…, near)`, `flockClearance(f, isBlocked)` — because only the caller has the terrain. The
renderer reads its own map window and the text game reads its own grid index; the RULE lives in one
file so the two cannot drift apart.

## The six

The rows live in `SPECIES` in [birds.js](../client/shared/birds.js) and are the source of truth;
this table is a reading of them, not a second copy to keep in step.

| | goose | gull | pigeon | songbird | hawk | vulture |
|---|---|---|---|---|---|---|
| wingspan (model units) | 0.85 | 1.1 | 0.5 | 0.155 | 1.02 | 1.3 |
| birds in a flock | 3–6 | 4–12 | 4–10 | 450–1,700 (a grand roost 4,000–300,000) | 1 | 3–7 |
| cycle | 100 s | 55 s | 27 s | 300 s | 150 s | 210 s |
| share of it on the ground | 40% | 25% | 78% | 70% | 18% | 42% |
| ceiling / circuit radius | 2.2 / 3.4 | 1.6 / 5.0 | 0.9 / 1.6 | 5.0 / sweeps a roost of 5, slowly | 3.6 / 1.9 | 4.4 / 3.2 |
| wingbeat | 1.5 Hz | 1.5 Hz | 1.5 Hz | 10 Hz, with glides | 1.5 Hz | 1.5 Hz |
| drawn out to | 14 tiles | 13 | 7 | 6 | 16 | 18 |
| about between | 06–20 | 05–21 | 06–20 | 05–18:35 | 08–18 | 08–18 |
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

`falconStoop` is resolved once per frame, before anything draws, because two things read the answer —
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

### What a real murmuration does, and the rule that does it (2026-09-23)

The flock-level half is [murmur.js](../client/game/js/panels/murmur.js), the per-bird rule is the shader in
[gl/murmur-gpu.js](../client/game/js/panels/gl/murmur-gpu.js), and the centre's path is `wanderAt` in
[birds.js](../client/shared/birds.js). Nearly every number comes from the STARFLAG/COBBS reconstructions of
starling flocks over Rome (Ballerini 2008, Cavagna 2010, Attanasi 2014–15, Bialek 2014), Hemelrijk's
StarDisplay model, and Storms et al. 2019's 795 filmed escape events.

**It travels as one body.** Real flocks have a polarisation of 0.96 ± 0.03 (Cavagna 2010) and a centre
moving at 10–12 m/s. The old rule held each bird to a fixed station on the path its centre had flown, while
the centre looped a one-tile circle at about 1 m/s, so twelve-metre-a-second birds orbited a point that
barely moved. That's milling. The starling now has its own circuit, `circuit: 2`: three epicycles in
seconds of flight that sweep a roost of radius `roam` (5 tiles, growing by the cube root of the count). The
centre moves at a median 10.2 m/s (7–14 m/s from the 5th to 95th percentile) and turns at 0.29 rad/s,
about the gull's 0.26. It's still a closed form, so the room text and the hawk read the same flock.

**It turns by relay, at equal radius.** A turn starts at a side edge and crosses the flock at 10–20 m/s
(Attanasi 2014). Each bird steers by the centre's own course as it was `delay` ago, where `delay` is its
distance from the inside edge of the turn over the relay speed (17 m/s). Every bird turns on the same
radius, so the body keeps its world orientation while the heading swings through it.

⚠ **The relay is centred on the present, never on the past.** Steered only by the past, the whole body
trailed its centre by the mean delay times its speed, 1.3 tiles in a steady turn. The record carries
`course`, which is `flockCentreAt` in birds.js, the shared model's centre at any time. The course table
is sampled from half the relay's span ahead of now, so the middle bird flies the course now and the body
sits on its centre. `flockCentreAt` shares one phase helper with `flockState`, so they can't disagree
about when the flock is up.

**The body is flat and broadside.** Real flocks are 1 : 2.8 : 5.6 (thickness : width : length) with the
long axis 60–90° across the course in straight flight (Attanasi 2015). The old ribbon put the long axis
along the path. The body is held in an ellipsoid (`ENV_L/W/T` in murmur.js), free inside and pushed back
over its outer band, which also makes the edge denser than the middle, as Ballerini found in all ten of
his flocks. Its long axis relaxes back to broadside over `ENV_TAU` after a turn, and its plane banks into
the turn.

⚠ **A bird holds its place fore and aft by its speed, not by turning.** Its speed is set, so a push from
the front of the body could only swing it sideways, and the body smeared out along its own course. The
rim pushes only across and vertically; a bird past the inner band slows or speeds up (`catchK`).

⚠ **Separation acts in full vertically.** Damping it with alignment and cohesion let cohesion press the
flock into a sheet, 1 : 12.9 thick-to-wide.

⚠ **The turn gain has to beat the turn rate.** At `wCmd` 1.8 a bird lagged a 0.3 rad/s turn by about
10°, and the body swung wide and trailed. At 4 the lag is a few degrees.

**Speed is shared and changes slowly.** A bird flies at the centre's speed, clamped to 6–16 m/s (wind
tunnel: 6.3–14.4). The deviation between birds is a few per cent, spatially smooth over domains about a
third of the body, and slowing is easier than speeding up (Cavagna 2022). The old fixed per-bird factor of
0.85–1.15 had birds overtaking each other.

**It beats its wings at 10 Hz and glides between bursts.** Every species used the goose's 1.5 Hz, and at
10 m/s that let a starling cover about 23 wingspans per beat. A tiny bird skating across the sky on still
wings reads as paper or insects. At the field-measured 10 Hz it covers 3.6 spans per beat, the same gait
as the goose (2.4) and the gull (about 4). `glide` is the share of each burst-and-glide cycle spent with
the wings held out (Tobalske 1995), offset per bird so the flock never glides in unison. `flapHz` is on the
species row and every other bird keeps the goose's rate.

**The dark bands are wings shown to the eye.** A bird's bank is its real turn, `g·tan(bank) = v·ω`, up to
`rollMax` (1.25 rad). The dot is shaded by the wing plane's normal against the line of sight
(Hemelrijk 2015; Costanzo 2021), so a bird banked toward you shows its planform and one banked away shows
its edge. Most of the flash is now the whole flock lightening and darkening as it turns, measured at a
swing of 0.20. A turn front crossing the flock spreads it by up to 0.05, and neighbours agree 2.3× better
than chance. ⚠ That reverses a rule the old flash section below states. "The flock must not pulse as a
whole" was right for birds on independent headings, and a flock that turns at equal radius does exactly
that.

**Travelling bands are a response to a hawk.** Every source ties pulse trains to an attack. `agitationWave`
is 1–5 pulses (mean 3.1 against a measured 2.88), 0.86 s apart, each leaving the stoop at 13.4 m/s with
its bank shrinking by `PULSE_DECAY` per relay. A hole (flash expansion) follows one attack in four, off
the same hash (Storms 2019: 25%). The constant rolling bands every flock carried every 0.75 s are gone.

**Measured** (`__glMurmurParity` on the game's own path, six roosts, 1,000 birds):

| | the flock | real flocks |
|---|---|---|
| thickness : width : length | 1 : 2.8 : 5.1 | 1 : 2.8 : 5.6 |
| polarisation | 0.988 | 0.96 ± 0.03 |
| nearest neighbour | 0.82 m | 0.68–1.51 m |
| off its centre | 0.31 tiles | — |
| long axis from the course | 87–88° straight, 52° mean while turning | 60–90° straight |
| Q4 (3 s) | 0.83–0.9 straight, about 0.3 turning, 0.36 mean | about 0.58 |

⚠ **Two shortfalls remain.** The wander path turns almost all the time, so the long axis spends much of
the flight swung by a turn. Churn is high while turning and low in a straight, so Q4 matches the
research on average rather than moment to moment. **Not built from the research:** the evening structure
(one 20–45 minute display and a funnel into the roost, where this flock flies 18–36 s and lands),
sub-flocks that split and merge, and the escape set beyond the pulse train and the hole (blackening,
dives, columns, cordons, vacuoles).

### On the GPU, and only on the GPU (2026-09-23)

A murmuration is simulated in [gl/murmur-gpu.js](../client/game/js/panels/gl/murmur-gpu.js) and drawn
straight out of its textures by [gl/fauna.js](../client/game/js/panels/gl/fauna.js). Nothing about a
bird reaches the CPU. Each frame, for each cloud, the birds are filed into a spatial grid, then one
fragment pass reads every bird's position (with its roll) and velocity (with its visibility) from two
float textures, finds its seven nearest flockmates, applies the rule, and writes the next state into
the other pair. The drawing side is one instanced draw per detail level, and each vertex shader works
out for its own bird what the per-bird loop in windshield.js used to: the cull and fade, its size in
pixels, the detail level that size earns, the wingbeat row, and the bank.

**There is no CPU flock at all.** murmur.js's per-bird step was deleted once the GPU flock had matched
it; what is left in [murmur.js](../client/game/js/panels/murmur.js) is the flock-level half the GPU
reads: the rule's numbers (`MURMUR_RULES`, with the notes that justify each), the flock's memory
(`flockFrame`: its clock, the trail its centre has flown, the stoop), the starting cloud
(`seedPoints`) and the two travelling waves. The reasoning behind each term of the deleted step
is in git at d4dc4f7fa. `murmurRoute()` in windshield.js answers **gpu** when the real GL pass is
drawing and **none** otherwise, so on GLASS 1 and in every headless harness no murmuration is drawn
and none is heard. The server's room text still describes one to a player who cannot see it; that
mismatch was accepted with the decision.

**The neighbour search goes through a hashed grid.** Brute force (every bird against every other) is
exact, and grows with the square of the flock: 5.1 ms a step at 12,000 birds. So each step the birds
are filed into cells about half a bird-spacing wide, and each bird walks outward in shells of cells
until it can prove nothing unread is nearer than its seventh — once every cell within Chebyshev
distance r has been read, anything further is at least r cells away. About 97% of birds are settled
within four shells, and for those the answer is brute force's answer, ties to the lower index. The
rest (stragglers on the edge, and the birds in the hole a stoop opens) also try last frame's seven
neighbours and each of theirs, 56 candidates, because who your seven are changes far more slowly than
where they are. Two details decide whether it works at all. The cells are hashed into a fixed table, so
there are no bounds to fit and a straggler anywhere is filed like any other bird. And WebGL2 has no
atomics, so a slot's birds are peeled one layer per pass: each bird is a one-pixel point at its slot
with its index as the depth, and each pass discards everything the last one kept.

⚠ **Brute force for the unsettled birds was built, measured and taken out.** It is exact, and a GPU
runs birds in groups that move in lockstep, so one long search holds its whole group: with ~2% of
birds unsettled, about 40% of groups held one, and the step cost 9.4 ms at 20,000 birds against 1.1
without it. Drawing the unsettled birds as points so they would pack together cost the same, because
each point ran as a group of its own. Walking sixteen shells instead cost 18 ms, for the same reason.

⚠ **The cell is sized from the cloud's own spacing, never in tiles.** The spread grows with the cube
root of the count, so `spread / cbrt(n)` is the spacing the flock was sized for. A fixed 0.12 tiles
held twelve birds and more to a cell at 20,000, and every full slot is an unsettled bird.

**What it costs.** GPU time for one step, measured with a GPU timer query over 20 back-to-back steps
on an RTX 2070 SUPER (ANGLE, D3D11), each flock settled for 240 frames first (`__glMurmurCost`):

| birds | grid | brute force |
|---|---|---|
| 4,000 | 0.72 ms | 1.9 ms |
| 12,000 | 0.94 ms | 5.1 ms |
| 20,000 | 1.58 ms | — |

The CPU step was 22.7 ms at 4,000. A whole cab frame with a 19,953-bird roost in it and another cloud
beside it (22,610 GPU birds) took 12.4 ms of wall clock at the median (`__glMurmurShot`).
⚠ **Every number here is one discrete NVIDIA card**, and nobody has measured an integrated GPU.
⚠ **Timer readings wander between runs by up to 2x** (the same brute-force step read 4.4 and 10.0
ms in two sessions), so compare within one run and never against a number in this file.

**How close to exact it is.** `__glMurmurExact` flies one flock through a stoop and a thinning and,
at checkpoints, runs both searches on the same state and compares every bird's seven. At 6,000 and
12,000 birds, every settled bird matched brute force exactly, and 99.6-99.9% of all neighbour links
matched overall. The misses are the unsettled birds' furthest neighbours; once, at 12,000, eight birds
missed a neighbour inside the separation radius.

**It flies like the CPU flock did.** `__glMurmurParity` flies fauna.mjs's shape protocol and
measures with [client/shared/flock-shape.js](../client/shared/flock-shape.js): 1 : 2.8 : 5.2 at 0.88 m
apart, against real starlings at 1 : 2.8 : 5.6 and 0.7-1.5 m, and against the deleted CPU flock's
1 : 2.8 : 5.7 at 0.81 m. With separation removed it collapses to 1 : 14.3 : 40.8 and fails, so the bench
can see a broken rule.

**Everything the CPU gates asserted is now a bench.** fauna.mjs and murmurthin.mjs drove the CPU step
on every push, and no headless harness can reach a GL draw call, so `__glMurmurChecks` in the
Modelshop asks the same claims with the same numbers of the GPU flock, by hand: it holds its derived
centre, stays a flock, keeps its birds out of each other (0.049 tiles apart, 0.028 with separation
off), releases its state, bands its flash (neighbours agree 2.25x better than chance), carries the
hawk's wave as a ring, opens a hole round a stoop (55% fewer birds), carries a frozen cloud with its
centre, and thins without reseeding, blinking or popping. murmurthin.mjs was deleted; fauna.mjs keeps
the checks that are still pure arithmetic (the agitation wave, the neighbour count). That is the cost
the no-fallback decision accepted.

**The GPU has its own budget, in birds.** `RENDER_TUNE.murmurBirds` (300,000) caps the birds stepped
in one frame over every cloud in view; clouds are admitted nearest first, and one that does not fit is
not drawn rather than drawn short. A GPU cloud is not charged to the face budget, which was capping a
murmuration at about 1,800 birds for a CPU cost it no longer has. ⚠ **The draw skips detail levels no
bird can reach**: each level is one instanced draw over every bird in the cloud, so at 20,000 birds a
full-mesh pass is millions of vertices for a cloud that is a smudge. The sphere murmur-gpu.js keeps
round the stations bounds how near any bird can be, and a bird outside it is clamped to the nearest
level that is drawn, never lost.

**Gates.** `npm run gl:murmur` ([scripts/shapes/murmurgpu.mjs](../scripts/shapes/murmurgpu.mjs), in both
chains) checks the route: one complete record per flock on the GPU route with every number finite and
no bird left behind, the bird budget charged and honoured, and nothing drawn on GLASS 1 or under a
harness hook. A field missing from the record is a NaN uniform that draws nothing, which is why that
check exists. `gl:glsl` checks the shaders' names. Whether they compile, and what they draw, only a
browser can say.

⚠ **A bench that reuses a canvas id reuses the GPU flock.** It lives in the GL context, so a new run
starting its clock earlier than the last one hands the cloud a negative elapsed time, and it never
steps. `withBench` in glbench.js takes a fresh canvas id per call.

### Grand roosts: a few flocks are enormous

The starling's `maxFlock` is 300,000, and flockSize rolls two bands rather than one wide one: one
anchor in `grand.share` (4%) draws from 4,000 to 300,000, skewed low (u squared), and the rest keep
450 to 1,700. A single band across 450-300,000 would have made the ordinary flock ten thousand strong
and the great roost ordinary. Over a synthetic all-habitat city at 8% that gave a median grand roost of
7,800 birds and 27 over 15,000 among 2,177 anchors; it ships at half that share. The room text words a
crowd rather than printing it: "Thousands of them are up over the trees", because nobody under a
murmuration could say it holds 18,431 birds. A starling party under 200 keeps its number.

### Landed: the same flock, on the ground

A starling flock that lands off any ledge stays the GPU flock, in GROUND MODE. There is no flocking on
the ground: each bird walks from wherever the cloud left it to its own spot on the patch, arriving
exactly when the settle window closes, then mills round it. The spot is `groundSpot` in birds.js,
split so the per-bird half (`groundSpotParts`: direction, share of the patch, jitter, mill phases) is
baked into two textures once per flock and put together in the shader. The draw switches to the
walking pose, stands the bird level and gives it the same bob `drawGooseGround` does. No neighbour
search and no grid run on the ground, so a landed flock costs the sim almost nothing.

It used to become a CPU flock at touchdown: drawn bird by bird, thinned to the face budget (about
1,800 birds), with every bird jumping from its cloud position to a skein formation. Measured with
`__glMurmurLanding`: no bird moves more than 0.06 tiles in a frame across touchdown (cruise is 0.036),
against jumps of 0.37-0.45 tiles on the old path. Every landed bird stands within 0.00001 tiles of
where `groundSpot` puts it, and no bird went below the ground. A floor now stops an airborne bird below
0.03 tiles, because a flock coming in to land is centred on a point at the ground and half of it
used to fly through the turf.

⚠ **A perched flock is still the CPU's**, because a ledge and a wire are geometry the GPU flock has
never seen, and **a grand roost never perches** (`perchedNow`, shared with the room text): ten thousand
starlings do not line one gutter, and a perched flock is thinned to about 1,800. An ordinary flock on a
parapet is under that anyway. `RENDER_TUNE.murmurGround` 0 hands landed flocks back to the per-bird
path, for the A/B.

**What it costs, on the machine it was measured on** (RTX 2070 SUPER, 1280x720, `__glMurmurGpuFrame`,
a GPU timer query round the whole frame). With a grand roost of 20,000 landed round the cab: GPU 11.3
ms and CPU 18.1 ms a frame in ground mode, against GPU 11.3 and CPU 21.3 on the old per-bird path,
which drew about 1,800 of them. In the air the roost's size barely moves the frame: 8.6 ms of GPU at
8,500 birds in view, 9.0 at 84,000. What costs is starlings near the camera at mesh detail, about
5 ms of GPU whatever the count, and the CPU work of the rest of the frame.

### Far birds conserve their ink, and the glyph rung starts at 2.5 px

A distant bird was a hard dot at least 0.45 px wide, and the sprite layer only draws a dot where a pixel
centre falls inside it, about 64% of the time at that size. A third of a distant flock was undrawn at
any instant, and birds blinked on and off the pixel grid: the glitter that made a murmuration read as
confetti. A far bird is now a soft dot at least 1.25 device pixels wide, faint by exactly the area it
was given, so it deposits the darkness it really covers wherever it sits. Where birds overlap, the
darkness stacks. The glyph rung starts at 2.5 px rather than 0.7: a three-face bird flapping through
sixteen poses at one pixel is a speck snapping between shapes. Glitter under 0.09 px of motion went
from 37% to 0%, with total darkness up 16%. `faunaInk: 0` and `faunaGlyphPx: 0.7` restore both.

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
stoop's own timestamp** rather than on "a stoop is live", because `falconStoop` is derived and answers
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

⚠ **Superseded 2026-09-23** by the wing-to-eye flash in [What a real murmuration does](#what-a-real-murmuration-does-and-the-rule-that-does-it-2026-09-23).
This section is the history of the per-bird flash it replaced.

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

⚠ **Superseded 2026-09-23**: the ribbon and its stations are gone. See
[What a real murmuration does](#what-a-real-murmuration-does-and-the-rule-that-does-it-2026-09-23). The hawk's
bubble described here survives as the flash expansion a quarter of attacks get.

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

A starling flock is **450-1,700**, and one roost in twenty-five is a **grand roost of 4,000-300,000**
(see "Grand roosts" above). On the ground or on a ledge a flock is drawn per bird and thinned to fit
the face budget, never below 15; in the air it is the GPU flock, which builds no faces and has its own
budget in birds. Three numbers have to agree or the biggest one does nothing:

| | |
|---|---|
| `maxFlock` 300,000 | what the row asks for (`client/shared/birds.js`) |
| GPU bird budget 300,000 | `RENDER_TUNE.murmurBirds`, over every cloud in a frame; `murmurFloor` 40,000 is how far a grand roost thins under frame pressure |
| simulation ceiling 300,000 | what one GPU flock step was measured to afford (`MURMUR_BIRDS_MAX` in fauna.mjs) |

⚠ RAISING `maxFlock` ON ITS OWN DOES NOTHING, which is the trap: when the CPU simulated the flock the
face budget capped it at 1,221 against a `maxFlock` of 1,200, two per cent apart, so the thinner
clamped anything bigger straight back and the flock looked identical. The budget has to move with it,
and on the GPU route the budget is `murmurBirds`.

⚠ AND THE COST IS THE SIMULATION, NOT THE DRAWING. Past `dotPx` a starling is one instanced dot and
very nearly free; what scales is the neighbour search. The CPU step measured 1.5 ms at 600 birds and
16.3 at 3,200, which is why the ceiling there was 1,800.

⚠ **WHAT A STEP COSTS, AND WHY IT USED TO GROW FASTER THAN THE FLOCK.** Measured 2026-09-24 with
GPU timer queries round the filing and step passes, one settled cloud, RTX 2070 SUPER:

| birds | hashed grid, scatter order (before) | wrapped grid, space order (now) |
|---|---|---|
| 80,000 | 4.4 ms | 2.9 ms |
| 160,000 | 14.2 ms | 5.9 ms |
| 300,000 | 67 ms | 17.2 ms |
| 450,000 | — | 39.5 ms |
| 600,000 | never completed (device lost) | 72.8 ms |

The grid was not overfull: a 4× table under the old hash only took 300k from 65 to 49 ms, with the
same unsettled birds. The cost was cache misses. The XOR hash scattered the ~125 cells one search
reads across the whole table, and the birds themselves sat in scatter order, so almost every
neighbour read missed. Two changes fixed it. **The slot is the cell wrapped**
(`slotOf` in `gl/murmur-gpu.js`), so neighbouring cells are neighbouring texels. **`seedPoints` returns birds in Morton order**, so
neighbouring birds are neighbouring texels, and a murmuration keeps its neighbours long enough
that sorting once at the seed holds (14.1 ms still at 300k after 300 frames). The table is 256 × 256 × 16 cells on 8 layers (a 1024 × 1024 texture array, 32 MB). Measured at 300k
it beat the other shapes tried: 128 × 128 × 32 on 16 layers took 19.6 ms (a 300k body is ~173 cells
long and wrapped onto itself), the same wide table on 16 layers 15.2, and it takes 14.0. A 512 × 256
table was 47 ms, because its z wrapped every 8 cells against a body ~34 thick. The unsettled counts
were the same in every case, so the layout changes speed only, never the neighbours.

⚠ **A FAR ROOST STEPS LESS OFTEN TOO.** Once a bird is under half the dot size (`FL × span / distance`,
the draw's own arithmetic, so it cannot disagree with what is drawn) the cloud takes stride 2, and
under a quarter stride 3, whatever its cost. The larger of the two strides wins.

⚠ **A BIG CLOUD STEPS EVERY 2ND OR 3RD FRAME, CHOSEN BY ITS OWN MEASURED GPU COST** (`STEP_BUDGET_MS`
6, `STRIDE_MAX` 3, `STRIDE_MIN` 10,000 in `gl/murmur-gpu.js`). Each step is timed with
`EXT_disjoint_timer_query_webgl2` and the stride is the fewest steps that keep the cloud under 6 ms a
frame, with hysteresis. It's drawn between its last two states (`uLerp` in `gl/fauna.js`), so it's
one step behind itself, and each cloud takes its own phase. Measured on the RTX 2070 SUPER: 80k takes
stride 1, 160k stride 2, 300k stride 3. Three things about it:
- **The first eight readings are thrown away.** A cloud's first steps pay for textures, the shader's
  first run and idle clocks; folded in, they held a 20k cloud at 8.9 ms against a real 1.5.
- **The readings are noisy** on a GPU that is also drawing a city (one 20k cloud read 2.2, 4.4 and 8.4
  ms in three runs), so a flock under 10,000 never strides. Noise can only push a grand roost a
  stride higher, which costs lag and nothing else.
- **It stops at 3**, because at 60 fps that's a 50 ms step, which is `DT_MAX`; past it the flock
  flies slower instead of costing less. Without the timer extension (Firefox often lacks it) a cloud
  over `STRIDE_FROM` (120,000) takes stride 2. Benches pass `stride: 1`, because they measure the rule.

⚠ **THE SPACE ORDER HOLDS, BECAUSE A RETURNING BIRD JOINS ITS NEIGHBOUR IN MEMORY.** Flown for 90
seconds with no thinning, a 300k step went 12.3 → 10.1 → 9.8 ms as the flock settled: sorting once at
the seed is enough. What broke it was thinning. A bird fading back in was placed at its scatter point,
a random spot in the body, so one thinning episode left the step at 20 ms for good. It now appears a
separation radius from the nearest visible bird within six slots either side (the scatter point only
if there's none), and the same flight ends at 10.1 ms. Returning birds land within 3.23 tiles of a
3.18-tile body, against 3.50 before.

⚠ **THE GRID USES ALL 16 LAYERS AT 300k** even though no cell holds more than about 5 birds: slots
shared through the wrap stack up. So cutting layers to save memory is not free; it would leave birds
unsettled.

⚠ **STORING POSITIONS IN THE GRID WAS TRIED AND IS SLOWER.** The grid could hold each bird's position
beside its index, saving a second read per candidate. Measured: 10% faster at 80k, 30% slower at 160k
and 300k (21.2 ms against 17.4). An RGBA32F grid texel is four times the traffic, and since the Morton
sort the position reads it saves were already cache-friendly. The grid's own bandwidth is the cost now.

⚠ **ALL OF THIS IS ONE CARD.** Nothing above has been measured on an integrated GPU.

⚠ **A BIGGER ROOST IS STILL MOSTLY A DRAWING TRICK.** Vertex-animation-texture crowds reach millions
because nothing in them reacts. What costs here is the live neighbour search. Simulating fewer
birds and drawing each as a small cluster of followers would grow the drawn count while the step
stays flat. That isn't built.

## The free rules (as built)

The shape of a murmuration is not authored. Until 2026-09-24 every bird was held inside a fixed
ellipsoid round the flock centre and steered hard onto one shared course, so the flock was always a
lozenge. `FREE_RULES` in `gl/murmur-gpu.js` replaces both with local rules on the StarDisplay model
(Hildenbrandt, Carere & Hemelrijk 2010); `RENDER_TUNE.murmurFree` 0 puts the old flock back.

- **No body, no course.** A bird follows its 7 nearest neighbours (alignment, cohesion, separation,
  the blind sector behind) and nothing else tells it where to be. `cmd` 0.
- **Cohesion is stronger on the edge** (`edge` 3, times how one-sided its view of the flock is,
  squared). That holds a free flock together without a boundary.
- **A pull back past a radius** (`roost` 3 past `roostR` 0.6 body-lengths), horizontal, per bird. The
  part of the flock that strays turns first, the turn spreads through its neighbours, and that
  differential turning is where every fold, crescent and comet comes from.
- **A height spring** (`alt` 0.8 over `band` 1.2 body-thicknesses), a spring rather than a band: a
  band with a dead zone is a floor and a ceiling the birds pile against, and drew the flock with a flat
  top and bottom.
- **A small wander** per bird (`wander` 0.15). At 0.6 polarisation fell to 0.78 against a real 0.96.
- **Neighbours match turning, not only heading** (`spin` 0.5): a bird's bank is pulled toward its
  neighbours' (the inertial spin model, Attanasi et al. 2014). With the shared course gone this is what
  makes a turn cross the flock as a band; banding went 1.8x to 2.46x better than chance.

⚠ **ANYTHING THAT HOLDS THE WHOLE FLOCK TO ITS CENTRE KILLS THE SHAPES.** A shared course, a uniform
push on every bird and a gentle position-only spring were each tried to stop the flock drifting, and
each flattened it back into a featureless disc: every bird's speed is fixed, so a push that is the same
for all of them is the same turn for all of them. So the flock is allowed to drift, and the game
follows it instead (below).

⚠ **SO THE STARLING'S CENTRE IS SLOW.** A free flock cannot whirl round a point moving at its own
speed: at the old 10 m/s it hung 4 tiles off the centre and clumped into a ball with a thin halo, the
opposite of a real flock. `wander` in the starling row of `client/shared/birds.js` now moves the centre at
about 3.4 m/s (0.25-0.48 tiles/s), so the murmuration performs over its roost while the birds whirl
round it at 10-12 m/s. The server reads the same centre for the room text and the hawk.

⚠ **THE GAME FOLLOWS THE MEASURED FLOCK.** Each step samples 1,024 birds into a 32 × 64 target and
reads it back through a pixel buffer and a fence (`sample`/`readSample`): asynchronous, a few frames
late, nothing waits. ⚠ **The fence must be flushed**, or it never signals, and a bench that steps in one
synchronous loop never sees a result at all (the checks bench yields for that reason). The measured
centre is used for:
- the culling sphere (`boundOf`), which is also widened by the roost radius;
- the hawk's scare and the agitation wave, carried by the flock's offset from the shared centre so
  they land on the birds (the hawk sprite still dives at the shared centre);
- where a bird fading back in appears: beside the visible memory neighbour nearest the measured centre,
  or near that centre if none is in reach.

⚠ **AND BUILDINGS.** Each roost gets a 64 × 64 height map at half-tile spacing (`murmurObstacles` in
windshield.js), the higher of `modelTopZAt` and `curtainTopZAt` — the geometry aircraft collide with —
cached per map window and uploaded only when it changes. A bird looks 0.8 s ahead, climbs and turns down
the height slope when within 0.6 tiles of a roof, and anything the look-ahead missed is lifted to the
roof. Against a 9-tile tower on the circuit: 0 birds inside it, against 4,546 without.
`RENDER_TUNE.murmurAvoid` 0 switches it off.

⚠ **HEIGHT AND THE CYCLE.** Starlings fly at `z` 5 tiles (about 55 m; it was 1.4, below most of the
city's roofs) and the cycle is 300 s with 70% on the ground: about 80 s of display, then 3.5 minutes
feeding.

Checked by `__glMurmurChecks` (all pass), `__glMurmurExact` (recall 0.998) and `__glMurmurParity`
(proportions 1 : 3.7 : 5.8 against a measured 1 : 2.8 : 5.6, polarisation 0.981). The centre check
now allows the roost radius plus the body under the free rules, 0.35 under the old. Look at the shapes
with `__glMurmurShape`, which posts a side-and-top contact sheet.

## The wingbeat, blended and blurred (as built)

A murmuration's wingbeat is 16 steps baked into the pose texture (`FAUNA_BEAT_STEPS`). The cloud's
vertex shader in `gl/fauna.js` does two things with them:

- **It blends.** The beat is a phase, not a row: `poseAt` reads the two baked steps either side and
  mixes them, so a slow flap (a landing, a take-off, a bird near the eye) moves smoothly rather than in
  sixteen jumps. One extra texture read per mesh vertex; far birds are dots and pay nothing.
- **It blurs a fast wing.** A starling beats 13 times a second, so a 60 fps frame samples fewer than five
  points of each beat and a sharp wing at a random point of it reads as flicker across a flock.
  `uBeatAdv` is how much of a beat passes in one rendered frame (`flapHz × frame time`, from
  `FAUNA_FRAME_DT` in windshield.js). Past `WING_BLUR_FROM` (0.12 of a beat) the wing is averaged over
  the frame's exposure with three reads, fully by `WING_BLUR_SPAN` later, and the vertices that travel
  furthest over a beat (the wings, never the body) fade by up to `WING_BLUR_FADE` (0.45). At 60 fps a
  starling is about half blurred; at 20 fps, fully.

⚠ **IT IS SUBTLE ON PURPOSE.** In a close shot of 4,000 birds it changes 1.35% of the frame at 60 fps and
1.62% at 20 fps: the wing tips soften and fade, the bodies do not move. A glide holds a fixed row and is
never blurred. Adding baked steps would not show at full beat speed: the limit is the frame rate sampling
a 13 Hz beat, not missing poses. `RENDER_TUNE.wingBlur` 0 draws the sharp wing as shipped (blending stays).

## The starling's day (as built)

`BIRD_TUNE.dusk` (on) is the evening half of the season code on its own: the flock size curve round dusk
(`roostFactor`) and the evening show (`roostShow`), without the year. `BIRD_TUNE.season` (the year) stays
off until launch. Both live in `client/shared/birds.js`, so the server's room text and the picture agree.

| time | ordinary flock | the 179,825-bird grand roost at 910,916 |
|---|---|---|
| before 05:00 | 30, roosting | 3,597, roosting |
| 05:00–16:30 | 30, short feeding flights (up about 28% of the time) | 3,597, short hops |
| 17:00 | 158, gathering | 18,955 |
| 17:30–18:20 | about 1,000–1,500, **the show** | 126,000–176,000, **the show** |
| from about 18:20 | down on the roost for the night | down on the roost |

⚠ **THE STARLING'S `dayEnd` IS 18.6, WHEN THE SKY STOPS DRAWING A BIRD.** windshield.js cuts every bird at
`sky.night` 0.55 (`GOOSE_NIGHT_OFF`), which its SKY table passes at about 18:35. At 21 the gathering peak
(`dayEnd - roost.lead`) fell at 20:18 and the dive at about 20:45, after the birds had stopped being drawn,
so the whole evening happened in the dark. ⚠ With the year off, the year may no longer call off the show:
`roostShow`'s `minSeason` gate now applies only when `season` is on.

## Waves and splits (as built)

⚠ **A MURMURATION LIFTS OFF AND POURS DOWN IN WAVES** (`MURMUR_WAVE_S` 24 in windshield.js, `uWave` in
`gl/murmur-gpu.js`). Each bird's turn comes off its rank, four waves with a little jitter. Coming down, the
rest keep wheeling overhead at their own height (`airZ`) until their turn, each with its own settle
deadline; going up, the rest keep walking on the patch (`hold`, the ground spec at rest) until theirs, and
the draw takes both passes for a flock that is half down. Measured on 4,000 birds: landing went from all
down in 3 s to 95% up at 3 s, 50% at 12 s, 2% at 21 s; take-off from 92% up at 3 s to 19% at 3 s, 60% at 12 s,
all by 21 s. Drawing only: the shared flock is up or down exactly when it always was.
`RENDER_TUNE.murmurWaves` 0 sends the whole flock at once.

⚠ **A SIDE OF THE FLOCK PEELS OFF AND COMES BACK** (`uSplit`, `SPLIT_EVERY` 17 s, `SPLIT_FOR` 6 s, `split`
4 in `FREE_RULES`). Birds on the side of the measured centre facing a hashed bearing are pulled that way
while the rest are not; their neighbours follow, so a piece breaks away as a sub-flock, and when the pull
ends cohesion and the roost bring it home. ⚠ **By position, never by rank**: a random third of the birds
pulled away stretches the whole flock rather than splitting it. Off during waves and on the ground.
Measured in `__glMurmurShape`: three sub-flocks at 13 s, a hook peeling off at 21 s, pieces apart and back
by 51 s; the checks, grid and parity benches all still pass.

## The hawk strikes (as built)

A stoop (`falconStoop`) is an event shared with the server: it scares the prey. For its three seconds the
hawk is now also DRAWN diving: `falconDiveState` in windshield.js bends its path onto the prey's measured
position (`MURMUR_MEASURED` in `panels/murmur.js`, written by the GPU readback) over one second, then back
onto its circuit over two. `RENDER_TUNE.falconDive` 0 leaves it on its circuit. Gated by
`scripts/shapes/falcondive.mjs` (`npm run gl:falcondive`, in the push chain and `shapes:smoke`).

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

This section describes the CPU step murmur.js used to run, which is deleted (see "On the GPU, and only
on the GPU" above). The measurements stand as the record of why the CPU could not go further.

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

`npm run shapes:smoke` runs both gates, and both are in the push chain:

- **[scripts/shapes/fauna.mjs](../scripts/shapes/fauna.mjs)** — the flock cycle, the skein, the
  wingbeat, the gear, the calls, the budget, the startle, determinism across a recentre, the orientation
  flash banding rather than flickering per bird, the hawk's pulse train (every crest at 13.4 m/s,
  each pulse weaker than the last, the event over by the time the longest train can last), and that
  nothing hangs below a bird's feet. The murmuration's shape, polarisation, spacing and churn are
  measured by `__glMurmurParity` in the Modelshop, because no headless gate can reach the GPU flock.
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
