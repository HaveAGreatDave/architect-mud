# Plugins — Index

Every folder in `/plugins/<name>/` is a self-contained unit (manifest + `index.js`). This is the
fast lookup: **which plugin owns a given verb or mechanic, and how it hooks into the engine.** For the
manifest schema and README convention, see [plugin-standard.md](plugin-standard.md). For the load
mechanism, see `server/engine/plugins.js`.

## ⚠️ Command precedence — plugins win over engine builtins

This is the single most important thing to know before editing any player command. The dispatch order
in `server/engine/commands/index.js` (`handleCommand`) is:

1. SIFT selection-state intercept
2. **`fireCommand(cmd, …)` — plugin-registered commands** ← runs first
3. `fireSpecializedAction(cmd, …)` — tag-gated specialized actions (also plugins)
4. `use` cosmetic-machine pre-intercept
5. **`builtins.get(cmd)` — engine handlers** in `server/engine/commands/*.js` ← runs last

So if a plugin registers a verb (e.g. `sit`), the matching handler in `server/engine/commands/*.js`
is **dead code** — it never executes. A verb can have an engine handler *and* a plugin handler; the
plugin always wins. When a command "doesn't behave like the engine code says," check the plugin
registry **first**. (This exact trap caused the posture/HP-regen bug — see
[systems-posture.md](systems-posture.md).)

To list what's actually registered at runtime: `getRegisteredCommands()` in `plugins.js`.

## Plugin catalogue

| Plugin | Owns | Player verbs | Engine surface |
|---|---|---|---|
| **interactions** | Posture (sit/stand/lie/kneel), emotes, social actions, furniture interaction, `examine surroundings` | `sit stand lie kneel stretch wave shrug point smile frown laugh cry sigh nod shake dance pace greet follow reflect examine lean` | Sets `player.posture` + `player.sittingOn` via `setLivePlayer`. Engine reacts (HP regen, stand-on-attack/move) — see [systems-posture.md](systems-posture.md) |
| **crafting** | Recipe display & item crafting | `craft recipes` | — |
| **factions** | Faction reputation display | `factions rep` | — |
| **mutations** | Radiation-triggered mutations | `mutations` | tick check |
| **quests** | Quest lifecycle + objective tracking | `quests quest ql` | Actions + event consumers; owns `quests`, `player_quests` tables |
| **dev-tools** | Admin/dev utilities | `.dresscyd` | admin-only |
| **container** | OPEN on containers | — | specialized action (tag-gated) |
| **fillable** | FILL/EMPTY fluid containers; DRINK from them | `fill empty` | specialized actions gated on the `fillable` capacity tag. Holds fluid amount + type in `player_inventory.custom_data`. `drink <container>` lands here; bare `drink`/`drink from <source>` falls through to the **water** plugin. Filling a non-empty unit splits it off the stack (filled = unique). Thirst-per-unit is a fluid property (`FLUID_RATES`, water=1), applied on DRINK |
| **doors** | OPEN/CLOSE/LOCK/UNLOCK | — | specialized actions (tag-gated) |
| **drugs** | USE/INJECT | — | specialized actions (tag-gated) |
| **food** | EAT | — | specialized action (tag-gated) |
| **water** | DRINK from furniture | — | specialized action gated on the `water_source` capability tag; resolves a named (or any) water-source furniture in the zone, restores thirst, else falls through to item DRINK. WASH at a water source is handled engine-side in `mis.js` (it now recognises `water_source`, not just `object_type='sink'`) |
| **lighting** | SWITCH/FLIP/TURN on switchable lights | — | specialized actions (tag-gated) |
| **weapon** | ATTACK (player path) | — | specialized action (tag-gated) |
| **clothing-wetness** | Per-item wetness from rain/snow, body-temp effect | — | tick + hook |
| **weather** | Seeded 7-day forecast; owns `weather_forecast` table | — | tick |
| **zone-validator** | Zone exit-connectivity integrity checks | — | startup/validation |
| **atm** | ATM terminals — power-aware, faction-networked, hackable, finite cash stock | `atm deposit withdraw jack` | USE specialized action (tag `atm`); replenish tick every 5 min. Owns `deposit`/`withdraw` outright — the matching engine `economy.js` handlers were removed |
| **bulletin** | Town-square leaderboard board — `read` it for the top 5 survivors by total XP | — | READ specialized action (furniture tag `bulletin`); ranks `bonus_xp + SUM(player_skills.ip)`, ties broken by older `created_at` |
| **broadcast** | Media framework — scripted channels, dynamic news, VINE graph scripts, camera feeds, NPC hosts | `tune watch listen` | USE specialized action (tag `broadcast_receiver`); broadcast tick every 5 s; event consumers (`player.death`, `flag.set`, `npc.broadcast_say`); exposes `hasChannelViewers` via broadcast-bridge for AI conditions |

A plugin with no player verbs and no specialized actions integrates purely through **hooks**
(request/response into engine flows) or **ticks** (scheduler cadences).

## When a system spans engine and plugin

Some mechanics are split: a plugin owns the **state** (what the player typed sets it) and the engine
owns the **reactions** (loops, combat, movement that read it). Posture is the canonical example. When
that happens, the plugin and engine **must agree on the field name and shape** — a mismatch makes one
half silently dead. Document the contract in the relevant `docs/systems-*.md` and run the
[source-of-truth audit](audits/source-of-truth-audit.md) when in doubt.
