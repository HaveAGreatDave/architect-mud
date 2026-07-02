# Posture & Sitting (as built)

Posture is a **split system**: the [interactions plugin](../plugins/interactions/index.js) owns the
*state* (what the player types), and the engine owns the *reactions* (HP regen and the
stand-up triggers in the game loop, movement, and combat). This doc is the contract between the two
halves — if they drift apart, sitting silently breaks (it has before; see _History_ below).

## Single source of truth

Two fields on the live player object (`world.players` map entries), both **runtime-only** — never
persisted to the `players` table:

| Field | Type | Meaning |
|---|---|---|
| `player.posture` | `"standing"` \| `"sitting"` \| `"lying"` \| `"kneeling"` \| `"scavenging"` \| `"butchering"` | current posture; absent = `"standing"`. The last two are **activity postures** owned by their plugins ([scavenging](systems-scavenging.md), butchering) — the posture string is the authoritative activity flag, and a companion state object (`scavengeState` / `butcherState`) carries the bookkeeping; when posture stops reading the activity value, the owning plugin's tick discards the stale state. |
| `player.sittingOn` | `string \| null` | furniture name when sitting on a piece; `null` = the ground |

**Anything that reads or changes posture uses these two fields.** Do not reintroduce a parallel
boolean (an old dead `player.sitting` engine field caused the original bug). `player.posture` is the
truth; `player.sittingOn` is only meaningful while `posture === "sitting"`.

## Who sets it (the plugin)

`plugins/interactions/index.js` registers the posture verbs `sit`, `stand`, `lie`, `kneel` (plus
`pace`, which forces standing). They mutate state via `setLivePlayer(player.id, { ...player, posture,
sittingOn })`:

- **`sit`** — optional furniture target (`sit on <name>` / `sit <name>`). Furniture must have the
  `sit` interaction flag (`flags.interactions` includes `"sit"`, set in the dev panel furniture
  editor). With no target it auto-picks any sittable furniture in the zone, else the ground.
  Sets `sittingOn` to the furniture name, or `null` for the ground.
- **`stand` / `lie` / `kneel` / `pace`** — set their posture and clear `sittingOn` to `null`.

The **scavenging** and **butchering** plugins set their activity postures the same way
(`setLivePlayer` with `posture` + their companion state object) — see the
[plugin index](plugins.md) rows for each.

> `setLivePlayer` **replaces** the map entry with a fresh object (`{ ...player }`). That's fine because
> every command re-fetches the live player from `world.players` at dispatch time, and the game loop
> iterates the map directly — both always see the current object. Don't cache a player reference
> across an `await` that might span a `setLivePlayer`.

## Who reacts (the engine)

| Behaviour | Location | Rule |
|---|---|---|
| **HP regen** | `gameLoop.js` `sittingRegenTick` (`15s` cadence) | While `posture === "sitting"` and not in combat, heal `SIT_REGEN_HP` (5) up to `hp_max`. In combat (`combatTargetId`/`pvpTargetId` set) → force stand instead. |
| **Stand when attacked (PvE)** | `gameLoop.js` enemy-attack handler | On any hit *attempt*, if `posture !== "standing"` (sitting, lying, kneeling, or an activity posture) → set standing, clear `sittingOn`, notify. Activity plugins' ticks then discard their own state. |
| **Stand when attacked (PvP)** | `gameLoop.js` `pvpSwing` handler | Same, against the defender. |
| **Stand when you attack** | [`plugins/weapon/index.js`](../plugins/weapon/index.js) `cmdAttack` | Initiating an attack clears any non-standing posture. |
| **Stand on zone change** | `commands/movement.js` `cmdMove` | Moving zones forces standing + clears `sittingOn` (unconditional). |
| **Reset on death/respawn** | `gameLoop.js` death handler | `posture = "standing"`, `sittingOn = null`. |
| **Look/examine description** | `commands/world.js` `describePlayerAppearance` | `"sitting"` → `"<X> is sitting on the <furniture|ground>."`; `"scavenging"` → rummaging line; `"butchering"` → elbow-deep-in-a-carcass line. |
| **`poop on <player>` gate (MIS)** | `commands/bodily.js` `cmdPoop` | Target must be sleeping/offline-sleeping or `posture === "lying"`. |

## Tunables

- `SIT_REGEN_HP` = 5 HP per tick, `15s` cadence (`gameLoop.js`). 5 HP / 15 s.

## History / why this doc exists

Originally there were **two disconnected sitting systems**: the interactions plugin set
`player.posture`, while the engine's regen/stand logic watched a separate `player.sitting` boolean the
plugin never set. Because [plugins win command dispatch](plugins.md#-command-precedence--plugins-win-over-engine-builtins),
the engine's `bodily.js` `sit` handler (which set `player.sitting`) was dead code — so HP never
regenerated and nothing stood the player up. The fix unified everything onto `player.posture`. If you
add a posture-aware behaviour, key it off `player.posture`, and add a row to the table above.

A later audit removed the last remnants of that split: `bodily.js` still carried dead `cmdSit`/
`cmdStand` handlers (registered as `sit`/`stand` but never reached, since the plugin wins dispatch)
that read/wrote the dead `player.sitting` boolean — both deleted. The `poop on <player>` gate also
read a never-written `tp.lying` boolean; it now reads `tp.posture === "lying"`.
