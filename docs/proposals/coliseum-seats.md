# Seats at the Coliseum

**Status: phase S0 built 2026-11-03 (the park clock and its gate, a measurement); S1 to S6 are
design.** S0's answer is no: at the live clock today's holds don't fit every pitch in a seat
([S0](#s0-what-the-gate-measured)). Four of the questions were decided on 2026-10-18: the booth paced
by the park, seat furniture per section, more fouls as part of this work, and a feed of plays and the
PA by default ([Decided](#decided-on-2026-10-18)). How a player watches Deadball in person from
the stands of the Charles B. Hughson Coliseum: sit in a section, see the game from that section with
nobody cutting the picture, hear the park and not the booth, read what the PA says and the crowd
does, and maybe go home with a foul ball. It's the last piece of Phase 6 of
[deadball-glass2.md](deadball-glass2.md#watching-in-person), and the one thing
[hughson-coliseum.md](hughson-coliseum.md#9-what-isnt-built) lists as not built.

Read with [deadball-glass2.md](deadball-glass2.md) (the Grandstand and its director),
[systems-broadcast.md](../systems-broadcast.md#sports--two-codes-one-pipeline) (the payloads, line
holds and catch-up), [systems-deadball-sound.md](../systems-deadball-sound.md),
[hughson-coliseum.md](hughson-coliseum.md) (the rooms and furniture), and
[architecture.md](../architecture.md#read-tiers-where-data-lives-at-runtime).

## The short version

- **The game stays decided on the server, as now.** The sim doesn't change, no physics sim is
  needed, and the regress hash of a hundred seeded games holds.
- **A seat is the Grandstand without the director's scissors.** On TV every jump in time hides
  under a camera cut. A seat has no cuts, so in person the park plays every pitch and every play on
  one continuous clock, and the dead time is the field's business, never a camera tour.
- **That clock is worked out on the server** when the game's graph is assembled: a time for every
  pitch, every play on the bases and every changeover, carried on the payloads (about 4 KB a game).
  Every seat and the server agree on when each pitch is thrown and where each foul comes down.
- **The booth is paced by the park (decided, and built for the TV on 2026-10-26).** Each line holds
  as long as its plays take in the park, so the TV and the field never drift apart. S0 measured
  whether those holds fit every pitch in a seat: at the live clock they don't, because they're sized
  for the TV's cuts. A seat needs the pacer to size each window by the seat's need (S1), and even then
  the live clock is short unless a seat's fixed costs come down ([S0](#s0-what-the-gate-measured)).
- **Fouls are decided on the server**, drawn at assembly with a salt of their own like `synthPlay`,
  and carried on the payload, so every seat and every TV sees the same ball. The one that lands in
  a section is the one that can become an item. There will be more of them: a new pitch draw
  brings fouls from 4.7% of pitches to about 17%, as in real baseball, at a recorded slot.
- **In the stands you read the park.** A text feed from the PA, the crowd around you and what you
  can see from your section, drawn from the payload on the park's clock, on the client. It works
  without the 3-D view, at every rung of the display ladder.
- **Nothing per pitch touches the database.** The clock and the fouls are computed once per slot
  with the rest of the graph; who's in a section comes from the room's occupants in RAM; the only
  writes are a ticket once a game and an item when somebody catches a ball.
- **Seats don't wait for people playing.** If a pitch-level sim ever plays live, it feeds the seats
  the same timed records, and the seats need no change.

## What exists

- **The rooms.** The Stands (rows behind home plate, Sir Charles's seat, the organ, the video board)
  and the Bleachers (plank benches, the scoreboard) are interior rooms; Section Nine is roped off at
  the crater. One `the seats` furniture piece in the Stands and `the benches` in the Bleachers take
  `sit`. There is no TV in the stands.
- **The Grandstand** ([gameday-grandstand.js](../../client/game/js/panels/gameday-grandstand.js)):
  the 3-D park, staged at-bat by at-bat by the director
  ([diamond/director.js](../../client/game/js/panels/diamond/director.js)), with the dead time
  filled by [diamond/between.js](../../client/game/js/panels/diamond/between.js).
- **How the director keeps up.** It gets a budget of 0.6 of the line's hold, between 13 and 34 s
  (`BUDGET` in [diamond/timing.js](../../client/game/js/panels/diamond/timing.js)). A long at-bat on
  a short hold leaves pitches out of the middle. When the bags the
  picture last showed differ from the next payload's, the at-bat opens on a cutaway and everyone is
  placed while the camera's away (`pictureAfter`). A replay is its own world shown in place of the
  live one.
- **Fouls today** are a coin off the pitch's hash (`hashStr('f' + i + p.batter) & 1` in the
  director): left or right, back over the screen at 70 mph, and gone after 1.2 s. The sound picks
  its crack from the seed the same way. Nothing says where the ball comes down.
- **The booth's pacing (2026-10-26).** Every plate appearance in regulation is called, and each
  line holds for as long as it takes to say, with each play timed by the park's clock
  ([baseball-pacing.js](../../plugins/broadcast/sports/baseball-pacing.js) `paceCalls`, over the
  numbers in [diamond/timing.js](../../client/game/js/panels/diamond/timing.js)): a play's call ends
  no sooner than it lands, and the next payload waits for what the park does after it. A payload's
  `hold` runs to the next payload, so the park plays on through the booth's talk.
  [gameday-smoke](../../scripts/shapes/gameday-smoke.mjs) checks that every play lands inside its
  line's hold.
- **Superseded: the WIP commit `feee5ae1a`.** It's on no ref, and it predates the pacing rework.
  It made a play the booth doesn't call ride the line before it, in that payload's `then` list or as
  an `uncalled` payload, and the Grandstand staged it after the landing. It won't land. The pacing
  rework gets every called play inside its line, and the S0 gate covers its `then` case: the plays
  the booth still doesn't call (a throw over left out, extra innings' plate appearances that don't
  score, their changeovers) ride the window before them there.

## 1. A park that keeps playing

### What a seat can't have

Every one of these is a cut in time, and a fixed seat would see each one as a jump:

| On TV | Why it can't happen in person |
|---|---|
| Pitches left out of a long at-bat (`planViews`, the budget) | The count jumps from 1-1 to 3-2 with nobody throwing. |
| A cutaway when the bags disagree (`pictureAfter`) | Runners appear on bases. |
| A play the booth doesn't call, never staged (a throw over left out, most of extra innings) | A play happens off camera, then its result is on the field. |
| The camera tour in the dead time (`shotsBetween`) | A seat doesn't move. |
| A replay shown in place of the live world | The field can't vanish for eight seconds. |
| The street shot at a game's first at-bat | Not from a seat. |

A seat needs a clock of its own that gives every pitch and every play its time.

### The park clock

A pure module, [diamond/parkclock.js](../../client/game/js/panels/diamond/parkclock.js) (baseball,
not Deadball, so engine), built in S0. It imports only `timing.js`, the numbers the server already
sizes its lines by, so the server can run it at graph assembly as it runs `synthPlay` (S1), and the
gates run it with no server. As built, a payload's window is its line's hold exactly, and the clock
lays the pitches out inside it; it doesn't move time between windows. The design it was built from:

- **In:** the game's payloads in order (at-bats, plays on the bases, half-inning breaks, `then`
  and `uncalled` plays included) and the time the game has: the play-by-play's share of the slot
  (`SPORTS_GAME_FILL`, 85% of an hour at the default clock, about 3,060 s).
- **Each piece's need, at its quickest:** a pitch cycle (the throw back, the pitcher set, the
  delivery and the result), the ball in play played out (`plays.js` already plans its length), a
  walk or a hit batsman's trot, a play on the bases, the reset between at-bats, a changeover with
  its warm-ups, the grounds crew in the middle of the fifth.
- **Out:** for every payload a window (`at`, `len`, in ms from the game's first pitch) and for each
  pitch its release time inside the window. The slack the game has over its need is shared out:
  most to the gaps between pitches (where a real game spends it), some to the resets, and a
  changeover gets its fixed share first.
- **On the payload** as `pk: { at, len, t: [...] }`, about 40 bytes, so about 4 KB a game.
- **Seeded** from the at-bat's seed with a salt of its own (`CLOCK_SALT`), for the little
  variation in how long each pitcher takes. Like `synthPlay`, it never touches the sim's stream.

The clock never needs a wall-clock time on the client. A seat plays a window from the moment its
payload arrives, so two seats differ only by their latency. A seat that joins mid-window is told how
far in it is (`ago`, ms), the way a late tuner gets a catch-up today.

### Does every game fit?

No, at the live clock (S0 measured it with the real holds, in [S0](#s0-what-the-gate-measured)).
What follows is the scratch model from before S0, kept for the record. It gave the whole fill to
pitches it costed at 3 s and a 4 s reset; the director's own numbers cost a play far more.

Rough numbers from a scratch model over 1,000 sim v2 games, with the whole 3,060 s given to the
game. The model's own guesses: a ball in play 5 to 12 s by kind, a reset of 4 s between at-bats, a
play on the bases 6 s, a changeover 25 s.

| Per game | |
|---|---|
| Plate appearances | 76 |
| Pitches | 308 (at most 8 in one at-bat) |
| Half-inning breaks | 18 |
| Plays on the bases | 3.1 |
| Fouls | 14.5 (4.7% of pitches) |
| Home runs | 2.2 |

| The pitch cycle each game can afford | |
|---|---|
| Median | 6.3 s |
| 10th percentile | 5.1 s |
| 1st percentile | 3.7 s |
| Worst (an 11-inning game of 503 pitches) | 3.1 s |
| Games under 4 s | 1.6% |
| Games under 3 s | none |

A pitch cycle of 3 s is a pitcher working fast with nobody on: 0.4 s to the plate, the throw back,
and set again. So every game fits with every pitch shown, and most have room for what real baseball
does between pitches. S0 found otherwise.

### Pacing the booth by the park (decided)

When this was written every play-by-play line held the same time (`perLine`), and the model had the
park drifting behind the booth. That's gone: since 2026-10-26 baseball has its `paceCalls`
([baseball-pacing.js](../../plugins/broadcast/sports/baseball-pacing.js)), the seam hockey uses, and
each play's lines hold for its time in the park by `timing.js`. So S0 dropped the drift measurement
and measured the fit of those holds instead.

What's still to do for a seat (S1): today a hold covers the TV's need, the pitches inside the
director's budget with cuts. A seat's need is every pitch whole, so the pacer has to size each
play's lines by the park clock's need, its `then` plays' included. The park's window for a payload
is its line's hold exactly. The line airs as the at-bat starts in
the park, the TV and the stands never disagree, and a seat never gets a play earlier than a TV
does. The TV gains too: an eight-pitch at-bat gets a long hold and so a long budget, so `BUDGET`
stays as it is until S1 re-measures it. What changes is when lines air. The sim, the lines' words
and the game's total time don't.

Letting the park run behind the booth lost: the video board would show a play before the field
did, and a game 280 s behind would have to be cut somewhere.

The park must never run ahead of the broadcast. `sportsbet` takes wagers on the game airing until
its final, and a seat that sees a play before a TV viewer is courtsiding.

### The director's seat mode

The director stays the director; a seat runs it in a mode with no budget:

- **Every pitch at its time** from `pk.t`, with no pitch left out and nothing placed on a cut.
- **The gaps between pitches are filled by the field**, from a seeded pool fitted to the gap: the
  batter steps out and fixes his gloves, the catcher gives signs and the pitcher shakes one off,
  the pitcher rubs up the ball, a throw over to first that the runner beats back, a mound visit
  after a long at-bat, the batter's practice swing. Each has a shortest and a longest length, and
  whatever's picked ends as the next pitch's motion starts. This is new, a sibling of `between.js`.
- **Between at-bats, `between.js` as now**: the field walks back, the pitcher rubs up the ball. The
  out man walks to the dugout and the next batter walks up from the on-deck circle, which TV skips.
- **Plays on the bases, the changeover and the grounds crew** play in full in their windows. With
  every play staged in order, the bags never disagree with the next payload, so `pictureAfter`
  never fires in a seat. The sim has one pitcher a side, so there are no pitching changes to walk
  on.
- **The game's ends.** Before the first pitch: the teams take the field and the organ plays the
  anthem. After the last out: the handshake line, the walk-off mob where there is one, and the
  field empties.
- **Joining mid-window.** The world is fast-forwarded from the window's start to `ago` without
  drawing, which is cheap because the world and the director are pure. A seat joining mid-game
  starts with clean dirt, since it never saw the marks made before it sat down.
- **Built to take pitches one at a time.** Seat mode reads `pk.t` as a queue and needs the at-bat's
  end only when its last pitch comes, which is what a live sim would hand it (§6).

## 2. Fouls decided on the server

### More fouls (decided)

Real baseball fouls off about 17% of pitches, roughly 50 a game; the sim has 14.5, 4.7%. On TV
nobody counts them. In the stands they're the main event, and the only balls most sections get.

- **Where the fouls come from.** `synthPitches` in
  [baseball.js](../../plugins/broadcast/sports/baseball.js) builds each at-bat's pitches to end on
  the outcome the sim already rolled, and today adds a foul only with two strikes (30%, at most
  two). Only the payload builder calls it (`baseball-gameday.js`), from the at-bat's own seed. So a
  new draw changes no outcome, score, standing or injury, and `rollAtBat` and the situational
  rules stay as they are.
- **The new draw** makes a foul a strike at any count, so most new fouls replace a called or
  swinging strike rather than adding a pitch, and two-strike fouls run longer. The target is about
  17% fouls at about the pitches per plate appearance the sim has now (4.05, against MLB's 3.9),
  so a game grows from about 308 pitches to roughly 320, not 370. S0 checks the fit on both draws.
- **It still goes in at a recorded slot.** Regress pins every synthesised pitch of a hundred seeded
  games, and a game on air at the deploy would change its pitches part-way, so a late tuner and an
  early one would disagree about the count. The switch is the v2 machinery in
  [index.js](../../plugins/broadcast/index.js) (`simVersionFor`, `nextSimSwitch`, `@sim` in the
  `.bsm`, world_flags). Since this was written v3 has been taken: it's v2 played by each club's
  fixed roster for the season (`clubRosters`), and `@sim 3` is in the `.bsm`. So the new draw is
  v4, v3 plus the draw, and the ratings-based at-bat roll can share it if it's ready, or take v5.
  Where this doc says v3 for the new draw, read v4.

### The draw

`synthFouls(abSeed, pitches, o)` in [baseball.js](../../plugins/broadcast/sports/baseball.js), next
to `synthPlay`, seeded from `sportsHash(abSeed, FOUL_SALT)`. It reads the pitches it's given, the
new draw's from v3 on, and never redraws them. One record per foul:

| Field | What |
|---|---|
| `i` | which pitch |
| `k` | the kind: `tip` (into the mitt), `back` (into the screen behind home), `over` (back over the screen), `side` (into the seats down a line), `roll` (on the ground, rolling foul), `dug` (into a dugout), `out` (out of the park) |
| `dir`, `ev`, `la` | spray in degrees, exit speed and launch angle, as `synthPlay` gives them |
| `d`, `ft` | how far from the plate it comes down, and how long it's in the air (ms) |
| `s` | the section it lands in, if it lands in one |

About 40 bytes a foul, so about 2 KB a game at the new rate. The kinds' shares follow the batter's timing:
late swings go the other way, and a ball high over the screen comes off a swing under the pitch.

### Sections

`venue.sections` in the Deadball row's `sports_pools.venue`, written by the build script with the
rest of the venue: for each section an id, its name, its outline in the park's frame (feet, home
plate at the origin), the eye a seat sees from, and the room and furniture it belongs to. The
landing's section is worked out at assembly by a point-in-outline test in a pure module both sides
read, as `play.js` is now.

A home run's landing spot is already decided by `synthPlay`, so a home run ball gets its section
the same way and can be caught in the bleachers.

### The client draws what the server decided

The director's foul (the left-or-right coin off `hashStr`) and the mixer's crack for a foul (off
the seed, in `sound.js`) read the record instead, on TV as well as in a seat. A foul tip is a mitt and no flight; a ball
into a section comes down where `d` and `dir` put it, at `ft`.

## 3. The catch

- **When a line airs**, the broadcast looks at its payload's fouls and home runs. A record with a
  section goes on a RAM list (`ballsDue`) with its wall-clock landing time, but only if somebody is
  seated in that section's room. Usually nobody is, and nothing is queued.
- **The broadcast's 1 s tick** takes the records that have come due. For each, it reads who's in
  the section from the room's occupants in RAM (`getZonePlayers`), keeping those sitting on that
  section's furniture (`player.posture`, `player.sittingOn`). A player who stood up or left before
  the ball came down isn't in it.
- **The roll** is the server's own random, not the sim's. A seated player has a chance in
  proportion to how many players are in the section, capped, so a regular in a baseline section
  takes a ball home every few games (the numbers are a question below). On a catch, one insert:
  the ball into that player's inventory.
- **The client shows a scramble** for the last second of the flight, hands going up round where it
  lands, and the server's answer ends it: you have it, someone else in the section has it, or a
  stranger does. The scramble covers the latency, so nobody sees the ball land in their lap and
  then go to somebody else.
- **The item** is one new content item, a ball with the game on its `custom_data`: the clubs, the
  day, the inning, the batter and the pitcher, and whether it was a foul, a home run, a grand slam
  or a walk-off. Its examine text reads the ink: "A Deadball ball, scuffed grey down one side. In
  ink: Rats at Kings, bottom of the sixth, off Okafor." (Check [items.md](../items.md) for a
  per-instance description key before adding one.)

## 4. What you hear and read in the stands

### Sound

- **The park is the room.** `systems-deadball-sound.md` keeps `setRoom()` off because a viewer in
  a bar is in the bar. A seated player is in the park, so the seat sets the park's room: the
  slap-back off the stands is real here.
- **Distance is heard.** The crack reaches the bleachers about 0.35 s after the swing (1,125 ft/s,
  the figure the fireworks already use). The plate umpire's calls are loud behind the plate and
  gone in the bleachers. The PA comes from horns under the press box, a beat late for the far
  seats.
- **No booth and no arcade announcer.** Chip Vega and "HOME RUN!" are the broadcast. In the stands
  the PA has its own words: the batter, the pitching change if one ever comes, a home run's hitter,
  the seventh-inning stretch.
- **The crowd is all round you**, the bed louder than on TV, and the vendor works your section.
  Sound Detail's tiers apply as now.

### The text feed

The game is text first, and a seated player can't hear the booth, so the stands get words of their
own. Three sources, all drawn from the payload on the park's clock, on the client, with no server
push per pitch:

| Source | What | Shape |
|---|---|---|
| The PA | the batter coming up, a home run's hitter, the stretch, safety notices | quoted, the park's own voice |
| What you see | the pitch and its result, the ball in play, a foul toward your section | plain, under 12 words, from your section's side |
| The crowd | the people round you reacting, overheard | a bark, 2 to 12 words, often half of a phone call |

- **Density is a setting**: every pitch, or the plays and the PA only (the default, decided). Whichever it
  is, a foul toward your section and a catch always print.
- **One section, one line.** The pick is seeded from the payload and the section, so
  everyone in a section reads the same thing and can talk about it.
- **The words are content.** Pools in [baseball.bsm](../../data/scripts/baseball.bsm) under
  `stands.*` keys (`stands.pa.batter`, `stands.sight.foul.side`, `stands.crowd.strikeout.home`),
  compiled into `sports_pools` and served once with the venue, cached by revision. No `.bsm` syntax
  changes. The PA's and the vendor's lines now in
  [deadball-sfx.js](../../client/shared/deadball-sfx.js) `VOICES` move into the same pools, since
  they're Coldwater content in an engine file.
- **The same rules as the booth**: the line and the picture agree, by construction and by test.
  Lines that name a direction or a fielder come from the play's tags, as the booth's do.
- **A screen reader** gets the feed in a polite live region, as Play by Play does now.

Written to [house-voice.md](../reference/house-voice.md): the default is literal, the tilt is
rationed to about one line in five and lives in the PA's quoted copy or a bark. For example:

- PA: "Now batting for the Kings, number 25, Yamamoto."
- PA: "Fans are reminded that a ball leaving the field of play becomes your property and your
  responsibility."
- Sight: "Strike two, swinging. The catcher throws it back."
- Sight: "A foul comes back high over the screen, toward you."
- Crowd: "A man two rows down, into his phone: 'No, I'm at the game. The game.'"
- Once a game, at the stretch: "Sir Charles's seat stays folded up." Nothing after it.

### The video board in the room

The board is a television on channel 7, so today a player in the Stands gets Chip's lines as the
room's TV text. In the park the speakers belong to the PA, so the board goes quiet in the room
while a game is on: a furniture flag (`flags.board_mute`, owned by the broadcast) keeps its lines
out of the room's ambient pass. `watch board` still opens the TV panel, booth and all, for anyone
who wants the broadcast.

## 5. The seat, the board and the ticket

### Sections

Seat furniture in the two rooms that exist, one piece per section, rather than a room per section (decided):
players in the Stands still hear each other, and the map gains no rooms.

| Section | Room | Ticket |
|---|---|---|
| Behind the plate | The Stands | 20₵ |
| First-base side | The Stands | 10₵ |
| Third-base side, up to Section Nine's rope | The Stands | 10₵ |
| Left-field bleachers | Bleachers | 5₵ |
| Right-field bleachers | Bleachers | 5₵ |

A Widowmaker is 7₵, for scale. Sir Charles's seat stays a decoration nobody can sit in.

### The view

- **`sit` on a section's seats while a game is on opens the seat view**, and standing closes it.
  The view mounts in the room pane, so it dispatches `pane:claimed` and `pane:released`
  ([mobile-layout.md](../reference/mobile-layout.md)).
- **It follows the display ladder** ([systems-display-mode.md](../systems-display-mode.md)): the
  3-D seat at the visual rung, the text feed alone at the other two.
- **The eye is the section's**, from `venue.sections`. The player looks round with relative mouse or
  touch drags, or the arrow keys; zooms like binoculars (`fovMul`); and can switch on following the
  ball, which turns the head as a fan's would. With reduced motion the view holds still and the
  follow is off.
- **No broadcast graphics over the picture.** The count, the score and the pitch speed are on the
  park's own board, with the arcade lettering, as part of the scene.
- **The fans round you are close.** The crowd figure was built for TV distances, and the rows in
  front of a seat fill the bottom of the frame. Phase S3 checks whether the near level holds up at
  ten feet.

### Replays on the board

KSAB's replay of a big play shows on the video board, in the park, while the field carries on. The
replay's world (`diamond/replay.js`) renders small into the board's texture for its length; on
phones and low tiers the board shows a still and the word REPLAY. With the booth paced by the park,
the board's replay always comes after the field's play.

### Tickets and the turnstile

- **Bought at the ticket office window**, beside the turnstiles, while the venue is lit. One
  transaction: the credits and a ticket item for that game and section.
- **Checked at the turnstile** by a move gate (`registerMoveGate`) from the Rotunda to the Concourse,
  and at the bleacher gate for the bleachers. The gate reads a RAM set of who holds tonight's
  tickets, filled on purchase. After a restart the set is empty, so a miss costs one query for a
  ticket item, once per entry, never per move inside.
- **The section on the ticket is where you may sit.** An usher's line moves you along from the
  wrong seats.
- **Off nights** the gates stay open and nobody checks, as now. The seats take `sit`, and the room
  says the field is dark.
- **The stub is kept**: the ticket is torn at the turnstile and stays in your inventory with the
  game on it, which costs nothing more.

## 6. Read tiers and egress

| What | Tier | Cost |
|---|---|---|
| The park clock and the fouls | computed at assembly, once per slot, cached with the graph (`getSportsGraph`) | no query |
| Each pitch | the client plays its window | nothing on the server |
| Who's in a section | the room's occupants and their posture, RAM | no query |
| Balls coming down | a RAM list on the 1 s broadcast tick, empty unless someone's seated where a ball lands | no query |
| A catch | one insert into `player_inventory` | about 1 a game, often 0 |
| A ticket | credits and one item, in one transaction | once per player per game |
| The turnstile | a RAM set; one query on a miss after a restart | once per entry |
| Sitting and standing | `player.posture`, RAM only | none |
| A seat's egress | as a TV viewer's (about 88 KB a game), plus `pk` (about 4 KB) and fouls (about 2 KB); the `stands.*` pools once per revision with the venue | about 94 KB a game |

Nothing new is scheduled. The landing list rides the broadcast's existing tick, and seats register
in a RAM map beside `tabletTuners`, delivered by the same pass that reuses the beat the tick already
resolved.

## 7. People playing later

A pitch-level sim (a v3) with AI fielding, played live, would let the stands watch with no delay.
Seats are built so they don't need it and wouldn't change for it:

- **The seat's input is timed records**: a pitch at a time, a foul with its landing, a play with
  its landing. Under v2 the park clock hands a window's worth at once with its times. Under a live
  sim the server would hand each pitch as it's decided, with a short lead (about a second) so every
  seat has it before it happens. Seat mode reads `pk.t` as a queue for this reason.
- **Fouls and home runs keep their record.** A live sim would decide the flight itself and send the
  same `k`, `d`, `ft` and `s`; the catch path on the server doesn't change.
- **The text feed and the sound** hear the same records either way.
- **What a live sim would change is the TV**, whose director waits for the whole at-bat because the
  booth's line does. That's v3's problem. Its TV would likely run in seat mode too, with cameras
  that follow and never jump.

"Seat" here means a place in the stands. In [cluster-puck-ai.md](cluster-puck-ai.md#people-in-the-seat)
it means a person controlling a team; the two don't meet.

## 8. Engine and content

| Piece | Side | Why |
|---|---|---|
| `diamond/parkclock.js`, seat mode in the director, the between-pitches filler | THOMAS (engine) | Baseball, not Deadball: a second game's ballpark keeps them. |
| `synthFouls` and the clock's place in assembly | broadcast plugin | The sport module, as `synthPlay` is. |
| `paceCalls` for baseball | broadcast plugin | The sport module's own pacing, through the seam hockey uses. |
| The section test, the stands narrator | THOMAS (engine) | Pure, from a venue's sections and a pool of words; names nothing. |
| `venue.sections`, ticket prices | Architect (content) | The Deadball row's venue, from the build script. |
| The `stands.*` pools, the PA's and the vendor's words | Architect (content) | `baseball.bsm`. |
| Seat furniture, the ticket and ball items, the usher's lines | Architect (content) | Content files, through the Coliseum's content script. |
| The seat registry, the landing list, the catch, the turnstile gate, `board_mute` | broadcast plugin | It owns the channel and the beat; the gate is a plugin move gate. |

## Phases

Each phase lands on `main` on its own. The WIP commit `feee5ae1a` doesn't land (see
[What exists](#what-exists)).

**S0: does it fit?** Size: small. **Built 2026-11-03.**
- [diamond/parkclock.js](../../client/game/js/panels/diamond/parkclock.js): each payload's window
  from its hold, and every pitch's release inside it, with the slack shared out (`SHARE`) and the
  gaps varied off `CLOCK_SALT`.
- [parkclock-smoke](../../scripts/shapes/parkclock-smoke.mjs), in the shapes group: four 8-club
  seasons (480 games) at sim v3 as they air, with the real lines and holds, on today's pitch draw
  and on a draft draw with more fouls. Its helper
  [parkclock-season.mjs](../../scripts/shapes/parkclock-season.mjs) builds the games, the narration
  and the pacing, and holds the draft draw, so S0 changes no runtime file's behaviour.
- To get the real lines without importing `broadcast/index.js` (it loads the plugin's state from the
  database as it's imported), Deadball's narration moved whole out of `assembleSportsGraph` into a
  pure module, [baseball-narrator.js](../../plugins/broadcast/sports/baseball-narrator.js). Its
  output is byte-identical: 480 graphs over v1, v2, v3, both clocks, a final and extra innings
  hashed the same before and after, and the helper's payload holds matched `assembleSportsGraph`'s
  in all 384 games compared.
- Cost: no runtime cost; the gate is about 9 s of CPU.

### S0: what the gate measured

The question for every window: do its pitches fit at `CYCLE_MIN`, every pitch whole, no budget
cut? A window's need, by the director's own numbers in `timing.js`, is `LAST_PITCH` for the last
pitch to the plate, `playRoom` for the play or the call, and `afterLand` for what follows (the
10 s reset, a replay, a home run's trot), plus a cycle for each pitch before the last. A changeover
needs `CHANGEOVER_MIN`. `CYCLE_MIN` is 5 s: `LAST_PITCH`, 3.5 s, and a 1.5 s throw back that no
cut hides from a seat. `CHANGEOVER_MIN` is 30 s, the centre fielder jogging out at the director's
jog. A play the booth doesn't call rides the window before it.

At the live clock (an hour's slot, 3:1):

| | Today's draw | Draft draw |
|---|---|---|
| Pitches a game | 308.9 | 318.4 |
| Pitches a plate appearance | 4.03 | 4.16 |
| Fouls | 4.7% | 17.3% |
| Games with every window fitting | 0 of 480 | 0 of 480 |
| Windows with a gap between pitches, under `CYCLE_MIN` | 67.2% | 68.1% |
| Their cycle: median, p10, p1 (s) | 3.0, 0.9, 0.1 | 2.9, 0.8, 0.1 |
| Each game's tightest window: median, p10, p1, worst (s) | 0.1, -6.9, -20.0, -21.0 | 0.1, -6.7, -20.0, -21.0 |
| Windows over: a play's own (at-bat, changeover, home run) | 29,736 (22,567, 7,138, 31) | 30,041 (22,841, 7,138, 62) |
| Windows over with a play riding them | 240 | 240 |
| The game's whole time over all its gaps: median, p10, p1, worst (s) | 3.8, 2.5, 0.6, 0.3 | 3.6, 2.5, 0.6, 0.3 |
| Pitches the TV's budget leaves out at its quickest (estimate) | 4,056 of 145,949, 2.8% | 4,924 of 150,407, 3.3% |

- **The worst window** is a two-pitch single in the top of the sixth (slot 189971) with a throw
  over the booth left out riding it: 25 s for a need of 51 s.
- **The booth leaves 1.94 plays a game uncalled**: 566 plate appearances in extra innings that
  don't score, 176 throws over, 169 extra-inning changeovers, and 22 plays on the bases in extra
  innings. The TV never shows their 2,340 pitches.
- **Changeover windows** run a median of 20 s, a tenth of them 8 s or less, the shortest 4 s.
  The TV gets away with it under cuts.
- **A game's fixed needs** come to about 2,220 s of its 3,100: the reset after each play 798 s,
  changeovers 538, the ball in play or the call 504, the last pitch to the plate 279, home run trots
  and welcomes 57, replays 47. That leaves 232 gaps between pitches to share what's over.

At 1:1 (a three-hour slot), today's draw: the game's whole time over its gaps is a median of 29.4 s
(p10 23.5, p1 19.4, worst 16.6), windows with a gap are under `CYCLE_MIN` only 0.6% of the time, and
416 of 480 games fit every play's own window. No game fits every window, because 3,987 changeover
windows are under 30 s (median 39 s, p10 13), and in 123 windows the plays riding them don't fit: the
worst is the last regular at-bat of an extra-inning game carrying 27 uncalled plays, 359 s for 877.
On the draft draw at 1:1, 332 of 480 games fit every play's own window. The TV leaves no pitch out
at 1:1.

What would make the live clock fit, worked out over the same 480 games' whole time (scratch, not in
the gate), as a median, p10 and p1 cycle, and the games under 5 s:

| A seat's fixed costs | Median | p10 | p1 | Under 5 s |
|---|---|---|---|---|
| As the director's numbers | 3.8 | 2.5 | 0.6 | 439 |
| The reset after a play 5 s, not 10 | 5.5 | 4.2 | 2.4 | 142 |
| Changeovers 20 s, not 30 | 4.6 | 3.2 | 1.4 | 335 |
| No replays (the board shows them while the field carries on) | 4.0 | 2.7 | 0.9 | 426 |
| All three | 6.5 | 5.1 | 3.4 | 38 |

Extra innings are most of the tail: 47 of the 480 games went to extras, and they're 33 of the worst
48. Nine-inning games alone, as the director's numbers: median 3.9, p10 2.9, p1 2.4, worst 2.0.

**What it means for S1.** The clock is built, and its windows are its lines' holds, but those holds
are sized for the TV. So S1's pacer has to size each play's lines by the park clock's need
(`windowNeed` at `CYCLE_MIN`), the plays riding it included, and give each changeover
`CHANGEOVER_MIN`. That's possible at 1:1 for every game. At the live clock it isn't, by about 280 s
for the median game and over 1,000 s at the 1st percentile, so S1 also has to choose: a seat's own
shorter costs (all three cuts above leave 38 games in 480 under 5 s), fewer booth lines in a slot
that can't hold them, or seats that open only at the slower clocks. The uncalled plays need room
too: either the booth calls them in short lines (hockey's way), or they ride with room made for
them. Run `node scripts/shapes/parkclock-smoke.mjs --strict` to fail on the fit; S1 makes it the
default once its pacer sizes windows by the park.

**What it means for S2.** The draft draw (a strike before the last pitch fouled off one time in
three, and with two strikes a 20% chance of each further foul, up to four) reaches 17.3% fouls at
4.16 pitches a plate appearance, 0.13 more than today, about ten more pitches a game. It moves the
fit only a little (the median whole-game cycle from 3.8 s to 3.6, 1:1's fitting games from 416 to
332), so the draw isn't what stands in the seats' way; the live clock's fixed costs are. On TV it
takes the pitches the budget leaves out from 2.8% to 3.3%.

**S1: the park clock on the server.** Size: medium.
- The clock at assembly, `pk` on every payload, `ago` on a catch-up, and baseball's `paceCalls`
  sizing each window by `windowNeed` (S0 above).
- The TV director's budget reads the window; the handover's budget question is re-measured.
- Tests: regress's sim hash unchanged; every payload's window inside its line's hold; every pitch
  timed; the windows sum to the game's time; parkclock-smoke `--strict` by default; gameday-smoke
  and diamond-smoke green.
- Cost: about 4 KB a game per viewer; assembly CPU negligible.

**S2: more fouls, decided on the server.** Size: medium.
- The new pitch draw as sim v4, switched on at a recorded slot; `simVersionFor` and
  `nextSimSwitch` take a fourth version.
- `synthFouls`, `venue.sections` and the section test; the director and the mixer draw the record
  on TV.
- Tests: the hash unchanged for every slot before the switch; fouls about 17% of pitches and
  pitches per plate appearance within 0.2 of today's over a season; outcomes, scores and standings
  identical with either draw; every foul lands where its record says (a diamond-smoke check, as
  balls in play have); the kinds' shares over a season; every section gets balls.
- Cost: about 2 KB a game per viewer.

**S3: the seat.** Size: large.
- Seat mode in the director, the between-pitches filler, joining mid-window, the game's ends; the
  section eye, look, zoom and follow; the board with the score and the count; the park's room and
  the distance in the sound; the seat registry; seat furniture per section; the view on `sit`.
- Tests: a seat-smoke gate that plays whole games in seat mode and fails on any pitch not thrown,
  any body that moves farther in a frame than it could run, and any window overrun; shapes and
  bigscreen gates for the view; regress for `sit` opening and closing it.
- Cost: GPU per seat as one Grandstand at a fixed eye, which sees the whole field at once at the
  far levels of detail.

**S4: the stands' words.** Size: medium.
- The narrator, the `stands.*` pools, the density setting, the live region, `board_mute`. The PA's
  and vendor's lines move out of `deadball-sfx.js`.
- Tests: every line's picture agrees with its play; a bare pool names no direction; every pool key
  the narrator asks for exists; the feed at the log rung with no GL.
- Cost: the pools once per revision, a few KB.

**S5: tickets and the ball.** Size: medium.
- The ticket office window, the ticket and ball items, the turnstile gates, the landing list, the
  catch and the scramble; home run balls in the bleachers.
- Tests: a catch writes one row; nobody seated means nothing queued; a player who stood up before
  the landing gets nothing; the gate passes a ticket holder and stops the rest; after a restart one
  query lets a holder in.
- Cost: one transaction per ticket, about one insert a game for catches.

**S6: optional.** Replays rendered on the board; other players drawn in their seats round you; a
foul into Section Nine landing in the crater's water, and a foul `out` of the park landing on Sorrel
Way or Kettle Lane as an item on the street; the press box as the one seat where the booth can be
heard.

## Risks

- **The live clock is short.** S0 replaced the rough model with the real holds, and at the hour
  slot a seat can't see every pitch whole by the director's numbers. S1 has to cut a seat's fixed
  costs, or the booth's lines, or keep seats to the slower clocks.
- **Pacing the booth changes how Deadball airs.** Lines that held the same time now vary with the
  plays. A line under its reading floor would be unreadable, so the floor wins and the park takes
  the difference from the gaps.
- **The crowd close up.** The fans in the rows in front of a seat are nearer than any TV camera
  gets. If the near level doesn't hold up, the seat needs a closer one, which is crowd work.
- **A fixed eye shows every flaw.** The TV's cuts hide foot slide, a clip's seam and a fielder
  taking the wrong way to a ball. A seat sees the whole field for a whole game; S3's gate has to
  look for jumps the TV never had to.
- **More fouls, more pitches.** If the new draw adds pitches instead of relabelling strikes, the
  tightest games stop fitting. S0 measured a draft draw that relabels strikes: about ten more
  pitches a game, and the fit moves a little.

## Decided on 2026-10-18

- **Pacing:** the booth's lines are paced by the park, so the TV and the stands are always in step.
- **Sections:** seat furniture in the Stands and the Bleachers, not a room per section.
- **Fouls:** more of them, as part of this work: the new pitch draw in S2, as sim v3 (now v4, since
  v3 is the club rosters).
- **The feed's default:** plays and the PA only; every pitch is a setting.

## Questions for David

1. **Tickets.** The prices above? Must a ticket name a section, or does one ticket let you sit
   anywhere? Can you get in without one, through the Undercroft or past the usher?
2. **Catching.** How often should a regular take a ball home? The proposal is one a few games for
   a player in a baseline section, less in the bleachers but for home runs. With about 50 fouls a
   game there are more chances, so the per-ball odds come down to match.
3. **The board's words.** Should the video board stop carrying the booth into the Stands as text
   while a game is on (proposed), or stay a television?
4. **Off nights.** Can you sit and look at the dark field, or do the seats open only on game
   nights?
5. **v4's contents.** The new pitch draw alone (recommended, so seats don't wait), or held for the
   ratings-based at-bat roll so both switch on at one slot?
