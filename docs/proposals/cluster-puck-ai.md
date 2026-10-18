# Cluster Puck AI

**Status: design. Nothing is built.** An assessment of how the men in the server's free-play game
should decide what to do, so that a featured game reads as hockey, each club plays like itself, an
unseen momentum meter keeps games close, and a person can take a team's place later without
anything else changing. It fills in the decision layer of
[cluster-puck-free-play.md](cluster-puck-free-play.md) (where the game runs, and Phase 0's numbers)
and sits beside [cluster-puck-glass2.md](cluster-puck-glass2.md) (how it's drawn).

## Decided on 2026-10-18

- **People will control a whole team** and switch between men, as in NHL '94 head to head: two
  people a game, the rest of each side played by the AI.
- **A momentum meter in the manner of NBA Jam:** it helps the side that's behind and holds back the
  side that's ahead, nobody can see it, and the home side gets a lean in it.

## What good means here

1. **It reads as hockey.** Men hold their positions, passes find open men, shots come from good ice,
   the forecheck and the backcheck happen, and the puck isn't loose for long.
2. **The numbers land in the target's bands:** goals, shots, shooting percentage, penalties, power
   plays, fights and the shape of the scores ([Targets](#targets)).
3. **Each club plays like itself**, in how it skates and passes as well as in its dice.
4. **It's fair.** No side wins by the order a loop runs in. Home ice counts only through the
   momentum meter's lean.
5. **It's cheap and repeatable:** inside the worker's budget at 60 Hz, and the same game from the same
   seed.
6. **A person can take a team's place,** and the men round him play with him as they would with the
   AI.

## Where it starts from

**The open play** in [sim.js](../../client/game/js/panels/rink/sim.js) already has roles and spots
(`assignRoles` and `systemSpot`): wingers wide in their lanes on the rush, the D on the points in the
zone with a man at the net, the strong-side D in the corner in their own end, a 1-2-2 through the
neutral zone. It passes by zone, fights for loose pucks, chases and intercepts, protects the puck and
keeps men apart.

**Phase 0's harness** added dice for shot attempts, hits and penalties, and resolved shots from
`CHANCE_TABLE` and `clubProfile`. Over 100 games it found ([results](cluster-puck-free-play.md#phase-0-results)):

- shots from 40 ft on average, against 18 in `simGame`, and a shooting percentage of 6.5 against 9.1;
- the home side ahead on possession (52.7%) because `ambient()` runs side `'a'` before `'h'` with a
  stale read of the carrier. A follow-up confirmed the fix: the loose-puck check sees a puck the first
  side just took, and the side that goes first alternates each step. With both, 20 games split evenly
  (away possession 50.5%);
- with no decision layer at all, whole periods ran with no whistle and no stall, and the carrier was
  in a shooting area 34% of the time, so the play already gets to good ice and the missing piece is
  the choice to shoot;
- a power play worth little: five on four adds 27% to the shot rate, so 0.5 power-play goals a game
  against 3.5;
- about twice the passing you'd expect, the puck loose 28% of the time, and backhands 17% of shots;
- no club identity in the play itself;
- no offside, no icing and no pulled goalie in the open play. The referee is in `director.js`.

**`clubProfile`** gives each club four numbers off its name (shooting, goaltending, discipline and
violence), nudged by the words in it, so the Goons and the Highlanders come out violent and
undisciplined, the Marauders and the Wharf Rats shoot better, the Bulldogs' goalie is better, and
the Guillotines take fewer penalties.

**Each club dresses six:** five skaters and a goalie (`ROSTER_SIZE` in
[hockey.js](../../plugins/broadcast/sports/hockey.js)). There are no lines to change; the same five
play the whole game.

**Not VINE.** The behaviour trees in [ai-behaviour.md](../ai-behaviour.md) tick every second for
enemies and every fifteen for NPCs, on the main server, through async actions. Skaters decide many
times a second inside the worker, so their AI is plain code in the sim.

**Not learned.** A trained policy would need a training pipeline the project doesn't have, would
be hard to tune toward the target's numbers, and couldn't be read or adjusted by hand. Scored
decisions can be all three.

## The shape: four layers

| Layer | Decides | How often |
|---|---|---|
| Coach | The system to play, the effort to ask for, special-teams units, pulling the goalie, sending a man to settle a score | On events, and every few seconds |
| System | Each man's role and spot for the phase of play: the current `assignRoles` and `systemSpot`, widened to the coach's systems | 5 to 10 times a second |
| Skater | What this man does now: carry, pass and to whom, shoot, dump, chip, protect, deke; without the puck, support, get open, pressure, cover, take a lane, block, hit | 10 to 20 times a second |
| Motor | Skating, steering, edges, puck control and the rig, as now | Every step, at 60 Hz |

**Every man has a controller.** Each step, the motor layer asks a man's controller for an intent: a
point or a velocity to skate to, an effort, a facing, and at most one action with its aim and power.
The AI controller is the three layers above the motor. A person's controller turns input into the
same intent. Nothing below the controller knows which one it's talking to, so plugging a person in
later changes nothing below it.

### The coach

- **The system:** how hard to forecheck (one man in or two), how to defend the neutral zone, how to
  enter the zone (carry or dump), how deep the D play. Set per club by its style and adjusted by the
  score and the clock: a side behind late presses, a side ahead sits back.
- **Effort and fatigue.** With no lines to change, the same five tire. Each man has stamina that
  drains with effort and comes back at whistles and intermissions; a tired man is slower to his spot
  and makes worse choices. The coach asks for less on a long shift in his own end, and more in the
  last minutes. The third period gets sloppier, which is right for a league that plays five men all
  night.
- **Special teams:** the shape for a power play or a kill.
- **The goalie:** pulled for an extra skater when behind late, as `simGame` already does.
- **Settling scores:** after a big hit on a teammate, a violent club sends a man after the hitter,
  which is where fights should come from.

### The system

The current roles and spots stay as the base, and the coach's choices change them: a 2-1-2 forecheck
puts both wingers in deep, a trap sits four men back in the neutral zone, a power play sets up its
shape. Spots move with the puck rather than standing still, as now.

### The skater

Each decision tick, the man with the puck scores what he could do and picks the best, with a little
noise from his ratings:

- **shoot:** the shot's expected-goal value ([below](#expected-goals)), times his shooting;
- **pass** to each teammate: the receiver's expected-goal value after it, and his chance of carrying
  on with it, times the chance the pass gets through (each defender's reach along the lane);
- **carry:** the space ahead and the pressure on him;
- **dump, chip or clear:** when he's under pressure with no lane;
- **protect:** when there's nothing better yet.

A man without the puck scores places to be and things to do the same way: getting open where a pass
would be worth most, supporting the carrier, pressuring, covering a man or a lane, blocking a shot,
finishing a check. A man's ratings come off his name, as his handedness does, so he plays the same
way all season.

This fixes most of what Phase 0 found: shots get taken from good ice because far ones score less,
passes get made only when they're worth more than what he has, and a loose puck has a man going for
it whose score says so.

### Expected goals

The free play needs odds per shot, not per chance. `CHANCE_TABLE` gives a beat's outcome, which
suited a sim of chances, but a shot from the point and one from the slot can't share odds. The
decision layer rolls each shot against a goal probability from:

- distance and angle to the net;
- the shot type (a one-timer across the slot beats a set goalie more often than a wrist shot from the
  same spot);
- a rebound, a rush, a screen, and whether the goalie was set or moving across;
- the shooter's rating, the goalie's rating, and the momentum meter.

Calibrated so the league's shooting percentage and goals a game land in the target. The NHL in
recent seasons shoots around 9 to 10%, which is close to `simGame`'s 9.1.

### The goalie

He plays the angle (on the line from the puck to the middle of the net), comes out or backs in by
the threat, and pushes across when the puck goes cross-ice, so a cross-slot pass is worth something.
The dice decide a save's result as now (held, kicked to the corner, a rebound into the slot, the
post) by his rating, and the shot's flight decides where he moves to meet it. Behind his net he
plays the puck to a defenceman. The puck has to meet him rather than pass through him
([free play](cluster-puck-free-play.md#the-servers-game)).

### The referee

Moved out of `director.js` into the sim, so the server's game has one:

- **offside**, with the tag-up;
- **icing**, from behind the red line past the goal line;
- **penalties**, when an infraction happens where he can see it, with the delayed call (the goalie
  to the bench for an extra man until the other side touches it);
- **faceoffs** at the dot each stoppage implies, as the league's rules say;
- **the box** and the strength that follows.

### Special teams

Phase 0's power play adds 27% to the shot rate; it needs to change the game. The power play sets up
in a shape (an umbrella or a 1-3-1) that moves the puck to its shooter's spot, and the kill plays a
box that collapses to the slot. Calibrated to the target's power-play rate; around a fifth of power
plays score in the NHL.

### Club styles

A style per club, beside its kit in the club seam, read by the coach and the skaters: forecheck
pressure, carry or dump, shoot from range or work it in, how often to finish a check, passing tempo,
how tight the D play. The defaults come from `clubProfile`'s numbers and its word nudges, so the
Goons dump and chase and finish every check, the Marauders carry and shoot, and the Guillotines stay
out of the box. A club's style is content and can be authored over the default.

## Momentum

The NBA Jam rubber band, unseen.

- **The meter** is one number a game, from the away side's full favour to the home side's.
- **What moves it:** the score. The side that's behind pulls it toward itself, harder the further
  behind it is and the later it gets. The home side gets a constant lean on top.
- **What it changes:** the odds at decision points, and only those: a shot's goal probability, a
  goalie's save, a puck battle's winner. Bounded small (a starting point of 15% at the meter's
  ends), and never skating speed or anything else a viewer could see on the ice.
- **Nobody sees it.** No meter, no stat, nothing in the tablet's Sports app, and the booth never
  names it. The booth's light nods to home ice are flavour, not a readout.
- **Both sims run it.** `simGame` gets the same meter on its chances, so the 53 off-air games a week
  play the same sport as the featured ones. That changes `simGame`'s results, so it goes in as a new
  sim version that starts at a slot the server records, and every game before it replays as it
  aired.
- **It's on in games with people too**, as in NBA Jam. Whether a person can turn it off for a game
  is an open question.

## People in the seat

### Team control

- One person drives one man at a time, and the rest of his side stays AI, playing the same system
  and treating his man as a teammate: they get open for him, support him and pass to him.
- **Switching:** control goes to the puck carrier when the person's side gets the puck; on defence a
  switch control moves him to the man nearest the puck. A pass goes to the man the stick points at.
- **What a person can't change:** the resolution. He decides when and where to shoot; the same
  expected-goal odds, his man's rating and the momentum meter decide what the shot does, as for the
  AI. The same holds for puck battles and the referee.

### Live games

A game with people in it can't be played before it airs, so the server plays it live, in the
worker, at 60 Hz.

- **Inputs** come over the socket as small frames, 20 to 30 a second: the stick's direction, the
  buttons and a sequence number.
- **The two players** get state 15 to 20 times a second. Each one's own man is predicted on his client
  with the same motor code and corrected toward the server's; everyone else is drawn from the
  server's state. It plays at about 100 ms of round trip and turns sluggish past about 250.
- **Spectators** get the usual chunks a few seconds behind, which keeps the booth's hindsight for
  them: the narrator reads a few seconds ahead of what they see, as it does for an AI game.
- **The cost** is the game's own CPU (3.7 s a game for the lean copy at 60 Hz in Phase 0), spread
  over the game, and the two players' streams.

## Targets

Phase 0 found free play and `simGame` playing different sports: free play scores fewer goals, from
farther out, but its scores look more like hockey, with closer games, fewer shutouts and more ties
after sixty minutes. Featured and off-air games have to match, so both get tuned to one target.

The recommendation: take the shape from hockey and the scoring from the CPhL. Most games within a
goal or two, roughly a fifth to a quarter tied after sixty minutes, shutouts uncommon, home sides
winning a little over half (the momentum meter's lean does that), and about 6.4 goals a game, which
is `simGame`'s rate and close to the NHL's in recent seasons. The CPhL's own violence stays on top:
the rivalry multipliers, the fights and the casualties. Tune with the momentum meter on, because a
rubber band closes games by itself.

## Gates

- **Numbers:** a set of seeded games through the server's sim, failing when any figure a game leaves
  its band. Phase 0's harness is where this starts.
- **Fairness:** the same seeds with home and away swapped and the meter's lean off; possession,
  shots and goals split within noise.
- **Identity:** each club's style shows in its numbers (the hitting clubs hit more, the dumping clubs
  dump more).
- **Momentum:** with the meter on, comeback and one-goal rates and the home win share in their bands.
- **Cost:** the AI's share of a step inside its budget.
- **A tuning bench:** a sandbox page that plays a seeded game at speed with each man's role and his
  option scores drawn over him. A tool for tuning by eye, never shown to players.

## Phases

Phases A0 to A4 are the free-play plan's Phase 1 (the server's game) in detail. A5 is new, and A6
follows the free-play plan's Phase 4 (Rinkside playing back the server's game).

- **A0: fair and lawful.** The tie-break (both of the changes Phase 0 confirmed), the referee in the sim (offside, icing, penalties, delayed
  calls, the box), goalies the puck meets, and stamina.
- **A1: the skater's decisions.** The controller seam, scored options with and without the puck, and
  the expected-goal model.
- **A2: special teams.** Power-play and penalty-kill shapes, tuned to the target's rate.
- **A3: goalies.** Angle, depth, the push across, rebounds by rating, playing the puck.
- **A4: club styles.** The style record, its defaults from `clubProfile`, the coach's systems.
- **A5: momentum.** The meter in the server's game and in `simGame`, behind a new sim version.
- **A6: people.** A person's controller on one machine in the sandbox first (one person against the
  AI), then live games over the socket with prediction, then spectators and the booth on the delay.

## Open questions

1. **Momentum off switch:** can a person turn the meter off for a game he's playing in?
2. **Momentum swings:** should big moments (a fight won, a big hit, a big save) also swing the meter
   briefly, the way hockey people say momentum does, or should only the score move it?
3. **Do games with people count?** In the standings, or exhibitions only?
4. **Where people play:** a seat in Golden Goose Gardens' press box, a machine in an arcade, the tablet,
   or any TV?
5. **Touch controls** for phones, or keyboard and gamepad only?
