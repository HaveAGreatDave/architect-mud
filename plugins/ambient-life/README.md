# ambient-life

## Purpose

The city's daily **routine**. The engine's ambient pool (`getRandomAmbient`) is a flat,
one-shot, theme-keyed list with no sense of *when* or *where* something belongs. This plugin
is the layer that gives street zones a lived-in rhythm — the right vignette in the right place
at the right time of day. Kids play by daylight; buskers set up at dusk; a delivery drone
whirs overhead and banks north; dogs bark two rooms over at any hour. It's the world breathing.

All nine categories ship as content: **kids playing, delivery drones, street musicians,
construction, traffic, maintenance crews, food vendors, arguments, dogs barking.**

### How it works

- **Content, not code.** The library lives in the `ambient_routines` table (loaded by
  `loadRoutines()` at boot and after a dev edit). Each row is a vignette gated by day-phase,
  `ambient_theme`, weather, and/or an explicit zone allowlist, with an ordered `lines` array —
  one entry is a one-shot, several play out as a paced scene (like `npc-banter`). Adding life is
  a data row, not a code change.
- **Opt-in zones.** A zone only feels routine life if it carries `flags.street_life` (the
  fishing/mining opt-in convention), so nothing sprays across the frozen bay or a quiet
  apartment — only the pedestrian hubs. Seeded on a curated set (North City grid, Marquee
  exterior, Civic commons, Docks, Media plaza).
- **Sound.** A routine with `loudness > 0` (drones, construction, traffic, dogs, arguments)
  bleeds muffled into neighbouring rooms through the engine's own `propagateSound`; quiet ones
  (kids, buskers, food-cart calls) stay in the room they happen in.
- **Two interactive routines.** A routine tagged `interactive` ('tip' | 'order') arms a
  short-lived per-zone opportunity and appends a clickable link:
  - **Street musician → `tip`** (`[Tip ₵5]`) — a few credits into the case + a small sanity lift.
  - **Food cart → `order`** (`[Buy a skewer ₵3]`) — restores hunger on the spot.
  Both resolve whatever opportunity is live in the player's room — no target to disambiguate.

### Coverage: what the gates are actually reachable by

A routine's gates are ANDed, so an unauthored value is not a fallback, it is a hole. Two
were open for a long time and neither could ever surface as an error:

- **`dawn` had nothing.** `phaseForMinutes()` returns `dawn | day | dusk | night`, and every
  one of the original 41 rows listed `day`, `dusk` or `night`. Between first light and the
  working day only the phase-agnostic rows could fire, so the busiest hour of a real city
  was its quietest here.
- **`weather` had four of twelve.** `WEATHER_TYPES` is `clear, cloudy, overcast, rain,
  sleet, thunderstorm, storm, snow, blizzard, fog, haze, ash`. Routines existed for the
  first three and `haze`. The street behaved identically in a blizzard, in fog and under
  falling ash.

Both are filled. When adding a routine, check it against the whole vocabulary rather than
the values already in the table — the table is where the hole came from.

**Weather-gated lines should describe the weather doing something to the street, not the
weather.** The player already knows it is raining; a routine that says so is a duplicate of
the environment line. What earns the slot is the gutter, the awning with four people
already under it, and the truck that does not slow down.

### Tick / pacing

A `30s` tick scans zones that currently hold a player, are opted in, and aren't resting; it
rolls `START_CHANCE` per zone and fires a matching routine. Paced vignettes re-check the room
still has an audience before each line. After any scene a zone rests for `ZONE_COOLDOWN_MS`.

## Commands

| Verb | Effect |
|---|---|
| `tip` | Tip the busker currently playing in your room (clickable `[Tip ₵5]`). |
| `order` | Buy a skewer off the food cart currently in your room (clickable `[Buy a skewer ₵3]`). |

## Seams

- **command** — `tip`, `order` (resolve the live per-zone opportunity).
- **tick** — `30s` routine driver.
- **dataSchema** — owns `ambient_routines` (classified `content` in the content registry).

## Content

- `content/ambient_routines/`: the 9-category library; street zones opt in with
  `flags.street_life` in their zone files.

## Notes

- Reads `getEnvironmentState()` for the current day-phase + weather, `world`/`getZonePlayers`
  for witnesses, `propagateSound`/`sendToZone` to emit, `adjustCredits` + hunger/sanity for the
  two interactions. No engine changes — a pure leaf plugin over existing seams.

## The bathroom trip

A resident in a flat with an en-suite goes to it now and then (`playBathroom` in home-life.js). They go in for something: a piss most of the time, a shower more often in the morning or when they've let themselves go, a longer sit now and then, a wash at the basin, and only what the room has. Each beat is its own step: up to the door, the door opened, through, the door shut behind them, the fixture used through bodily's NPC calls (the water runs, the bowl fills, and nearly always it's flushed), back to the door, out, and the door shut again if it was shut before. A door row's `is_open` changes for real, so the text world and the door's sound follow. Nobody goes in on top of a player or another resident, or through a bolted door; they try it and come away. Every beat is emitted as `npc.bathroom` (`going`, `open`, `in`, `close`, `use`, `done`, `out`, `end`), and ROOM walks the body to it.

## Eviction — being told to leave, and then made to

[intrusion.js](intrusion.js) is the words half: a resident challenges a stranger standing in their
kitchen. It stopped there on purpose, because nothing in the game moved a player and inventing that
inside a scenery layer would have been a mechanic hiding in the furniture. Two things changed:
`shove`/`drag` made moving another body an ordinary thing that goes through `cmdMove` like any other
step, and **NPC lock-up** (see [systems-world.md](../../docs/systems-world.md#npc-lock-up-never-traps-anybody))
turned a soft problem hard — a shopkeeper who shuts up shop around a browsing player has locked a
stranger in their stockroom overnight.

[eviction.js](eviction.js) is the consequence. **The NPC ejects you; it never traps you.**

- **`npc.lockup`** (emitted by `moveEntity` when a shop closes or a resident secures their home) —
  everyone inside who doesn't belong gets one line and, after a 20s grace, an escort out through
  `cmdMove` (the same `bypassEncumbrance` exemption `shove` uses, so every gate and arrival
  description runs normally).
- **the intrusion beat** used to schedule the same escort. Since 2026-11-15 it calls the police
  instead (the panic section below): an escort left nothing to stay for, and staying is now what costs you.

`belongsHere(player, npc, zone)` is the single answer to *who belongs*, asked by both paths and by
remarks.js, and pinned by [regress.js](regress.js):

| Who | Result |
|---|---|
| admin/dev | never thrown out or reported; in a home, a fright and then "Oh. It's just you." |
| tenant/owner of a unit either side, or any resident of the building | belongs; no challenge at all |
| a **regular** — `familiar`+ with this NPC | belongs; a shop closing tells them, politely |
| someone the NPC is fighting | left alone — an eviction must never be a way to win a fight |
| everyone else | in a shop at closing, warned and walked out; in a home, challenged, then the police |

## Panic: somebody frightened, and the police called (as built)

[panic.js](panic.js). Two things set it off:

- **A stranger who won't leave a home.** intrusion.js challenges them; still there after 15 s
  (`GRACE_MS`), the resident panics and phones the police.
- **Somebody working a keypad.** The engine's `hackDoor` fires `lock.hackAttempt` for whoever's on the
  hacker's side of the door (the residents behind it are the burglary plugin's). One or two NPCs standing
  there startle ("That isn't your door"), then call it in. Cops, animals, sleepers, anybody already
  frightened and anybody with `flags.wont_call_police` don't.

The call is surveillance's `POLICE_CALL` action: **1★**, a patrol mustered in the hall outside 25 s later
and coming in to arrest you, and **+½★ for every 30 s you're still in that room**. Leave and the call's
over; a call against a clean suspect then sends no hunt of its own and the star bleeds off unseen (see
[systems-surveillance.md](../../docs/systems-surveillance.md#a-citizens-call-2026-11-15)).

While you stay they keep reacting every 7 to 11 s: on the phone ("They're still here. Please hurry."),
hands up, backing off, looking for a way out, begging you to go, screaming for help. When you leave they
calm down ("sags against the wall, still shaking"). **The words drive the body:** every line names
something client/shared/npc-acts.js reads as an act (`callcops`, `handsup`, `backoff`, `scan`, `plead`,
`scream`, `startle`, `shaken`), so anybody in a room with the Stage open is seen doing it, in the clips in
client/game/js/panels/actor-moods.js. A resident the Room Stage is walking round their flat also gets
`npc.panic`, so npc-life.js stops them, turns them to you and holds the clip between lines. The burglary
plugin's alarm sends the same event.

**An admin is recognised, not reported.** The first time an NPC sees an admin or dev where they shouldn't
be, they get the fright like anybody would, then a proper look: "Oh. It's just you." After that, for two
hours, that NPC doesn't react to them at all.

## Remarks: said to you (as built)

[remarks.js](remarks.js). Everything else an NPC says goes to the room; this is said to the player near
them. Somebody who knows you says hello a moment after you come in (half the time, once in 20 minutes per
NPC). On the 30 s tick, now and then (a player gets one every 2 to 5 minutes at most), somebody in the
room comments on what they can see: you're wanted, bleeding, filthy, drunk or high; else the weather,
the hour, or small talk. How well they know you (relations.js) sets the register: a stranger is guarded,
a regular uses your first name, somebody who hates you tells you to keep walking. All of it is RAM: no
query, no write. It gives way to anybody asleep, fighting, frightened, mid-banter or who spoke in the last
45 s, and to intrusion.js (nobody chats to a stranger in their flat). `flags.no_remarks` opts an NPC out.

No resist roll: a refusal mechanic would let a player stand in a locked shop indefinitely by losing
rolls, which is the situation the whole file exists to end. The timer re-validates everything (still
online, still in the room, NPC still there and awake) — a warning is not a scheduled teleport.

## Blackout — somebody in the room has an opinion about it

[blackout.js](blackout.js) is the reaction the power sim never had. It cut the fixtures,
preserved what they were doing, restored them and narrated all three; what it had no
concept of was a **person standing in the room while it happened**. A generator tripping
in an occupied kitchen used to leave two residents carrying on in silence.

It rides a new engine event, **`zone.power.changed`** (`{ zoneId, prevStatus, status, silent }`),
emitted on a genuine status transition. ⚠ It is queued during the power sim and flushed from
`loadZonePowerAndLighting()`, because `state.zones` — everything `getZonePowerStatus` and
`getZoneVisibility` read — is not rebuilt until after `simulatePowerNetwork` returns. Emitting
inline would hand every subscriber a world that still reported the OLD status for the very zone
the event says just changed.

**Words only.** The engine owns the lights, the fridge, the till and the dark; this owns what
somebody says about them. Same rule `intrusion.js` is written to.

| Rule | Why |
|---|---|
| **Where they are decides what they say** | Three pools, chosen off `home_zone` / `work_zone_id` (266 and 224 of the cast carry them). Home is an inconvenience with a sigh in it; work is stock, a dead till and money; a corridor is barely anything. Without the split every shopkeeper in Coldwater complained about their heating. |
| **Nobody wakes up for it** | A sleeper's lights were already off. `intrusion.js` forces a wake because a stranger in your bedroom is the loudest thing that can happen to you; a power cut is not, and a tenement sitting up in bed because a generator tripped is worse than silence. |
| **One voice per room, on a 5-minute cooldown** | The brownout rotation re-derives the grid every five minutes and a zone flapping at its ceiling transitions every other cycle. |
| **Outdoors in daylight, nothing happened** | Losing a street's supply at noon changes nothing anybody standing in it can perceive. Indoors always counts, because what dies indoors is appliances rather than daylight. |

⚠ **It deliberately does NOT use `eligibleNpcs()`.** That predicate excludes an NPC on their vendor
shift (`_ai.vendor_was_working`), because banter is what you do when you're *not* working — and the
shopkeeper behind the counter is precisely the person this feature exists for. [regress.js](regress.js)
pins that, so a future tidy-up that unifies the two predicates fails there rather than silently in a shop.

⚠ **`silent` is not a reason to abstain.** The flag means something else is already narrating this
blackout (the ion storm's sky-wide announce, a ghost-mode sabotage emote) and the generic "the lights
cut out" line was suppressed. A person swearing at a dead freezer is not a second copy of that; it's
the reaction to it.

**Home life stops.** `home-life.js` now refuses to start a domestic routine in an unpowered zone and
aborts an in-flight one, because "Something is frying" in a room with no supply is the single line
that would make the whole layer read as broken. ⚠ `zoneIsDark()` treats an **unknown** zone as
POWERED — `getZonePowerStatus` answers `'unpowered'` for any zone with no `power_zones` row, which is
most of the map, and reading that as "dark" would switch off every domestic routine everywhere the
grid was simply never wired.

## Home talk: flatmates talking to each other

When two or more residents are home, off shift and awake, `home-life.js` hands the turn to `home-talk.js` about
45% of the time instead of a solo scene. A talk is built, not played from a list:

- **Topics are steps of alternative lines, read as lanes.** A talk picks one lane and takes the line in that
  position at every step, so lines in the same position are written to follow on from each other.
- **Temper.** Each pair of flatmates has one. A line starting `+` raises it and `-` lowers it, and a
  `{ calm, hot }` step picks its branch from it, so the same topic can end in a deal or a row.
- **Memory, RAM only.** `#grudge` saves what they fell out over and `#joke:<text>` saves a joke. A later talk
  can open on either, and `#make-up` clears the grudge. A pair still sore at each other gets the `SULK` solo
  scenes (loud washing up in the other one's direction). `#storm` sends the speaker off to the bathroom.
- **Interruptions.** The pipes, the neighbour through the wall, a drone at the window. Some knock the talk onto
  another topic.
- **The witness.** A stranger in the flat (`belongsHere` false) is talked about, in front of them.

It shares the engine banter's chitchat format and its `npc.banter.start`/`end` events (the Room Stage turns
them to face each other), and holds the zone with `holdBanterZone` so a library thread doesn't start over it.

### Street banter frames

The engine's library threads (anywhere, not at home) are framed by `banter-frames.js`, registered with
`registerBanterFrames`. The engine remembers in RAM how often each pair has talked: strangers open with a
nod or a name, a pair that has met says "You again.", regulars skip the hello. A pair that has talked may
open on their last talk instead, and won't repeat any of its last eight threads. A talk may end on a closer,
a third idle NPC may remark on it afterwards, and a player neither of them has met may get looked at first.
Every frame piece is two lines so the thread still opens on the initiator. `{me}` and `{you}` (first names)
now work in library threads too.

The solo half got eleven more kinds besides cooking, drinks and tidying: phone calls (one side of them),
hobbies, getting ready, rehearsing something to say, fixing things, money, downtime, late-night and
early-morning scenes, rare odd ones, and sulking. `soloScene` weights them by the time of day.
