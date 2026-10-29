# Seats at the Coliseum

**Status: design, 2026-10-18. Nothing here is built.** Four of the questions were decided the same
day: the booth paced by the park, seat furniture per section, more fouls as part of this work, and a
feed of plays and the PA by default ([Decided](#decided-on-2026-10-18)). How a player watches Deadball in person from
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
- **The booth is paced by the park (decided).** Each line holds as long as its plays take in the
  park, so the TV and the field never drift apart, and the TV leaves out fewer pitches as well.
  Measured roughly over 1,000 games, every game fits with every pitch shown: the median game can
  give each pitch 6.3 s, and the worst needed 3.1 s.
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
- **How the director keeps up.** It gets a budget of 0.45 of the line's hold, between 13 and 26 s
  (`BUDGET`). A long at-bat on a short hold leaves pitches out of the middle. When the bags the
  picture last showed differ from the next payload's, the at-bat opens on a cutaway and everyone is
  placed while the camera's away (`pictureAfter`). A replay is its own world shown in place of the
  live one.
- **Fouls today** are a coin off the pitch's hash (`hashStr('f' + i + p.batter) & 1` in the
  director): left or right, back over the screen at 70 mph, and gone after 1.2 s. The sound picks
  its crack from the seed the same way. Nothing says where the ball comes down.
- **Work in progress, not on `main`.** Commit `feee5ae1a` on `refs/heads/claude/elastic-matsumoto-6ebc73`
  makes every play reach the park: a play the booth doesn't call rides the line before it, in that
  payload's `then` list or as an `uncalled` payload. The Grandstand stages a `then` play 1.2 s after
  the landing in what's left of the line, and leaves it out (a cutaway) when under 1 s is left. In
  30 hour-slot games it staged every play with no cutaways, against 96.7% and 56 cutaways before.
  It still works inside line time and under cuts. Its hand-over lists regress, docs and a squash
  as still to do.

## 1. A park that keeps playing

### What a seat can't have

Every one of these is a cut in time, and a fixed seat would see each one as a jump:

| On TV | Why it can't happen in person |
|---|---|
| Pitches left out of a long at-bat (`planViews`, the budget) | The count jumps from 1-1 to 3-2 with nobody throwing. |
| A cutaway when the bags disagree (`pictureAfter`) | Runners appear on bases. |
| A `then` play left out for want of room (THEN.least) | A play happens off camera, then its result is on the field. |
| The camera tour in the dead time (`shotsBetween`) | A seat doesn't move. |
| A replay shown in place of the live world | The field can't vanish for eight seconds. |
| The street shot at a game's first at-bat | Not from a seat. |

`feee5ae1a` fixes the third row for the TV, as long as the line has room. Beyond it, a seat needs
a clock of its own that gives every pitch and every play its time.

### The park clock

A pure module, `diamond/parkclock.js` (baseball, not Deadball, so engine), that the server runs at
graph assembly as it runs `synthPlay`, and that the gates can run with no server:

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
does between pitches. Phase S0 measures this properly, with the real holds and the chatter lines,
which this model ignores.

### Pacing the booth by the park (decided)

Today every play-by-play line in a baseball game holds the same time (`perLine`). The park clock
gives each at-bat what it needs, so the two drift: with equal windows and a 4 s cycle, the model
had the park falling behind the booth by 20 s in a game at the 90th percentile and by 280 s at the
99th.

So the lines are paced by the park. Baseball gets a `paceCalls`, the seam hockey already uses
(`sportMod.paceCalls`). Each line holds for the park time of the plays it carries, its own and its
`then` plays, and a line that calls nothing holds its reading floor (`SPORTS_LINE_HOLD_MS`). The
park's window for a payload is then its line's hold exactly. The line airs as the at-bat starts in
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
  `.bsm`, world_flags), which knows only v1 and v2 today. Recommended: a plain v3, v2 plus the new
  draw. The ratings-based at-bat roll can share it if it's ready, or take v4.

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

Each phase lands on `main` on its own. The WIP commit lands first, with its hand-over's list done.

**S0: does it fit?** Size: small.
- `parkclock.js` and a gate (`parkclock-smoke`) that lays out a season of seeded games with the
  real line holds, chatter lines included, and reports each game's pitch cycle, its worst at-bat
  and how far the park and the booth drift with equal holds.
- Runs on today's pitch draw and on the new one with more fouls, so the fit is known before v3 is
  switched on.
- Cost: no runtime cost; one gate under its 60 s budget.

**S1: the park clock on the server.** Size: medium.
- The clock at assembly, `pk` on every payload, `ago` on a catch-up, and baseball's `paceCalls`.
- The TV director's budget reads the window; the handover's budget question is re-measured.
- Tests: regress's sim hash unchanged; every payload's window inside its line's hold; every pitch
  timed; the windows sum to the game's time; gameday-smoke and diamond-smoke green.
- Cost: about 4 KB a game per viewer; assembly CPU negligible.

**S2: more fouls, decided on the server.** Size: medium.
- The new pitch draw as sim v3, switched on at a recorded slot; `simVersionFor` and
  `nextSimSwitch` take a third version.
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

- **The model is rough.** Its play lengths are guesses, and it gives the game the whole fill. S0
  exists to replace it with the real thing before anything else is built.
- **Pacing the booth changes how Deadball airs.** Lines that held the same time now vary with the
  plays. A line under its reading floor would be unreadable, so the floor wins and the park takes
  the difference from the gaps.
- **The crowd close up.** The fans in the rows in front of a seat are nearer than any TV camera
  gets. If the near level doesn't hold up, the seat needs a closer one, which is crowd work.
- **A fixed eye shows every flaw.** The TV's cuts hide foot slide, a clip's seam and a fielder
  taking the wrong way to a ball. A seat sees the whole field for a whole game; S3's gate has to
  look for jumps the TV never had to.
- **More fouls, more pitches.** If the new draw adds pitches instead of relabelling strikes, the
  tightest games stop fitting. S0 measures both draws before v3 is switched on.

## Decided on 2026-10-18

- **Pacing:** the booth's lines are paced by the park, so the TV and the stands are always in step.
- **Sections:** seat furniture in the Stands and the Bleachers, not a room per section.
- **Fouls:** more of them, as part of this work: the new pitch draw in S2, as sim v3.
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
5. **v3's contents.** The new pitch draw alone (recommended, so seats don't wait), or held for the
   ratings-based at-bat roll so both switch on at one slot?
