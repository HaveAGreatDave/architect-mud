# ATM System (As Built)

Physical cash terminals with finite stock, power dependency, faction network gating, and hackable dispensers. Primary file: [`plugins/atm/index.js`](../plugins/atm/index.js).

---

## Schema

Two tables in `server/models/schema.js`:

### `atm_networks`

A banking faction/brand. Controls fee rates, withdrawal limits, UI colour, and faction reputation gating.

```
id TEXT PK
name TEXT               — displayed in the panel header and fee messages
color TEXT              — accent hex, e.g. '#00ff88'
fee_rate NUMERIC        — fraction deducted per withdrawal (0.05 = 5%); fee goes to the network (evaporates)
withdrawal_limit INT    — per-transaction cap in credits
min_faction_rep INT     — minimum reputation with faction_id to use this network (-200 = open to all)
faction_id TEXT         — which faction reputation is checked (NULL = no gate)
```

### `atm_units`

One row per placed ATM terminal. `id` matches the `furniture.id` of the furniture item that has the `atm` flag.

```
id TEXT PK              — same as furniture.id
network_id TEXT FK      — optional; NULL means "CENTRAL BANK" defaults
cash_stock INT          — current cash in the machine (drained by withdrawals)
cash_max INT            — refill target for the replenish tick
replenish_interval_hours INT — hours between automatic refills (default 6)
last_replenish BIGINT   — unix seconds of last refill
hack_difficulty INT     — target number for hacking skill check (default 5)
is_broken INT           — 0 = operational; 1 = broken (all operations blocked)
```

---

## Furniture integration

An ATM is a normal **furniture** row with the `atm` flag set in `flags`. The ATM plugin:

1. Detects furniture with `jsonb_exists(f.flags, 'atm')` in `findAtmInZone()`.
2. Expects a corresponding `atm_units` row with the same `id`.
3. Falls back to the legacy `zone.flags.has_atm` zone-flag if no ATM furniture is found — so old zones with just a flag still work for basic deposit/withdraw.

To place a functional ATM:
1. Create a furniture item and set the `atm` flag.
2. Add a row to `atm_units` with the matching `id`, set desired `network_id`, `cash_max`, `hack_difficulty`, etc.

---

## Player commands

### `atm [name]`

Opens the ATM panel UI in the game client (`{ type: 'atm_panel', … }`). Optional name argument targets a specific terminal if multiple are in the zone. Returns:

```js
{
  atmId, name,
  network: { id, name, color, fee_rate, withdrawal_limit },
  cashStock, cashMax,
  powered: bool,
  isBroken: bool,
  player: { credits, bank_credits }
}
```

The client renders this as an interactive ATM panel (`client/game/js/panels/atm.js`). `use <atm-name>` reaches the same panel via the `specializedActions` path (tag `atm`).

### `deposit <amount|all>`

Moves carried credits → bank. Checks:
1. ATM exists in zone (legacy fallback if zone flag only).
2. ATM is not broken.
3. Zone is powered.
4. Player meets network faction rep requirement.

Deposit increases `atm_units.cash_stock` up to `cash_max`. The machine fills as cash flows in.

### `withdraw <amount|all>`

Moves bank credits → carried. Checks (in order):
1. ATM exists, not broken, zone powered, faction rep OK.
2. Amount ≤ `withdrawal_limit`.
3. Amount ≤ `cash_stock`.
4. Player has enough banked: `banked >= amount + fee`.

`withdraw all` computes the maximum withdrawable: `min(cash_stock, withdrawal_limit, floor(banked / (1 + fee_rate)))`.

Fee calculation: `fee = ceil(amount × fee_rate)`. The fee is deducted from bank alongside the withdrawal amount; only the raw amount reaches the player's carried credits. The fee evaporates (no faction receives it — it's a network tax).

After a successful withdrawal, `cash_stock` decreases by `amount` (not including the fee).

### `jack`

Hacking attack on the ATM. Requires hacking skill.

1. ATM must exist, not broken, zone powered, and have cash stock > 0.
2. Per-player lockout checked (`jackLockout` Map, in-memory, 5-minute cooldown after any failed attempt).
3. `skillCheck(player, 'hacking', hack_difficulty)` — rolls against difficulty.
4. **Success**: `cash_stock` emptied into player's carried credits; ATM set `is_broken = 1`. Skill use awarded (`awardSkillUse`).
5. **Failure**: player locked out for 5 minutes. Hard failure (margin ≥ 4) shows "INTRUSION DETECTED" with console-ID-flagged flavour text. Soft failure shows generic rejection message.

Lockout is in-memory — it resets on server restart. The ATM itself is not permanently damaged by a soft failure, only by a successful hack.

---

## Power dependency

`isZonePowered(zoneId)` checks the in-memory power map from `getPowerMap()`. Zones not in the power map (no generator assigned) are treated as powered — the ATM only goes dark when a generator explicitly cuts power.

`deposit`, `withdraw`, and `jack` all check power. `atm` (the panel command) does **not** block on power — it returns `powered: false` in the payload and the client renders the panel with a "screen dark" state.

---

## Faction gating

`checkFactionAccess(player, atm)` queries `player_faction_rep` when:
- `atm.faction_id` is set, **and**
- `atm.min_faction_rep > -200` (−200 is the effective "no gate" sentinel)

Returns `true` if the player's rep ≥ `min_faction_rep`. Gates `deposit`, `withdraw`, and `jack` — not the panel display itself (players can see the ATM is there even if they can't use it).

---

## Replenish tick

`replenishTick()` runs every 5 minutes via `setInterval`:

```
SELECT id, cash_max, replenish_interval_hours, last_replenish
FROM atm_units WHERE cash_stock < cash_max AND is_broken = 0
```

For each row, if `now - last_replenish >= replenish_interval_hours × 3600`, sets `cash_stock = cash_max` and updates `last_replenish`. Broken ATMs are excluded.

---

## Dev panel routes (`/atm/…`)

All write routes require dev/admin/builder/designer role. Reads are open (GET).

### Units (`/atm/units`)

| Method | Path | Action |
|---|---|---|
| GET | `/atm/units` | List all ATM units with zone name, network name, power status (from live power map) |
| PUT | `/atm/units/:id` | Update any subset of: `cash_stock`, `cash_max`, `replenish_interval_hours`, `hack_difficulty`, `network_id`, `is_broken` |
| POST | `/atm/units/:id/repair` | Set `is_broken = 0` |
| POST | `/atm/units/:id/replenish` | Immediately fill to `cash_max`, update `last_replenish` |

### Networks (`/atm/networks`)

| Method | Path | Action |
|---|---|---|
| GET | `/atm/networks` | List all networks |
| POST | `/atm/networks` | Create network |
| PUT | `/atm/networks/:id` | Update network (name, color, fee_rate, withdrawal_limit, min_faction_rep, faction_id) |
| DELETE | `/atm/networks/:id` | Unlink all ATMs from this network, then delete |
| POST | `/atm/networks/:id/inject` | Fill all non-broken ATMs on this network to `cash_max` |

### Bulk (`/atm/replenish-all`)

| Method | Path | Action |
|---|---|---|
| POST | `/atm/replenish-all` | Fill every non-broken ATM across all networks |

---

## Legacy fallback

Commands also handle zones that have only `zone.flags.has_atm` set (no furniture, no `atm_units` row). In this mode:

- No power check, no faction check, no withdrawal limit, no fee, no cash stock.
- `deposit`/`withdraw` use `transferCredits()` directly.
- `atm` returns a simple text summary instead of an `atm_panel` message.

This keeps zones built before the ATM plugin working without migration. New content should always use proper ATM furniture + `atm_units`.

---

## `transferCredits()` vs direct write

`deposit` and `withdraw` use the engine's `transferCredits(player, amount, type)` for the basic credit movement — this enforces the "credits can't go negative" invariant in one place. The credit movement and the follow-on `cash_stock` update are now wrapped together in a single `withTransaction()` (see [systems-economy.md](systems-economy.md) → Transactions), so they commit or roll back as one unit — the credits-moved-but-stock-stale window is closed. The `withdraw` fee path uses a guarded `bank_credits >= amount` UPDATE inside that transaction so a concurrent second withdrawal can't overdraw. `jack` likewise wraps its cash payout + terminal-bricking. (The **legacy zone-flag fallback** paths do a single `transferCredits` with no follow-on write, so they're already atomic on their own.)
