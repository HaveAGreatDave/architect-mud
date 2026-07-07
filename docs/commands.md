# Command System

## Overview

Commands enter via WebSocket (`{ type: "command", command: "..." }`), routed through `server/engine/commands/index.js`. The dispatch chain:

1. **SIFT intercept** — if the player has an active selection state, handle their response (number, next/prev, cancel).
2. **Alias pre-pass** (`getAlias`, [aliases.js](../server/engine/commands/aliases.js)) — the first typed word is rewritten to its canonical verb *before any routing* (`go`→`move`, `l`→`look`, `n`→`north`, `scav`→`scavenge`…), and `raw` is rebuilt to match. This is a pure text substitution: everything downstream only ever sees canonical verbs, so each verb has one source of truth in code. Aliases ship as `ALIAS_DEFAULTS` and are DB-overridable via the dev panel; they're invisible to players. **Only pure synonyms/abbreviations are aliased** — tag-routed verbs that share an implementation (`eat`/`drink`/`use`, `open` on door-vs-container) stay distinct so the specialized layer can tell them apart.
3. **Sleep intercept** — wake the player if sleeping, then re-run the command.
4. **Input matchers** (`fireInputMatchers`) — regex against the raw line, for multi-word verbs (`registerInputMatcher`; e.g. the MIS plugin's `jerk off on` / `eat out`).
5. **Plugin commands** (`fireCommand`).
6. **Specialized actions** (`fireSpecializedAction`) — tag- or self-gated (doors, containers, food, weapons, cosmetic machine, toilets…).
7. **Builtins** — the `Map` built from the engine domain handler exports.

There are no per-verb special cases in the pipeline; anything that used to be one (the cosmetic-machine `use` pre-intercept, the MIS regexes) now registers through steps 4–6.

---

## Target Resolution: SIFT and FATE

All entity targeting goes through `server/engine/sift.js`. There are two resolution modes:

### FATE — Fast Action Target Engine

Used **only for combat** (enemy targeting). Always returns exactly one result with no UI — deterministic, fast.

- **Tiebreakers:** last-attacked target wins; otherwise lowest instanceId.
- Triggered when: `player.combatTargetId != null`, `context.combatScope === true`, or `context.verb` is in the COMBAT_VERBS set (`attack`, `hit`, `strike`, `shoot`, `kill`, `k`, `a`).
- Entry point: `resolveForCommand(query, candidates, player, context)` — automatically routes to FATE when appropriate.

### SIFT — System for Intent Filtering & Targeting

Used for all non-combat entity lookup. Fuzzy scoring with a paged disambiguation UI when candidates are too close.

- Scores candidates 0–100 (exact match = 100, substring = 90–99, prefix = 70–88, word overlap = 40–69, partial word match = 10–38).
- If the top two candidates are within 8 points of each other (and have different names), it returns `type: 'ambiguous'` and presents a numbered selection list.
- If only one candidate scores above 0, or one has a clear lead (≥8 points), it returns `type: 'match'`.
- Entry points: `resolve(query, candidates, context)` — SIFT only; and `matchAll(query, candidates)` — returns **all** candidates scoring above 0, best-first, with no ambiguity gate (for bulk verbs that act on every match rather than prompting, e.g. `drop all <filter>`).

### Selection State (disambiguation UI)

When SIFT returns `ambiguous`:
1. Call `createSelectionState(player.id, candidates, context)` — stores state keyed by player id, expires after 60s.
2. Return the formatted page: `formatSelectionPage({ allCandidates, visibleIndex: 0, pageSize: 5 })`.
3. The player types a number (1–5), `next`, `prev`, or `cancel`.
4. `index.js` intercepts the next command via `advanceSelectionState` and replays the pick.

**Replay routes — pick the right context:**
- **Plugin verbs (the default):** `{ dispatchType: 'myplugin.my_action', dispatchParam: 'target' }` —
  the pick is dispatched as an Action with the chosen candidate object as `params.target`. Register the
  Action in your plugin (examples: `thievery.steal`, `commerce.buy_item`, `bodily.pee_target`,
  `gametable.watch_choice`).
- **Engine builtins only:** `{ verb }` — replays through `builtins.get(verb)` with the candidate's
  *name*. This route cannot reach plugin verbs; using it for one is the classic silent-breakage trap.

---

## Rule: All Commands Use SIFT

**Every command that looks up a zone entity (enemy, NPC, player, item) by name must use SIFT.** Do not use `array.find(x => x.name.toLowerCase().includes(query))`. That pattern silently picks the wrong target when names are similar.

### For NPC/enemy candidates

These have a `name` field natively. Pass them directly:

```js
import { resolve as siftResolve, createSelectionState, formatSelectionPage } from '../sift.js';

const r = siftResolve(targetStr, getZoneNpcs(player.current_zone));
if (r.type === 'none')      return { type:'error', message:`Can't find "${targetStr}" here.` };
if (r.type === 'ambiguous') {
  createSelectionState(player.id, r.candidates, { verb: 'talk' });
  return { type:'output', message: formatSelectionPage({ allCandidates: r.candidates, visibleIndex: 0, pageSize: 5 }) };
}
const npc = r.candidate;
```

### For player candidates

Players have `handle`, not `name`. Map them before passing to SIFT:

```js
const pool = getZonePlayers(player.current_zone)
  .filter(p => p.id !== player.id)
  .map(p => ({ ...p, name: p.handle }));
const r = siftResolve(targetStr, pool);
if (r.type === 'none')      return { type:'error', message:`Can't find "${targetStr}" here.` };
if (r.type === 'ambiguous') {
  createSelectionState(player.id, r.candidates, { dispatchType: 'myplugin.my_action', dispatchParam: 'target' });
  return { type:'output', message: formatSelectionPage({ allCandidates: r.candidates, visibleIndex: 0, pageSize: 5 }) };
}
const target = r.candidate; // has .handle, .id, etc. — the spread preserves all player fields
```

### Exception: complex-arg commands

Commands where the argument string encodes more than just a target name (e.g. `give <item> to <player>`) cannot use the full disambiguation UI — if the command is replayed with only the candidate's name, the extra argument is lost. For these, use SIFT scoring but return an error on ambiguous:

```js
if (r.type === 'ambiguous') return { type:'error', message:`Multiple people match — be more specific.` };
```

Commands currently in this category: `give` (player target), `jerk off on`, `eat out`.

### Exception: combat enemy targeting (FATE, not SIFT)

Enemies in attack commands use FATE. Call `resolveForCommand` with `combatScope: true`:

```js
import { resolveForCommand } from '../sift.js';

const result = resolveForCommand(targetStr, enemies, player, { verb: 'attack', combatScope: true });
if (result.type === 'none') { /* no enemy found */ }
const target = result.candidate; // auto-selected by FATE, no UI
```

---

## Where Each Domain Handles Targeting

| Command file | Entity type | Resolution |
|---|---|---|
| `plugins/weapon` | Enemies (attack) | FATE via `resolveForCommand` |
| `plugins/weapon` | Players (attack) | SIFT UI; replay via `dispatchType: 'ATTACK'` |
| `plugins/thievery` | Players (steal) | SIFT UI; replay via `thievery.steal` Action |
| `plugins/commerce` | NPCs (shop) / stock items (buy) | SIFT UI; replay via `commerce.shop_vendor` / `commerce.buy_item` Actions |
| `plugins/bodily` | Players (pee/poop on target) | SIFT UI; replay via `bodily.pee_target` / `bodily.poop_target` Actions |
| `plugins/mis` | Players (all MIS targeting) | SIFT via its `resolveTarget` helpers |
| `combat.js` | Players (loot) | SIFT with disambiguation UI |
| `social.js` | NPCs (talk), players (obama) | SIFT with disambiguation UI |
| `world.js` | Enemies + NPCs + players (examine) | SIFT with disambiguation UI, combined pool |
| `inventory.js` | Items (take, drop) | SIFT via `dispatchType/dispatchParam`; `drop all` → `confirm` result (`drop __allconfirm`, sheds everything incl. equipped); `drop all <filter>` → `matchAll`, drops every match with no prompt. Equipped items are included and `recomputeArmor`/`recomputeInsulation` re-run if any dropped item was equipped |
| `inventory.js` | Players (give) | SIFT scoring only, error on ambiguous |
| `housing.js` | Windows (open, close) | SIFT with disambiguation UI |
| `plugins/gps` | Zones/locations (`gps <name>`) | SIFT UI over `getAllZones()`; replay via `dispatchType: 'gps.navigate'` |

---

## Adding a New Command

1. **New verbs belong in a plugin** (CLAUDE.md: engine builtins are for core verbs only). Export it in
   the plugin's `commands` object and declare it in `plugin.json`; add a `regress.js` check.
2. If it takes a named target: use `siftResolve` for the lookup, never `.find()` + `.includes()`.
3. If targeting players specifically: map `handle → name` before passing to SIFT (see player pattern above).
4. Ambiguous picks from a plugin verb replay via `dispatchType`/`dispatchParam` + a registered Action —
   never `{ verb }` (that route only reaches builtins).
5. If the command has complex args that would break on replay: use SIFT scoring but return "be more specific" on ambiguous.
6. If it's a new combat verb (should use FATE): add it to `COMBAT_VERBS` in `sift.js` and use `resolveForCommand`.
7. Run `npm run test:regress` before deploying.
