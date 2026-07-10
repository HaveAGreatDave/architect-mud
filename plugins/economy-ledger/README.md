# economy-ledger

**Purpose** — Append-only audit trail for the game economy. Records every credit mutation that flows through the engine's central `adjustCredits` (with a per-caller `reason` label) and takes a daily snapshot of every credit pool in the world. Nothing else reads its state; its only consumer is `tools/economy-report`, which charts circulation, faucet-vs-sink balance per system, and **unattributed drift** — the delta explained by raw-SQL credit writes that still bypass `economy.js` (flight, insurance, jail, gametable, surveillance, rent, clone-vat). Drift is the migration worklist, by design.

## Registered actions
none

## Events emitted
none

## Events consumed
- `credits.changed` — emitted by `server/engine/economy.js adjustCredits` on every successful non-zero adjustment; payload `{ playerId, delta, reason, after }` → inserts one `economy_ledger` row.
- `environment.dayRollover` — inserts one `economy_snapshots` row totaling players' carried/banked credits, org treasuries, NPC vendor floats, and ATM cassettes.

## Tick usage
none (rides `environment.dayRollover`)

## Dependencies
none

## Config
none

## Data schema
- `economy_ledger` — `id, player_id, delta, reason, credits_after, created_at` (classified `player` in the content registry)
- `economy_snapshots` — `id, game_date, player_credits, player_bank, org_treasury, vendor_credits, atm_cash, created_at` (classified `runtime`)

## Extension points
Callers of `adjustCredits(player, delta, exec, reason)` should pass a short `'system:verb'` reason label — unlabeled mutations still ledger with `reason = null`.
