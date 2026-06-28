# Command System

## Overview

Commands enter via WebSocket (`{ type: "command", command: "..." }`), routed through `server/engine/commands/index.js`, which dispatches to domain handler files. The dispatch chain:

1. **SIFT intercept** — if the player has an active selection state, handle their response (number, next/prev, cancel).
2. **Sleep intercept** — wake the player if sleeping, then re-run the command.
3. **Multi-word MIS intercepts** (`jerk off on`, `eat out`) — regex-matched before normal parsing.
4. **Plugin commands** (`fireCommand`).
5. **Specialized actions** (`fireSpecializedAction`) — tag-gated (doors, containers, food, weapons, etc.).
6. **Cosmetic machine pre-intercept** for `use`.
7. **Builtins** — the `Map` built from all domain handler exports.

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
- Entry points: `resolve(query, candidates, context)` — SIFT only.

### Selection State (disambiguation UI)

When SIFT returns `ambiguous`:
1. Call `createSelectionState(player.id, candidates, { verb })` — stores state keyed by player id, expires after 60s.
2. Return the formatted page: `formatSelectionPage({ allCandidates, visibleIndex: 0, pageSize: 5 })`.
3. The player types a number (1–5), `next`, `prev`, or `cancel`.
4. `index.js` intercepts the next command via `advanceSelectionState` and replays the original command with the chosen candidate's name.

The stored `verb` must be a key present in the `builtins` map so the handler can be looked up for replay. If it isn't (e.g. multi-word commands like `jerk off on`), skip the disambiguation UI and return a "be more specific" error instead.

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
  createSelectionState(player.id, r.candidates, { verb: 'give' });
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
| `combat.js` | Enemies (attack) | FATE via `resolveForCommand` |
| `combat.js` | Players (attack, loot, steal) | SIFT with disambiguation UI |
| `social.js` | NPCs (talk) | SIFT with disambiguation UI |
| `social.js` | Players (obama) | SIFT with disambiguation UI |
| `economy.js` | NPCs (shop) | SIFT with disambiguation UI |
| `economy.js` | Vendor stock items (buy) | SIFT with disambiguation UI |
| `world.js` | Enemies + NPCs + players (examine) | SIFT with disambiguation UI, combined pool |
| `inventory.js` | Items (take, drop) | SIFT via `dispatchType/dispatchParam` |
| `inventory.js` | Players (give) | SIFT scoring only, error on ambiguous |
| `housing.js` | Windows (open, close) | SIFT with disambiguation UI |
| `bodily.js` | Players (pee, poop on target) | SIFT with disambiguation UI |
| `mis.js` | Players (all MIS targeting) | SIFT via `resolveTarget`/`resolveTargetMis` |

---

## Adding a New Command

1. Add a handler function to the appropriate domain file (or a new one).
2. Export it in that file's `handlers` object.
3. If it takes a named target: use `siftResolve` for the lookup, never `.find()` + `.includes()`.
4. If targeting players specifically: map `handle → name` before passing to SIFT (see player pattern above).
5. If the command has complex args that would break on replay: use SIFT scoring but return "be more specific" on ambiguous.
6. If it's a new combat verb (should use FATE): add it to `COMBAT_VERBS` in `sift.js` and use `resolveForCommand`.
