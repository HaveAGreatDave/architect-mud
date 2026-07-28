# Dreams

**STATUS: BUILT** — the sleep dreamscape and all three drug hallucination modes ship.
Template-driven authoring and instanced drug trips are design (see [Planned](#planned) at the bottom).

Two systems share the word "dream" and are **not** the same mechanism:

| | Sleep dreamscape | Drug dreamzone |
|---|---|---|
| Owner | `server/engine/dreamscape.js` (engine) | `plugins/trip/` |
| Rooms | Generated per sleep, 3–4 of them | 3 authored `zones` rows |
| Lifetime | Dissolved on waking | Permanent |
| Occupancy | One player, always | **Shared** — two trippers meet |
| Storage | RAM only (`registerTransientZone`) | DB, `map_id: map_dream` |
| Body | Stays in the room, asleep | Phantom body mirrors your HP |

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

`buildDreamscape(playerId, { size, tether })` returns the entry zone id and registers `size` rooms
(3–4) through `registerTransientZone` — the same non-DB substrate the void crossings use, so a
dreamscape costs no schema, no content, and no cleanup beyond forgetting it.

- **Ids** are `zone_dream_<playerId>_<base36 ms>_<n>`. The player id in the key is what makes a
  dreamscape private *and* what lets `dissolveDreamscape` tear down one player's rooms without
  touching anyone else's.
- **Rooms and objects** come from the `ROOMS` / `OBJECTS` arrays in `dreamscape.js`. Each object
  carries several alternate `looks` and picks one per instance — *a dream object that reads
  identically twice is furniture*.
- **Exits deliberately do not reciprocate.** 1–2 per room, pointing at any other room in the set. A
  dream loops rather than branching, and the player should work out within a room or two that this
  place does not obey what the rest of the game taught them.
- **Flags** are `is_interior`, `always_lit`, `dream`, `no_combat`.
  > ⚠ `no_combat` is **currently decorative** — `dreamscape.js` is the only writer and nothing in the
  > combat path reads it. Combat in a dream is impossible today for a different reason: the rooms are
  > private, so no attacker can ever be in one. Treat the flag as reserved, not enforced.
- **The tether** puts something real in the prose — a 40% chance per room of naming the zone your body
  is actually lying in, "rebuilt slightly wrong".

### Where your body is *(the load-bearing part)*

**`current_zone` is where your mind is. `zone.players` is where your body is.** Entering a dreamscape
moves only the first.

The sleeper is **not** removed from the room's occupant set. That means:

- `look` still lists them (with a `(sleeping)` tag), and `examine` reports them asleep and offers `loot`.
- Looting reads **their real `player_inventory`** — taking an item genuinely takes it off them.
- A killer can find and attack them in their bed. Previously a dreamer was absent from the set and so
  was untouchable, which contradicted the `bodyZone` contract.

Nothing leaks the other way: `receivesZoneMessage` ([`delivery.js`](../server/engine/delivery.js))
rejects a dreamer on **two** independent clauses — `current_zone` isn't the room, and `player.sleeping`
is set. Room speech, ambience, combat lines, propagated sound and audio all route through
`zoneAudience`, so the seal is at one choke point.

`player.sleeping.bodyZone` is the durable answer to "where is this person really", set at lie-down.

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

Fires off the `drug.used` hook for any drug whose effects carry a `hallucination` block. Three modes:

- **`overlay`** — you don't move. Timed descriptive events flood your client while your body stays in
  the real zone, visible and attackable.
- **`dreamzone`** — you're teleported into an authored isolated zone while a **phantom body** spawns in
  the real zone mirroring your HP. Damage to the phantom transfers to you; its death kills you.
- **`phantom`** — a deliriant. No screen FX and no "you are tripping" cue: fake people and animals walk
  into your real room and answer to look/examine/talk/attack as if real, until an interaction (a whiffed
  punch) reveals there was nothing there.

The three authored dreamzones — `zone_dream_threshold`, `zone_dream_khole`, `zone_dream_void` — are
single-room, exitless, `map_id: map_dream`, `flags.is_dreamzone`. A missing or unresolvable
`dreamzone_id` **downgrades the trip to `overlay` before the mode is announced**, so a content mistake
never produces a half-entered dreamzone.

All trip state is in-memory. A restart loses trips, and the login rescue in `server/index.js` bounces any
`is_dreamzone` occupant back to their anchor.

---

## Planned

Not built. Recorded so the shape is agreed before anyone starts.

1. **Templates become content.** `ROOMS`/`OBJECTS` move out of `dreamscape.js` into a `dream_templates`
   table (id, name, description, `objects` JSONB, eligibility tags). This is the enabling step for
   everything else, and it fixes a live violation of the engine-vs-content rule.
   - **`readTier: 'cold'`, queried at build time, NOT cached.** The read happens only when a dream
     actually fires — inside the odds check, once per dreamscape — not on every sleep tick. That is a
     few percent of ticks for a player who is asleep and waiting on nothing, so the round trip is free
     and the cache is unnecessary.
   - No cache means **no invalidation** — no write funnel to grep, no stale-in-production failure mode,
     and no contract for a future contributor to violate. (An earlier draft of this plan specified a
     boot cache and named its invalidation the riskiest part of the work; deleting the cache deleted
     the risk. If templates ever do become hot, the `items-cache.js` pattern is the fallback and the
     write surface here is small — devpanel editor plus content import.)
   - Consequence: `buildDreamscape` becomes **async**. Callers are the sleep tick (already async) and
     regress.
   - A template is **not** a `zones` row. The world loader, minimap, districts, GPS and the map-audit
     tooling all assume a `zones` row is a *place*; a template has no coordinates, which is the point.
2. **Devpanel Dream editor.** Ordinary CRUD once templates are rows, plus an objects sub-editor (each
   object needs several alternate `looks`) and a **roll-a-preview** button — non-reciprocating exits are
   hard to eyeball from a form.
3. **Instanced drug trips.** Migrate `dreamzone` mode onto `buildDreamscape`, seeded from the three
   existing zones as templates. Do this **last** — it touches an active drug path with phantom bodies and
   death transfer.
   - Retiring the three `zones` rows needs a **hand-run one-shot**; the additive CODEX deploy can never
     delete rows.
   - The `is_dreamzone` login rescue stops firing (an instance has no DB row) and must move onto
     `persistableZone`.
   - **Instancing removes shared trips.** Two players on the same drug currently meet in the same room.
     That's a deliberate property of an authored zone and a real loss, not just a bug fix — decide it
     consciously.
