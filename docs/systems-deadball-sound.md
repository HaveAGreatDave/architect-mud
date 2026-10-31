# Deadball Sound (as built)

What KSAB's ballpark sounds like in the Grandstand, Deadball's 3-D Gameday view: the bat, the
leather, the ball, the men running, the crowd, the park's air, the organ, the graphics' stings, the
fireworks, and four voices (the arcade announcer's calls, the plate umpire, the public address and
a vendor) under Chip Vega in the booth. Step 4f of [deadball-glass2.md](proposals/deadball-glass2.md).

Everything is synthesised. There are no samples.

## Where it lives

| File | What |
|---|---|
| [client/shared/deadball-sfx.js](../client/shared/deadball-sfx.js) | The bank: 70 patches in SIREN's layer schema, the event table, the mix, the Sound Detail tiers, the voices and their words, the crowd bed and the park's air |
| [client/game/js/panels/diamond/sound.js](../client/game/js/panels/diamond/sound.js) | The mixer: hears the live world each frame and plays the bank |
| [client/game/js/panels/gameday-grandstand.js](../client/game/js/panels/gameday-grandstand.js) | Makes the mixer, hands it each frame, each payload and each landing |
| [client/shared/audio-engine.js](../client/shared/audio-engine.js) | SIREN and ORACLE. The `scene` speech channel, `speak({ gain })`, `speechLeft()` and `engineNodes(category)` were added for this |
| [client/shared/sfx-catalog.js](../client/shared/sfx-catalog.js) | `addBank()`, which folds the bank into the dev panel's Audio tab |
| [scripts/audio/deadball-smoke.mjs](../scripts/audio/deadball-smoke.mjs) | The gate (below) |

The 2-D Gameday (`gameday.js`) still plays its nine cues by name from `DEADBALL_SFX`, which now
points at the bank's patches.

## How it plays

The mixer listens rather than being told. After the live world steps, `hear(W)` finds what
happened since the last frame:

- **The clips.** Every clip in the library says when its catches, throws, tags, footsteps and
  umpire's calls fall (`events` in [clips.js](../client/game/js/panels/diamond/clips.js)), so the clip
  a body is playing says what he sounds like. A slide is heard on its clip's last step, a dive as
  the ball's caught, a man diving back to the bag on his last step.
- **The ball.** Sampled at the frame's times: a bounce is the vertical speed changing sign near the
  ground (dirt or grass by where), the wall is the ball coming back toward the plate past 200 ft,
  the backstop (low) or the club seats (high, as there is no net) is it passing behind the plate, a home run clatters into the seats at its
  path's own `land` time, and one that hits the pole rings it as it crosses the fence.
- **The spectacle.** The comet's tail, the sparks off the bat, and each shell's launch whistle,
  burst and crackle. A burst is heard late by its distance at 1,125 ft/s.
- **The crowd.** The fans in the stands (`createRoar` in [gl/crowd.js](../client/game/js/panels/gl/crowd.js),
  side 0 the home fans) say how loud. The home side passing 0.4 is a cheer and 0.8 a roar; the
  visitors getting up with the home side sitting is the home crowd's groan.
- **The graphics.** Each pitch's count lamps and speed readout, a splash word, the leaders' table
  rolling in, and the replay's sting. With two strikes on a visiting batter, the crowd claps three
  times.

The director still names the four sounds it plans (`crack`, `mitt`, `glove`, `whiff`) through
`cue()`. A catch it names isn't played a second time off the clip (anything within 0.15 s is the
same catch), and the clip's `contact` event is never played, because it fires on a miss too. The
crack is picked from the payload: a foul off the end or the handle, a slow roller as a soft
contact, a ground ball under 80 mph a broken bat one time in fourteen, otherwise the barrel, harder
with exit speed. A mitt within 0.3 s of a crack is a foul tip.

A replay's world isn't heard: the replay is silent but for its sting.

On a payload the mixer starts the beds, tells the park's air the hour and the weather, and clears
anything the last payload still had waiting. A half-inning break gets the sweep and, 1.4 s later if
the booth is quiet, the organ. A new batter gets the public address 0.7 s in, if the booth and the
scene are both quiet. Otherwise a vendor calls about one payload in seven. The streets (a horn, the
Beacon's foghorn, a dead lamp at night) come from the payload's hash.

On a landing: the play's sting (as the 2-D view plays them), boos for an error by the home side,
an "ooh" for a ball caught at the wall or the rail, the organ's rally when the home side scores,
and the announcer's call.

## The mix

| Layer | Level | While Chip speaks |
|---|---|---|
| The announcer's calls | 0 dB | |
| The umpire and the public address | -3 dB | |
| A vendor | -9 dB | |
| The bat on the ball and the ball into a glove | -4 dB | a further -3 dB |
| Effects: the ball, running, stings, fireworks | -9 dB | a further -6 dB |
| The organ | -12 dB | a further -6 dB |
| The crowd and the park's air | -14 dB | a further -4 dB |
| The hype: air horn, videoboard, drum, stamping | -11 dB | a further -6 dB |

The levels are `MIX` in the bank, and they're the plan's starting point, not set by ear yet. Every
patch rides `tv_fx`, the TV bus's effects side, so the player's TV slider sets all of it. The
effects and the organ take the duck at their onset (`speechLeft('tv')`), which is the whole of a
short sound; the crowd bed ducks for as long as the booth has left to say.

The voices speak on ORACLE's `scene` channel, which neither cuts the booth off nor is cut off by
it. When the announcer makes a call, the booth's held line waits for it (`afterCall`).

There's no ballpark room. `setRoom()` changes the reverb for everything the player hears, and a
player watching in a bar is in the bar. The park's slap-back off the stands is baked into its
sharp sounds instead: a darker copy 120 ms later.

## Sound Detail

| Tier | Plays |
|---|---|
| Off | The calls only: the announcer and the umpire |
| Limited (the default) | And every event: bat, leather, ball, slides, the crowd's reactions, the stings, the fireworks |
| Full | And the beds, the park's air and its streets, the organ, the public address, the vendor, footsteps and throws, rhythmic claps, the towels in the final |

A fielder creeping in as the pitch comes (`field_ready_*`) is never heard, even at Full.

## The patches

70, in the `deadball` group, ids `db-*`. Measured at 48 kHz (16 kHz past 1.5 s) by the gate.

- **Contact:** `db-crack` (the barrel: a click, a shaped noise crack, the wood's body through three
  resonances at 380, 820 and 1,650 Hz, an FM ring at 2.41, a low knock and a sub thump),
  `db-crack-screamer` (100 mph and up, not foul: the barrel with a longer ring and the outfield
  bleachers answering 380 ms later), `db-crack-pop` (a pop-up: a hollow tock, no ring),
  `db-crack-end`, `db-crack-jam`, `db-foul-tip`, `db-bunt` (soft contact), `db-bat-break`, `db-whiff`.
- **Leather:** `db-mitt`, `db-glove`, `db-stretch`, `db-tag`, `db-pickoff`.
- **The ball:** `db-hop-dirt`, `db-hop-grass`, `db-roll-grass`, `db-wall`, `db-pole` (the one that
  rings, about 0.9 s), `db-net`, `db-backstop`, `db-seats`, `db-ball-dirt`, `db-hbp`.
- **Running:** `db-cleat-dirt`, `db-cleat-grass`, `db-slide` and `db-dive-back` (both with grains
  of dirt coming down), `db-dive` (on the grass), `db-dive-dirt` (on the infield or the track: the
  body, the spray and the grains), `db-collision`, `db-throw`.
- **The park:** `db-horn`, `db-foghorn`, `db-lamp`.
- **The crowd:** `db-crowd-swell`, `-cheer`, `-roar`, `-groan`, `-boo`, `-gasp`, `-ooh`, `-murmur`,
  `-whistle`, `db-clap`, `db-towels`.
- **The hype:** `db-airhorn` (three driven reeds; driven layers normalise, so its gains are tiny),
  `db-hype-boom` (the videoboard), `db-drum-chant` (the bleachers' bass drum, two then three quick),
  `db-stomp` (the stands stamping, quickening).
- **The graphics:** `db-sting-homer`, `-run`, `-k`, `-out`, `-base`, `-splash` (brass is a sawtooth
  whose lowpass opens on the attack), `db-click`, `db-beep`, `db-trail`, `db-sparks`, `db-rewind`,
  `db-sweep`, `db-table`.
- **Fireworks:** `db-fw-launch`, `db-fw-burst` (with the city answering at 0.38 and 0.85 s),
  `db-fw-crackle`.
- **The organ:** `db-organ-dirge`, the one song the organist knows (D minor, about drowning, as the
  booth says in `baseball.bsm`), `db-organ-rally`, its first four notes played hopefully, and
  `db-organ-anthem`, the same song in D major for once, before a final's first pitch. A
  note's length is held by its decay at full sustain, so a phrase is one cue.

`db-collision` is in the bank and the event table but nothing plays it yet: the sim has no
collisions at the plate.

## The crowd and the game

`tension(p, S)` in the mixer says how much the next pitch matters, 0 to 1: the inning, the margin,
men on (more for scoring position), two out, two strikes or three balls, and a final. A margin of
six or more cuts it to 40%. It drives:

- the crowd bed's floor, 0.1 + 0.32 × tension, under whatever the fans in the stands say
- a murmur 0.4 s after a pitch's graphics go up, past 0.6
- two strikes on a visitor: the three claps, or with two out at 0.45 or more, the stamping
- a home batter coming up with men on at 0.45 or more: the bleachers' drum, if the booth's quiet

Off the bat the crowd swells 90 ms after any ball put in play but a pop-up or a bunt, louder for a
harder hit and a fly. A hit batter gets a gasp. On a landing, a home run or a walk-off by the home
side gets the videoboard's boom, the air horn and then the drum. A home run in gets a whistle, as
do a double or triple play by the home side and every other home strikeout. An inning-ending home
strikeout at 0.4 or more gets the air horn.

`variant(def, seed, amount, intensity)` is hockey's: one pitch factor for the whole cue, a level
and an envelope inside the patch's `vary`, and the noise from another place. The mixer seeds a take
from the event and the world's time, so a replayed game sounds the same.

## The beds

`crowdBed()` is hockey's crowd bed on a continuous level instead of named states: a rumble, two
airy bands panned either side, three narrow voice bands, all pulsed by LFOs that never line up,
under a 2.4 kHz lowpass. `setLevel(x)` goes up fast and down slowly. The mixer sets it each frame
from the louder side of the fans, with a floor of 0.12 (0.22 from the seventh inning in a game
within two runs).

`parkBed()` is the Curtain's hum (50 Hz and its partials), the light towers' 120 Hz buzz at night,
the city's rumble, wind over the Curtain and rain on the roof. `set({ night, wind, rain })` from the
payload's clock and weather.

## The voices

`VOICES` in the bank, each fully authored so nothing falls through to a seed's dice:

- **The announcer**, a driven baritone, heard on the broadcast and in a box's suite (Announcer in the Box), never from an ordinary seat. Calls `STRIKE THREE!` (a swinging third strike),
  `HOME RUN!`, `GRAND SLAM!`, `DOUBLE PLAY!`, `TRIPLE PLAY!` and `WALK-OFF!`, and at a final's last out,
  once the moment's held, `CHAMPIONS!`.
- **The umpire**, gravelly, on the clips' `call` events: `STRIKE!`, `STRIKE THREE!` (a called
  third strike is his, not the announcer's), `FOUL BALL!`, `OUT!`, `SAFE!`, `DEAD BALL!`. He doesn't
  call balls. A base umpire is a little quieter than the plate umpire.
- **The public address** through ORACLE's horn: "Now batting, number 25, Yamamoto." Before a
  final's first pitch it reads both line-ups as their cards go up: "Batting third, number 27, Ray
  Pellicano."
- **A vendor**: the Widowmaker, "meat adjacent", cold-ish ones, mostly peanuts.

Every call is all caps and 20 letters or fewer, which ORACLE shouts, and is sold only part way
(the announcer at 0.4, the umpire at 0.25): a shout already leans on its last word, and at full
excitement "STRIKE THREE!" peaked at 310 Hz from a 96 Hz voice. It peaks at 185 Hz now. No voice in
the picture starts while the booth is speaking; it's dropped, since the booth is saying it anyway.
Chip's own call at the crack (`contact` on the payload) is said the same way.

## Tests

`scripts/audio/deadball-smoke.mjs`, in the `audio` gate group, about 11 s:

- every patch renders finite, starts and ends in silence, has no DC, peaks between 0.02 and 0.6,
  and is as long as its family should be; the barrel is the loudest contact and a footstep is
  quiet beside a glove
- a seed is the same take twice, two seeds differ, a soft take is quieter
- every event has a patch, every umpire's call but `ball` has words, every call is a shout, every
  voice is fully authored, and the 2-D view's nine are patches
- a grand slam at its busiest (crack, sparks, fanfare, roar, two shells, the organ) stays under
  full scale at the mix's levels
- the crowd bed rises with its level, comes back down, never steps (10 ms windows within 2.2× of
  the one before), adds no nodes and is silent after `stop()`; the park's air likewise
- the mixer, on a real world playing real clips: the catches (once, though the director names one
  too), the tag, the throw, the slide, the hit batter, the umpire's strike on the scene channel at
  -3 dB, a bounce, the wall once, the backstop, the fireworks in order, the trail and the sparks,
  the crowd's cheer, roar and groan, the seats on a home run, the levels and the duck, the calls, the
  booth waiting for one, the three tiers, and no footsteps from the ready creep
- `addBank` folds the bank in once

[speech-channels-smoke.mjs](../scripts/audio/speech-channels-smoke.mjs) covers the `scene` channel,
`gain` and `speechLeft()`, and [diamond-smoke.mjs](../scripts/shapes/diamond-smoke.mjs) runs every
at-bat of a game through the Grandstand with the mixer in it.

## Limitations

- Nobody has listened in a full game yet. The numbers say each sound is the length, level and shape
  intended; the mix's levels are the plan's starting point, to set by ear in the sandbox
  ([tools/sandbox/deadball-park-test.html](../tools/sandbox/deadball-park-test.html)) and the dev
  panel's Audio tab.
- The fence the mixer listens for is the venue default, not a venue's own.
- The announcer and the umpire have Voice Lab-style parameters in the bank; nothing reads a saved
  Voice Lab voice yet.
- Frames stop when nobody's moving, and a hidden tab freezes them, so the mixer hears nothing then;
  only the landing and the payload's sounds, which run on timers, still play.
