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

### `jack` / `jackresolve`

Hacking attack on the ATM. **No server-side skill roll gates this anymore** — the
Circuit Breach minigame (client-side, [`client/game/js/panels/circuithack.js`](../client/game/js/panels/circuithack.js))
is authoritative: winning it *is* the breach. The only server-side gate is
physically carrying a hacking device.

`jack` arms the attempt:
1. ATM must exist, not broken, zone powered, and have cash stock > 0.
2. Player must be carrying `item_hack_deck` in inventory (`hasHackDevice()` —
   plain `player_inventory` presence check, no roll). Seeded as **Hack Deck**.
3. Per-player lockout checked (`jackLockout` Map, in-memory, 5-minute cooldown
   after a failed attempt).
4. Returns `{ type: 'circuit_hack', deviceId, deviceName, skill, difficulty, resolveCmd: 'jackresolve' }` —
   `skill`/`difficulty` (effective hacking skill vs. `hack_difficulty`) only
   scale the minigame board's harshness (grid size, hazard density, sensor
   range, move budget — see `circuithack.js`), they don't gate the outcome.
   The ATM panel's own JACK button opens the minigame directly client-side
   from data already on the panel, skipping this arm step for snappier UX;
   the typed `jack` command hits this path and goes through the client's
   generic `circuit_hack` dispatch handler instead.

`jackresolve <atmId> <1|0>` — fired silently by the Circuit Breach overlay when it resolves:
1. Re-validates ATM exists in the player's zone, not broken, zone powered, and the player still carries the hacking device (defense in depth in case the panel's client-side gate was stale or bypassed).
2. **Win**: grants that player MAINTENANCE access on that terminal (`atmMaintenanceAccess` Map, in-memory, keyed by atm id → Set of player ids). Skill use awarded (`awardSkillUse`). The ATM panel then shows an "EJECT ALL CREDITS" option for that player. No immediate payout.
3. **Loss**: player locked out for 5 minutes, "INTRUSION DETECTED" flavour text.

Lockout is in-memory — it resets on server restart. The ATM itself is not permanently damaged by a failed attempt, only by a successful `drain`.

### `drain`

Cashes out a terminal the player has MAINTENANCE access on (from a prior successful `jack`). (Named `drain` server-side to avoid a verb collision with the broadcast plugin's cassette-`eject`; the ATM panel button is still labelled "EJECT ALL CREDITS".)

1. ATM must exist, not broken, zone powered, cash stock > 0.
2. Player must hold MAINTENANCE access for that specific atm id (`hasMaintenanceAccess`).
3. Pays out the full `cash_stock` into the player's carried credits and bricks the terminal (`is_broken = 1`) in one atomic transaction, then revokes the player's MAINTENANCE access for that atm.

MAINTENANCE access is per-player, per-terminal, in-memory (resets on server restart) and is also cleared by the dev-panel `repair` route.

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

`deposit` and `withdraw` use the engine's `transferCredits(player, amount, type)` for the basic credit movement — this enforces the "credits can't go negative" invariant in one place. The credit movement and the follow-on `cash_stock` update are now wrapped together in a single `withTransaction()` (see [systems-economy.md](systems-economy.md) → Transactions), so they commit or roll back as one unit — the credits-moved-but-stock-stale window is closed. The `withdraw` fee path uses a guarded `bank_credits >= amount` UPDATE inside that transaction so a concurrent second withdrawal can't overdraw. `drain` likewise wraps its cash payout + terminal-bricking. (The **legacy zone-flag fallback** paths do a single `transferCredits` with no follow-on write, so they're already atomic on their own.)
