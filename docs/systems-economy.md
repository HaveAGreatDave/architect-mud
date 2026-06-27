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
  (banked). `deposit`/`withdraw` commands require the zone flag `has_atm`; both accept a number or `all`.

> **Note:** `adjustCredits` and `transferCredits` write directly with the single `query()` helper — no
> transaction wraps the debit + the follow-on inventory write in `buy`/`sell`/`craft`. See the QA report
> (non-atomic economy mutations).

## Vendors

[vendor.js](../server/engine/vendor.js), driven by `shop`/`buy`/`sell`.

- **Stock** comes from the NPC's `vendor_inventory` JSON; price is `entry.price` (falling back to the
  item's `value`), discounted by faction reputation, floored at 1.
- **Buy:** debits credits via `adjustCredits`, then inserts/stacks the item. Vendor `stock` is **not**
  decremented — supply is effectively infinite (default `stock ?? 99` is display-only).
- **Sell:** pays **40% of the item's `value`**. Rejects `quest_item`-tagged and equipped items.

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

- **Skill gate:** each recipe's `skill_req` (skill → min rank) is checked against the player's trained
  skills before crafting.
- **Station gate:** `requires_station` recipes need a matching station (`stationQuality !== 'none'`).
- **Resolution:** a `skillCheck` against `base_difficulty`, plus a station bonus (refined +2, pristine +4).
  Output quality from final margin: `<0` scrap, `≥3` refined, `≥6` pristine; crits always pristine and
  double output. Catastrophic failure (`margin < −4`) consumes ingredients for nothing; ordinary failure
  leaves materials intact.
- **Quality tiers** (`QUALITY_TIERS`): scrap 0.5× → common 1.0× → refined 1.5× → pristine 2.0× →
  architect-grade 3.0× (a multiplier on output stats; tier is stored in the item instance's `custom_data`).

> **Known bug:** the `recipes` command queries `SELECT skill_id, rank FROM player_skills`, but the live
> skill column is `trained` (the `rank` column is legacy/dead). So `recipes` reads every skill as 0 and
> hides any recipe with a non-zero skill requirement — yet `craft` (which reads `trained` correctly) will
> still make it. See the QA report.

## IP & raising stats

[ip.js](../server/engine/ip.js). IP is the single advancement currency.

- **Minting:** `awardSkillUse` (on a successful skill use) → `mintIp(playerId, skillDelta)` =
  `skillDelta × 100 × ip_per_skill_point`. A barely-won check grants the most skill growth, hence the
  most IP.
- **Stat cost curve:** `statCost(current) = ceil(stat_cost_base × current^stat_cost_exponent)`
  (defaults base 10, exponent 1.5). Raising 0→1 costs 10; 9→10 costs ~310.
- **Raisable stats:** brawn, reflexes, endurance, brains, cool. `raise <stat>` spends IP and
  bumps the stat by 1; `raise`/`ip` with no arg shows current values and costs.
- **Starting IP:** `startingIp(target=3)` grants enough to buy every stat from 0 to the baseline target
  at character creation.

## Housing & apartments

[apartments.js](../server/engine/apartments.js), commands in [commands/housing.js](../server/engine/commands/housing.js).
A zone is an apartment when `flags.is_apartment` is set; ownership/lock state lives in the `apartments`
table, cached in `world.apartments`.

- **`rent`:** claims an unowned unit for its `rent_cost` (default 100c), setting base lock difficulty 4.
- **`lock` / `unlock`:** owner-only toggle.
- **`upgrade lock`:** +1 lock difficulty for 75c, up to a max of 14.
- **`pick` / `picklock`:** a `security` check vs the unit's lock difficulty on someone else's locked door.

> **Broken access control** (see the QA report): `cmdMove` never checks apartment locks, so a locked
> door does **not** stop anyone from walking in — locking only affects *sleep* eligibility. And a
> successful `pick` returns `bypassed_zone` but **nothing consumes it** and the door is never actually
> unlocked, so lock-picking has no functional effect. The lock/upgrade/pick loop is currently cosmetic
> for entry; it only gates whether you may `sleep` in the unit.

`sleep` mechanics are covered in [systems-survival.md](systems-survival.md).
