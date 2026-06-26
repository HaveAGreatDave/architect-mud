# Plugin Standard

Every plugin in `/plugins/<name>/` is a self-describing unit. This document defines the manifest
schema, the required README, and the doc-generation convention adopted in the 2026 architecture
rework. See [docs/adr/](adr/) for the architectural decisions that define Action / Event / Hook / Tag.

## Files

```
plugins/<name>/
├── plugin.json     # manifest (required)
├── index.js        # server module: exports hooks / commands / actions / routeHandler (required)
├── client.js       # client module (optional — deferred; not loaded yet, see rework plan §8)
└── README.md       # generated/maintained from plugin.json (required)
```

## `plugin.json` schema

Existing fields (`name`, `version`, `description`, `hooks`, `commands`, `routePrefix`) are unchanged
and stay valid. The rework adds optional declarative fields so a plugin's full surface is inspectable
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
