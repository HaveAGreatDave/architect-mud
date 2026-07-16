# Audit Findings — 2026-07 Sweep

A findings log from a nine-area static audit sweep of the codebase, run as focused
per-subsystem passes using the methodology in [README.md](README.md) (challenge the
silent seams: engine↔plugin dead code, content↔engine field drift, client↔server protocol
drift, string-keyed registry typos, split source-of-truth, plus a simplification lens).

**Areas covered:** NPC/AI · Broadcast · Vendor · Combat · Survival · Economy core ·
World systems · UI/CSS standardization · Dev-panel↔REST · Doors/Locks/Bypass (§10, 2026-07-03 deep-dive).
**Only un-audited system:** Scavenging (deferred).

All findings are static (read-by-reading); **none were runtime-verified**. Many were fixed
during the same sweep — those are tagged below and listed in the [changelog](#changelog).

### Status legend
- ✅ **Fixed** this sweep · 🔧 **Partial** (bug fixed, larger work parked) · ⏸ **Deferred** (needs runtime verification) · ⬜ **Open** · 📝 **Doc drift** (code fine, doc wrong) · ➖ **Smell** (no action taken)

---

## 1. NPC / AI behaviour

- ✅ **VINE editor silently dropped NPC graph edges on save (data loss).** The runtime `execAction`/`evalCondition` catalogue had grown past what `vine-schema-ai.js` could author; `CHECK_VENDOR_WORK`'s 4 ports weren't serialized, so opening+saving a vendor graph dropped its `endShift`/`offWork` edges and blanked unauthorable actions/conditions. Added the missing conditions (`TARGETABLE_IN_ZONE`, `AT_HOME`, `IS_BROADCAST_SCHEDULED`, `AT_WORK_ZONE`, `IS_VENDOR_WORK_TIME`) and actions (`ROAM`, `GO_TO_STUDIO`, `CHECK_VENDOR_WORK`, `VENDOR_CHITCHAT`, `AT_HOME_LIFE`, `VENDOR_COLLECT_SAFE`, `VENDOR_GO_TO_ATM`, `VENDOR_DEPOSIT`); added the 4-port render for `CHECK_VENDOR_WORK`; made edge (de)serialization driven by a single `AI_EDGE_PORTS` list so no named port can silently drop again.
- ➖ Dead param `FLEE.max_distance` and `EXECUTE_SCRIPT.arguments` (schema-authorable, runtime never reads). `world`-scope flags authorable but a runtime no-op (documented limitation).
- ✅ Clean: event-key wiring (`npc.broadcast_say` emit↔consume), blackboard keys, no engine/plugin verb duplication.
- **Simplify (open):** six near-identical "step toward a zone" walk blocks in `ai-behaviour.js` (GO_HOME/GO_TO_STUDIO/VENDOR_GO_TO_ATM/GO_TO_WORK/HAVE_LIFE/ESP-shelter) — already lightly drifted; collapse to one `stepToward()` helper. **Highest-value AI cleanup.**

## 2. Broadcast / TV

- ✅ **Passive-viewer TV ambient regression.** Non-watchers only got `broadcast_ambient` when someone *else* in the room was actively watching (`watchersHere.length > 0`) — backwards. Removed the gate so a lone player near a playing TV overhears spoken lines; kept the `result.speech` gate; doc rewritten to the real mechanism.
- ✅ **`formatMessage` corrupted graphic broadcasts.** `[Radio]`/`[FEED…]` prefixes were glued onto raw SVG/ASCII/credits on radio/security devices. Made it style-aware (`GRAPHIC_STYLES` pass through unprefixed).
- ✅ **`_seekGraph` vs `tickBroadcastGraph` divergent node-duration tables.** Unified both on a single `nodeHoldMs()` source; the seeker now tick-quantizes to the 5s grid. (Investigation note: the audit's headline `npc_action` example was a non-issue — sub-5s holds round up to the tick anyway; the real drift was multi-tick nodes like overlays.)
- ✅ **Stale `plugin.json` manifest** — emits/consumes synced to the real `emit()`/`on()` set.
- ✅ **Duplicated helpers extracted** — `_offAirMessage` (tick vs panel), `_techDiffMessage` (3×), `_ensureCassetteItem` (command vs route).
- ✅ **`cmdTune` vs `TUNE_DEVICE` deduped** via `_applyTuning`; off-path `device.tuned` emit deliberately kept caller-side (the audio plugin plays a `tv_relay_click` on it, and `cmdTune` intentionally stays silent on manual power-off).
- ✅ **`channels.js` naming collision** — `broadcastToChannel` → `sendToChatChannel` (chat channels, unrelated to media broadcast) across all 5 sites + doc.
- ➖ Split `CREATE`+`ALTER` schema for `media_channels`/`media_channel_playlist` — cosmetic, left alone.

## 3. Vendor

- ✅ **Text `buy`/`sell` ignored the shop session → wrong-vendor bug.** With two vendors in a room, bare buy/sell hit the *first* vendor, not the one you opened. `cmdShop` now opens a session; `resolveVendor()` prefers the session vendor; leaving a zone closes the session (`cmdMove`) so a text-shopped vendor doesn't stay paused.
- ✅ **Undocumented Cool sell multiplier** — kept (deliberate perk) and documented the real formula `floor(value×0.4×(1+Cool×0.05)×(1+factionDiscount))`.
- ✅ **`sellToVendor` ignored its `npc` param** — now faction-aware (friendly rep pays more, hostile less), mirroring buy; extracted `computeSellUnitPrice` as the single sell-price source.
- ✅ **GUI shop was buy-only** — added `sell_npc` handler + a Buy/Sell tab in the dialogue panel (`getSellableInventory` lister; refactored the three shop-panel sends through one `sendShopPanel`).
- ➖ `getVendorStock` N+1 (`SELECT * FROM items` per shelf item); `stock:99` is a display-only lie the client never shows.

## 4. Combat

- ✅ **Death re-entrancy** — `handlePlayerDeath` had no guard; two same-tick lethal hits each inserted a corpse and double-counted `deaths`. Added a `player._dying` sentinel (early-return, cleared after respawn).
- ✅ **Offline sleep-kill duplicated `handlePlayerDeath` wholesale** (Merge M1) — extracted `spawnPlayerCorpse` + `equipStarterOutfit` (used by both paths; capacity unified on `carryCapacity`), and the offline path now fires `player.death` emit+hook so sleep-kills get murder news, death SFX, and admin-protection retaliation (previously all skipped).
- ➖ **ATTACK trampoline still live** — `plugins/weapon` → `dispatchAction('ATTACK')` → `cmdAttack`, while engine builtins call the same `cmdAttack` (dead for the keyboard path). Deleting `plugins/weapon/` is zero-behavior-change (the `combat-flow-paths.md` cleanup). **Open.**
- ➖ **Six near-identical attacker functions** in `combat.js` (~250 lines) → one `resolveSwing()`. Open, hot-path — do deliberately.
- ➖ Ghost read: weapon `status_chance` tag read but never consumed (see Survival effects framework); `firearms`/`explosives` weapon skills train `brawling`; `respawn_zone` emitted-never-read.
- 📝 Stale docs: `recomputeArmor` now runs on equip+unequip (doc says login-only); corpse/loot system is live (doc says dead); legacy enemy `damage_min/max`+flat-soak fallbacks don't exist (doc still lists them).

## 5. Survival

- ⬜ **Drug system half-built.** `active_until`/`duration_seconds` written, never read; effects apply instantly; `is_addicted` set but never read (no withdrawal).
  - ✅ **Overdose was permanent** — `tickDrugDecay` had zero callers, so `doses_in_system` only ever climbed. Wired it into `minuteTickFn` over online players; doses now decay once a dose's window expires. *(The instant-effects / dead-addiction parts remain open.)*
- 🔧 **Status-effect framework fully dead + a stacked latent bug.**
  - ✅ `statusLabels` mapped `EFFECT_DEFS[name].label` but no def had a `label` key — the `stats` status line silently dropped every effect. Added `label` to each def.
  - ⬜ Nothing calls `applyEffect` (framework inert) and `tickEffects`' HP changes aren't persisted/sent — reviving it is a gameplay decision (parked A/B/C: wire combat `status_chance`→bleed + finish plumbing / stop / full migration of well-fed·hydrated·heal-over-time·overdose).
- 📝 **Stale doc** — `systems-survival.md` still warns of a `visibly_mutated` login bug that's **already fixed** (`index.js:588` copies it). **Open (doc edit).**
- ➖ Buff state (`wellFedUntil`/`hydratedUntil`/`healOverTime`) is live-object-only — lost on reconnect (likely intended, undocumented).
- **Simplify (open):** `effects.js` vs the ad-hoc `resourceTick` buff flags are two timed-effect systems; routing the buffs through `applyEffect` deletes bespoke bookkeeping *and* fixes the status line — the top survival consolidation. Also `applyHunger` to mirror the already-shared `applyThirst`. Triple per-minute player sweep (radiation/mutation/wetness).

## 6. Economy core

- ✅ **Rent ignored bank credits → wrongful eviction.** `rentCollectionTick` debited carried credits only; a banked, wealthy tenant carrying < rent was evicted. Now drafts **bank first, carried as fallback**, evicts only if the total can't cover; message reworded.
- ⬜ **Faction reputation has no writer.** `adjustReputation` has zero callers — every player is permanently Neutral, so vendor faction discounts (incl. the new sell-side one), the tier tables, and ATM `min_faction_rep` gates are all inert. **Open (design: wire it into quests/trades/kills).**
- ⬜ **ATM `jack` is dead behind an early return.** `cmdJack` returns "offline" before ~40 lines of hacking logic; `hack_difficulty` never read at runtime; docs describe it as working. **Open (re-enable vs document the kill-switch).**
- 📝 `statCost` doc describes an exponential curve; code is a flat 100/point (`ip.js`). Doc edit.
- ➖ Dead column `player_skills.trained`; ATM legacy `has_atm` fallback duplicated across 3 commands.
- **Simplify (open):** `API`/`directAPI` client wrapper duplication (see §9).

## 7. World systems

- ⬜ **Corpses never expire at runtime.** `cleanCorpses` is documented ("every 30s") but **exists nowhere and is scheduled nowhere**. Corpses get a 1h `expiresAt` read only on boot; the sole runtime purge is the 24h `dailyMaintenance`, so every corpse (and its loot rows) lingers up to 24h. **Open — highest-value world fix:** add `schedule('30s', cleanCorpses)` walking `world.corpses` for `Date.now() > expiresAt`. (Note: this is the *expiry* half of the corpse system we consolidated the *creation* half of in Merge M1.)
- 📝 **Doc inverted** — `systems-world.md` says `createCorpse` has no callers / corpse map "always empty." It has two live callers and the map populates on every death; the stale note masks the leak above.
- ➖ `dropWords` (`sounds.js`) does two independent random passes — the emptiness guard validates a discarded array, so the returned string can still be empty. Cosmetic.
- ➖ `emit('tick.minute')` (`gameLoop.js`) has zero event-bus subscribers (all consumers use the `hook`) — dead emit + a hook-vs-event trap.
- ✅ Clean: scheduler↔subscriber wiring (no orphan cadences — **this pass effectively covered the scheduler-cadences seam**), event-bus keys, server→client world protocol.
- **Simplify (open):** two per-minute `world.players` sweeps (`minuteTickFn` + `resourceTick`) could share one sweep + one UPDATE/player.

## 8. UI / CSS standardization

- ✅ **UTF-8 BOM** on `client/game/index.html` (direct CLAUDE.md violation) — stripped.
- ✅ **`.modal-overlay`** — 12 duplicated modal-backdrop `cssText` strings across 6 files collapsed to a shared layout-only class per client (varying opacity/z-index kept inline → provably identical).
- ✅ **`.lv-btn`** — `_lvBtnStyle` per-file button generator reduced to emitting only the accent variable; static styling moved to a class.
- ⏸ **`.radio-label`** (5 multi-line auth-form `style` blocks) and **ghost-mode's ~200-line injected `<style>` block → `styles.css` + purple tokenization** — **deferred** to a pass where the client can be launched to visually diff (both are unverifiable read-only).
- **Scale note:** the real inline-style debt is ~**2,547** inline `style=` (devpanel JS alone: 2,014; heaviest single file `devpanel/js/panels/broadcast.js`, 296). Glyph integrity otherwise clean (no mojibake). Per-panel migration + a whole-pattern `.hidden` utility (200+ `style.display` toggles) are **open**, all-at-once passes.

## 9. Dev-panel ↔ REST API

- ✅ **Strong seam — no bugs.** Zero called-but-unimplemented routes (no dead buttons), zero proven request/response shape drift, no auth/method gaps in devpanel scope. The client funnels through `API`/`directAPI` wrappers with consistent envelopes and role guards.
- ➖ **~7 orphaned `environment` dev endpoints** (implemented, no caller): `/environment/time/advance`, `/weather/storm`, `/weather/snow`, `/power/generator`, `/power/load`, `/power/fail`, `/power/city-generators` — superseded by other buttons. Flagged, not deleted (per CLAUDE.md).
- ➖ `player_update` from `apiUpdatePlayer` emits **flat** vitals — the same flat-vs-nested shape the WS-protocol audit flags; an emitter feeding that known WS-seam drift.
- **Simplify (open):** `API` vs `directAPI` near-duplicate wrappers (differ only in staging bypass + error richness) → one `API(path, method, body, {stage=true})`; repeated manual `path.split('/')` param extraction.

## 10. Doors / Locks / Bypass (2026-07-03 deep-dive)

Three-angle investigation of doors, locks, and lock-bypass skills (model+movement coupling ·
lock types+installation · bypass skills/IP/NPC/targeting). Static, **not runtime-verified**. The
lock-*type* registry (`server/engine/locks.js`, `registerLockType`) is a genuinely clean substrate;
almost everything around it is a half-finished extraction. Findings below, correctness first.

**Correctness / security**
- ⬜ **Dual-master lock state + live drift path.** `doors.lock_state` and `apartments.is_locked` are two
  writable masters mirrored by two functions (`doors.js:69,78` ↔ `apartments.js:397`). `cmdMove`'s inline
  re-lock (`movement.js:376`) writes `lock_state` **without** the apartment mirror → a door re-locked
  behind a walking player desyncs the flag. Textbook [source-of-truth](source-of-truth-audit.md) bug.
- ⬜ **Spoofable breach.** Every hack surface (hololock/ATM/vendor-safe/camera) trusts the client `win`
  flag; the anti-spoof only checks the attempt was *armed* (`pendingHack`, `doors.js:361,382`), not *won*.
  A crafted `hackresolve <id> 1` bypasses any lock. Server has a real opposed-roll primitive (`skillCheck`,
  `skills.js:57`, used by butcher/scavenge/synthesis) that **no lock path uses**.

**Boundary cleanup (engine/plugin + tag-vs-hardcode)**
- ⬜ **Capability + values hardcoded instead of tag/registry-driven.** This is the same class as the
  [capability-tag-vs-itemid audit](capability-tag-vs-itemid-audit.md), found again here — the boundary
  cleanup must include it:
  - `HACK_DEVICE_ITEM_ID = 'item_hack_deck'` hardcoded as the hack gate in **three** places
    (`doors.js:291`, `plugins/atm/index.js:12`, `plugins/jail/index.js:33`), while the *same* lock domain
    already gates lock **installation** by tag via `kitTag` (`lockkit:*`). Should be one `hack_device` tag
    read through one shared helper.
  - **keycard minting is a hardcoded per-type `if (tagType==='lock:keycardlock')` branch in the engine
    handler** (`doors.js:498-517`) — lock-type-specific install behavior that is NOT declared through
    `registerLockType`. The registry has no `onInstall` hook, so any lock needing an install artifact
    requires engine edits.
  - **The entire hololock hack mechanic string-matches `'lock:hololock'`** (`doors.js:324,391`) and is
    bespoke to the engine; `canHack` gates entry but the mechanic isn't generic. A second hackable lock
    type inherits none of it. The registry needs a hack-mechanic hook the same way it needs `onInstall`.
  - Net: the "add a lock type with no engine edits" promise (`plugins/doors/index.js:8-9`) holds only for a
    *passive* lock (auth+messages). Install artifacts and bypass mechanics leaked into the engine as
    hardcoded values/branches instead of registry hooks + tags.
- ⬜ **`lock`/`unlock` verb collision resolved only by dispatch order.** Both the doors plugin
  (specializedAction) and `housing.js` builtin claim the verbs; the apartment handler is shadowed dead
  whenever a door row exists, and the two paths touch different masters with different messages.
  Undocumented in [plugins.md](../plugins.md).
- ⬜ **No single door-write path.** `updateDoor` (`doors.js:63`) is the intended chokepoint (fires the
  mirror), but `movement.js` (327,376,381), `apartments.js` (105,175,357,409), and the privacy scheduler
  (`plugins/doors/index.js:90`) all mutate the in-memory door + `setDoorCache` directly, so the mirror
  invariant holds on only one path. (Correction 2026-07-15: none of these issue a raw `UPDATE doors` —
  door runtime state is RAM-only, per the registry contract; the bypass is of the *helper*, not the DB.)
- ➖ **`requiredTag: 'lockable'` is dead/decorative** — ignored at dispatch (`specializedActions.js:26-45`,
  used only for UI hints) and never written onto any door by engine code.
- ➖ **The "doors plugin" is a thin re-export shim** (`plugins/doors/index.js:11` imports engine handlers);
  the door *system* lives in the engine. Registry is correctly a plugin; the command behavior is a system
  left un-extracted.

**Model / integrity**
- ➖ **No `(zone_id, exit_dir)` uniqueness and no door↔exit referential integrity.** Door topology is a
  hand-maintained shadow of exit topology; duplicate/orphan door rows resolve arbitrarily
  (`getDoorForExit` returns `matches[0]`, `world.js:152`). A door with no matching exit is invisible to
  `cmdMove` (movement bails at the exit check before the door lookup) yet still operable by the door verbs.

**Design gaps you asked about (features, not bugs)**
- ➖ **Lock-yourself-out protection absent.** `lock` has no side-check (`doors.js:116-139`) — you can lock
  from the hallway. Saved from *permanent* lockout only incidentally (auth is credential-based), but a
  **keycard** holder who locks up and loses the card on the far side is hard-locked-out (bash only).
- ➖ **`hack <full-direction>` works and disambiguates; `hack s` does not** — `resolveDoor` matches full
  words only (`doors.js:13,33`) and alias expansion is first-word-only (`aliases.js`). Widen `DIRECTIONS`
  or expand abbreviations in `resolveDoor` to match movement.
- ➖ **Skill is client-only; IP award is a damped constant.** No server skill roll; `skill`/`difficulty`
  only tune the minigame. Success awards `awardSkillUse('hacking', 2)` with a **hardcoded** margin
  (`doors.js:402`, atm:350, vendor-safe:139), so nail-biters and walkovers raise skill identically;
  failure grants nothing. NPCs can open/lock their own home/shop doors via `moveEntity` but **cannot hack**
  and have no VINE door action node.

---

## Changelog — fixes applied this sweep {#changelog}

| # | Area | Fix | Files |
|---|---|---|---|
| 1 | NPC/AI | VINE editor ↔ runtime catalogue + port serialization | `vine-schema-ai.js` |
| 2 | Vendor | Text buy/sell honor the shop session | `commands/economy.js`, `commands/movement.js` |
| 3 | Vendor | Document Cool sell multiplier | `systems-economy.md` |
| 4 | Vendor | Faction-aware sell + `computeSellUnitPrice` | `vendor.js` |
| 5 | Vendor | GUI Sell tab + `sell_npc` handler | `server/index.js`, `net.js`, `panels/dialogue.js`, `styles.css` |
| 6 | Broadcast | Passive ambient gate fix + doc | `plugins/broadcast/index.js`, `systems-broadcast.md` |
| 7 | Broadcast | Style-aware `formatMessage` | `plugins/broadcast/index.js` |
| 8 | Broadcast | `nodeHoldMs` single source + seek quantization | `plugins/broadcast/index.js` |
| 9 | Broadcast | `plugin.json` manifest sync | `plugins/broadcast/plugin.json` |
| 10 | Broadcast | Extract off-air / tech-diff / cassette helpers | `plugins/broadcast/index.js` |
| 11 | Broadcast | `_applyTuning` dedup | `plugins/broadcast/index.js` |
| 12 | Broadcast | `broadcastToChannel` → `sendToChatChannel` | `channels.js`, `routes.js`, `commands/social.js`, `systems-world.md` |
| 13 | Economy | Rent drafts bank-first | `gameLoop.js` |
| 14 | Survival | Wire `tickDrugDecay` to minute tick | `gameLoop.js`, `drugs.js` |
| 15 | Survival | Effect `label` keys (fix status line) | `effects.js` |
| 16 | Combat | Death re-entrancy guard | `gameLoop.js` |
| 17 | Combat | Offline sleep-kill uses canonical death mechanics | `gameLoop.js`, `commands/combat.js` |
| 18 | UI | Strip BOM | `client/game/index.html` |
| 19 | UI | `.modal-overlay` class (12 sites) | 6 client JS files + both `styles.css` |
| 20 | UI | `.lv-btn` class | `lightview.js`, game `styles.css` |

---

## Open items — recommended order

**Cheap, unambiguous bugs**
1. **World: `cleanCorpses` tick** — corpses ignore their 1h expiry (highest-value world fix) + correct the `systems-world.md` corpse section.
2. **Doc edits** — survival `visibly_mutated` stale-bug block; combat stale docs (recomputeArmor/corpses/legacy fallbacks); economy `statCost` curve.

**Design decisions (need intent)**
3. **Effects framework revival** (A/B/C) — wire combat `status_chance`→bleed + finish plumbing / stop / full `resourceTick` migration.
4. **Faction reputation writer** — the largest dormant surface.
5. **ATM `jack`** — re-enable vs document the kill-switch.

**Simplifications (safe, deliberate)**
6. AI six-fold `stepToward` consolidation · combat `resolveSwing` + delete `plugins/weapon` · survival buffs→effects + `applyHunger` · world two-sweep merge · `API`/`directAPI` consolidation.

**Deferred (needs a running client to visually diff)**
7. UI: `.radio-label`, ghost-mode `<style>` relocation + purple tokenization, per-panel inline-style migration, `.hidden` whole-pattern pass.

**Un-audited**
8. **Scavenging** — the one system not yet swept.
</content>
</invoke>
