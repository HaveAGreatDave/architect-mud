# Combat Flow Paths — Deferred Re-evaluation

**Status:** flagged, not actioned. Surfaced during the engine-vs-plugin source-of-truth audit
(see [source-of-truth-audit.md](source-of-truth-audit.md)). Combat dispatch is currently split across
three layers with one redundant indirection. Nothing here is a live bug — it's a structural cleanup
that deserves its own focused pass, because it touches dispatch, the Action registry (ADR-0001), and
content authoring.

## TL;DR

The player `attack`/`kill`/`k` verbs route through a **trampoline** that adds zero behavior:

```
attack rat
  → weapon plugin specialized action            (plugins/weapon/index.js:10)
  → dispatchAction({ type: 'ATTACK' })           (server/engine/actions.js:123)
  → cmdAttack()                                   (server/engine/commands/combat.js:109)
  → resolveAttack()                               (server/engine/commands/combat.js:12)
```

The `ATTACK` action handler ([actions.js:123-129](../../server/engine/actions.js#L123)) does nothing
but `import` and call `cmdAttack`. It has **no `validate`, no `requiredTag`, and emits no events** —
all combat events (`enemy.killed`, `combat.hit`, …) fire inside `resolveAttack`/`cmdAttack` regardless.
So the Action layer is pure indirection for the player path.

## The three combat entry points

| Path | Trigger | Route | Notes |
|---|---|---|---|
| **Player command** | `attack`/`kill`/`k` typed | weapon plugin → ATTACK action → `cmdAttack` | The trampoline. Empty-target and `door` cases return `undefined` and fall through to the combat.js builtins, which call the **same** `cmdAttack`. |
| **Enemy AI** | VINE behaviour tree `ATTACK` node | `ai-behaviour.js:206` → `enemyAttackPlayer` directly | **Separate switch — does NOT use the Action registry.** Independent of the player path. |
| **1-second combat tick** | sustained engagement | `gameLoop.js:142` → `resolveAttack` directly | Raw, latency-critical; deliberately never routed through the dispatcher (per ADR-0001). |

There are effectively **two unrelated things named `ATTACK`**: the actions.js registry action (player
path) and the VINE behaviour node (AI path). They share a name but no code. Do not conflate them when
refactoring.

## Single source of truth — already clean

- One implementation: `resolveAttack`/`cmdAttack` in [combat.js](../../server/engine/commands/combat.js).
  Both the player trampoline and the engine builtins terminate here. **No divergence risk.**
- Combat **state** (`combatTargetId`, `pvpTargetId`, `offlinePvpTargetId`) is entirely engine-side and
  consistent across `combat.js`, `gameLoop.js`, `movement.js`, `ai-behaviour.js`, `sift.js`. The weapon
  plugin is stateless. No `fighting`/`inCombat` legacy fields exist. No field mismatches, dead writes,
  or dead reactions.

So the cleanup is about **flow/ownership**, not correctness.

## Proposed direction: collapse player combat into combat.js

Two **independently shippable** steps:

### Step A — delete `plugins/weapon/` (safe, no content risk)
`attack`/`kill`/`k` then resolve straight to the combat.js builtins
([combat.js:638-642](../../server/engine/commands/combat.js#L638)), which already call `cmdAttack` and
already handle the empty-target (`Attack what?`) and `door` (`cmdAttackDoor`) cases. **Functionally a
no-op** for the keyboard path. After this, combat is owned by combat.js for the player command path,
while the ATTACK action remains as a thin content escape hatch (see Step B).

### Step B — unregister the `ATTACK` action in actions.js (needs a content check first)
This is the intense part. The `ATTACK` action is a **public dispatch target for content**, not just the
weapon plugin. `dispatchAction` is called with arbitrary `a.action` strings from:

- NPC dialogue option actions and node actions — [server/index.js:811](../../server/index.js#L811),
  [server/index.js:850](../../server/index.js#L850)
- Script-graph `action` nodes — [server/engine/graph.js:64](../../server/engine/graph.js#L64)

So a dev-panel-authored dialogue or script could contain `{ action: "ATTACK", params: { targetStr } }`.
Unregistering the action would silently break any such content → `"Unknown action: ATTACK"`.

**Before removing it:**
1. Grep/query the content dump for `"ATTACK"` in `dialogue_tree` and script graphs. (Cannot be verified
   from engine code — it's a DB-content question.)
2. If nothing uses it, removing the action is safe.
3. Either way, **record the decision as an amendment to ADR-0001** — it scopes combat *out* of the
   "all content mutations flow through `dispatchAction`" rule. That's defensible (combat is
   latency-critical and its own subsystem) but it's a deliberate reversal, not a silent deletion.

**Lowest-risk version:** do Step A only. Keep the ATTACK action as the content hook; drop the redundant
plugin layer.

## When this is actioned, also update

- [docs/plugins.md](../plugins.md) — remove/rewrite the **weapon** catalogue row.
- [docs/architecture.md](../architecture.md) — weapon plugin references (~lines 110, 331) and the
  combat flow diagram (~line 225).
- [docs/combat.md](../combat.md) — record the final canonical player→combat path.
- [docs/adr/0001](../scripting.md) — if Step B is taken, note combat's exemption from the canonical
  Action path.

## Open question for the re-evaluation

Should **all three** combat entry points eventually share one chokepoint, or is the current split
(player command path · AI switch · raw tick) the right shape? The tick is intentionally raw for
latency; the AI switch predates the Action system. Decide whether combat is "a subsystem with its own
front door (`cmdAttack`/`resolveAttack`)" — in which case the Action trampoline should go — or "content
like everything else" — in which case the builtins should be the thin layer and the Action path the
real one. Right now it's neither: ownership is split between the plugin, the action, and the builtins.
