# Economy, Crafting, Progression & Housing (As Built)

Credits, banking, vendors, theft, crafting, the IP/stat-raise economy, factions, and apartments.
Primary files: [economy.js](../server/engine/economy.js), [vendor.js](../server/engine/vendor.js),
[factions.js](../server/engine/factions.js), [crafting.js](../server/engine/crafting.js),
[ip.js](../server/engine/ip.js), [skills.js](../server/engine/skills.js),
[apartments.js](../server/engine/apartments.js), and the matching command files.

## Credits & banking

[economy.js](../server/engine/economy.js) is the single mutation point so the "credits can't go
negative" invariant lives in one place.

- **`adjustCredits(player, delta)`** — returns `false` (no-op) if it would push carried credits below 0.
- **`transferCredits(player, amount, type)`** — moves between `credits` (carried) and `bank_credits`
  (banked). Both accept a number or `all`. The primary path is through the ATM plugin (see below); the engine's `transferCredits` handles only the credit ledger movement, not power/faction/stock checks.

Both primitives are **individually atomic**: the affordability check and the write are a single guarded
`UPDATE … WHERE … RETURNING` against the DB (no read-modify-write off the cached balance), so concurrent
spends can't lose updates or drive a balance negative. The in-memory `player.credits`/`bank_credits`
mirror is synced from the `RETURNING` row, which remains the source of truth. Both accept an optional
`exec` executor (defaulting to the pooled `query`) so a debit/transfer can join a caller's transaction.

### Transactions (`withTransaction`)

`withTransaction(fn)` ([db.js](../server/models/db.js)) runs `fn` inside a single `BEGIN`/`COMMIT`,
handing it a `q(text, params)` runner bound to the transaction's client (commit on resolve, rollback on
throw). It's the seam for making **compound** money ops all-or-nothing, and the primitive a shared corp
treasury will use.

The compound economy paths now each wrap their debit + follow-on write in one transaction, so a crash or
error between the two steps can't tear them:

- **`buy`** — debit + inventory insert/stack + vendor-safe credit ([vendor.js](../server/engine/vendor.js)). (Trust-flag bookkeeping stays outside — it's not a money/item tear.)
- **`sell`** — payout + inventory removal ([vendor.js](../server/engine/vendor.js)).
- **`craft`** — ingredient consume + output insert, on both the success and catastrophic-fail paths ([crafting.js](../server/engine/crafting.js)).
- **ATM `deposit`/`withdraw`** — `transferCredits` (or the fee-bearing bank debit) + the `cash_stock` update ([plugins/atm/index.js](../plugins/atm/index.js)).
- **ATM `jack`** — cash payout + bricking the terminal ([plugins/atm/index.js](../plugins/atm/index.js)).
- **`use`** — effect/credit application + item consumption ([commands/inventory.js](../server/engine/commands/inventory.js)).

## ATM terminals

`deposit`, `withdraw`, and `jack` are owned by the **atm plugin** ([plugins/atm/index.js](../plugins/atm/index.js)), not engine builtins. Full details in [docs/systems-atm.md](systems-atm.md). Summary:

- ATMs are **furniture items** with the `atm` flag. A corresponding `atm_units` row tracks `cash_stock`, `network_id`, `hack_difficulty`, and `is_broken`.
- **Networks** (`atm_networks`) define `fee_rate`, `withdrawal_limit`, faction rep gates, and the UI accent colour.
- **`deposit`**: moves carried → banked; increases `cash_stock` (machine fills up).
- **`withdraw`**: moves banked → carried; drains `cash_stock`; fee deducted from bank, only raw amount reaches player.
- **`jack`**: hacking skill check vs `hack_difficulty`; success empties `cash_stock` into player's carry and breaks the machine; failure sets a 5-minute in-memory lockout.
- **Power**: all operations check `isZonePowered()` — ATMs go dark when the zone loses power.
- **Replenish tick**: every 5 minutes the plugin refills ATMs whose `replenish_interval_hours` has elapsed.
- **Legacy fallback**: zones with only `zone.flags.has_atm` (no furniture) still work for basic deposit/withdraw with no power, faction, or stock checks.

## Vendors

[vendor.js](../server/engine/vendor.js), driven by the `shop`/`buy`/`sell` verbs — owned by the
**commerce plugin** ([plugins/commerce/index.js](../plugins/commerce/index.js)); vendor services stay engine.

- **Stock** comes from the NPC's `vendor_inventory` JSON — an array of `{ "item_id": "<id>", "price"?: <int>, "stock"?: <int> }`.
  Only `item_id` is required (the exact snake_case key — a `itemId` typo silently yields no stock; the NPC editor
  now rejects entries missing `item_id`). Price is `entry.price` (falling back to the item's `value`), discounted by
  faction reputation, floored at 1.
- **Buy:** debits credits via `adjustCredits`, then inserts/stacks the item. Vendor `stock` is **not**
  decremented — supply is effectively infinite (default `stock ?? 99` is display-only).
- **Sell:** pays `floor(value × 0.4 × (1 + Cool×0.05) × (1 + factionDiscount))`, floored at 1 — a base **40% of the item's `value`**, boosted **+5% per point of the seller's Cool stat**, and adjusted by faction reputation with the vendor (friendly rep pays more, hostile pays less — the same discount buy uses, inverted). Rejects `quest_item`-tagged and equipped items. Sell price logic lives in `computeSellUnitPrice` (`vendor.js`), shared by the actual sale and the GUI Sell-tab preview.

## Faction reputation

[factions.js](../server/engine/factions.js). Six tiers by reputation value:

| Tier | Range | Vendor price effect |
|------|-------|---------------------|
| Hostile | −1000…−200 | +20% markup |
| Unknown | −200…0 | none |
| Neutral | 0…200 | none |
| Known | 200…500 | −5% |
| Trusted | 500…900 | −15% |
| Inner Circle | 900+ | −25% |

`adjustReputation` clamps to [−1000, 9999] and reports tier changes. `isFactionHostile` is available
for faction-gated AI. Reputation is read by the vendor discount path and the (engine-side) hostility
checks.

> **Missing command:** there is **no `factions` player command** wired into the engine, even though
> `help` advertises it and the client has a render handler for it. `getPlayerFactionRep()` exists but
> nothing calls it from a command. Players currently can't view their standings. See the QA report.

## Theft

`steal` ([commands/combat.js](../server/engine/commands/combat.js)): blocked in safe zones, 60-second
per-player cooldown. A `deception` check vs difficulty 7; success lifts 10–30% of the target's carried
credits, failure broadcasts a public "caught red-handed" event. Uses `adjustCredits` both directions.

## Crafting

[crafting.js](../server/engine/crafting.js) + the [crafting plugin](../plugins/crafting/index.js)
(`craft`, `recipes` commands). Recipes are dev-panel editable, cached at boot.

- **Skill gate:** each recipe's `skill_req` (skill → min rank) is checked against the player's skill
  levels (`floor(player_skills.ip / 100)`) before crafting.
- **Station gate:** `requires_station` recipes need a matching station (`stationQuality !== 'none'`).
- **Resolution:** a `skillCheck` against `base_difficulty`, plus a station bonus (refined +2, pristine +4).
  Crits (rare) yield double output. Catastrophic failure (`margin < −4`) consumes ingredients for nothing;
  ordinary failure leaves materials intact.

Both `recipes` (the availability list) and `craft` (the actual gate) derive skill rank the same way —
`floor(player_skills.ip / 100)` — so the list and what you can build always agree. (Previously
`recipes` read the dead `trained` column and could hide recipes `craft` would still make; fixed.)

## IP, XP & raising stats

[ip.js](../server/engine/ip.js). Two linked currencies: **IP** advances individual skills, and **XP**
(earned 1:1 from IP) is spent on stats. Both are stored as whole numbers — every account's Total XP
must be a round number.

- **IP award (binary roll):** on a *successful* skill use, `awardSkillUse` → `awardIp(playerId,
  skillId, margin)` rolls **once**: `chance = ip_award_base_chance / (1 + max(0, margin) ×
  ip_award_margin_scale)`. A barely-won check (margin ≈ 0) has the best odds; the chance falls off as
  the margin grows. That chance is then scaled by a **brains** multiplier
  `1 + (stat_brains − 1) × ip_brains_bonus_per_point` (default 0.05): 1 brain (the starting value) gets
  the unmodified base rate, 21 brains doubles the per-roll odds. On a hit, exactly **1 IP** is added to that skill (`player_skills.ip`), capped at
  1000. Each award shows a `+1 IP` line in the main pane, plus a skill-level-up line at every 100
  boundary.
- **Skill level** = `floor(player_skills.ip / 100)`, 0–10. Feeds `effectiveSkill` (level + avg of the
  skill's governing stats). The old fractional `trained` column is vestigial.
- **XP model:** 1 IP silently grants 1 XP. **Total XP** is never stored — it's computed as
  `SUM(player_skills.ip) + players.bonus_xp`, so it can only ever grow. `bonus_xp` holds non-skill XP:
  the starting grant, and future sources (e.g. a one-time quest reward via `grantXp`).
- **Net XP** (the spendable amount shown to players) = `Total XP − statSpent`, where `statSpent` is the
  cumulative curve cost to reach the current stat levels. Raising a stat raises `statSpent`, which
  lowers Net — nothing is decremented, so Total XP is unchanged. If the cost curve is later retuned,
  Net can rise or **go negative**.
- **Stat cost curve:** `statCost(current) = ceil(stat_cost_base × current^stat_cost_exponent)`
  (defaults base 10, exponent 1.5). Raising 0→1 costs 10 XP; 9→10 costs ~310 XP.
- **Raisable stats:** brawn, reflexes, endurance, brains, cool. `raise <stat>` spends Net XP and
  bumps the stat by 1; `raise`/`xp`/`ip` with no arg shows current values and costs.
- **Starting XP:** new characters get `startingIp(target=3)` plus the cost of their baseline stats
  (which begin at 1) granted into `bonus_xp`, so Net XP at creation equals the old IP grant.

## Housing & apartments

[apartments.js](../server/engine/apartments.js), commands in [commands/housing.js](../server/engine/commands/housing.js).
A zone is an apartment when `flags.is_apartment` is set; ownership/lock state lives in the `apartments`
table, cached in `world.apartments`.

- **`rent`:** claims an unowned unit for its `rent_cost` (default 100c), setting base lock difficulty 4.
- **`lock` / `unlock`:** owner-only toggle.
- **`upgrade lock`:** +1 lock difficulty for 75c, up to a max of 14.
- **`pick` / `picklock`:** a `security` check vs the unit's lock difficulty on someone else's locked door.

### Lock state — source of truth

Apartment lock status lives in **two fields that are kept in sync**, each read by different mechanics:

- `apartments.is_locked` (0/1) — read by **sleep eligibility** and the **room-description text**.
- `doors.lock_state` (`'locked'`/`'unlocked'`/`null`) — read by **physical passage** ([movement.js](../server/engine/commands/movement.js) and AI movement) and the **door commands**.

The sync is **bidirectional**, so the two never drift regardless of which command was used:

- The apartment command (`apartments.js` `cmdLockDoor`) treats `is_locked` as the write target and mirrors it into every lock-tagged door touching the zone.
- The door-lock-tag command (`doors.js`, via `updateDoor` → `syncApartmentLock`) writes `lock_state` and mirrors it back into the apartment's `is_locked`.

`forcefield_locked` on a door is a separate, forcefield-owned flag layered on top (set/cleared by `activateForcefield`/`deactivateForcefield`). When changing either lock field, update through these command paths so the mirror runs — don't write one field raw.

> **Known gap** (see the QA report): a successful `pick` returns `bypassed_zone` but **nothing consumes
> it** and the door is never actually unlocked, so lock-picking has no functional effect yet. (Passage
> itself *is* gated — `cmdMove` checks `door.lock_state` — so a locked lock-tagged apartment door does
> block entry; an apartment with no physical door still only gates `sleep`.)

`sleep` mechanics are covered in [systems-survival.md](systems-survival.md).
