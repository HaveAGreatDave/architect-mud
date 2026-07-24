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

### Stance is not posture

`player.combat_stance` ([stance.js](../server/engine/stance.js), see [combat.md](combat.md)) is a
**separate, orthogonal** field with its own substrate deliberately modelled on this one. Posture is
what your body is doing; stance is how you're fighting. You can be cautious while standing or
cautious while kneeling — collapsing them into one field would recreate exactly the bug class this
doc exists to prevent. `forceStand` does **not** touch stance, and nothing in the stance path reads
posture.

## Who sets it (the plugin)

`plugins/interactions/index.js` registers the posture verbs `sit`, `stand`, `lie`, `kneel` (plus
`pace`, which forces standing). **All posture writes go through the engine substrate API in
`server/engine/posture.js`** — `setPosture(player, posture, { sittingOn })` and
`forceStand(player, reason)`. Never assign `player.posture` directly and never clone-and-replace via
`setLivePlayer` for posture: the game loop holds direct object references while it ticks, and a
replaced object silently orphans them.

- **`sit`** — optional furniture target (`sit on <name>` / `sit <name>`). Furniture must have the
  `sit` interaction flag (`flags.interactions` includes `"sit"`, set in the dev panel furniture
  editor). With no target it auto-picks any sittable furniture in the zone, else the ground.
  Sets `sittingOn` to the furniture name, or `null` for the ground.
- **`stand` / `lie` / `kneel` / `pace`** — set their posture; `setPosture` clears `sittingOn` unless
  passed explicitly.

The **scavenging** and **butchering** plugins set their activity postures the same way
(`setPosture` + their companion state object mutated in place) — see the
[plugin index](plugins.md) rows for each.

Every transition emits a `posture.changed` event (`{ player, from, to, forced?, reason? }`), so a
system can react to being interrupted without polling; the activity plugins' 1s ticks also still
notice the flip and discard their stale state.

`forceStand(player, reason)` is **the** interruption trigger — attack initiation (weapon plugin),
incoming hits (gameLoop PvE + PvP), movement (`cmdMove`), waking — and clears ANY non-standing
posture. It returns the interrupted posture (or `null` if already standing), which callers use to
gate their messaging.

## Who reacts (the engine)

| Behaviour | Location | Rule |
|---|---|---|
| **Stamina + HP regen** | `gameLoop.js` `restRegenTick` (`15s` cadence) | Stamina recovers first, and only after the player has been idle (no move) for `IDLE_REGEN_MS` (8 s) — `STAND_STAMINA_REGEN` (1) per tick standing, `SIT_STAMINA_REGEN` (6) while sitting, both scaled by `tempRegenMultiplier`. HP heals `SIT_REGEN_HP` (3) per tick **only while `posture === "sitting"` and stamina is at max**. In combat (`combatTargetId`/`pvpTargetId` set) while sitting → force stand instead. `cmdMove` stamps `player._lastMoveAt`; the resource tick (`1m`) still applies temperature *drains*. |
| **Stand when attacked (PvE)** | `gameLoop.js` enemy-attack handler | On any hit *attempt*, `forceStand(target, 'attacked')` clears any non-standing posture and notifies. Activity plugins' ticks then discard their own state. |
| **Stand when attacked (PvP)** | `gameLoop.js` `pvpSwing` handler | Same, against the defender. |
| **Stand when you attack** | [`plugins/weapon/index.js`](../plugins/weapon/index.js) `cmdAttack` | `forceStand(player, 'attacking')` on attack initiation. |
| **Stand on zone change** | `commands/movement.js` `cmdMove` | `forceStand(player, 'moved')` (unconditional); the "stands up" room message fires only when the interrupted posture was `sitting`. |
| **Reset on death/respawn** | `gameLoop.js` death handler | `setPosture(player, 'standing')`. |
| **Look/examine description** | `commands/world.js` `describePlayerAppearance` | `"sitting"` → `"<X> is sitting on the <furniture|ground>."`; `"scavenging"` → rummaging line; `"butchering"` → elbow-deep-in-a-carcass line. |
| **`poop on <creature>` lying gate** | `plugins/bodily/index.js` `startRelief` / `isLyingTarget` | Pooping on a creature requires the target be sleeping/offline-sleeping or `posture === "lying"`. Qualifying targets: a lying/sleeping player, or a sleeping-at-home NPC (`AT_HOME_LIFE` sets `posture:"lying"`). Enemies have no posture, so they never qualify. No MIS gate. |

## Tunables

- `IDLE_REGEN_MS` = 8 s idle grace before stamina recovers.
- `STAND_STAMINA_REGEN` = 1 / tick (standing, idle), `SIT_STAMINA_REGEN` = 6 / tick (sitting), `15s` cadence (`gameLoop.js`).
- `SIT_REGEN_HP` = 3 HP per tick, only while sitting **and** stamina is full. 3 HP / 15 s.
- `flags.rest_multiplier` (zone flag, default 1) — scales **both** stamina regen and HP knit-back for anyone resting in that zone (`restRegenTick`). Authored on comfort zones: luxury apartments (Solenne units 1.5, penthouse 2.0). Reusable for any future safehouse/comfort space; no code change to add more.

## NPCs use the same substrate

Posture is not player-only. NPCs (live world-cache entities) carry the same
`posture`/`sittingOn` fields, written through the same `server/engine/posture.js`
API — never a parallel field. The [`AT_HOME_LIFE`](ai-behaviour.md) AI node sets
`setPosture(entity, 'lying', { sittingOn })` when an NPC sleeps at home (bound to a
bed/couch in the room, or `null` for the floor) and clears to `standing` on wake.
Keep the two flags distinct: `entity._ai.homeSleeping` is *asleep* (mental);
`entity.posture === 'lying'` is the *physical stance* — the seam for future
"lie down but stay awake" cases. The room-look NPC list and `examine <npc>` both
read these: `(sleeping)` when `homeSleeping`, else `(lying down)` for a bare
`lying` posture. `posture.changed` has no consumers today, so emitting it for an
NPC entity is harmless.

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
