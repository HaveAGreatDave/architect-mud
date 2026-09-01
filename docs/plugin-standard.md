# Plugin Standard

Every plugin in `/plugins/<name>/` is a self-describing unit. This document defines the manifest
schema, the README convention, and the doc-generation convention. See [docs/adr/](adr/) for the
architectural decisions that define Action / Event / Hook / Tag.

## Files

```
plugins/<name>/
├── plugin.json     # manifest (required)
├── index.js        # server module: exports hooks / commands / specializedActions / routeHandler (required — at least one)
├── regress.js      # regression suite (optional — run by tests/regress.js, never loaded in production)
└── README.md       # maintained from plugin.json (convention — see below)
```

## `plugin.json` schema

Core fields: `name`, `version`, `description`, `hooks`, `commands`, `routePrefix`. Three more are
read at runtime:

- `"after": ["otherPlugin", …]` — load after the named plugins. Load order is otherwise
  filesystem-alphabetical; declare this whenever a verb override is intentional (the loader warns on
  every plugin↔plugin verb collision at boot).
- `"critical": true` — a load failure aborts boot instead of logging and skipping. Use for plugins
  the game is unplayable without (weapon).
- `"objectGatedCommands": { "<verb>": { "discoverVia": "<tag-or-flag>", "exposed": false, "note": "…" } }` —
  verbs that only work near a specific world object. **The regression harness enforces this**
  (layer 1b): the verb must be in `commands[]`, and unless `exposed:false` marks it a logged gap, a
  specialized action registered under the `discoverVia` **tag or flag** must surface it on that
  object's examine. A verb the player can't find is invisible content.
  For a verb that stays an ordinary command-map verb (its handler self-resolves the object), close the
  loop with a **declaration-only** specialized action — `{ verb, requiredFlag: "<flags key>", handler: null }`.
  It registers nothing at dispatch; it exists purely so `availableActions()` advertises the verb on
  every object carrying that flag. `requiredTag` works the same way and is preferred where the object
  is already tagged.

Optional declarative fields make a plugin's full surface inspectable without reading its code, and
let READMEs be generated:

```jsonc
{
  "name": "quests",                 // required, unique
  "version": "1.0.0",               // required
  "description": "...",             // required, one line

  "commands": ["quests", "abandon"],          // player verbs registered (existing)
  "hooks": ["zone.describeRoom"],             // request/response hooks consumed (existing)
  "routePrefix": "/quests",                   // REST prefix, if any (existing)

  // --- new declarative fields (all optional) ---
  "actions": {
    "registers": ["START_QUEST", "TURN_IN"], // Action types this plugin owns
    "tagGated": [                            // specialized Actions and their required Tag
      { "verb": "eat", "requiredTag": "edible" }
    ]
  },
  "events": {
    "emits":    ["quest.started", "quest.completed"],
    "consumes": ["item.given", "enemy.killed", "zone.entered"]
  },
  "ticks": ["1m"],                            // scheduler cadences subscribed (see scheduler.js)
  "dependencies": ["economy"],                // other plugins/services required at load
  "config": {                                 // declared, validated config surface
    "maxActiveQuests": { "type": "int", "default": 10 }
  },
  "dataSchema": ["quests", "player_quests"],  // DB tables this plugin owns
  "extensionPoints": ["quest.objectiveType"], // hooks/events others can plug into
  "devPanel": {                               // a dev-panel tab this plugin brings
    "id": "quests",                           // PANELS key; must not collide with a core panel
    "nav": "❗ Quests",                        // the sidebar row, glyph included
    "scripts": ["panel.js"],                  // loaded IN ORDER from this plugin's folder
    "navAlias": null                          // highlight another panel's nav row instead
  }
}
```

Unknown fields are ignored by the loader; declaring them is for documentation and tooling, not runtime
behavior. The loader (`server/engine/plugins.js`) wires only the manifest's `hooks`, `commands`,
`routePrefix` and `devPanel` (plus the module's own `specializedActions` export);
`actions`/`events`/`ticks` are registered imperatively in `index.js` and *described* here for inspection.

**`devPanel` is real wiring, not documentation.** It is the one place a plugin can add an operator
surface without touching `client/devpanel/`: the shell reads `/dev/plugin-panels.json` at boot, appends
the nav row, and loads each script from `/dev/plugin/<plugin>/<file>.js`. The script then calls
`registerDevPanel({ id, … })` — see [devpanel-js.md](devpanel-js.md#plugin-panelsjs).

The split is deliberate. The manifest carries only what the shell needs **before** the script runs (the
nav row and the file list); `fetch` and `render` are functions and a manifest is JSON, so the script
supplies them — the same division as `plugin.json` declaring what a plugin offers and `index.js`
providing it.

⚠ **`scripts` is ordered**, because these are classic browser scripts sharing one global scope: a panel
that registers using a helper defined in a sibling file needs that sibling listed first.
⚠ **Only declared filenames are served.** The route checks the request against the manifest, so a
plugin's `index.js` is not readable through it, and a `script` that is not a plain `.js` filename is
rejected at load with a warning.
⚠ **`client:smoke` parses these off the manifest** — nothing else does, since the loader imports
`index.js` and never the panel.

**`dataSchema` is documentation, not wiring — and it does not export your content.** Listing a table
here records ownership; it does **not** add the table's DDL to `SCHEMA_SQL`, nor its rows to the git
seed. Both are separate, deliberate steps:

- **Schema:** add the idempotent DDL to `SCHEMA_SQL` in `server/models/schema.js`; `npm run db:schema`
  applies it to your **local** dev DB. Production gets it through the **CODEX deploy** — a push to
  `main`, where CI applies the full `SCHEMA_SQL` + additive content in one regress-gated, backed-up
  transaction (see [content-pipeline.md](content-pipeline.md)). Don't run `db:schema` against
  prod, and don't hand-write a prod one-shot for plain schema DDL. Never a boot-time migration.
- **Content rows:** if the table holds *authored world content* (not per-player runtime state),
  classify it by adding an entry to `REGISTRY` in `server/models/content-registry.js`, in FK-safe
  insertion order (`CONTENT_TABLES` is derived from it; `backup.routes.js` just re-exports).
  This allowlist is what the dump ships — into both the git content tree and the prod deploy. **Miss it and your content restores
  empty on a fresh DB with no error** — this is the class of bug that hid the `quests` table. Declaring
  the table in `dataSchema` is *not* enough; that list is documentation, not wired to the export.
- **Data transformations** (backfilling or rewriting *existing* rows — e.g. moving data between
  columns) are the one thing the additive deploy can't do (`INSERT … ON CONFLICT DO NOTHING` never
  touches existing rows). Those still need a hand-written one-shot, run against prod after the deploy.

## Ticks and DB burden

A plugin's recurring work shares one small connection pool with every player command — prod
Postgres is remote, so each `query()` is a full network round trip holding a pool slot. Rules for any
scheduled work:

- **Register EVERY recurring tick through `scheduler.js`** (`schedule('1m', fn)`), never your own
  `setInterval` — **not just the ones that touch the DB.** The scheduler jitters cadence phase and
  staggers same-cadence subscribers so tick convoys can't starve the pool at a minute boundary —
  **and it idle-gates every callback by default** (below). A raw `setInterval` that awaits `query()`
  bypasses both and is the bug class that pinned Neon's compute awake 24/7 (surveillance's camera
  refresh).
  **This rule is swept by `npm run test:regress`** (layer 1) — a raw `setInterval` anywhere under
  `plugins/` fails the build.
  The "only if it touches the DB" carve-out used to be the wording here, and it is exactly how this
  drifted: thirteen plugin ticks were raw `setInterval`s judged DB-free at the time, six of them
  hand-rolling the idle guard and seven with no guard at all — each one live-ammo for the day someone
  adds a `query()` inside it. Whether a tick queries today is not a property you can rely on
  tomorrow, so the rule no longer depends on it.
  **The only exemption is a timer tied to the lifetime of ONE object** — a player's trip, a card
  table's shuffle loop — created and cleared with that object, where idle-gating is meaningless.
  Those keep a raw `setInterval` and must be listed in `SESSION_TIMER_FILES` in `tests/regress.js`
  with a reason. (The engine additionally exempts the 1 s combat tick and the WS/keepalive
  infrastructure timers, which must run on an empty world; both are documented at their call sites.)
- **Idle-gate is automatic — the scheduler skips your callback entirely when `hasActivePlayers()` is
  false.** The guard is not yours to type — forgetting it is safe. This exists because a clock-driven
  `query()` on an empty world keeps a pool connection alive inside its idle window, so Neon's compute
  never suspends (scale-to-zero) and the empty server bills 24/7. Derive state from the game clock or
  `resolve_at`-style timestamps so the first tick after a login catches up correctly (see
  sportsleague/sportsbet). **Opt out only for a tick that genuinely must run on an empty server** —
  pass `schedule(cadence, fn, { runWhenEmpty: true })`, and reserve it for pure in-memory continuity
  work (e.g. advancing the world clock) that costs no DB round trip.
- **No queries in loops** — batch with `WHERE id = ANY($1)` or a `GROUP BY` aggregate — and
  **diff-gate recurring writes** so a stable world writes nothing.
- **Decide where your data lives before querying for it.** Hot paths (per-move gates, event
  subscribers on `zone.entered`, per-swing hooks) must not add awaited round trips; see
  [Read Tiers in architecture.md](architecture.md#read-tiers-where-data-lives-at-runtime) for the
  cache tiers and the write-funnel safety test.

## README convention

A plugin's `README.md` carries these sections (mirroring `plugin.json`):

```md
# <name>

**Purpose** — one paragraph: what gameplay domain this plugin owns.

## Registered actions
<generic/specialized Actions, with required Tags>

## Events emitted
<event name — when it fires — payload shape>

## Events consumed
<event name — what this plugin does in response>

## Tick usage
<cadences subscribed and what runs on each>

## Dependencies
<other plugins/services this relies on>

## Config
<config keys, types, defaults>

## Data schema
<tables owned and their shape>

## Extension points
<hooks/events other plugins can use to extend this one>
```

## Doc-generation convention

`plugin.json` is the source of truth; the README's machine-listable sections (Registered actions,
Events emitted/consumed, Tick usage, Dependencies, Config, Data schema, Extension points) are
generated from it, leaving only **Purpose** and prose as hand-written. Most plugins have no README
yet — write one when the plugin gains Actions/Events worth listing; backfilling empty sections is noise.

**And the manifest wins arguments, which is now a gate.** `npm run docs:readmes`
([scripts/docs/readmes.mjs](../scripts/docs/readmes.mjs)) runs inside `docs:lint`, so it is on every
regress and every push. It fails when a README files a verb under work-not-done — a section headed
"Not yet built", "Later slices", "TODO", "Deferred" — while `plugin.json` **declares** that verb. The
loader registers exactly what the manifest lists, so a declared verb cannot be future work; either the
prose is stale or the manifest is wrong, and both are worth stopping for. It also runs `docs:lint`'s
own status-header rule over `plugins/**/*.md`.

It exists because voidwalking's README described a "walking skeleton" with "**no** loot, encounters,
parties, ghost-traces, or frontier map yet" for months, three lines above a manifest declaring `loot`,
`frontier`, `scrawl`, `camp`, `flag` and `ready`. ⚠ It reads **headings only** — a first cut that also
swept prose for a "no … yet" sentence produced three false positives across 89 READMEs, because
English puts "not" and "later" in one sentence all the time and means nothing by it.

## `regress.js` — per-plugin regression suite

The regression harness (`npm run test:regress`, [tests/regress.js](../tests/regress.js) — see
CLAUDE.md "Regression testing" for **when** to run it) automatically:

1. verifies every plugin's manifest contract (declared commands registered, declared hooks handled) —
   no per-plugin code needed for that layer, and
2. runs `plugins/<name>/regress.js` if present.

A suite is a default-exported async function receiving a test kit:

```js
// plugins/<name>/regress.js — never loaded in production, only by the harness
export default async function regress({ run, check, getPlayer }) {
  // run(input)  → drives the full dispatch pipeline as the harness's fake player
  // check(name, condition, failDetail) → records a pass/fail (name is auto-prefixed with the plugin)
  // getPlayer() → the fake player's live object (posture, zone, stats — stat_brawn etc.)
  const r = await run('myverb');
  check('myverb routed', r?.type !== 'error', r?.message);
}
```

The fake player starts opted out of MIS, unencumbered, in a real zone with exits; DB writes against
its id are no-ops. Keep suites fast and side-effect-free: assert routing, gating, and state
transitions — don't create rows. **Add a suite whenever you add a plugin or give one a new verb**;
the harness is the pre-deploy gate, so an untested verb is an unguarded verb.
