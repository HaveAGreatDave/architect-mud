# tablet

**Purpose** — Architect Tablet OS: the unified in-world app shell for Quests, Skills & Stats, Bank,
Weather, Vehicles, Properties, Settings, and a Corporation link-out. `tablet`/`os` opens the shell;
other plugins (quests, jobboard, flight, atm) register an app tile via `registerTabletApp` and wire
their own existing verbs to launch straight into it — no duplicate UI, no reimplemented game logic.

## Registered actions
None. Tablet is a UI shell over existing Actions (`START_QUEST`, `TURN_IN`, `ABANDON_QUEST`, etc. —
all owned by the quests plugin) and existing commands (flight's `accept`, atm's deposit logic via
`transferCredits`, pinch's `home`).

## Events emitted
None.

## Events consumed
None.

## Tick usage
None.

## Dependencies
None at load time. Calls into `quests`, `jobboard`, `flight`, `atm`, `pinch` lazily (dynamic
`import()` at call time) to avoid load-order coupling — those plugins likewise dynamic-import
`tablet` to launch it, so none of them need `"after"` in their manifests.

## Config
None.

## Data schema
- `bank_transactions` — Bank app's deposit ledger (`player_id`, `type`, `amount`, `balance_after`,
  `created_at`). Written by both the ATM plugin's own `deposit` command and the Tablet Bank app's
  "Deposit All" action, so Transaction History has one consistent source.
- `quests.category` — new column (idempotent `ALTER TABLE`) grouping quests for the Quests app's
  category list, independent of the mechanical `quest_type`. Falls back to a derived default
  (`Pilot Contracts` for `quest_type='flight'`, else `Quests`) when unset.
- `players.tracked_quest_id` — the single tracked quest, set by the Quests app's Track button.

## Extension points
`registerTabletApp({ id, name, icon, category, buildHome(player), buildScreen(player, screenId,
params), handleAction(player, actionId, params) })` — call this at your plugin's own module init
time to add a Home-screen tile. `buildHome` is optional (extra data merged into the tile).
`buildScreen` is required and returns the full screen payload for that app. `handleAction` is
optional; if omitted, `tabletaction` re-renders the app's current screen after the action plugin
performed its own side effect via a different command.
