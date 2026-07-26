# Engine/Plugin Boundary — Audit & Migration Proposal

**Status: Phases 0–2 built (ghost deferred); Phase 3 partially built — protection substrate + AI node registry done, vendor-life and housing extractions next.** Produced 2026-07-02 from a full audit of `server/engine/` (~17,600 lines).

> **Inherited backlog (added 2026-07-24).** This doc supersedes the earlier
> [reference/plugin-architecture-analysis.md](../reference/plugin-architecture-analysis.md)
> (2026-06-21/22), whose nine-item roadmap has since resolved six ways. Its **three unresolved
> items** are recorded here so they don't die with a doc nobody reads — all three verified still
> open on 2026-07-24:
> - **Drug/mutation effects never unified with `effects.js`.** `server/engine/drugs.js:583` keeps a
>   local `applyEffects` applying stat deltas its own way, parallel to the engine's `applyEffect`.
>   Two applicators, slightly different semantics — the older doc called this out and it survived
>   the extraction to `plugins/drugs/`.
> - **No dev-panel UI registration.** A plugin still cannot add a tab or a panel section; every
>   dev-panel feature is a hand edit to `client/devpanel/`. The 2026-06 pass called this the
>   highest-leverage missing API for this codebase specifically, and it is still unbuilt.
> - **Power-grid simulation still in the engine.** `simulatePowerNetwork`
>   (`server/engine/environment.js:1217`) is a self-contained sim that reacts to ticks — a plugin
>   shape by the litmus tests in §2. Routes stay core either way.
>
> Everything else from that doc landed: `engine/economy.js` + `adjustCredits`, `engine/inventory.js`,
> `player.create`/`login`/`logout` hooks, and the lighting/crafting/drugs plugins.

> **Phase 3 log (2026-07-02):**
> - **Protection substrate built** — `engine/protection.js` (`registerProtectionProvider`/`getZoneProtection`,
>   sync-by-contract provider chain). apartments.js publishes forcefields through it; the four law sites
>   (weapon live-attack + offline-sleep-swing, shove, loot) now consult the substrate instead of reading
>   `getApartment().forcefield_active`, and the **steal gap is closed** — thievery consults the same law
>   (verified in the harness with a decoy player in a shielded zone). Corp territory / wards later = one
>   provider registration, zero law changes.
> - **AI node registry built** (E3) — `registerAICondition`/`registerAIAction` in ai-behaviour.js; unknown
>   node types fall through to plugins (conditions sync-by-contract, actions may be async and return
>   port strings). The broadcast plugin's four nodes (`CHANNEL_HAS_VIEWERS`, `IS_BROADCAST_SCHEDULED`,
>   `AT_WORK_ZONE`, `BROADCAST_SAY`) moved out of the engine switches as the first users.
> - **Deferred to focused follow-ups** (each is now purely mechanical against an existing seam, but big):
>   (a) **vendor-life nodes** — GO_TO_WORK / CHECK_WORK / AT_WORK / HAVE_LIFE / CHECK_VENDOR_WORK /
>   VENDOR_CHITCHAT / AT_HOME_LIFE / VENDOR_GO_TO_ATM / VENDOR_DEPOSIT / IS_VENDOR_WORK_TIME plus the
>   schedule helpers (~350 lines of commute/home-life logic entangled with the patrol blackboard);
>   should ship with a tick-level test rig (fake NPC + graph through `tickEntityAI`).
>   (b) **housing plugin** — apartments.js + housing verbs + rent tick, now that forcefields publish
>   through the protection substrate; remaining tendrils to cut: describe.js status lines,
>   doors.js↔apartment lock sync, hololock auth, the wake path.
> - Gate after this batch: **29/29**.

> **Phase 2 completion log (2026-07-02, second batch):**
> - **Bodily extracted** → `plugins/bodily/`. The old `engine/bodily.js` split along the substrate line:
>   stains (`stainClothing`/`stainZone`) and digestion loads (`foodLoad`/`drinkLoad`/`applyThirst`) stay
>   engine (written/read by mis, butchering, drugs, water, fillable, inventory); the pressure tick,
>   involuntary release, and pee/poop/flush verbs moved. The plugin's 1m tick skips sleeping players,
>   mirroring the engine tick it replaced. The toilet/sink `use` panels (`bodilyUseHandler`) were **dead
>   code** — exported but never wired — and are now live as a self-gated `use` specialized action (named
>   targets only; bare `use` stays with the inventory builtin). SIFT on-player replays go through
>   `bodily.pee_target`/`bodily.poop_target` Actions.
> - **Commerce extracted** → `plugins/commerce/` (shop/browse/buy/sell/balance). Vendor *services* stay
>   engine per the plan. Both SIFT replay sites converted to Actions (`commerce.shop_vendor`,
>   `commerce.buy_item`).
> - **Ghost deferred, deliberately.** It is not a verb set — ghost is a WS session *mode*: server/index.js
>   calls `cmdGhostLook/Move/Haunt/PowerDrain` directly on session objects, bypassing `handleCommand`
>   entirely. Extracting it means inventing a session-mode extension point nothing else needs yet. Revisit
>   if a second session mode appears (spectator, admin-eye).
> - Regression gate after both extractions: **24/24** across the three layers; 38 plugins boot clean.

> **Phase 2 log (2026-07-02):**
> - **MIS extracted** → `plugins/mis/` (~1,600 lines out of the engine). The engine keeps only the consent
>   substrate (`isMisActive`/`isAttractedTo`/server setting in the slimmed `engine/mis.js`). Seams used:
>   plugin commands + input matchers (verbs), `player.stop` event (unified stop), new `mis.toggled` event
>   (WS Maturity-Slider handler in server/index.js now just emits), `1m` scheduler tick (horniness decay,
>   out of gameLoop), and a new `player.appearanceMisNotes` hook that `describePlayerAppearance` fires at
>   its two MIS sites (the plugin owns the prose + arousal-on-examine). Note: `wash` (including blood)
>   moved with it — disabling the mis plugin also disables washing blood off.
> - **Thievery extracted** → `plugins/thievery/` with both discovery-log fixes: cooldown persisted in the
>   Flag store (survives restarts), SIFT ambiguous pick replays via the `thievery.steal` Action instead of
>   the builtin replay path.
> - **Cosmetic-machine extracted** → `plugins/cosmetic-machine/`; the hardcoded `use` pre-intercept
>   (dispatch step 5) is **gone** — the plugin self-gates a `use` specialized action; the engine furniture
>   router opens the panel via the `cosmetic.open` Action.
> - **Regression harness added and codified as the pre-deploy gate** — `npm run test:regress`
>   (`tests/regress.js`), three layers: (1) automatic manifest-contract sweep across all plugins
>   (declared commands registered, declared hooks handled), (2) core engine checks driven end-to-end
>   through `handleCommand` (dispatch order, posture substrate, move-gate chain), (3) per-plugin
>   `plugins/<name>/regress.js` suites (optional default-export; never loads in production —
>   convention in docs/plugin-standard.md, when-to-run policy in CLAUDE.md "Regression testing").
>   mis/thievery/cosmetic-machine ship the first three suites. 17/17 green. Deliberately NOT run at
>   production boot (same principle as no startup migrations). Pool caveat resolved: the recurring
>   EMAXCONNSESSION was an orphaned local `node server/index.js` from a prior session — killed.

> **Implementation log (2026-07-02):**
> - **Phase 1 done** — dead `stop`/`disengage` builtins deleted (commands/combat.js, commands/mis.js), proof-of-life
>   subscribers removed (actions.js), shared `engine/directions.js` created (mapValidation, ai-behaviour, movement,
>   api/routes now import it). Corrections found while verifying: `cmdSwitch`/`cmdTurn` are NOT dead (the lighting
>   plugin delegates to them); `checkMutationTrigger` is NOT dead (mutations plugin tick calls it); the gameLoop
>   auto-attack `break` is a top-of-loop guard, not a per-target bug. NPC-archetype→DB and precipitation-table moves
>   deferred (DB schema changes — do deliberately per CLAUDE.md).
> - **E1 done (gates)** — `engine/movement-gates.js`: `registerMoveGate(fn, owner)` veto chain runs before any move
>   mutation; engine's door-lock + encumbrance laws register through it (commands/movement.js); MOVE Action implemented
>   (dispatches cmdMove). Fixed in passing: doors used to open *before* the encumbrance veto, stranding them open.
>   Post-move reactive channel = existing `zone.entered` event (also fired by teleports); inline arrival effects
>   (radiation, weather attrition, battle cries, followers) stay in cmdMove for now.
> - **E2 done** — `registerInputMatcher`/`fireInputMatchers` in plugins.js; MIS multi-word verbs registered through it.
> - **E4 done** — `registerStatusEffect` registry in effects.js; core four effects are registrations.
> - **E5 done** — `engine/posture.js` (`setPosture`/`forceStand`/`getPosture`, in-place mutation, `posture.changed`
>   event); all live posture writes converted (gameLoop ×3, movement, commands/index wake, apartments ×2, weapon,
>   pinch, interactions ×8, scavenging, butchering).
> - **E6 done** — manifest `after:` (stable DFS load order), `critical: true` boot abort (weapon marked critical),
>   verb-collision warnings + builtin-shadow report at boot, `unschedule()` in scheduler.
> - **Found by the new collision detector:** the interactions plugin had silently stolen `watch` from gametable
>   (alphabetical load order) — poker spectating / TV routing via `watch` was dead at runtime. Fixed: gametable declares
>   `after:["broadcast","interactions"]` and its router now falls through to the interactions furniture emote in plain
>   rooms.
Goal: make it possible to add independent systems that interact emergently **without spelling out every
interaction** — the corpse-mule property (encumbrance + corpses + shove compose because each is a clearly
defined rule that never mentions the others), applied everywhere.

---

## 0. Why the corpse mule works (the model for everything else)

Decompose the example:

- **Encumbrance** is a *law*: `carried weight > capacity` blocks MOVE. It doesn't know what made you heavy.
- **A corpse** is an *entity on a substrate*: it has weight, position, and containment. It doesn't know it can be shoved.
- **Shove** is a *system*: contested roll vs. carried weight, then reuses `cmdMove` with `bypassEncumbrance`. It doesn't know what's inside the corpse.

Three pieces, zero pairwise special cases. They meet only in shared **substrates** (weight, position,
containment) and a **law** the engine enforces uniformly. That's the whole thesis: emergence is cheap when
systems write to substrates and laws read them; emergence is O(N²) hand-written code when systems check for
each other by name (which is what `cmdMove` does today — it hardcodes eight different systems' checks inline).

## 1. Audit: what's in the engine today

Full per-file detail lives in the audit transcripts; this is the classification that matters for the plan.

### Clean engine (keep as-is)
| File | Why it stays |
|---|---|
| `plugins.js`, `events.js`, `actions.js`, `flags.js`, `tags.js`, `supertags.js`, `specializedActions.js`, `scheduler.js`, `sift.js`, `graph.js` | The registries and buses — the coupling channels themselves |
| `combat.js` | Combat *math* (swing rolls, soak, cooldown ledger, enemy AI swings) — a law layer; verbs already extracted to the weapon plugin per ADR-0001 |
| `statmods.js` | Reversible stat-delta ledger. **Gold standard substrate API** — the model for posture, stains, cooldowns |
| `exits.js` | Zone-exit accessor substrate: normalizes the polymorphic `exits[dir]` value (string \| array — one direction, multiple exits) so every reader (movement, describe, pathfinding, sounds, apartments, validators) shares one shape. `exitTargets`/`allExits`/`neighborZoneIds`/`primaryExits` + `addExit`/`removeExit` |
| `skills.js`, `ip.js`, `economy.js`, `factions.js`, `crafting.js`, `vendor.js`, `vendor-session.js`, `furniture-shop.js`, `inventory.js` (engine), `locks.js`, `lockAuthHandlers.js`, `appearance.js` | Generic rule engines over DB-driven content; no hardcoded world knowledge |
| `sounds.js`, `pathfinding.js`, `mapValidation.js`, `world.js` (store), `broadcast-bridge.js`, `motd.js`, mail/verification | Physics, graph traversal, state store, injection adapters |

### Mixed (engine core with mechanics embedded)
| File | Engine part | Embedded mechanic |
|---|---|---|
| `gameLoop.js` (1027) | Tick orchestration, death/respawn, corpse lifecycle | Temperature-drift constants, starvation damage, sitting regen, horniness decay, rent collection, NPC wander fallback, battle-cry throttling, ashfall choking |
| `environment.js` (2354) | Clock, power network sim, lighting/visibility, indoor thermal model, weather-field sampling seam | Storm generator faults, precipitation intensity tables (duplicated in clothing-wetness), extreme-weather hazard application |
| `ai-behaviour.js` (1295) | VINE tree runner, blackboard, entity movement | Vendor work-schedule nodes (`IS_VENDOR_WORK_TIME`, `GO_TO_WORK`, `HAVE_LIFE`), broadcast nodes (`AT_WORK_ZONE`, `BROADCAST_SAY`) hardcoded in the switch |
| `commands/index.js` | Dispatch pipeline, unified `stop` | MIS multi-word regexes, cosmetic-machine `use` pre-intercept, apartment-forcefield-on-wake |
| `commands/movement.js` | MOVE core | Eight inline cross-system checks (see §3.1) |
| `effects.js` | Status-effect tick loop | The four effect definitions hardcoded (`EFFECT_DEFS`) |
| `drugs.js` | Phased-effect machinery over statmods | Tolerance/addiction curve constants baked in |
| `channels.js` | Channel machinery | Hardcoded channel list |

### Whole systems living in the engine (extraction candidates)
| System | Where | Size | Leaf? |
|---|---|---|---|
| **MIS** (mature interactions) | `commands/mis.js` + `engine/mis.js` + gameLoop decay + appearance hooks | ~1,600 lines | Yes — nothing else reads horniness |
| **Bodily** (bladder/bowel) | `engine/bodily.js` + `commands/bodily.js` | ~430 | Yes — only stains escape it, and stains are a substrate |
| **Cosmetic machine** (MORPHEX) | `commands/appearance.js` | 277 | Yes |
| **Steal** | `commands/combat.js` | ~90 | Yes |
| **Ghost mode** | `commands/ghost.js` | 148 | Yes (dev feature) |
| **Shopping verbs** (`shop`/`buy`/`sell`) | `commands/economy.js` | 92 | Thin wrappers over clean engine services |
| **Apartments/housing** | `engine/apartments.js` + rent tick + housing commands | ~800 | **No** — forcefield is read by loot, attack, wake paths (see §4.1) |
| **NPC personality archetypes** | `npc-personality.js` | 721 | Pure content, zero logic — belongs in the DB, not in either code layer |
| **NPC banter** | `npc-banter.js` | ~170 | Yes, small; low priority |

### Dead code (verified)
- `cmdSwitch`/`cmdTurn`/`flip` builtins in `commands/world.js` — lighting plugin owns these verbs.
- `stop`/`disengage` handlers in `commands/combat.js` and `commands/mis.js` — shadowed by `cmdStopAll` (Map merge order in `commands/index.js`).
- Proof-of-life event subscribers in `actions.js:44-50` ("remove when events are tested").
- `MOVE` and `EXAMINE` Action placeholders in `actions.js` that return errors.

---

## 2. Proposal #1 — The boundary strategy

### The engine owns three things

1. **Substrates** — state that multiple unrelated systems read or write:
   position/exits, containment+weight, posture, vitals (HP/stamina/hunger/thirst/rads/sanity/body-temp),
   stats/skills/IP, credits, flags, tags, stains, light/visibility, ambient temperature, power, sound,
   cooldowns. Each substrate gets an **engine-owned mutation API** (the way `statmods.js` already works),
   never raw field pokes from plugins.

2. **Laws** — rules about how a substrate always behaves, regardless of which system touched it:
   encumbrance blocks MOVE, damage soaks through armor, sound falls off with distance, light gates what a
   room description shows, non-standing postures break on combat/movement, death → corpse → respawn.
   A law never names a system ("if scavenging…"); it only reads substrates.

3. **Registries and buses** — the coupling channels: commands, specialized actions, the Action dispatcher,
   events, hooks, scheduler, SIFT/FATE, the graph runner, provider injection (`registerPlayerCombat`,
   `registerWeatherField`), broadcast-bridge-style adapters.

### Plugins own systems

A plugin owns: the verbs players type, the activity state, the mechanic's rules and numbers, its own DB
tables, and its content. It touches the rest of the game **only** through substrates (via engine APIs),
laws (by putting weight/heat/light into the world and letting laws react), tags, Actions, events, and hooks.

### Litmus tests (apply in order)

1. **Substrate test** — do two or more unrelated systems need to read this value to make decisions?
   → engine substrate. (Posture: combat, movement, scavenging, butchering, bodily, appearance all read it → engine.
   Horniness: only MIS reads it → plugin.)
2. **Law test** — is this a rule about how a substrate behaves no matter who poked it? → engine law.
   (Starvation damage is a law over the hunger vital. Body-temp drift is a law over the temperature substrate.
   Keep them, even though they *feel* like "survival mechanics".)
3. **Leaf test** — if nothing outside the system reads its state, it's a leaf → plugin, however big.
   (MIS is 1,600 lines and still a leaf.)
4. **Total-conversion test** — would a different game built on this engine keep the code byte-identical?
   → engine. Would they retheme or retune it? → plugin or DB content. (SIFT: identical. Vendor archetype
   chitchat: rewritten. Drug tolerance curves: retuned → at minimum, tunables.)
5. **Verb test** — is it something a player *does*? → plugin. (The engine ends up with almost no verbs:
   look/examine/inventory/movement/communication/help/admin, per ADR-0001's "read-only commands stay plain
   handlers".)

### The interaction rule (this is what buys emergence)

> **Two systems may only meet in a substrate, a law, a tag, an Action, or an event. Never by importing
> each other, and never by an engine file naming a system.**

The existing precedents already prove each channel: interactions→gametable via the action registry,
loot→butchering via the `BUTCHER` Action, weather→engine via provider injection, dealer→say via a hook,
trip→drugs via events. The strategy is simply: *make these the only options*, and give the engine's own
laws the same discipline (an encumbrance law registered as a MOVE gate is testable, listable, and sits next
to the plugin-registered gates — no privileged inline checks).

### Anti-goal: don't over-extract

Extraction is not free — every split system carries the posture-bug risk (two halves silently disagreeing
on a field contract; see `docs/systems-posture.md`). The vitals laws, combat math, power simulation, and
thermal model **stay in the engine** because they're hubs: extracting them would just move the hub behind a
provider callback and add a contract to break. Extract leaves; anchor hubs.

---

## 3. Proposal #2 — Migration plan (out of the engine)

Phased so each step is independently shippable and each extraction lands on a seam built the phase before.
Run the [source-of-truth audit](../audits/source-of-truth-audit.md) after every split-system change.

### Phase 0 — Build the seams (enablers, no behavior change)

| # | Enabler | Unblocks |
|---|---|---|
| E1 | **MOVE becomes an Action with gates and effects.** Implement the `MOVE` placeholder in `actions.js`. Gates = ordered veto chain (`registerMoveGate(fn)` → `{block, message}` or pass); effects = post-move events. Port `cmdMove`'s inline checks into registered gates/effects — *the engine registers its own laws through the same mechanism* (encumbrance gate, door/lock gate, posture effect, combat-clear effect, weather-attrition effect, radiation effect, battle-cry effect, follower-drag effect). `bypassEncumbrance` becomes a named gate exemption in params. | Every future system that wants to touch movement (corps territory, wanted checkpoints, disease quarantine) attaches a gate instead of editing `cmdMove`. This is the flagship change. |
| E2 | **Raw-input matchers for plugins** — `registerInputMatcher(regex → handler)` in the dispatch pipeline, replacing the hardcoded `jerk off on` / `eat out` regexes. | MIS extraction (Phase 2). |
| E3 | **AI node registry** — `registerAICondition(type, fn)` / `registerAIAction(type, fn)`; the `ai-behaviour.js` switch falls through to the registry. | Vendor/broadcast node extraction (Phase 3). |
| E4 | **Status-effect registry** — `registerStatusEffect({name, label, onTick})`; `EFFECT_DEFS` becomes the engine's registrations. | Plugins add poison/frostbite/disease without engine edits. |
| E5 | **Substrate APIs**: `setPosture(player, posture, meta)` / `forceStand(player, reason)` in the engine (plugins stop raw-writing `player.posture`); a generic cooldown service (generalize combat.js's ledger); a stain API (`stainZone`/`stainClothing` formalized). | Kills the split-system bug class at the source (§4.1). |
| E6 | **Plugin manifest hardening**: optional `after: ["broadcast"]` load-order field; loader **warns on verb collisions** (plugin↔builtin and plugin↔plugin) at boot; `unschedule()`; plugin-load failure for a manifest-flagged `critical: true` plugin aborts boot. | Makes today's implicit facts (gametable beats broadcast alphabetically; weapon plugin failure silently disables combat) explicit and safe. |
| E7 | **Missing events**: `equipment.changed`, `device.destroyed`, `zone.stained`, `player.wake`. Cheap; emit where the mutation happens. | Reactive plugins instead of polling. |

### Phase 1 — Deletions and content moves (zero-risk)

1. Delete the verified dead code (§1 list). Keep the `cmdSwitch` export only if the lighting plugin actually delegates to it — verify first.
2. `npc-personality.js` → `npc_archetypes` DB table, edited in the dev panel; `getNpcChitchat` reads the cache. (~700 lines of pure content out of the engine; archetypes become live-editable.)
3. Precipitation intensity tables → weather plugin, which already owns the field; clothing-wetness reads the same source (currently duplicated).
4. Shared `directions.js` constant (DIR_OFFSET/OPPOSITE currently copy-pasted in `environment.js`, `ai-behaviour.js`, `mapValidation.js`, and 3× in `api/routes.js`).
5. Naked constants → `tunables.js`: sleep restore/drain rates, lock upgrade cost, sit-regen HP, dangerous-temp tick count, disengage grace, drug tolerance/addiction curve constants, MIS thresholds.

### Phase 2 — Leaf extractions (system by system)

Ordered by (value ÷ risk); each mirrors the scavenging/butchering template (plugin owns verbs + state +
tick; engine reactions read substrates).

1. **MIS plugin** — the big one. Moves `commands/mis.js`, `engine/mis.js`, the gameLoop horniness decay
   (plugin tick), the appearance-arousal hooks (a `player.examined` hook), and the MORPHEX MIS-gated options.
   Needs E2 (multi-word verbs). The server-wide `mis_enabled` flag becomes "is the plugin loaded + setting".
   Stains stay engine (substrate). Result: the most content-sensitive system in the game becomes deletable
   by removing a folder.
2. **Bodily plugin** — pressure ticks, pee/poop/flush verbs. Stains via the E5 stain API. Note the poop-on-player
   posture check must read the engine posture substrate, not its own copy.
3. **Cosmetic-machine plugin** — MORPHEX becomes a specialized action gated on a `cosmetic_machine` furniture
   tag, which deletes the hardcoded step-4 `use` pre-intercept in the dispatch pipeline entirely (the dispatch
   order becomes: SIFT → plugin commands → specialized actions → builtins, no special cases).
4. **Thievery plugin** — `steal`, with the cooldown moved to the E5 cooldown service (fixes the in-memory
   restart-reset bug in passing).
5. **Commerce plugin** — `shop/buy/sell` verbs; `vendor.js`/`furniture-shop.js` stay as engine services
   initially (same pattern as combat math), reconsider once stable.
6. **Ghost plugin** — self-contained dev feature.

### Phase 3 — Hub splits (substrate first, then extract)

1. **Housing**: introduce a generic **protection substrate** first — `zone.protected` (or a `protection`
   tag with a source), with laws: protected zones block attack/loot/steal by non-owners. Then the housing
   plugin owns rent, sleep, forcefield lifecycle, the HoloLock tutorial, and the rent tick. The payoff is
   bigger than housing: corp territory, safe zones, and future wards all reuse the same substrate instead of
   each re-implementing "check forcefield_active" (which today is checked on the loot path but — verify —
   possibly not uniformly on attack).
2. **AI vendor/broadcast nodes** → vendor-life plugin and broadcast plugin via E3. `DEFAULT_HOME_ACTIVITIES`
   and the work-schedule helpers go with them; the tree runner keeps only generic nodes (time, zone, HP,
   flags, movement).
3. **Weather-extreme hazard channels** — candidate for a `weather-extremes` plugin consuming the severity
   scalar (thermal/wind/blackout/ash application, storm generator faults). **Defer** until extreme-weather
   step 7 (EMP/acid rain) forces the file open anyway; the system is freshly built and stable.
4. **Enemy threat escalation / battle cries** — fold into behaviour graphs (the VINE runner is the right
   owner) rather than a new plugin; the gameLoop fallback shrinks to "run the graph".

### What deliberately stays

Combat math, enemy AI swings, the power network, the thermal model, vitals laws (hunger/thirst/starvation,
body-temp drift, stamina), death/corpse/respawn, dispatch, SIFT, the graph runner, sound, light. All hubs
or laws. Also **encumbrance-not-checked-on-take**: agents flagged it as a smell, but gating at movement
rather than acquisition is exactly what makes the corpse mule possible — worth writing into `docs/design.md`
as a named principle ("gate at the law, not at the verb").

---

## 4. Proposal #3 — Integration plan (plugin-side things that need engine anchoring)

1. **Posture writes** (interactions, scavenging, butchering plugins) currently poke `player.posture` /
   `sittingOn` / `scavengeState` / `butcherState` via `setLivePlayer`. This is the documented bug class.
   E5's `setPosture`/`forceStand` API inverts it: the *substrate* moves into the engine, the *verbs* stay
   in plugins, and force-stand triggers become one engine law instead of a contract every plugin re-reads.
2. **Plugin↔plugin verb precedence by alphabet**: gametable wins `watch` over broadcast because "g" loads
   after "b". Works today, is a trap tomorrow. E6's `after:` field makes it declared; the loader collision
   warning makes it visible.
3. **Critical-plugin failure**: if the weapon plugin fails to load, all combat silently dies (gameLoop just
   logs every 10s, and the swing loop `break`s instead of continuing). `critical: true` in the manifest +
   boot abort. Same treatment for any plugin that registers a provider the engine calls every tick.
4. **Corpse creation in the weapon plugin**: corpses are a substrate (world store owns their lifecycle);
   verify kill-path corpse creation goes through a single engine API rather than plugin-side inserts, so a
   future second killer (traps? falling?) doesn't duplicate it.
5. **zone-validator** is engine-quality infrastructure living as a plugin — that's fine (it's optional
   tooling), no action needed. Listed so nobody "fixes" it inward.

---

## 5. Discovery log (found during the audit)

### Bugs — verified directly
| What | Where |
|---|---|
| Proof-of-life event subscribers shipped in production code | `actions.js:44-50` |
| Steal cooldown is in-memory only; resets on restart | `commands/combat.js:269-270` |
| Trash-bin close runs two DELETEs untransacted (partial-failure leaves orphan rows) | `commands/inventory.js:516-517` |
| `MOVE`/`EXAMINE` Actions are error-returning placeholders | `actions.js` |
| OPPOSITE/DIR_OFFSET duplicated 6+ places | engine ×3, `api/routes.js` ×3 |

### Reported by audit agents — spot-check before acting
- Auto-attack loop `break`s (not `continue`s) when the combat provider is missing — one bad state kills all players' swings that tick (`gameLoop.js` ~165), and provider absence is only a log line.
- Bare `.catch(() => {})` on HP persistence (`gameLoop.js:138`) and corpse loading (`world.js:41-52`) — DB outage silently stops persistence.
- `drugs.js:146` reads `drug.withdrawal_effects?.overdose`, a field nothing sets — dead branch or schema drift.
- Window `light_transmission` is queried but unused in the visibility gate (`describe.js`).
- Weighted ambient selection has no zero-total-weight guard (`world.js:384`).
- `ai-behaviour.js:249` dynamic-imports movement.js to dodge a circular dependency — restructure or document.
- `events.js` catches rejected promises but not thrown-async errors.
- One agent claimed `checkMutationTrigger` is dead code — **false**, the mutations plugin tick calls it. Kept here as a reminder that the audit reports contain unverified claims.

### Ideas
- **"Gate at the law, not at the verb"** — codify the encumbrance/corpse-mule principle in `docs/design.md` so future systems inherit it deliberately.
- **Command-ownership devpanel view** — render `getRegisteredCommands()` + builtin map + collision warnings; auto-generates most of the `docs/plugins.md` table.
- **Stain fade on tick** — stains currently persist until `wash`; a slow decay law over the stain substrate would make the world self-clean.
- **Loot/attack/steal protection law** — once the protection substrate exists (Phase 3.1), audit that all three paths consult it; today forcefield is checked on loot but attack-path coverage is unverified.
- **Drug curves and skill list as data** — tolerance/addiction constants and the `SKILLS` const are the last balance-relevant data not editable without a rebuild.
