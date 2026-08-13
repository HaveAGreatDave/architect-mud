# strays

Cathode, the stray cat with a bionic front paw, who lives in Dray Lane.

Most of the time she is not there. Every few minutes, if somebody is standing in
the lane, she comes out for a minute or two, does one cat thing per beat, and
goes again. You can pet her. You can kill her. She remembers which you did,
permanently.

Full write-up: [docs/systems-strays.md](../../docs/systems-strays.md).

## Files

| File | Holds |
|---|---|
| `index.js` | the tick, surface/despawn, the pet hook, the kill handler, the search provider |
| `behaviours.js` | the 32-entry behaviour table and its weighted picker |
| `memory.js` | `moodToward()` and the flag/relation writers |
| `regress.js` | the suite — start with the respawn check |

## The four things to know before you touch it

**Hiding is absence, not suppression.** While hidden, Cathode is in
`zone_dray_lane_den` — a real zone with no exits, `map_id: null`, unreachable by
movement. So `look`, `getZoneNpcs`, SIFT, `attack` and `pet` all agree for free.
A `flags.hidden` that the room description filtered would need honouring by six
other readers, and the first one anybody forgot would be an invisible cat you
could still stab.

**The den is also the fail-safe.** `home_zone` is the den, so the engine's own
boot placement (`world.js`) and its own respawn (`gameLoop.js` `npcWanderTick`)
both return her to hiding without knowing this plugin exists. The default state
after any restart, crash or unanticipated path is *hidden*, which is the safe one.

**We retune the engine's respawn timer, we don't replace it.** Combat sets
`npc._respawnAt = now + 60s`. The 24-hour hide is that same field with a bigger
number, written **synchronously, as the first line of the kill handler, before
any `await`**. If an await creeps above it, `npcWanderTick` fires in the gap and
the 24-hour grief window silently becomes sixty seconds. There is no respawn code
in this plugin at all. `regress.js` asserts the window is > 23h.

**`zone.npcs` has no reconciler.** `zone.players` drift is repaired by
`reconcileZoneMembership`; `zone.npcs` is not. Every position change goes through
`moveNpcToZone` and nothing else, or you get a cat in two rooms — or in none —
permanently, silently, with no self-heal.

## Calling her

```
Cathode!     Here Cathode!!     call cathode     summon cathode     pspsps
```

An **input matcher**, not a command — there's no verb `cathode`, there's somebody
shouting a name. Bare `call`/`summon` belong to gametable's poker table and stay
there: every pattern but `pspsps` carries her name, and matchers run before
command routing so the named form wins without taking a verb off anybody.
`regress.js` asserts bare `call` is *not* matched — **that check protects poker,
not the cat.**

**Spamming does not help, and the code means it.** Flat per-call chance, no
streak counter, no pity timer. Two gates: 60 s between attempts, 45 min after she
actually turns up. The 60 s alone wouldn't be enough — an hour of shouting is ~60
rolls, and any workable chance makes that a reliable summon.

The relationship is the only thing that moves the number: 4% for a stranger, 9%
once you've petted her, 20% for a regular, **never** for a killer — who gets the
ordinary miss line, because a bespoke one would tell them what they'd done.

## Memory

Two stores, on purpose.

| Fact | Lives in | Why |
|---|---|---|
| pet count, kill count, last-pet time | `player_flags` | must not decay, must not be launderable |
| warmth / familiarity | `player_npc_relations` | gives tiering, decay and VINE conditions for free |

Warmth is a *shared* substrate — buying things and being clean nudge it, and it
decays. Killing this animal must not be something you can launder by being
pleasant for a fortnight, so it lives in its own flag, never decays, is never
cleared, and outranks everything else in `moodToward()`.

```
kills > 0                      -> 'flee'      won't approach, can't be petted, can't be found
pets >= 5 (or 1 + familiar)    -> 'seek'      comes to you, greets you, brings you things at 10
pets >= 1                      -> 'neutral'   knows you, doesn't fuss
otherwise                      -> 'wary'      watches from out of reach
```

`moodToward` is awaited but never queries (flags and relations are both hydrated
at login). It is still resolved **once per player per tick** in `buildCtx` and
handed down as a string — never called from inside the behaviour loop.

## Tone rules

**Nothing explains the paw.** Dorrit Tallow, who named her, has looked at it
twice and does not know who fitted it, and that is the whole of the lore. If you
add an answer, the stray stops being a stray and becomes a quest.

**She is not cute at the player.** She is busy, and you are allowed to watch.

**Eight of the 32 behaviours are just a cat being a cat.** They are not filler.
Without them every appearance is A Bionic Paw Moment and the animal reads as a
mechanism with fur on it. Do not trim them to make room for cleverer ones —
`regress.js` asserts `loaf` and `groom` survive.

**The killing is not funny.** The accolade line is dry because the Architect
files rather than moralises; the sadness is carried entirely by the room prose at
the moment it happens. Keep those two voices apart.

**The refusal never says why.** A killer gets a cold shoulder and no
explanation, ever, from anybody. The player knows. `regress.js` asserts every
line on every rung contains no accusation.

## The refusal ladder

| state | answer |
|---|---|
| 1 kill, first reach | **hiss** — a warning, and a real one |
| 1 kill, reaching again | **bite** — 2–4 HP, self-defence; she leaves |
| 2+ kills | **bolt** — no warning, no defence, simply gone |

Warn, then defend, then leave. A cat that bit on the first reach would be
vicious; one that never escalated would be scenery. **There is no rung above
bolting** — she never becomes hostile and never gets a revenge arc.

The bite is floored at **1 HP, never 0**: a cat must not route a `pet` command
into the death path.

## Known interaction

`plugins/corps` destabilises territory on any `npc.killed`, so killing the cat
nudges corp stability slightly. Emergent and arguably correct — but know it
before somebody files it as a bug.
