# Plugin Standard

Every plugin in `/plugins/<name>/` is a self-describing unit. This document defines the manifest
schema, the required README, and the doc-generation convention adopted in the 2026 architecture
rework. See [docs/adr/](adr/) for the architectural decisions that define Action / Event / Hook / Tag.

## Files

```
plugins/<name>/
├── plugin.json     # manifest (required)
├── index.js        # server module: exports hooks / commands / actions / routeHandler (required)
├── regress.js      # regression suite (optional — run by tests/regress.js, never loaded in production)
├── client.js       # client module (optional — deferred; not loaded yet, see rework plan §8)
└── README.md       # generated/maintained from plugin.json (required)
```

## `plugin.json` schema

Existing fields (`name`, `version`, `description`, `hooks`, `commands`, `routePrefix`) are unchanged
and stay valid. Two loader-wired fields were added in the engine/plugin boundary work (2026-07):

- `"after": ["otherPlugin", …]` — load after the named plugins. Load order is otherwise
  filesystem-alphabetical; declare this whenever a verb override is intentional (the loader warns on
  every plugin↔plugin verb collision at boot).
- `"critical": true` — a load failure aborts boot instead of logging and skipping. Use for plugins
  the game is unplayable without (weapon).

The rework also adds optional declarative fields so a plugin's full surface is inspectable
without reading its code, and so READMEs can be generated:

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
  "extensionPoints": ["quest.objectiveType"]  // hooks/events others can plug into
}
```

Unknown fields are ignored by the loader; declaring them is for documentation and tooling, not runtime
behavior. The loader (`server/engine/plugins.js`) continues to wire only `hooks`, `commands`, and
`routePrefix`; `actions`/`events`/`ticks` are registered imperatively in `index.js` today and
*described* here for inspection. (A future pass may have the loader read them directly.)

## README requirement

Every plugin has a `README.md` with these sections (mirroring `plugin.json`):

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
generated from it, leaving only **Purpose** and prose as hand-written. Missing READMEs are generated
on demand. Existing plugins gain their declarative `plugin.json` fields and README in the phase that
gives them Actions/Events (most have none until then) — backfilling empty sections now would be noise.

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
