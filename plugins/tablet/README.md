# tablet

**Purpose** — Architect Tablet OS: the unified in-world app shell for Quests, Skills & Stats, Bank,
Weather, Vehicles, Properties, Settings, and a Corporation link-out. `tablet`/`os` opens the shell;
other plugins (quests, jobboard, flight, atm) register an app tile via `registerTabletApp` and wire
their own existing verbs to launch straight into it — no duplicate UI, no reimplemented game logic.

## Display Mode
Settings is otherwise pure client-side localStorage, with one exception: **Display Mode**
(`displaymode visual|text`, Settings → General). It is the game-wide switch between a system's
graphical presentation and its text version — the flight display and the poker table today — and
lives in [server/engine/presentation.js](../../server/engine/presentation.js). It has to be server
state because the flight plugin reads it *on the server*, at board time, to decide whether to push a
graphical panel at all. So `settings-app.js` ships the current value down in its payload and the
client mirrors changes back through the silent verb; nothing about it is stored in the browser.
Poker's own `text`/`visual` verbs are handles on the same preference, and the verb syncs that
plugin's runtime Set through its exported `syncDisplayMode`.

At the **`log` rung the shell itself is unusable**, so `tablet`/`os` answer with a typed index of
what the device is for — [text-index.js](text-index.js), one line per visible app listing the verbs
that reach that feature. The smartbar chip sends the literal verb, so the button and the typed
command get the same thing. `tablet verbs` forces the index at any rung. Verbs are declared per app
(`verbs: []` on the appDef) so a tile registered from another plugin can carry its own, and a
regress case sweeps them all against the live command registries. See
[docs/systems-display-mode.md](../../docs/systems-display-mode.md#the-tablet-at-the-log-rung--an-index-of-verbs).

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

## Sports (`sports-app.js`)

The league desk for both codes. Owns NO data: standings, the per-player races and
season state all arrive through the **sportsleague** and **broadcast** plugins' registered
Actions, never their tables — which is what keeps a leaderboard from ever contradicting
the game that just aired.

- **Deadball** — W/L/PCT/RDIF, plus batting average, home runs and RBI.
- **Cluster Puck** — W/L/OTL/PTS/GD, plus the scoring race and the season casualty count.
- **Tap a club** for its card: league position, current streak, last five results, and
  the next time they are on.

**The spoiler rule.** Every game is a pure function of its slot, so the result of a
fixture that has not aired is computable right now. The team card therefore returns the
matchup and the airtime for an upcoming game and *nothing else* — the scores are
computed (there is no way not to) and dropped. A regress assertion checks no score can
reach that row, because printing one would spoil the broadcast this whole system exists
to make worth watching.

`broadcast.getTeamCard` is bounded on both sides (24 slots back, 24 forward): it runs on
a tablet tap, and every slot inspected is a full game sim.
