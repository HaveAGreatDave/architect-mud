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

- `scripts/seed-ambient-life.mjs` — flags the street zones and seeds the 9-category library
  (idempotent; re-run after edits). Needs `npm run db:schema` first (adds `ambient_routines`).

## Notes

- Reads `getEnvironmentState()` for the current day-phase + weather, `world`/`getZonePlayers`
  for witnesses, `propagateSound`/`sendToZone` to emit, `adjustCredits` + hunger/sanity for the
  two interactions. No engine changes — a pure leaf plugin over existing seams.

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
- **the intrusion beat** now schedules the same escort, so a challenge you can stand in forever
  became a challenge with a deadline.

`belongsHere(player, npc, zone)` is the single answer to *who gets thrown out*, asked by both paths
and pinned by [regress.js](regress.js):

| Who | Result |
|---|---|
| admin/dev | never challenged, never moved |
| tenant/owner of a unit either side, or any resident of the building | belongs |
| a **regular** — `familiar`+ with this NPC | belongs; a shop closing tells them, politely |
| someone the NPC is fighting | left alone — an eviction must never be a way to win a fight |
| everyone else | warned, then walked out |

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
