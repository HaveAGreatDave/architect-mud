# Dreams

**STATUS: BUILT** — sleep dreamscapes, template-driven authoring, all four drug hallucination modes, and
the devpanel editor all ship. Nothing here has been exercised against a running server yet; see
[Known gaps](#known-gaps).

**One mechanism, two causes.** A sleep dream and a drug hallucination both build the same thing: a
private, RAM-only set of rooms that dissolves when the cause ends. What differs is who triggers it and
what pool it draws from.

| | Sleep dreamscape | Drug dreamzone |
|---|---|---|
| Owner | `server/engine/dreamscape.js` (engine) | `plugins/trip/` |
| Rooms | 3–4, generated per instance, from `dream_templates` | same |
| Lifetime | Dissolved on waking | Dissolved when the trip ends |
| Occupancy | **One player, always** | **One player, always** (was shared, pre-instancing) |
| Storage | RAM only (`registerTransientZone`) | same |
| Body | Stays in the room, asleep | Stays in the room, glassy-eyed |
| Exit | `wake` verb / button, or any waking cause | **Timer only** — you cannot will your way out |

### The drug mode split

Chosen by what the drug does to your **relationship with reality**, not by how strong it is:

| Mode | Drugs | What happens |
|---|---|---|
| `dreamzone` | **Dissociatives** — khole, deadair, threshold | You have left. Instanced rooms; the body stays behind. |
| `transform` | **Psychedelics** — blotter, mescaline, psilocybin | You have NOT left. The room stays and misbehaves — furniture becomes something else and talks, for you only. |
| `phantom` | **Deliriants** — glasshollow, wraithdust | Fake people walk into your real room and read as real until an interaction reveals otherwise. |
| `overlay` | everything else, and the degrade target | Timed descriptive events; you don't move. |

`transform` and `phantom` are two halves of one engine law (`engine/phantoms.js`): a phantom **adds**
what is not there, a transform **re-reads** what is. Both are live-world, per-viewer, and neither
removes the player from play. A psychedelic belongs there because **the uncanny needs a baseline to
violate** — your own room is a baseline, and a dreamscape has already announced that the rules are off.

Everything below marked *(as built)* describes what actually ships.

---

## 1. The sleep dreamscape

Most dreams are a line of text ([`dreams.js`](../server/engine/dreams.js), rolled every sleep tick).
Occasionally you don't dream *about* somewhere, you **go** there.

### When it fires

In the sleep tick ([`apartments.js`](../server/engine/apartments.js)), once you've been under two
minutes, aren't in a light sleep, and aren't already dreaming:

| Sanity | Chance per eligible tick |
|---|---|
| ≤ 25% | 22% |
| ≤ 55% | 12% |
| else | 6% |

**Rare on purpose.** Being pulled somewhere is a strong beat and stops being one if it's nightly. The
sanity weighting is what makes the deep end of the sanity track *qualitatively* different rather than
just worse.

### What gets built

`buildDreamscape(playerId, { size, tether, cause, drugId, broadcast })` is **async**, returns the entry
zone id — or **null** when no templates exist for the cause, which callers must handle — and registers
`size` rooms (3–4) through `registerTransientZone`: the same non-DB substrate the void crossings use, so
an instance costs no schema and no cleanup beyond forgetting it.

- **Ids** are `zone_dream_<playerId>_<base36 ms>_<n>`. The player id in the key is what makes an
  instance private *and* what lets `dissolveDreamscape` tear down one player's rooms without touching
  anyone else's.
- **Rooms and objects come from `dream_templates`** (content, authored in the dev panel — they used to
  be hardcoded arrays in `dreamscape.js`, which broke the engine-vs-content rule). Each object carries
  several alternate `looks` and picks one per instance — *an object that reads identically twice is
  furniture*. `readTier: cold`: the query runs once per instance, only when an experience actually
  fires, never on a per-tick path, so there is **no cache and nothing to invalidate**.
- **The drug fallback chain**: this drug's templates → the default drug set (`drug_id IS NULL`) →
  nothing, and the caller degrades (trip falls back to `overlay`). Fallback, **not blend** — a drug with
  its own rooms never gets generic ones mixed in.
- **A wandering presence** (`dream_presences`) moves between the rooms of your instance on a per-instance
  timer, announced only when it arrives where you are or leaves. It never resolves into anything.
- **Room ambience is NOT on that timer.** The engine's scheduled `ambientTick` already walks
  `world.zones` — transient rooms included — and `getRandomAmbient` already reads the `ambient_events`
  these rooms are built with. It was being dropped purely because `receivesZoneMessage` rejects a
  sleeper; that now makes an exception for the dream they are *inside*. The timer exists solely for the
  presence, which nothing else can move.
- **Exits deliberately do not reciprocate.** 1–2 per room, pointing at any other room in the set. A
  dream loops rather than branching, and the player should work out within a room or two that this
  place does not obey what the rest of the game taught them.
- **Flags** are `is_interior`, `always_lit`, `dream`, `no_combat`.
  > ⚠ `no_combat` is **currently decorative** — `dreamscape.js` is the only writer and nothing in the
  > combat path reads it. Combat in a dream is impossible today for a different reason: the rooms are
  > private, so no attacker can ever be in one. Treat the flag as reserved, not enforced.
- **Tethers** (`dream_tethers`) are what a room borrows from your actual life: the zone your body is
  lying in, somebody you know, something in your pockets, or the thing that last killed you. Rolled PER
  ROOM — ~55% of rooms get one at all, and of those ~60% are personal. **The mix is the point**: a dream
  that is relentlessly about you is exactly as predictable as one that never is, so a large share of
  lines (`kind: 'none'`) hook onto nothing and are merely strange. A per-instance `used` set stops any
  line repeating inside one dream, which is what makes a pool feel small however many rows it holds.
  > The death fact is the **agent** ("a dog", "Cyd") parsed out of `cause_label`, never the raw label —
  > pasting "Killed by a dog." mid-line read as a database string stapled on. A death with no agent
  > offers no death fact rather than an awkward one. Death lines must not take a **pronoun** for the
  > killer, who may be a person or an animal. That is an authoring rule, deliberately NOT automated —
  > a regex for it flags correct lines ("where {value} opened it" — the *it* is your body), and a check
  > that fails on good writing gets deleted or written around.
- **Weather** — a dream room is flagged interior, so it never got a weather line at all, and weather is
  most of what sells somewhere as a place. Each room authors its own impossible one.
- **A particle field** (`fx`, `fx_intensity`) drives the client's weather-FX canvas directly, ignoring
  the real weather AND the indoor gate: ash falling in a windowless corridor SHOWS the rules are off
  instead of saying so. Pushed by `pushDreamFx` on entry and on every move within an instance;
  `{effect:'none'}` on the way out is what hands the real weather back. None of it touches the weather
  sim — gear, temperature and the hazard channels are unaffected.

### Where your body is *(the load-bearing part)*

**`current_zone` is where your mind is. `zone.players` is where your body is.** Entering a dreamscape
moves only the first.

The sleeper is **not** removed from the room's occupant set. That means:

- `look` still lists them with a tag from **`bodyTell(player, roomId)`**, and `examine` says so and
  offers `loot`. The tell is keyed on **where the mind actually is**, not on `player.sleeping` — a drug
  tripper has no `sleeping` object at all, so keying it on that (as it first did) left people deep in a
  K-hole reading as ordinary alert players standing in the room. A sleeper reads `(sleeping)`; a
  dissociative tripper reads `(glassy-eyed)`; a psychedelic user reads normally, correctly, because
  they are present and functional.
- Looting reads **their real `player_inventory`** — taking an item genuinely takes it off them.
- A killer can find and attack them in their bed. Previously a dreamer was absent from the set and so
  was untouchable, which contradicted the `bodyZone` contract.

Nothing leaks the other way: `receivesZoneMessage` ([`delivery.js`](../server/engine/delivery.js))
rejects them because `current_zone` isn't the room they're lying in. Room speech, ambience, combat
lines, propagated sound and audio all route through `zoneAudience`, so the seal is at one choke point.

The sleep clause in that function is narrowed to `player.sleeping && !isDreamZone(zoneId)` — asleep
players perceive nothing **of the real room**, but a dreamer does hear the dream they're inside, which
is the only room they are actually in. Without that exception every dream room's authored ambience is
built, walked by `ambientTick`, selected, and then silently dropped at the last step.

`player.sleeping.bodyZone` (sleep) and `player._bodyZone` (drug trip) are the durable answer to "where
is this person really". `persistableZone` reads both.

### Waking

`wakeFromDream(player)` is idempotent, safe on someone who never dreamt, and **must be called on every
wake path**. A path that forgets strands the player in rooms whose exits go nowhere real and leaks
zones for the life of the process. The paths:

| Path | Site |
|---|---|
| Slept it out / alarm | `apartments.js` sleep tick |
| Any waking command | `commands/index.js` sleep gate |
| The `wake` verb | `commands/index.js` dream gate |
| Killed | `gameLoop.js` `handlePlayerDeath` |
| Attacked in bed (live PvP) | `plugins/weapon/index.js` |
| Attacked in bed (offline→live handover) | `plugins/weapon/index.js` |
| **Disconnect** | `server/index.js` |

> **Order matters in `handlePlayerDeath`.** The wake must happen **before** `deathZone` is captured
> from `current_zone`, or the corpse spawns inside a dream room that dissolves a line later — taking
> the body's whole inventory with it and leaving the killer nothing to loot. A regress check asserts
> the source order, because the ordering *is* the fix and a comment won't hold it.

### What your own commands do in there

The sleep gate wakes you on any command. A dreamer is exempt, or the walkable dream would be
unwalkable — the entry message invites you to move and look, and the first command accepting the
invitation used to end the dream.

`DREAM_VERBS` (exported from `commands/index.js`) is an **allowlist**: directions, `move`, `look`,
`examine`, `talk`, `say`, `wake`. Everything else returns a dream refusal **without waking you**.

> **The allowlist is a safety property, not a style choice.** Dream rooms are deleted seconds later.
> `drop` inside one files the item under `_ground_<dream zone>` and orphans it in the DB forever. Any
> verb added here must be checked for whether it writes anything keyed to the zone id. Walking, looking
> and talking are safe because they touch nothing that outlives the room.

External wake causes — alarm, attack, the game loop, death — are unaffected. This governs only what
the player's own typing does.

`forceStand` is skipped for a dreaming mover in `cmdMove`: walking in a dream is the *mind* moving, and
the body must stay lying.

### Never persist a transient zone

`persistableZone(player)` ([`world.js`](../server/engine/world.js)) is the guard: a transient id falls
back to `sleeping.bodyZone`, then `anchor_zone`, then `zone_start`. **Every writer of the
`players.current_zone` column goes through it** — `flushDirtyPositions` and the disconnect checkpoint.

Without it, a dreamer walking between rooms marks `_posDirty` and the one-minute batch writes a RAM-only
zone id into the durable row. This also covers void crossings, which had the same exposure.

Note the failure modes were asymmetric: a **crash** was always safe (nothing written, last row is the
bed). A **disconnect** was not — it actively checkpointed, and because nothing dissolved the dreamscape,
a reconnect *before* a restart put the player back inside the dream, awake, with the sleeping state gone.
Disconnect is now a wake path.

### Client

A `sleep_state` message (`{ sleeping, dreaming }`) drives the sleep bar — a label plus a **wake up**
button above the quick-cmds, shown only while asleep.

**The server stamps it on every command reply.** There is no single funnel that clears
`player.sleeping`, and teaching six wake paths to notify the client is the exact mistake that left
`wakeFromDream` uncalled on half of them. Stamping the truth on whatever reply was already going out
is one site that cannot drift.

---

## 2. Drug hallucinations *(plugins/trip)*

Fires off the `drug.used` hook for any drug whose effects carry a `hallucination` block. See the
[mode split](#the-drug-mode-split) at the top for which drug is which and why.

### dreamzone — dissociatives

`enterDreamzone` builds an instance via `buildDreamscape({ cause: 'drug', drugId })` and moves only
`current_zone`. **The real body stays in the real room**, exactly as a sleeper's does — looted, attacked
and killed directly.

> **There is no phantom body any more.** The old model teleported you into a shared authored zone and
> spawned a fake body that mirrored your HP on a 1-second interval, transferring damage back to you and
> killing you if it died. Instancing made the fake body pointless: your real one never left.
> `syncPhantom`, `despawnPhantom` and the mirroring interval are all gone.

`player._bodyZone` records where the body is — the trip-side equivalent of `player.sleeping.bodyZone`,
read by `persistableZone` so a disconnect mid-trip checkpoints the real room.

**No early exit.** A trip runs its timer. You cannot will your way out of a K-hole, and being unable to
leave is most of the horror — so `wake` is dream-only and does not end a trip.

### transform — psychedelics

The room stays and misbehaves. **Three layers, and the first always fires** (`scope` on
`drug_transforms`):

| scope | what it does |
|---|---|
| `room` | a warp line appended to the room description. **Always applied** — a psychedelic on a bare street corner must still be a psychedelic, which the furniture-only first version was not. |
| `object` | two or three pieces of real furniture become something else. Never the whole room: the pieces that stay ordinary are what make the changed ones land. |
| `spawn` | objects CONJURED where there was too little to work with — real phantoms with `kind: 'object'`, rendered on their own line rather than joining the Hostiles. A psychedelic makes the room strange; it does not populate it with monsters. |
| `weather` | appended to the REAL weather line outdoors, so the actual conditions stay legible — you are still in the rain, the rain has simply stopped behaving. |

The trip follows you: each new room is re-dressed as you walk, and transformed objects say things at you
unprompted. Applied at the two `getZoneFurniture` seams — the room render in `describe.js` and the
examine branch in `commands/world.js`.

> ⚠ **`applyTransforms` returns COPIES and must never mutate.** `getZoneFurniture` serves rows straight
> out of the world cache, and those objects are **shared by every player in the room**. Mutating one
> would show a single player's hallucination to everybody and write it into the cache until reload. A
> regress check asserts the shared row is untouched after a transform is applied, because this is the
> failure that looks fine in testing and is very ugly in production.

Transform content falls back the same way rooms do: this drug's transforms → the default set
(`drug_id IS NULL`) → degrade to `overlay`.

### Everything that speaks

`drug_reactions` is one shared pool with two consumers (`source`: `object` for a transformed or conjured
thing, `npc` for a person reacting to how you look) and two registers (`tone`):

- **`surreal`** — it half-participates in what you are experiencing.
- **`normal`** — **the load-bearing half.** A chair asking whether you ever sorted the bins is far worse
  than a chair being cosmic, because you cannot tell whether *that* one was real. A pool of nothing but
  cosmic pronouncements becomes wallpaper inside a single trip.

`NORMAL_SHARE` is rolled as its own tone selection **before** the pool is filtered, never shuffled into
one list — otherwise adding surreal content would quietly dilute the mundane out of existence. A
transform's own `says[]` wins 40% of the time when authored, so a specific thing keeps a specific voice,
but nothing is ever mute for want of one. You can `talk` to any of it, and it answers from the same pool.

**Social reactions.** Somebody in the room notices what state you are in — from **one** NPC, never the
whole room, because a chorus reads as a bug and the point is that *somebody* noticed. Only `transform`
triggers them: a dreamzone tripper cannot walk, an overlay trip is internal, and a deliriant is
deliberately undetectable.

- **On entry (50%) and while you stand (a quarter of that).** Entry-only meant a bar full of people
  commented once at the door and never again, so pacing the doorway was the only way to see the content.
  The standing beat rides the existing follow timer — no second interval.
- **Scoped to who they are and what you are to them.** A line may carry an `npc_type` (cop, medic,
  bartender, dealer) or a `relation` tier read from `player_npc_relations` — in memory, no query. A
  close friend puts a glass of water in front of you and says nothing about it; a stranger decides,
  visibly, not to get involved; a hostile watches you with an interest that has plans in it.
- **Specific wins, but only if specific exists.** The chain is type → relation → general, each step used
  only when it has anything, so no combination of trade and history leaves an NPC mute.
- **They remember.** An NPC that has commented shuts up for 45s and will not repeat a line it has
  already used on you this trip; without it, stepping out and back in got you the same "are you all
  right?" forever. The memory is per (player, NPC) and dropped when the trip ends.

> **The law is separate and already worked.** A hallucinogen sets `_visibleDrug` (`drugs.js` treats any
> `effects.hallucination` as visibly tripping), so surveillance raises `public_intoxication` on room
> entry regardless of any of the above. These reactions are the human half of something the legal half
> already handles.

### phantom — deliriants

Unchanged. No screen FX and no "you are tripping" cue: fake people and animals walk into your real room
and answer to look/examine/talk/attack as if real, until an interaction (a whiffed punch) reveals there
was nothing there.

### Degrading

Both content-backed modes check their pool **before the mode is announced to the client**
(`hasDreamTemplates` / `hasTransforms`), so a drug with no authored content degrades to a working
`overlay` trip rather than half-entering something that isn't there.

All trip state is in-memory. A restart loses trips; `persistableZone` stops a transient id ever reaching
the players row, and the login rescue in `server/index.js` catches anything else.

### Cost

Everything is `readTier: cold` and **nothing queries on a clock.** Both per-trip pools are fetched once
and held on the trip's state:

| | queries |
|---|---|
| a sleep dream | 6, once (templates, presences, tethers, + 2 for tether facts) |
| a dissociative trip | 7, once |
| a psychedelic trip | 3, once — then nothing for its whole duration, however far the player walks |

> Both pools were originally fetched per use, and both were wrong in the same way. `drawReaction`
> queried per spoken line off a 9-second timer; `applyTransformsHere` queried on every room change, so a
> player *walking* while high paid a round trip every 9 seconds. Held on trip state rather than
> module-level on purpose: the pool dies with the trip, so a dev-panel edit is live for the next one and
> there is still nothing to invalidate.

The only ongoing cost is timers — one per active dreamer (moves the presence), one per transform tripper
(re-dresses rooms, speaks lines). Both are RAM-only, both self-cancel if their player vanishes, and both
scale with people currently high or asleep rather than with players online.

> **Legacy:** `zone_dream_threshold`, `zone_dream_khole` and `zone_dream_void` are the old authored
> single-room dreamzones. Nothing reads them now. Retiring them needs a **hand-run one-shot** — the
> additive CODEX deploy can never delete rows. See `scripts/prune-orphan-dream-rows.mjs` for the same
> problem in the newer tables.

---


## Planned

The original three-step plan is BUILT. What actually remains:

1. **Exercise it against a running server.** The largest outstanding item by far. Regress boots no
   sockets and runs no timers, so the presence beat, the transform speech, the FX push, the devpanel
   panel, and a real trip entering and leaving an instance are all unverified.
2. **Retire the three legacy `zone_dream_*` rows** — nothing reads them. Needs a hand-run one-shot; the
   additive deploy cannot delete.
3. **More dissociatives** if wanted. The mode has room for nitrous-style loops and scripted
   life-review structures that the current random-instance builder cannot express.

## Known gaps

- **`no_combat` is not enforced** — reserved, not a law. See the flag note above.
- **Nothing has run live.** Regress covers pools, splits, transform isolation, tether substitution and
  the wake paths, but every timer-driven and client-facing behaviour is untested in a real session.
- **Content deletions need the prune script.** `content:import` is additive and can never delete, so a
  rewritten pool leaves its old rows live and still drawable — they are **not inert**. This bit once for
  real: rewritten tether lines kept serving the exact versions they had been rewritten to replace, until
  `scripts/prune-orphan-dream-rows.mjs` cleared them. Run it after any pool rewrite.
- **Social reactions do not escalate.** They now scope by trade and relationship, remember, and fire
  while you stand as well as when you arrive — but nothing accumulates. An NPC who has watched you come
  down twice thinks nothing of it, and no reaction feeds relations, gossip or the job market.
