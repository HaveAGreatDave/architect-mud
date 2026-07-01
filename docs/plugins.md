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
| **interactions** | Posture (sit/stand/lie/kneel), emotes, social actions, furniture interaction, `examine surroundings` | `sit stand lie kneel stretch wave shrug point smile frown laugh cry sigh nod shake dance pace greet follow reflect examine lean` | Sets `player.posture` + `player.sittingOn` via `setLivePlayer`. Engine reacts (HP regen, stand-on-attack/move) — see [systems-posture.md](systems-posture.md). **Poker bridge:** when the room has a poker table, `sit <chair>` / `sit at the poker table` dispatches the `gametable.take_seat` action (using the chair's `seat_idx` flag) instead of posturing, and bare `sit` SIFT-prompts *floor vs the poker table* (replayed via the `interactions.sit_choice` action). No import of gametable — the coupling is purely through the action registry |
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
| **weather** | Seeded 7-day forecast; owns `weather_forecast` table. Also owns the moving per-zone **weather field** (cloud/storm cells drifting over `map_world`) — injects a `sampleWeatherAt(x,y)` sampler into the engine via `registerWeatherField`; the engine samples it in `getZoneTemperature`/`getZonePrecip`/`getZoneStormIntensity`/`getZoneVisibility`. No new table (field re-derives from the day's seed). | — | tick (30s advect) |
| **zone-validator** | Zone exit-connectivity integrity checks | — | startup/validation |
| **atm** | ATM terminals — power-aware, faction-networked, hackable, finite cash stock | `atm deposit withdraw jack` | USE specialized action (tag `atm`); replenish tick every 5 min. Owns `deposit`/`withdraw` outright — the matching engine `economy.js` handlers were removed |
| **bulletin** | Town-square leaderboard board — `read` it for the top 5 survivors by total XP | — | READ specialized action (furniture tag `bulletin`); ranks `bonus_xp + SUM(player_skills.ip)`, ties broken by older `created_at` |
| **shove** | Force a player or corpse into an adjacent room | `shove drag` | Contested 2d8 of actor brawn vs. target carried-weight(kg)/3 (rounded up). Validates the exit first; on success reuses engine `cmdMove` for both parties with `{bypassEncumbrance:true}` (relocates corpses via `moveCorpse`); 60 s cooldown only on failure. Player gating mirrors `attack` (forcefield apartments block) |
| **scavenging** | Perpetual, posture-based search — per-zone loot tables, the 2d8−2d8 Scavenging check, lazy weighted replenish | `scavenge` | Sets `player.posture="scavenging"` + runtime `scavengeState`; engine reads it in `describePlayerAppearance` and clears it via the usual force-stand triggers. 1s plugin tick drives 3.5s attempts. Owns `scavenging_tables`/`_items`/`_zone_stock`/`_zone_state`. See [systems-scavenging.md](systems-scavenging.md) |
| **broadcast** | Media framework — scripted channels, dynamic news, VINE graph scripts, camera feeds, NPC hosts; TV popup presentation layer | `tune watch listen tv` | USE specialized action (tag `broadcast_receiver`); broadcast tick every 5 s; event consumers (`player.death`, `flag.set`, `npc.broadcast_say`); exposes `hasChannelViewers` via broadcast-bridge for AI conditions; `tv`/`watch tv` opens in-page TV panel |
| **pinch** | Wake an offline-sleeping player and path them home; `.gohome` auto-walks a live player home then sleeps them | `pinch .gohome` | `pinch` targets offline_sleeping players with a `home_zone` not in that home — clears offline_sleeping, starts BFS walk (1 zone/min via `tick.minute` hook). `.gohome` sets `player.goingHome=true`; same hook steps them via `cmdMove {bypassEncumbrance}`; arriving puts them to sleep at home rest rates. Type `.gohome` again to cancel |
| **gametable** | Multiplayer poker (Texas Hold'em); manages buy-in/cash-out, 4-seat game loop, turn timers, area-pane table view | `join seat leave spectate watch look say help check call bet raise fold allin table board pot players showhand` | Intercepts bare `look` while seated to push `{ type: 'poker_update', html }` instead of room HTML — area pane locked to table view. Intercepts `say` for seated players to float the line as an on-table speech bubble, then falls through so the engine still logs/broadcasts it. Credits deducted on join, returned on leave. Verbs are poker-specific aliases where the natural word is owned elsewhere: `seat <n>` buys in / moves seats (posture owns `sit`), `spectate` watches (broadcast owns `watch`); `raise` falls through to the engine's spend-IP command when the player isn't seated. `leave` cashes out (folding first if mid-hand) and reverts the leaver's area pane to the room look. `seat` with no number drops you in the first open seat. The pane carries a clickable command bar (`data-cmd`/`data-fill` relayed by a delegated handler on `#area-content` in `main.js`); labels are aliases where the verb collides (`sit`→`seat`, `watch`→`spectate`), and a `help` button shows a how-to-play card. Bare `help` while seated/spectating shows that same poker help (and falls through to engine help otherwise, like `raise`). Exposes a `gametable.take_seat` action so the **interactions** `sit` command can seat a player on a poker chair (`params.seatIdx`, or first-open when omitted). gametable also **takes over `watch`** (it loads after broadcast, so it wins the command Map): TV-only rooms delegate straight back to `broadcast.commands.watch`, poker-only rooms spectate, and rooms with **both a TV and a poker table** disambiguate via SIFT (selection replay routed through the `gametable.watch_choice` action, since SIFT's builtin replay path doesn't cover plugin verbs). The dealer has an on-table speech bubble: every action/street/win is narrated through it (`_dealerSay`), plus flavor quips (`DEALER_LINES`) at key moments and idle chatter via the plugin tick. When a single player sits waiting for the table to fill, the dealer gets chattier (`WAITING_LINES` via `dealerWaitingBanter`, ~every 30 s): it chats the lone player up, heckles other players in the room (`getZonePlayers`) to sit down, or — if the room's empty — jokes about the emptiness. Bets render as denominated ₵ bills/coins (100/50/20/10/5 notes + 1 ₵ coins, `denominate()` in `render-pane.js`): a pile tosses onto the felt in front of the bettor (`_betAnimPlayer`) and sweeps to the central pot when the street ends (`_sweepAnim`). Owns `game_tables` DB table (JSONB state, persisted every 10 s and on hand end). See `plugins/gametable/` |

A plugin with no player verbs and no specialized actions integrates purely through **hooks**
(request/response into engine flows) or **ticks** (scheduler cadences).

## When a system spans engine and plugin

Some mechanics are split: a plugin owns the **state** (what the player typed sets it) and the engine
owns the **reactions** (loops, combat, movement that read it). Posture is the canonical example. When
that happens, the plugin and engine **must agree on the field name and shape** — a mismatch makes one
half silently dead. Document the contract in the relevant `docs/systems-*.md` and run the
[source-of-truth audit](audits/source-of-truth-audit.md) when in doubt.
