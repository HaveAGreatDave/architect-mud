# QA Audit — June 2026

A critical, document-only sweep of the engine, command layer, persistence, API, and game client.
**No code was changed.** Each finding cites a real `file:line` and a suggested fix. Severity reflects
player/operator impact, not effort.

The dev panel (`client/devpanel/index.html`, ~5,200 lines), `environment.js` (~1,635 lines),
`migrate.js`/`seed.js` correctness, and the `staging`/`environment`/`worldvalidator` route modules and
`net.js` were surveyed **structurally, not line-audited** — see [Scope](#scope--not-deeply-audited).
Treat the absence of findings there as "not yet looked at," not "clean."

## Triage summary

| # | Severity | Area | One-liner |
|---|----------|------|-----------|
| 1 | **Critical** | Security | Admin API token is unsigned base64 — trivially forgeable |
| 2 | High | Security | Stored/reflected XSS via `innerHTML` on player-authored text |
| 3 | High | Bug | `handlePlayerDeath` has no re-entrancy guard (double respawn) |
| 4 | High | Bug | Armour soak only recomputed at login, not on equip/unequip |
| 5 | High | Bug | Client silently drops several server message types (invisible command output) |
| 6 | Medium | Bug | `recipes` command reads dead `rank` column → skill-gated recipes hidden |
| 7 | Medium | Bug | `visibly_mutated`/`origin_fragment` missing from live player → outcast mechanic resets on reconnect |
| 8 | Medium | Bug | Firearms/explosives never trained through combat |
| 9 | Medium | Bug | Apartment locks don't gate entry; lock-picking is a no-op |
| 10 | Medium | Bug | Economy + inventory mutations are non-atomic (no transactions) |
| 11–15 | Low | Bug | Attack-interval clamp, `say` self-echo, `use` NaN vitals, `dropWords`, loot label |
| 16–18 | Medium | Dead/disconnected | Status effects inert; corpse system disconnected; drug decay never runs |
| 19–25 | Low | Dead code | Missing `factions` command, shadowed `open/close`, stubs, vestigial `xp_reward`/`rank`/`minuteTick` |
| 26–29 | Med/Low | Performance | Per-swing skill DB reads; per-minute no-op writes; spawn/look query volume |
| 30–35 | Med/Low | Paradigm | Swallowed DB errors; `environment.js` size + weather dup; legacy `is_light`; window-path split; cross-boundary import; stat-name drift |

---

## Critical

### 1. Forgeable admin API token
`server/api/routes.js:18,34–42`. Dev tokens are `base64(playerId:role:timestamp)` with **no signature
or server-side validation**. `verifyToken` simply base64-decodes the bearer token, checks the timestamp
is within 24h, and **trusts the embedded role**:

```js
const [playerId, role, ts] = Buffer.from(token,'base64').toString().split(':');
if (Date.now() - parseInt(ts) > 86400000) return null;
return { playerId, role };
```

Anyone can craft `base64("anything:admin:" + Date.now())` and gain full admin API access: create/update/
delete zones, items, NPCs, enemies, drugs, mutations, apartments; smite/teleport players; assign roles
(`requireDev`/`requireAdmin` only check the self-asserted `role`). This is the most serious issue in the
codebase.
**Fix:** sign tokens with an `HMAC` over `playerId:role:ts` using a server secret and verify the
signature in `verifyToken`; or keep a server-side session map keyed by an opaque random token and look up
role server-side. Never trust a client-presented role.

---

## High

### 2. Stored/reflected XSS via `innerHTML`
`client/game/js/render.js:11–17` (`appendHtml`) sets `el.innerHTML = html` with no sanitization. Several
paths embed **player-authored** text into that HTML server-side without escaping:
- `say` — `server/engine/commands/social.js:16` (`${player.handle} says: "${text}"`)
- whisper — `social.js:35` → client `dispatch.js:222` `receiveWhisper`
- player handles, item names, NPC names interpolated into room HTML/attributes —
  `server/engine/commands/describe.js:194,251,261`

`escapeHtml()` exists at `client/shared/dom.js` but is unused. A handle or `say`/whisper payload
containing markup executes in other players' clients (stored XSS via the persisted handle; reflected via
chat).
**Fix:** escape user-authored substrings before embedding them in server-built HTML (or sanitize on the
client). Server-authored prose can stay raw; user text cannot.

### 3. `handlePlayerDeath` re-entrancy
`server/engine/gameLoop.js:110`. No guard prevents a second invocation in the same 1-second tick. Two
enemies landing lethal hits, or a lethal hit plus a status-effect tick (`tick()` checks `hp<=0` in both
the combat loop at `:56` and the status loop at `:85`), each call `handlePlayerDeath` → double death
broadcast, double full-restore, duplicate DB write, double `player.death` hook.
**Fix:** set a `player.dead` flag at entry, bail if already set, clear it after respawn completes.

### 4. Armour soak only recomputed at login
`recomputeArmor()` (`server/engine/commands/inventory.js:15`) is called once, at `server/index.js:395`.
The equip/unequip handlers (`inventory.js` `cmdEquip`/`cmdUnequip`/`cmdEquipById`/`cmdUnequipById`)
update `is_equipped` in the DB but **never recompute `player.soak`**. So equipping armour mid-session has
zero combat effect until the player reconnects, and unequipping leaves stale protection.
**Fix:** `await recomputeArmor(player)` at the end of each equip/unequip handler.

### 5. Client silently drops several server message types
`client/game/js/dispatch.js:226` — `handleServerMsg` runs a handler only `if (handlers[msg.type])`, with
no default. These server-emitted types have **no handler**, so the messages vanish:
- **`output`** — yells to everyone (`server/engine/sounds.js:85,93`), the yeller's own echo and the
  whisperer's own echo (`social.js:23,36`), and admin smite/role messages (`routes.js:662,718`).
  **Net effect: yelling shows nothing to anyone; whisper sender sees no confirmation.**
- **`rent` / `lock` / `upgrade` / `pick_success` / `pick_fail`** (`server/engine/apartments.js`) —
  renting, locking, upgrading, and lock-picking produce **no on-screen feedback**.
- **`message`** — "light already on/off" (`commands/world.js:149`), "window already open/closed"
  (`commands/world.js:247,251`).
- **`talk`** — "that NPC doesn't want to talk" (`social.js:10`).

**Fix:** add the missing handlers, or give `handleServerMsg` a default that `appendHtml(msg.message)`
when `msg.message` is present.

---

## Medium

### 6. `recipes` command reads a dead column
`plugins/crafting/index.js:5` runs `SELECT skill_id, rank FROM player_skills`, but the live skill value
is `trained` (`server/models/migrate.js:40` created `rank` (legacy); `:362` added `trained`; the whole
engine uses `trained`). Every skill therefore reads `undefined`→0, so `getAvailableRecipes` hides any
recipe with a non-zero `skill_req` — even though `craft` (which reads `trained` correctly) will still
make it.
**Fix:** select `trained`; then drop the legacy `rank` column (see #23).

### 7. `visibly_mutated` / `origin_fragment` missing from the live player
`server/index.js:369–393` builds the in-memory `livePlayer` field by field and omits both
`visibly_mutated` and `origin_fragment`. Consequences: the Custodian outcast/turret mechanic
(`commands/describe.js:173`, `mutations.js:77`) reads `player.visibly_mutated` (undefined) → never fires
after a reconnect, even for a permanently mutated character; and `look me` / `examine <player>`
(`movement.js:43`, `commands/world.js:101`) always show the fallback origin text.
**Fix:** copy both fields from the DB row into `livePlayer`.

### 8. Firearms/explosives never trained in combat
`server/engine/commands/combat.js:41–47`. After a hit, the weapon's `weapon_skill` is remapped to
`bladed` / `electronics` (only when it's literally `'energy'`) / else `brawling` before awarding skill
use — discarding `firearms` and `explosives`. Those skills can never grow through attacks.
**Fix:** award the weapon's actual `weapon_skill`.

### 9. Apartment locks don't gate entry; lock-picking does nothing
`cmdMove` (`server/engine/commands/movement.js:78`) moves into any zone with an exit and never checks
apartment lock state — so a locked door does not keep anyone out. Separately, `cmdPickLock`
(`server/engine/apartments.js:143`) returns `bypassed_zone` on success (`:166`) but **nothing consumes
it** and the door is never unlocked. The entire lock / upgrade-lock / pick loop only affects whether you
may `sleep` in a unit (`getSleepEligibility`).
**Fix:** block movement into a locked apartment the player doesn't own; on a successful pick, record a
per-session bypass (e.g. a `Set` of zone ids) that `cmdMove` honours.

### 10. Economy + inventory mutations are non-atomic
`buyFromVendor` (`vendor.js:38`), `sellToVendor` (`vendor.js:77`), `attemptCraft` (`crafting.js`),
`steal` (`commands/combat.js:157`), and `transferCredits` (`economy.js:19`) all perform a credit change
and a separate inventory insert/update through the single per-call `query()` helper. `getClient()`
(transactions) is used in exactly one place (`routes.js:430`). If the second statement fails after the
first commits, state is left inconsistent (credits gone, no item; or item granted, credits not debited).
**Fix:** wrap each multi-step money+item operation in a transaction via `getClient()` / `BEGIN…COMMIT`.

---

## Low (bugs)

### 11. Enemy attack interval has no lower clamp
`combat.js:181`: `attackInterval = 5000 - enemy.stat_agi * 150`. At `stat_agi ≥ 34` this is ≤0, so the
enemy attacks every tick. **Fix:** `Math.max(MIN_INTERVAL, 5000 - stat_agi*150)`.

### 12. `say` echoes twice to the speaker
`commands/social.js:16` broadcasts with `excludePlayerId = null`, so the speaker receives the zone
"X says" event **and** the "You say" return. `yell` correctly excludes the sender.
**Fix:** exclude the speaker from the `say` broadcast.

### 13. `use` renders partial vitals (NaN bars)
`client/game/js/dispatch.js:144–147` calls `updateVitals(msg.player_update)` with only the changed
fields, so `setBar` computes `val/max` with `undefined` → NaN bar widths. Every other handler does
`Object.assign(state.player, msg.player_update); updateVitals(state.player)`.
**Fix:** use the same Object.assign pattern.

### 14. `dropWords` double-randomization
`server/engine/sounds.js:33–46` builds a filtered array to test for emptiness, then runs a **second,
independent** random pass to produce the returned string — the validated result isn't what's returned
(it can even come back all "…").
**Fix:** compute the muffled string once and reuse it.

### 15. Combat loot shows raw item ids
`dispatch.js:71` prints `${l.item_id} x${qty}` (e.g. `item_scrap_metal`) instead of a display name.
Cosmetic. **Fix:** include item names in the kill payload, or resolve client-side.

---

## Dead / disconnected systems

### 16. Status-effect framework is inert (Medium)
`server/engine/effects.js` defines `bleeding`/`burning`/`irradiated` and `tickEffects` runs every second
from `gameLoop.js:82`, but **`applyEffect()` has zero callers** (`grep` confirms). Nothing starts an
effect — weapon `status_chance` is read (`commands/combat.js:23`) and discarded; drug overdose and zone
radiation don't route through it. **Fix:** wire `applyEffect` into weapon status procs, drug overdose,
and irradiated zones — or mark the system explicitly pending.

### 17. Corpse system is disconnected (Medium)
`createCorpse()` (`world.js:239`) has zero callers. Kills insert loot under `_ground_<zone>`
(`commands/combat.js:56–64`), but `cmdLootCorpse` reads `_corpse_<zone>` (`:113`). So corpses are never
created, the `loot` command can never find anything, and `getZoneCorpses`/`cleanCorpses`/corpse rendering
(`describe.js:272`) all operate on an always-empty set. Loot reaches players only via `take`.
**Fix:** decide the model — either have kills `createCorpse` and move loot onto it, or delete the corpse
code path and the `loot` command and keep ground drops.

### 18. Drug decay never runs (Medium)
`tickDrugDecay()` and `getPlayerDrugState()` (`drugs.js:82,91`) have no callers. `doses_in_system` only
ever increments (`useDrug`), so once a player hits `overdose_threshold` they are **permanently** in
overdose state, and addiction has no enacted withdrawal. `duration_seconds`/`active_until` are stored but
no timed effect reversal exists — drug effects are applied instantly.
**Fix:** schedule `tickDrugDecay` per online player on a scheduler cadence; if timed effects are intended,
implement reversal at `active_until`.

### 19. `factions` command is missing (Low)
No engine or plugin command handler exists for `factions`, yet `help` advertises it
(`commands/world.js:197`) and the client has a `factions` render handler (`dispatch.js:131`).
`getPlayerFactionRep()` (`factions.js:23`) is unused by any command — players can't view standings.
**Fix:** add a `factions` command that renders `getPlayerFactionRep`.

### 20. Duplicate `open`/`close` handlers; apartment-curtain version is shadowed (Low)
`commands/index.js:14–22` builds the builtin map by spreading housing handlers then world handlers, so
`world.js` `cmdOpenWindow` (`open`/`close`, `:272–273`) overwrites `housing.js` `cmdCurtain`
(`:76–77`) — the curtain handler never runs. The two implementations differ: `cmdCurtain` matches windows
by name and calls `setWindowState` (which updates the environment cache); `cmdOpenWindow` matches by
`handle`/`id` and writes the `windows` table directly **without** refreshing the in-memory window/lighting
state. So the surviving path may not update lighting until a reload.
**Fix:** keep one implementation; ensure it refreshes the environment cache.

### 21. Stub / retired plugins (Low)
`plugins/visibility/index.js` is an empty stub (`export const hooks = {}`); `plugins/_example-weather-retired/`
is retired. **Fix:** remove or document as intentional placeholders.

### 22. Vestigial `xp_reward` (Low)
There is no XP system (advancement is IP). `xp_reward` is carried through the `enemies` table
(`migrate.js:129`), spawn instances (`world.js:205`), combat results (`combat.js:156`,
`commands/combat.js:90`), and the dev-panel form (`devpanel/index.html:323,1750,1927`) but is never
awarded. **Fix:** implement or remove.

### 23. Legacy `rank` column (Low)
`player_skills.rank` (`migrate.js:40`) is superseded by `trained` (`:362`); only the buggy `recipes`
command (#6) still reads it. **Fix:** drop the column once #6 is fixed.

### 24. `minuteTick` counter unused (Low)
`gameLoop.js:13` declares and increments `minuteTick` (`:91`); it's never read. **Fix:** remove.

### 25. Unverified exported helpers (Low)
`scheduler.stopAll`, `plugins.registerCommand`/`registerRoutes` (the programmatic variants — plugins
register via manifest), and a few `world.js` setters may be unused. Confirm and prune. Low priority.

---

## Performance

### 26. Skills hit the DB on every swing (Medium)
`effectiveSkill` (`skills.js:28`) runs a `SELECT` per call. Each attack calls it for the attacker and for
the defender's `dodge`, and `awardSkillUse` (`:50`) adds a `SELECT` + `INSERT/UPDATE` + an IP `UPDATE` per
hit. Under the 1-second tick with multiple enemies, that's many round-trips per second per player —
notable because everything else (world, recipes, drugs, tunables) is cached in memory while skills are
not.
**Fix:** cache a player's trained skills on the live player object, refreshed on award.

### 27. Per-minute no-op writes (Low)
`resourceTick` (`gameLoop.js:250–251`) issues a `players` UPDATE every minute for every online player even
when nothing changed. **Fix:** skip the write when no field changed, or batch.

### 28. Spawn query volume (Low)
`tickSpawns` (`world.js:222`) joins all of `zone_spawns` × `enemies` every 10s. Fine now; note for scale.

### 29. Per-look query fan-out (Low)
`describeZone` (`describe.js`) issues several queries per look (ground items, furniture, generators ×2).
Acceptable at current scale; revisit if look frequency or zone counts grow.

---

## Broken paradigms / consistency

### 30. Swallowed DB errors (Medium)
`query(...).catch(()=>{})` is used pervasively (`gameLoop.js:54,101`, `drugs.js:76`, `world.js`,
`commands/world.js:126,160`, etc.). Non-critical writes silently failing is fine; a *persistent* write
failing silently is not, and there's no signal when it happens. **Fix:** route swallowed errors through a
single logger so failures are at least visible.

### 31. `environment.js` size + weather duplication (Medium)
`server/engine/environment.js` is ~1,635 lines spanning time, weather, power grid, lighting, visibility,
and windows. Weather constants (season-by-month, weather icons, visibility factors) are duplicated between
it and `plugins/weather/index.js`. **Fix:** split into `weather.js`/`power.js`/`lighting.js`/`visibility.js`
and single-source the weather tables.

### 32. `examine` reads the legacy `is_light` column (Low)
`commands/world.js:64–67` branches on `f.is_light`/`f.light_type`, while `switch`/`turn` (`:110,141`) and
`describeZone` (`describe.js:203`) use `object_type='light'`. If `is_light` is dropped, `examine`'s light
detail breaks. **Fix:** standardize on `object_type`.

### 33. Two window-control data paths (Low)
The surviving `open`/`close` path writes the `windows` table directly and bypasses the environment
lighting cache, while the shadowed curtain path went through `setWindowState`. See #20. Standardize so
window changes always refresh lighting state.

### 34. Server depends on a client file's import side effect (Low)
`server/engine/tags.js:6–8` imports `client/shared/tagCatalog.js` purely for its `globalThis.TAG_CATALOG`
assignment. It works (single source of truth, served at `/shared/*`), but a server module reaching into a
`client/` file via a global side effect is surprising. **Fix (optional):** move the catalog to a neutral
shared location and export it explicitly.

### 35. Stat-name drift (Low)
Skills/combat use `stat_brawn/reflexes/endurance/brains/senses/cool` (`skills.js`, `ip.js`), while enemies
and older docs use `stat_str/agi/end` (`combat.js:181,189`, `world.js:202`), and mutations apply arbitrary
`stat_*` keys (`mutations.js:43`). Mostly isolated, but a content author setting a mutation's
`stat_modifiers` to the wrong family silently does nothing. **Fix:** document the canonical stat keys (see
[combat-and-stats-plan.md](combat-and-stats-plan.md)) and validate mutation/enemy stat keys on save.

---

## Scope — not deeply audited

These were read structurally (entry points, signatures, sizes) but not line-audited; a follow-up pass is
warranted:

- **`client/devpanel/index.html`** (~5,200 lines) — the single largest maintainability risk and the
  biggest un-reviewed correctness surface. It mints/holds the dev token (#1) and writes all content.
- **`server/engine/environment.js`** (~1,635 lines) — power/lighting/visibility math and tick wiring.
- **`server/models/migrate.js` / `seed.js`** — migration idempotency and seed correctness.
- **`server/api/staging.routes.js`, `environment.routes.js`, `worldvalidator.routes.js`** — bulk/admin
  endpoints (same auth model as #1).
- **`client/game/js/net.js`** and the panel modules beyond `render.js`/`dispatch.js`.

## Suggested order of attack

1. **#1 (token signing)** and **#2 (XSS)** — security, before any public exposure.
2. **#3, #4, #5** — they make core gameplay (death, armour, chat/housing feedback) visibly wrong.
3. **#16/#17/#18** — decide keep-and-wire vs remove for the three half-connected systems; they shape
   what the survival/combat docs should promise.
4. The Low/housekeeping items as opportunistic cleanups (several are one-liners: #11, #12, #13, #24).
