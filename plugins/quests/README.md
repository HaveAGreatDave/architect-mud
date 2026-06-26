# quests

**Purpose** — owns the Quest domain: goals with objectives that players accept, progress, and turn
in. Quests are authored as data (`quests` table) and started/turned-in through Actions, so an NPC
dialogue node or a script drives the same lifecycle a future command would. Objective progress is
never written by the kill/give/move code — this plugin subscribes to the Events those Actions emit
and advances objectives itself (ADR-0002).

## Registered actions

- `START_QUEST {quest_id}` — adds the quest to the player (or restarts a `repeatable` one); emits `quest.started`.
- `ADVANCE {quest_id, index?, amount?}` — manual objective bump (dialogue/script); emits `quest.advanced`.
- `COMPLETE {quest_id}` — flips a met quest to `completed` (tracking usually does this automatically); emits `quest.completed`.
- `TURN_IN {quest_id}` — pays out `rewards` (credits/items/flags) and marks `turned_in`; emits `quest.turned_in`.

All four are generic Actions (no required Tag), dispatchable from any Source. Registering them is what
un-stubs quest dialogue-actions — the dialogue handler already dispatches whatever Action a node names.

Each transition also mirrors the quest's status into a player Flag named after the quest id
(`<quest_id>` = `active` | `completed` | `turned_in`). Dialogue/Script Conditions gate options on it
through the normal Flag mechanism — e.g. show "Accept" only when the flag is `unset`, and "Turn in"
only when it equals `completed`:

```jsonc
{ "next": "accept", "label": "Accept",  "conditions": { "flag": "quest_pest_control", "op": "unset" } }
{ "next": "turnin", "label": "Turn in", "conditions": { "flag": "quest_pest_control", "op": "eq", "value": "completed" } }
```

## Events emitted

- `quest.started`   — `{actor, quest_id}` when a quest is accepted.
- `quest.advanced`  — `{actor, quest_id, progress}` when any objective counter changes.
- `quest.completed` — `{actor, quest_id}` when all objectives are met.
- `quest.turned_in` — `{actor, quest_id}` after rewards are paid.

## Events consumed

- `enemy.killed`  → advances `kill` objectives whose `target` substring-matches the enemy name.
- `item.given`    → advances `give` objectives on the **recipient** whose `item_id` matches.
- `zone.entered`  → advances `visit` objectives whose `zone` matches.

## Tick usage

None.

## Dependencies

`economy` (`adjustCredits` for credit rewards); the core graph-engine Actions `GRANT_ITEM` / `SET_FLAG`
for item and flag rewards.

## Config

None.

## Data schema

- `quests` — `id, name, description, objectives JSONB, rewards JSONB, repeatable, updated_at`.
  - `objectives`: `[{ type:'kill'|'give'|'visit', target?, item_id?, zone?, count?, desc }]`
  - `rewards`: `{ credits?, items?:[{item_id,quantity}], flags?:[{scope,flag,value}] }`
- `player_quests` — `player_id, quest_id, status ('active'|'completed'|'turned_in'), progress JSONB (index-aligned counters), started_at, updated_at`.

Dev CRUD lives under `/api/quests` (GET/POST, PUT/DELETE by id) for devpanel authoring.

## Extension points

None yet. New objective types are added by extending the predicates in `index.js` and subscribing to
the relevant Event.
