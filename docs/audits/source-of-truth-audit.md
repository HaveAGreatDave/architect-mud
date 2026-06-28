# Audit Prompt — Engine vs. Plugin: Single Source of Truth

A reusable prompt for finding mechanics that are implemented in **two places** (an engine handler and
a plugin), where one half is dead or the two halves read/write different fields. This class of bug is
silent: the code looks correct in isolation, but the wrong half runs at runtime. The posture/HP-regen
bug ([systems-posture.md](../systems-posture.md)) was exactly this.

## How to run

Paste the prompt below to an agent (or work through it yourself). Scope it to one subsystem at a time
(combat, posture, inventory, doors…) rather than the whole game — the cross-referencing is the work,
and a focused pass is far more reliable.

---

## Prompt

> You are auditing the Architect MUD codebase for **duplicate or split sources of truth** between the
> engine (`server/engine/`) and plugins (`/plugins/`). Background you must internalize first:
> read [docs/plugins.md](../plugins.md) (especially the **command-precedence** rule: plugin-registered
> commands run *before* engine builtins, so a colliding engine handler is dead code) and the relevant
> `docs/systems-*.md`.
>
> Audit scope: **<NAME THE SUBSYSTEM, e.g. "posture / sitting">**. Do this:
>
> 1. **Find every player verb and mechanic in scope.** List the engine handlers
>    (`server/engine/commands/*.js` `handlers` maps) and the plugin handlers
>    (`plugins/*/index.js` `commands` exports + `plugin.json` `commands`/`actions`). Use
>    `getRegisteredCommands()` semantics in `plugins.js` to determine what actually wins dispatch.
>
> 2. **Flag command collisions.** Any verb registered by a plugin that *also* has an engine builtin
>    handler → the engine handler is dead. Report each: `<verb>` — plugin `<name>` wins, engine
>    `<file>:<fn>` is dead. Confirm by tracing `handleCommand` order, don't assume.
>
> 3. **Flag split state.** For each stateful mechanic, identify the field(s) that hold its truth (e.g.
>    `player.posture`, `player.sitting`, `player.sittingOn`). Grep for every read and write of each
>    field across **both** engine and plugins. Flag when:
>    - the writer (plugin) and the reader (engine loop/combat/movement) use **different field names**
>      or shapes → one half is silently inert;
>    - the same logical state has **two fields** that can disagree;
>    - a field is written but never read (dead write), or read but never written (dead reaction).
>
> 4. **Verify, don't theorize.** For each suspected dead/split path, prove it at runtime where feasible:
>    drive the server over the WebSocket protocol (`{type:"auth",username,password}` then
>    `{type:"command",command:"…"}` — see `server/index.js` `handleAuth`/`handleGameCommand`), or add a
>    temporary log, and show the actual behaviour. A claim of "this is dead code" must be demonstrated,
>    not inferred.
>
> 5. **Report**, per finding: what's duplicated/split · which half runs · which is dead · the field
>    mismatch (if any) · the minimal unification (pick ONE source of truth) · which `docs/systems-*.md`
>    should record the contract. Do **not** refactor beyond removing the proven dead path and wiring the
>    surviving half to the single field — match existing style, keep changes surgical (per CLAUDE.md).

---

## Checklist (quick manual version)

- [ ] Read [plugins.md](../plugins.md) + the subsystem's `docs/systems-*.md`.
- [ ] List engine `handlers` verbs vs. plugin `commands` verbs in scope → any overlap is a dead engine handler.
- [ ] For each state field, grep reads and writes across `server/engine/` **and** `plugins/`.
- [ ] Writer field name == reader field name == doc'd field name? If not, that's the bug.
- [ ] Any field written-but-never-read or read-but-never-written?
- [ ] Prove each finding at runtime (WS client or a temporary log) before changing code.
- [ ] Unify on one field; update the `docs/systems-*.md` contract table.
