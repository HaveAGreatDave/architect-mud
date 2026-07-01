# World, Ambience, Sound & Scheduling (As Built)

Live world state, zone navigation, ambient events, sound propagation, spawning, the minimap, the
scheduler, and balance tunables. Primary files: [world.js](../server/engine/world.js),
[sounds.js](../server/engine/sounds.js), [scheduler.js](../server/engine/scheduler.js),
[tunables.js](../server/engine/tunables.js), [commands/describe.js](../server/engine/commands/describe.js),
[commands/movement.js](../server/engine/commands/movement.js).

## In-memory world state

[world.js](../server/engine/world.js) holds the live mirror of the DB (the DB remains source of truth):

```
world = { zones, players, enemies, npcs, corpses, spawnTimers, apartments }   // all Maps
```

Zones carry live membership Sets (`players`, `enemies`, `npcs`, `corpses`) layered over the DB row.
`initWorld()` loads zones, NPCs, spawn templates, apartments, and the global ambient pool at boot.
`reloadZone(id)` re-reads a single zone while preserving its live membership Sets — this is what the
dev panel's "reload" uses so editing a zone doesn't evict the players standing in it.

## Movement

`cmdMove` ([movement.js](../server/engine/commands/movement.js)) validates `zone.exits[direction]`,
updates the live membership and `players.current_zone`, persists the new zone, and broadcasts
departure/arrival events (with the opposite-direction phrasing where applicable). Entry applies zone
radiation (see [systems-survival.md](systems-survival.md)). `go <name>` resolves named building/room
destinations via `resolveNamedDestination` ([describe.js](../server/engine/commands/describe.js)),
handling exact, unique-prefix, and ambiguous matches.

`describeZone` is the heavy renderer: light level gating (pitch-dark/dark/dim degrade what's visible),
danger/RAD/PVP tags, building-discovery flavour, apartment status, the Custodian outcast/turret
response, ground items, furniture, windows, exits, other players, NPCs, enemies, and corpses. It fires
the `zone.describeRoom` plugin hook for optional injected prose.

## Ambient events & sound

### Ambient pool

`getRandomAmbient(zoneId)` prefers a zone's hand-authored `ambient_events` (loudness 1.0), then falls
back to the global weighted pool keyed by the zone's `ambient_theme` (default `indoors`). A per-zone
recent-window of the last 5 messages avoids immediate repeats. `ambientTick` (every 45s) fires for
~40% of populated zones, after first trying the `zone.describeAmbient` plugin hook (used by the weather
plugin). Exterior zones in active weather may additionally layer a weather-themed ambient.

### Interrupts

A loud sound registers in `zoneInterruptLoudness` for a few seconds (`registerInterrupt`); quieter
ambients are suppressed while a louder sound is "in the air" (`getInterruptLoudness`, with lazy expiry).

### Propagation

[sounds.js](../server/engine/sounds.js) models distance with inverse-square intensity
`loudness / (d² + 1)`:

- `getSoundReach` BFS's zone exits out to the furthest zone where intensity exceeds `HEAR_THRESHOLD` (0.5).
- `dropWords` muffles by randomly dropping/eliding words proportional to attenuation (up to ~55%).
- `distancePrefix` labels remote sounds *Nearby,* / *In the distance,* / *Faintly,*.
- `propagateYell` is the all-caps variant; the sender is excluded from the origin broadcast and gets
  their own echo from the command.

> **Minor bug** (QA report): `dropWords` does a throwaway first random pass only to test emptiness, then
> a second independent random pass for the actual output — the validated string isn't the one returned.

> **Future / unwired (drift audit):** two authored surfaces are intentionally *not* consumed yet and are
> kept pending a design pass — don't assume they do anything:
> - The **`sounds` definition table** (name/category/descriptions/loudness) is authored in the dev panel
>   but no engine path ever `SELECT`s it to emit a sound; sound emission today is code-driven via
>   `propagateSound`. Wiring a tag/event → `playSound(name)` lookup is the open task. (The unread
>   `sounds.tags` ghost column was dropped.)
> - Window **`visibility_transmission`** is authored on windows but every consumer reads only
>   `light_transmission`; peer-through keys off the linked zone's presence, not this value. Either wire it
>   into peer/look opacity or drop the field — needs a look-through design decision first.

## Spawning & corpses

`tickSpawns` (every 10s) joins `zone_spawns` with `enemies`, and for each timer that's due, spawns if the
live count of that template in the zone is below `max_count` and a `Math.random()×100 < spawn_weight`
roll passes; then it reschedules `nextSpawn` by `respawn_seconds`. `cleanCorpses` (every 30s) expires
corpses past their `expiresAt`.

> **Dead system:** `createCorpse` has no callers, so the corpse Map is never populated — see
> [combat.md](combat.md). `cleanCorpses` and corpse rendering run against an always-empty set.

## Minimap

`getMinimapData(centerZoneId, depth=4)` BFS's exits up to 4 hops, staying within the same `map_id`
(so interiors and exteriors don't bleed into each other), and returns node snapshots (grid coords,
markers, colours, danger, player counts) for the client's 5×5 ASCII grid. `cmdMap` returns the full
same-`map_id`/same-`grid_z` tile set for the full-screen map popup.

## Scheduler

[scheduler.js](../server/engine/scheduler.js) is the single interval dispatcher. Named cadences
(`10s, 30s, 45s, 1m, 5m, 30m, 24h`) each own one `setInterval`; multiple callbacks share it, and errors
in one callback are caught and logged without killing the timer. The **1-second combat tick is
deliberately not on the scheduler** — it's the latency-critical hot path and uses a raw `setInterval`
in `gameLoop.js`. Plugins and the environment system subscribe via `schedule()`.

## Pathfinding

[pathfinding.js](../server/engine/pathfinding.js) — BFS over the zone exits adjacency graph. Used by the AI behaviour system for PATROL walk mode and CALL_BACKUP radius lookups.

- `findPath(startId, targetId, { maxDistance = 60 })` — returns `[startId, …, targetId]` or `null` if unreachable. Crosses map/interior boundaries freely; exits JSONB is the graph.
- `getZonesInRadius(startId, radius)` — BFS out to `radius` hops; returns a `Map<zone_id, distance>`.

## Channels

[channels.js](../server/engine/channels.js) — radio-style communication channels persisted as recent-message histories.

**Built-in channels:**

| Channel | Access | Notes |
|---|---|---|
| `#system` | All players | Server-only broadcast — players cannot send |
| `#arcnet` | admin/dev/builder/designer roles | Staff chat |

`CHANNEL_DEFS` is the definition registry (id, `permanent`, `systemOnly`, `isMember(player)`). New channels are added here.

- `getPlayerChannels(player)` — the channels a player should subscribe to on login.
- `sendToChatChannel(channelId, msg, broadcast)` — send to all eligible online players.
- `saveChannelMessage(channelId, msg)` / `getChannelHistory(channelId)` — persist and replay last 50 messages per channel (stored in `channel_history` table).

## Appearance

[appearance.js](../server/engine/appearance.js) — character physical description, generated once at character creation and stored on the player row.

- `generateAppearance()` — returns a random appearance object: `{ hair_style, hair_length, hair_color, eye_color, height, weight, biological_sex }`. Hair length is constrained by style (mohawks can't be very long, etc.).
- `describeAppearance(player)` — builds a prose description string from the stored appearance fields for use in `look <player>` output.

## Locks

[locks.js](../server/engine/locks.js) — extensible lock type registry. Separates lock *type* definitions from the *auth logic* that resolves whether a player can open a given lock.

- `registerLockType(shortName, { tagType, kitTag, defaults, authFn })` — registers a lock type. The doors plugin calls this for `hololock`, `keypad`, etc.
- `resolveLockAuth(lockTag, door, player)` — dispatches to the auth function registered for `lockTag.type`. Returns `true` if the player is authorized.
- `getAllLockTypes()` — used by the dev panel's door editor to populate the lock type dropdown.

Lock type definitions live in the doors plugin ([plugins/doors/index.js](../plugins/doors/index.js)); the lock registry in `locks.js` is the extensibility seam, not the implementation.

## Tunables

[tunables.js](../server/engine/tunables.js) caches the `combat_config` table at first use
(`ensureTunables`). `getTunable(key, default)` returns the cached value or the default. The dev panel
edits these rows and calls `reloadTunables()`. Combat, skills, and IP all read their balance knobs here
(body-part weights, crit/dodge/soak factors, learn rates, stat-cost curve). See [combat.md](combat.md)
for the specific keys.
