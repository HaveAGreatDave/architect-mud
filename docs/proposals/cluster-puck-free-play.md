# Cluster Puck: free play on the server

**Status: design. Phase 0, a throwaway test outside the repo, is done; nothing is built.** A plan
to reverse how Cluster Puck is made. Today the server decides every beat of a game, and Rinkside
stages each one on the ice as the booth's line for it airs. Under this plan the server plays each
featured game as free hockey before it airs, and the booth and Rinkside both work from what
happened. Phase 0 played 100 games of free play with no director: the play holds up, the
home-side bias it found has a confirmed fix, and three things need fixing before anything is built
on it ([Phase 0 results](#phase-0-results)).

Read with [systems-broadcast.md](../systems-broadcast.md#hockey-specifics-as-built) (the sim, the
narrator, the pacing and Rinkside as built), the read tiers in
[architecture.md](../architecture.md#read-tiers-where-data-lives-at-runtime), and the free-tier
budgets in [ops-usage-watch.md](../ops-usage-watch.md). The decision layer is worked out in
[cluster-puck-ai.md](cluster-puck-ai.md), and the look that follows this plan in
[cluster-puck-glass2.md](cluster-puck-glass2.md).

## The short version

- The server plays a featured game headless, in a worker, an hour or more before it airs. Wherever
  a man decides something, it rolls the odds `simGame` uses today.
- It stores the result once. Standings, the injury ledger, recaps and wagers read the stored
  result, and the 53 off-air games a week stay on `simGame`. The stored positions are read back
  only around air time, never at boot.
- The booth narrates the game's event log knowing how each play ends, and keeps what fits in the
  hour, most important first.
- Rinkside plays the game back at real speed from chunks sent a few seconds ahead, and poses the
  men itself. The director's beat staging goes.
- Warm-ups cover the drop when the game isn't ready. Nothing on a hot path touches the database.
- Phase 0's free play had no stalls in 100 games and took its shots from believable places, and a
  lean copy of the sim plays a game in 3.7 s of CPU at 60 Hz.

## Why

### How it works now

`simGame` in [hockey.js](../../plugins/broadcast/sports/hockey.js) decides the game on the server
as a list of beats. Over 500 seeded games it averaged 179 beats and 6.50 goals, at 0.78 ms of CPU
a game (measured 2026-10-18). The narrator
([hockey-narrator.js](../../plugins/broadcast/sports/hockey-narrator.js)) writes about 1,000 lines
from the beats, and the pacer ([hockey-pacing.js](../../plugins/broadcast/sports/hockey-pacing.js))
times each line and turns the narrator's tags into cues. Rinkside's world
([sim.js](../../client/game/js/panels/rink/sim.js)) plays hockey between beats, but that hockey
never shoots, and a net only takes the puck while the director allows it (`W.allowGoal`). The
director ([director.js](../../client/game/js/panels/rink/director.js)) makes each beat happen on
the ice as its line airs.

### What the staging costs

The director is the biggest file in the rink: 151 KB and 2,357 lines, against 105 KB for the sim.
Most of it makes free hockey arrive at an outcome decided in advance, at the moment the line says
so: men curling round a spot until their line comes, a rush that has fallen behind its lines
catching up, a hitter timed to arrive as the hit is called, a shot that would miss steered in
through the mouth of the net. Every new kind of play has to be staged the same way, and the rink
smoke carries a check for each seam (no teleports, no frozen battles, shots taken in stride). The
[simulation grading](../reports/simulation-grading.html) gave the sport sims a C+ for the same
reason: the broadcast round them is stronger than the games it narrates.

### What it buys

- Most of the director goes, and the hockey on screen runs at hockey speed.
- Hits, scrums and chances can happen that nobody scripted.
- The text stays first-class, because the booth reads the same event log the picture is drawn from.
- A game that's played rather than staged is one a person can take part in later. Decided on
  2026-10-18: one person controls a whole team ([People in the seat](cluster-puck-ai.md#people-in-the-seat)).

## Where the game lives

### On the server

Only a viewer with Rinkside open sees the rink. Everyone else gets the game from the server: the
TV panel's lines, the `[TV]` line overheard in a room, the NPCs reacting through `tv-reactions`,
the betting desk, the standings, the recaps and the news desk's tokens. So there has to be one game,
on the server.

A seeded sim in each browser wouldn't stay in step. ECMA-262 lets engines differ in the last bit of
`Math.sin`, `Math.cos` and the rest, and Phase 0 found `sin`, `cos`, `atan2`, `exp` and `log` all
through the decision path. The same slot played in a second Node process ended in an identical
state, six slots out of six, so a game is repeatable inside one Node build, but a browser can't
replay it. The server has to send the play itself, never a seed. A late tuner would also have to
fast-forward an hour of play on a phone, and a hidden tab stops stepping.

### Played ahead of air

A booth reacting live trails the play by a line. At the pacer's 76 to 95 ms a character, an
eight-word call takes about three seconds, so the shot would be called after the goal light. With
the whole game played first, the narrator works from the event log knowing how each sequence ends,
so it can call a build-up as it happens and choose what's worth a line.

The betting desk's rule also holds: a game is decided before it airs, and
[sportsbet](../../plugins/sportsbet/index.js) captures the result when a wager locks.

## The server's game

- **One sim, two jobs.** The server imports `sim.js` the way `baseball.js` already imports the
  client's `diamond/play.js`. `sim.js` imports only `util.js`, `geo.js` and `rig.js`, nothing from
  the DOM. A headless switch leaves out what only the picture uses: the ice cuts, particles, snow,
  debris, limbs, the Zamboni, the drawn puck and its tail, glass flex, the crowd, the lamp, sounds,
  the full skeleton, and `W.ice`, which needs a canvas. Ragdolls can become a timer that keeps a
  man down. The client keeps the same file for warm-ups and dead time.
- **A decision layer.** The free play gets what it lacks: a man in a shooting area decides to
  shoot, a hitter decides to finish his check, an infraction gets called, two men drop the gloves.
  Each decision rolls the odds `simGame` uses now: `CHANCE_TABLE` for what a shot does, `clubProfile`
  for shooting, goaltending, discipline and violence, the rivalry multipliers, and the injury bands.
  The physics only carries the puck. That keeps a featured game playing the same sport as the
  off-air games round it. [cluster-puck-ai.md](cluster-puck-ai.md) works this out in full: odds per
  shot from an expected-goal model in place of `CHANCE_TABLE`'s per chance, and the momentum meter.
- **The league's rules.** An injured man isn't replaced, a fight's loser serves five and the
  winner's side gets the power play, overtime ends on the first goal or the first fatality, a draw
  is taken at the dot its stoppage implies, and a depleted club calls up from the reserve. All of
  these live in `simGame`. The referee lives in `director.js` (faceoffs, the box, goals, line
  changes), and the open play has no offside, no icing, no line changes and no pulled goalie. The
  server's game needs every one of them.
- **Goalies.** Saves and blocks in Phase 0 were dice with scripted rebounds, and the puck passed
  through goalies. The dice can keep deciding, but a goalie has to be something the puck meets, or
  the picture shows a goal going in through him.
- **Its own dice.** Every decision draws from the game's seeded stream and nothing else. That isn't
  true of `sim.js` yet: the client seeds every world with `'rinkside'`, `dribble` defaults to
  `Math.random`, and the cosmetics (`W.burst`, the stop spray, the goalie's fidgets, the puck's spin
  and lift) draw from the same stream as the play. Only the snow has a stream of its own
  (`fxRand`). The server's game seeds the world from the game and moves the cosmetics onto
  `fxRand`.
- **Drawing changes nothing.** `pocketOf` reads the rig's eased blade (`bladeE`), which any call to
  the rig writes, a renderer's included, so where the puck sits through a deke depends on whether
  something drew the man. The decision path has to work that out without the renderer's state.
- **Fights and casualties** are decisions, not physics. The server rolls the exchange punch for punch
  and the injury, as `simGame` does now, and the client animates them.

### When it runs

The schedule is deterministic, so the server knows the featured slot and its matchup well in
advance. Every game before it is either an off-air `simGame`, which costs nothing, or a featured game
the server has already played, so a featured game never waits on another.

`sportsHeartbeat` runs every minute, and the scheduler skips it while nobody's online. It checks a
flag in RAM for the featured game on air, if there is one, and for the next featured game: has it
been played? It posts any that hasn't to a `worker_threads` worker, the earlier first, which keeps
the work off the event loop the rest of the server runs on. With hour-long slots, that's an hour of
slack for a few seconds of work.

Off-air games never go physical. The CPhL airs on Tuesday, Thursday and Sunday at 18:00, which is
three of the 56 games in a week.

### What it costs

One game through the headless rink smoke (`node scripts/shapes/rink-smoke.mjs 37`), with the
director, the rig and stub drawing, took 16.8 s on the dev machine, and 20.3 s with the profiler on
(2026-10-18):

| Part | Time | Share |
|---|---|---|
| `sim.js`: skating, open play, separation, the puck, goalies, particles | 8.8 s | 43% |
| `rig.js`: the 21-joint skeleton | 3.6 s | 18% |
| Drawing: figures, camera, renderer, textures, the DOM stub | 3.4 s | 17% |
| Shared maths, garbage collection, the replay buffer | 1.8 s | 9% |
| The gate's own checks | 1.3 s | 6% |
| `director.js` | 1.0 s | 5% |

Phase 0 then timed the sim alone, with no director, over sixty minutes of play (about 443,000
steps at 120 Hz, nearly all of them live), five warm games each:

| Copy | CPU a game | CPU a step |
|---|---|---|
| `sim.js` as it is, 120 Hz | 13.8 s | 31 µs |
| Lean copy, 120 Hz | 6.3 s | 14 µs |
| `sim.js` as it is, 60 Hz | 6.5 s | 30 µs |
| Lean copy, 60 Hz | 3.7 s | 17 µs |
| `simGame` | 0.8 to 1.9 ms | |

- **The lean copy** leaves out what the headless switch leaves out. The ice cuts were the biggest
  single item: they solve a skate pose (`skaterFeet` then `standRig`) for every moving man 14 times
  a second, which is 21% of a step on its own. Arrays allocated every step cost about another 10%
  in garbage collection.
- **60 Hz** held up over 20 games: 6.1 goals a game against `simGame`'s 5.9 on the same slots, and
  no stalls. 30 Hz would roughly halve the cost again if the play holds up there, which nobody has
  tested.
- **Dead time** was already almost absent from Phase 0's games (about 10,000 stopped steps), so the
  measured cost includes it. On the server, at a whistle the game records the stoppage and the next
  dot and jumps to the drop. The skate to the dot, the linesman bringing the puck, the Zamboni, the
  stretcher, the fight and the walk to the box are the client's to animate, as they are now. The
  server puts the men on their faceoff spots for the drop with the same `spotFor` the client skates
  them to (it moves out of `director.js` into a shared module), so the track picks up where the
  client's animation ends.

### What's stored

A feature table in `SCHEMA_SQL`, one row per featured game:

```sql
CREATE TABLE IF NOT EXISTS sports_featured_games (
  sport       TEXT NOT NULL,
  slot        INTEGER NOT NULL,
  sim_version INTEGER NOT NULL,
  box         JSONB NOT NULL,    -- score, scorers, penalties, casualties: what the folds read
  events      JSONB NOT NULL,    -- every shot, hit, whistle, fight and goal, with its game time
  track       BYTEA,             -- the packed positions; cleared by the next game's write
  played_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (sport, slot)
);
```

- **One write** per featured game, when the worker finishes. The same write clears the track of
  every game whose slot has ended, and never the track of the game on air, so storage holds one or
  two tracks at most: the game on air and the next one. Clearing "the previous game's track" would
  clear the airing game's as soon as the next game was played, and a restart mid-game would have no
  picture to go back to.
- **One read at boot:** `slot` and `box` for the featured games in the standings and injury window,
  cached in RAM, and nothing else; `events` and `track` are the big columns and stay out of it. The
  same read sets the heartbeat's flags. `computeStandings` and `ledgerAt` read a featured slot's row
  instead of re-running the slot. A featured slot with no row, because the server was down for it,
  folds as `simGame`, so a game nobody saw stays a statistical one. A row still counts for nothing
  until its slot has ended, as now.
- **The track and the events load late, never at boot.** Every boot is a world load, and there are
  several a day: about four deploys, plus cold starts, which have measured anywhere from 0.3 to 13
  a day ([ops-usage-watch.md](../ops-usage-watch.md)). A game is almost always played and waiting,
  so a read at boot would be paid on nearly every load, on top of a boot payload of about 13 MB.
  The server keeps what the worker hands back in RAM until air. After a restart, the heartbeat
  reads the track and the events a few minutes before the game's slot starts, or the booth or a
  Rinkside viewer's first request does, so a boot pays only when it lands just before or during a
  featured broadcast. They're stored rather than replayed after a restart, because a deploy can
  change the sim or the Node version, and a re-run wouldn't match the events the booth is calling.
- **The track is deflated before it's stored, and read back as base64.** `pg` returns a BYTEA
  column as hex text, two characters a byte, so a raw track (about 4.5 MB an hour, from the sample
  size under [The picture](#the-picture)) would cost about 9 MB of egress a read. Deflated, it's 1
  to 2 MB, and `SELECT encode(track, 'base64')` sends four characters for every three bytes, so a
  read costs 2 to 3 MB. A write sends the buffer as binary.
- **Per step, per tick and per viewer:** no queries. The game, its chunks and its lines are all in
  RAM.

## The booth

- **The narrator reads the event log** in order, as it reads beats now, and scores each event. A
  goal or a death outranks a fight, a fight outranks a shot on goal, a shot outranks a big hit, and
  a big hit outranks a zone entry or a pass.
- **The pacer works the other way round.** Event times are fixed by the game, and the pacer places
  the lines round them. A call goes up as its event happens, or a little before for a build-up the
  narrator knows is coming. Colour fills the gaps, and whatever doesn't fit is dropped, lowest score
  first, the way `paceCalls` drops colour lines today. A line that carries a graphic (the score bug,
  a goal card) is never dropped.
- **Lines carry their air time,** and the client shows each one then, or at once if it arrives late.
  `broadcastTick` runs once a second, so without the stamp a line could land up to a second after
  the picture.
- **The pre-game, the injury report and the intermissions** stay as they are. Each reads what the
  event log says happened.

## The picture

- **Chunks.** The server sends the game in chunks of about five seconds of play: each man's position,
  heading and action code at 10 Hz, and the puck as events (released at a point with a velocity and
  spin, off the post, caught, picked up). The client integrates the puck's flight between events,
  and a carried puck rides the carrier's blade as drawn. A chunk goes out a few seconds before its
  air time, and only to viewers with Rinkside open.
- **Size.** About 126 bytes a sample for 20 bodies and the puck, which is about 4.5 MB an hour packed
  as 16-bit numbers, and roughly 1 to 2 MB a viewer a game after the socket's deflate. The server
  deflates frames over 1 KB and keeps its context between frames (`server/index.js`), and Render
  allows 100 GB a cycle.
- **Real speed.** The client plays the track on the air clock and poses the rig itself from the
  action codes: strides, shots, passes, checks and punches. Nothing waits for a line.
- **Late tuners** get the current chunk and the next one through `sendCatchUp`. A hidden tab drops
  what it missed and asks for the chunk at the current air time when it's shown again. Both are
  served from RAM.
- **Replays** stay as they are: the client records what it drew and runs it back on the booth's
  replay line.
- **The director** keeps its dead-time stagers (stoppages, the Zamboni, the stretcher, fights, the
  walk to the box, a death) and loses the beat stagers.

## When the game isn't ready

The game misses its drop when the server restarted while the worker was playing it, when staff
skipped the clock, or when nobody was online, so the heartbeat never ran.

- **Before the drop: warm-ups.** They cost the server nothing. Each side skates laps in its own half
  and shoots on its own goalie, the goalies stretch and tap their posts (`tapPosts` and `stretch`
  already exist), and the booth's intro, matchup card and injury report air over it, with colour
  from the barn's `chatter` pool if it runs long. The game starts when its first chunk arrives with
  the drop time, and the code that sends men to a dot lines them up for it.
- **During the game: the buffer.** A viewer holds a few seconds of play, which covers most restarts,
  since reading the stored row back is one query. If the buffer runs dry, the rink cuts to a crowd
  shot, and after a few more seconds to the channel's technical-difficulties card, which the
  station already has for its studio shows. The booth picks up from the stored events.

## The betting desk

A wager can be locked until the final, and anything sent to a client before its air time can be
read in devtools. Chunks go out no more than a few seconds ahead, which is about what a play's
payload gives away today.

## Open questions

1. **Which sim sets the target?** Featured and off-air games have to play the same sport, and
   Phase 0's free play doesn't yet match `simGame`: fewer goals (4.9 against 6.4), from shots taken
   farther out. Its scores also look more like hockey's, with closer games and fewer shutouts.
   Either the decision layer is tuned to `simGame`'s numbers, or `simGame` is retuned to free
   play's, which needs a new sim version so past games replay as they aired. The AI plan recommends
   one target for both: hockey's shape with the CPhL's scoring ([Targets](cluster-puck-ai.md#targets)).
2. **Slot length.** At real speed, an hour slot can't hold sixty minutes of hockey with its
   stoppages and two intermissions. Periods of about 12 minutes of play fit an hour, and three-hour
   slots (`world_clock.time_scale` 1) hold the full game. Which?
3. **The blade point.** The lean copy drops the skeleton solve in `pocketOf`, and the play held up.
   Does the client's posed stick still meet the puck where the track says it does?
4. **A sim version.** Stored rows free old games from the code, but a change to the decision layer's
   odds still needs a version stamp, as baseball's `@sim 2` has, so the change starts from a slot the
   server records.

## Phases

Phases 1 to 4 are built behind a switch, a `@sim` version for hockey as baseball has, and go live
together, because the booth and the picture have to read the same game.

- **Phase 0: can free play make a game?** Done on 2026-10-18; see the results below.
- **Phase 1: the server's game.** The headless switch, the seeded stream, the cosmetics moved to
  their own dice, the blade worked out without the renderer's state, and the decision layer. Then
  the fixes from Phase 0: the fair tie-break it confirmed, a power play that's worth something, club
  identity in how a side skates and passes, and the lean copy running in a worker. Then the referee, the league's rules and goalies the puck meets. A gate
  plays a set of seeded games and fails when shots, goals, penalties, fights or casualties a game
  leave the target's bands, or when a game costs more than its CPU budget. Phase 0's harness is
  where the gate starts.
- **Phase 2: storage and the folds.** The feature table, the worker, the heartbeat's check, the boot
  read, the deflated track and the late read of the track and events, and `computeStandings` and
  `ledgerAt` reading featured rows. A test checks that the boot read selects neither `track` nor
  `events`, and that a write never clears the track of a game on air.
- **Phase 3: the booth.** The narrator over the event log, the event scores, the reversed pacer, and
  air-time stamps on lines.
- **Phase 4: Rinkside plays it back.** Chunks over the socket, playback and posing, late tuners and
  hidden tabs, and the rink smoke reworked to check playback: no teleports, every chunk continuous
  with the last, every goal into the net the events name.
- **Phase 5: warm-ups and recovery.** The warm-up routine, the crowd shot, the technical-difficulties
  card, and a test that restarts the server mid-game.
- **Phase 6: retire the staging.** The director's beat stagers go, and its dead-time stagers stay.

## Phase 0 results

Run on 2026-10-18 in a separate session. A throwaway harness ran `sim.js` headless with no
director and the smallest decision layer: shots, hits and penalties rolled by dice, with shots
resolved from `CHANCE_TABLE` and `clubProfile`. It played slots 0 to 99, sixty minutes of
regulation each, and compared them with `simGame` over the same slots. Nothing in the repo changed.
The figures below were checked by re-running the harness's summary over its per-game data.

| A game | Free play | `simGame` |
|---|---|---|
| Shot attempts (set by a dice knob) | 111 | 101 |
| Shots on goal | 75.6 | 70.0 |
| Goals | 4.9 | 6.4 |
| Shooting percentage | 6.5 | 9.1 |
| Mean shot distance | 40 ft | 18 ft |
| Hits (a dice knob) | 39, from 572 chances | 9.9 boards hits |
| Penalties (a dice knob) | 5.6 | 7.3 |
| Power-play goals | 0.5 | 3.5 |
| Faceoffs | 37 | 44 |
| Level after regulation | 16% | 11% |
| Shutouts | 14% | 22% |
| Mean winning margin | 1.8 goals | 3.1 goals |

- **Where the shots came from:** the top of the zone 29%, the circles 35%, the slot 18%, the high
  slot 11%, the points and the walls the rest. They came out of the play itself, if a little far
  out. `simGame` puts every shot in the slot.
- **Stalls:** none. No dead pucks, no puck pinned on the wall, no stall whistles, and no pair of men
  frozen together by the rink smoke's test. Skaters spent 5% of their time under 1.5 ft/s. A loose
  puck sat more than 12 ft from anyone for 2 s or more about 47 times a game, which is dumps and
  clearances.
- **Clubs:** they differ only through the dice. Free play's results by club don't follow
  `simGame`'s: the Boomtown Bulldogs scored 2.2 a game in free play and 4.5 in `simGame`.

**The home-side bias has a confirmed fix.** `ambient()` reads `pk.carrier` once and then runs side
`'a'` before side `'h'`, so a puck both sides reached on the same step went to the home side: home
had 52.7% of possession (t = -12.7). The fix takes two changes: the loose-puck check has to see a
puck the first side just took, and the side that goes first has to alternate each step. Either one
alone hands the edge to the away side (52.6%). With both, a follow-up run of 20 games split evenly:

| | Before | With the fair tie-break |
|---|---|---|
| Away possession | 47.3% (t = -12.7) | 50.5% (t = 1.4) |
| Away offensive-zone time | 47.2% | 50.5% |
| Away shot attempts | 45.6% | 50.2% |
| Possession changes a game | 408 | 359 |

About 50 of the possession changes a game had been the second side taking the puck off a man who'd
just picked it up.

**With no decision layer at all** (3 games, nothing shoots), each 20-minute period ran without a
whistle and still never stalled: no dead or pinned puck, no frozen pairs, skaters under 1.5 ft/s
6.4% of the time and the puck loose 25% of the time. The carrier spent 34% of the game in a shooting
area, so the decision layer only has to choose to shoot; the play already gets there.

The three things still to fix before building on it:

1. **A weak power play.** Five on four adds only 27% to the shot rate, so power-play goals are rare:
   0.5 a game against `simGame`'s 3.5.
2. **No club identity in the play.** Clubs should differ in how they skate and pass as well as in
   their dice.
3. **A lean, seeded copy for the server, off the main thread,** with the seeding, the dice and the
   blade fixed as [The server's game](#the-servers-game) describes.

The rules the open play lacks (offside, icing, the pulled goalie) are Phase 1 work as well. Line
changes don't apply, because each club dresses six.

Smaller notes: about twice the passing you'd expect (1,541 attempts a game), the puck loose 28% of
the time, and backhands 17% of shots against `simGame`'s 13%.
