# Economy, Crafting, Progression & Housing (As Built)

Credits, banking, vendors, theft, crafting, the IP/stat-raise economy, factions, and apartments.
Primary files: [economy.js](../server/engine/economy.js), [vendor.js](../server/engine/vendor.js),
[factions.js](../server/engine/factions.js), [crafting.js](../server/engine/crafting.js),
[ip.js](../server/engine/ip.js), [skills.js](../server/engine/skills.js),
[apartments.js](../server/engine/apartments.js), and the matching command files.

## Credits & banking

[economy.js](../server/engine/economy.js) is the single mutation point so the "credits can't go
negative" invariant lives in one place.

- **`adjustCredits(player, delta, exec?, reason?)`** — returns `false` (no-op) if it would push carried
  credits below 0. On success it emits **`credits.changed`** `{ playerId, delta, reason, after }`; the
  `reason` is a short `'system:verb'` source label (every caller passes one) consumed by the
  **economy-ledger plugin**, which appends one `economy_ledger` row per mutation and one
  `economy_snapshots` row per game day. `tools/economy-report` charts circulation, faucet/sink balance
  per reason, and **unattributed drift** — flow through the raw-SQL paths that still bypass this helper
  (flight, insurance, jail, gametable, surveillance, rent, clone-vat); drift is the migration worklist.
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
- **ATM `drain`** — cash payout + bricking the terminal ([plugins/atm/index.js](../plugins/atm/index.js)).
- **`use`** — effect/credit application + item consumption ([commands/inventory.js](../server/engine/commands/inventory.js)).

## ATM terminals

`deposit`, `withdraw`, and `jack` are owned by the **atm plugin** ([plugins/atm/index.js](../plugins/atm/index.js)), not engine builtins. Full details in [docs/systems-atm.md](systems-atm.md). Summary:

- ATMs are **furniture items** with the `atm` flag. A corresponding `atm_units` row tracks `cash_stock`, `network_id`, `hack_difficulty`, and `is_broken`.
- **Networks** (`atm_networks`) define `fee_rate`, `withdrawal_limit`, faction rep gates, and the UI accent colour.
- **`deposit`**: moves carried → banked; increases `cash_stock` (machine fills up). Every deposit
  also writes a `bank_transactions` ledger row (feeds the Tablet Bank app).
- **`withdraw`**: moves banked → carried; drains `cash_stock`; fee deducted from bank, only raw amount reaches player.
- **`jack`**: requires a carried `hack_device`; arms the Circuit Breach minigame (no server-side
  skill roll). Success grants **maintenance access**; the actual cash-out + bricking is the
  separate **`drain`** command.
- **Power**: all operations check `isZonePowered()` — ATMs go dark when the zone loses power.
- **Replenish tick**: every 5 minutes the plugin refills ATMs whose `replenish_interval_hours` has elapsed.
- **Legacy fallback**: zones with only `zone.flags.has_atm` (no furniture) still work for basic deposit/withdraw with no power, faction, or stock checks.

## Vendors

[vendor.js](../server/engine/vendor.js), driven by the `shop`/`buy`/`sell` verbs — owned by the
**commerce plugin** ([plugins/commerce/index.js](../plugins/commerce/index.js)); vendor services stay engine.

- **Stock** comes from the NPC's `vendor_inventory` JSON — an array of `{ "item_id": "<id>", "price"?: <int>, "stock"?: <int> }`.
  Only `item_id` is required (the exact snake_case key — a `itemId` typo silently yields no stock; the NPC editor
  now rejects entries missing `item_id`). Price is `entry.price` (falling back to the item's `value`), discounted by
  ideology reputation, floored at 1.
- **Buy:** debits credits via `adjustCredits`, then inserts/stacks the item. Vendor `stock` is **not**
  decremented — supply is effectively infinite (default `stock ?? 99` is display-only).
- **Two opt-in seams let a plugin change what a sale produces**, both registered against `vendor.js`
  and both running *inside* the sale transaction:
  - `registerPurchaseStamp(itemId, fn)` — **what state the unit arrives in.** Returns a `custom_data`
    bag seeded onto the fresh row (a ticket stamped for one showing), or a string to refuse the sale.
    A stamped unit never merges into a stack.
  - `registerPurchaseDelivery(npcFlagKey, fn)` — **where it arrives at all.** Runs in place of the
    inventory insert and owns the goods: nothing lands in the buyer's pockets. Returns the receipt
    line, `'!reason'` to refuse and roll back, or **`null` for "not mine"** so the same counter can
    still sell a shotgun over the desk. Registered against an **NPC flag, not an item tag**, because
    "does this counter deliver rather than hand over" is a property of the *vendor* — two fences
    selling the same raws would otherwise collide, and they do: `raws_counter` runs a pallet out to a
    dead drop ([systems-flight.md](systems-flight.md#ordering--the-counter-is-a-vendor-shelf)) while
    `mule_counter` books a drone drop at the Scald ([smuggle](../plugins/smuggle/README.md)).

**Shelves — one NPC, a front counter and a back room.** A `vendor_inventory` entry may carry a
`shelf` label. Entries with **no** `shelf` are the front counter: what `shop` and the implicit
"Browse your wares" option open. A labelled entry is only ever visible to an `OPEN_SHOP` action that
names that shelf (`params: { shelf: 'back_room' }`), and the label is held on the **shop session**, so
it dies with the conversation. `getVendorStock` and `buyFromVendor` both filter on it — the buy check
is load-bearing, because the client sends an item id and without it a front-counter session could buy
straight off the back room. This is what lets Sully be a bartender selling swill *and* a fence selling
precursor without his bar list ever leaking contraband.
- ⚠️ **Abort a sale by THROWING, never by returning false.** `withTransaction` commits on a falsy
  return and only rolls back on a throw, so a mid-sale bail-out that returns takes the credits and
  hands over nothing — which the sold-out-mid-transaction path silently did until 2026-07-29. Use the
  `VendorAbort` sentinel; it is caught immediately outside the transaction, becomes the refusal line,
  and re-reads `players.credits` to undo the mirror `adjustCredits` left on the live player object.
- **Sell:** pays `floor(value × 0.4 × (1 + Cool×0.05) × (1 + factionDiscount))`, floored at 1 — a base **40% of the item's `value`**, boosted **+5% per point of the seller's Cool stat**, and adjusted by ideology reputation with the vendor (friendly rep pays more, hostile pays less — the same discount buy uses, inverted). Rejects `quest_item`-tagged and equipped items. Sell price logic lives in `computeSellUnitPrice` (`vendor.js`), shared by the actual sale and the GUI Sell-tab preview.

## Ideology reputation

[ideologies.js](../server/engine/ideologies.js) (renamed from the old `factions.js`). Reputation
is now held per **ideology** (the four owner-less orgs — see [design.md](design.md) and
[systems-jobboard.md](systems-jobboard.md)) in the `player_ideology_rep` ledger. Six tiers by
reputation value:

| Tier | Range | Vendor price effect |
|------|-------|---------------------|
| Hostile | −1000…−200 | +20% markup |
| Unknown | −200…0 | none |
| Neutral | 0…200 | none |
| Known | 200…500 | −5% |
| Trusted | 500…900 | −15% |
| Inner Circle | 900+ | −25% |

`adjustReputation` clamps to [−1000, 9999] and reports tier changes. `isIdeologyHostile` is available
for ideology-gated AI. Reputation is read by the vendor discount path and the (engine-side) hostility
checks. (Both live in [ideologies.js](../server/engine/ideologies.js).)

The `ideologies` player command — alias `rep` — (view your standings, stance slider, and leaned
ideology) is owned by the **ideologies plugin** ([plugins/ideologies/index.js](../plugins/ideologies/index.js)),
which also registers `ADJUST_REPUTATION`, `ADJUST_STANCE`, and `ADJUST_PATH`.

## Theft

`steal` (owned by the **thievery plugin**, [plugins/thievery/index.js](../plugins/thievery/index.js)):
blocked in protected zones (the protection substrate — housing forcefields and `sanctuary`-tagged
zones), 60-second per-player cooldown (Flag-persisted as `steal_cooldown_until`, survives restart). A `deception` check vs difficulty 7; success lifts 10–30% of the target's carried
credits, failure broadcasts a public "caught red-handed" event. Uses `adjustCredits` both directions.

## Crafting

[crafting.js](../server/engine/crafting.js) + the [crafting plugin](../plugins/crafting/index.js)
(`craft`, `recipes` commands). Recipes are dev-panel editable, cached at boot.

- **Skill gate:** each recipe's `skill_req` (skill → min rank) is checked against the player's skill
  levels (`floor(player_skills.ip / 100)`) before crafting.
- **Station gate:** `requires_station` recipes need a matching station (`stationQuality !== 'none'`).
- **Time gate:** a craft is **not instant**. `craft` validates up front (`checkCraftReady`), then puts you
  in `posture === 'crafting'` with a `player.craftState = { recipeId, name, completeAt }`; the engine's
  [activity-tick substrate](server.md) resolves it when the clock runs out. Posture being the authoritative
  flag means every force-stand interruption — moving, attacking, being attacked, dying, `stop` — aborts the
  craft for free. **Nothing is consumed until it completes**, so an interrupted craft costs only time.
- **Resolution:** a `skillCheck` against `base_difficulty`, plus a station bonus (refined +2, pristine +4).
  Crits (rare) yield double output. Catastrophic failure (`margin < −4`) consumes ingredients for nothing;
  ordinary failure leaves materials intact. The resolve re-runs the full validation, so parts dropped or
  sold during the wait fail the craft rather than being conjured out of nothing.

### How long a craft takes

**Derived, never authored** — `craftSeconds()` in [crafting.js](../server/engine/crafting.js):

```
seconds = 3 + base_difficulty × 1.5 + maxSkillReq × 1.0 + bulk × 0.5
```

where `bulk` is ingredient units beyond one each. The current table lands in a **6–23 s** band: a Field
Bandage is near-instant, an Architect Signal Decoder pins you in place long enough to be worth ambushing.

There was a `recipes.craft_time` column for this, and it is gone. Nothing ever read it, and **35 of its 36
rows still carried the default of 3** — the standing proof that a per-recipe number with no mechanical
effect never gets tuned. Deriving instead means every existing and future recipe gets a sensible duration
with zero authoring. Note it is deliberately **not** derived from the output item's `value` the way
durability derives its condition capacity: value tracks what a thing sells for, not what it takes to make
(difficulty↔value correlate at r=0.04 across the table). If a recipe ever genuinely needs to defy the
formula, add a **nullable** override column then — not a defaulted one.

Only the `craft` path is timed. The ~23 chemistry recipes that produce drugs are claimed by the
[synthesis plugin's](../plugins/synthesis/index.js) `cook`, which already has its own minigame as the
time-and-skill gate; double-gating them would be a worse experience, not a harder one.

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
  Net can rise or fall, and **both figures are reported raw — XP CAN go negative.** `getNetXp` and
  `getTotalXp` apply no floor, so a cost-curve retune that outruns a survivor's earnings leaves them
  in genuine debt: `stats`/`raise` display the negative figure, and every spend gate is a `net < cost`
  comparison, so they must grind back up past 0 before a single point is spendable again. (The floor
  that used to hide this was removed deliberately.) The one-shot `scripts/zero-negative-xp.mjs` remains
  as the tool for *forgiving* a retune — it tops `bonus_xp` up by the shortfall to settle balances at 0.
- **Stat cost curve:** `statCost(current) = ceil(stat_cost_base × current^stat_cost_exponent)`
  (defaults base 10, exponent 1.5). Raising 0→1 costs 10 XP; 9→10 costs ~310 XP.
- **Raisable stats:** brawn, reflexes, endurance, brains, cool. `raise <stat>` spends Net XP and
  bumps the stat by 1; `raise`/`xp`/`ip` with no arg shows current values and costs.
- **Starting XP:** new characters get `startingIp(target=3)` plus the cost of their baseline stats
  (which begin at 1) granted into `bonus_xp`, so Net XP at creation equals the old IP grant.

## Housing & apartments

[apartments.js](../server/engine/apartments.js), commands in [commands/housing.js](../server/engine/commands/housing.js).
A zone is an apartment when `flags.is_apartment` is set.

**Source of truth (do not conflate these two):**
- **Authored config = content, on the zone.** Per-unit rent price is `flags.rent_cost` (₵/cycle, read via `authoredRentCost(zone)`; omit ⇒ 100c default). It ships in the zone file and returns identically after any restart/rebuild.
- **Tenancy = player data, in the `apartments` table** (`class: 'player'` in the content registry — never exported). `owner_id`/`owner_handle`/`is_locked`/`rent dates` live only in the DB where the player plays; loaded into `world.apartments` at boot straight from the DB, so a player's apartment persists across every restart and the deploy pipeline never touches it. A real tenancy always has an `owner_id`; there is no such thing as an ownerless `apartments` row (the old content-export stamped ownerless "owner_type=player" phantoms over every DB — that's fixed, and `scripts/purge-phantom-apartments.mjs` cleans any legacy residue). `lock_difficulty` is set to `BASE` on rent (the authored value was vestigial); `building_name` on a rented row is derived from the zone via `getBuildingName` at rent time.

- **`rent`:** claims an unowned unit for its authored `flags.rent_cost` (default 100c), setting base lock difficulty 4. Rent then recurs every `RENT_PERIOD_DAYS` (7) **game**-days on the game calendar — the next due date is stored in `apartments.rent_due_date` and charged on the `environment.dayRollover` event, so the billing cycle scales with the game-speed knob (`timeScale`). Non-payment auto-evicts. (Pre-existing rentals with no `rent_due_date` are lazily granted a fresh cycle on the first rollover.)
- **`lock` / `unlock`:** owner-only toggle.
- **`upgrade lock`:** +1 lock difficulty for 75c, up to a max of 14.
- **`pick` / `picklock`:** a `security` check vs the unit's lock difficulty on someone else's locked door.

### NPC homing vs. player ownership (the law)

NPCs share the same housing pool — an NPC living in a rentable unit is intended (they carry their own key, `npc_residences` tracks who lives where). The one hard rule: **an NPC may never be homed in a unit a *player* owns** (`apartments.owner_id` set — the "flag on take"). The auto-home finder (`findNearestVacantApartment`) already skips owned units, so the only way a squatter appears is a **hardcoded content `home_zone`** authored into an owned unit — the recurring "someone's in Akerson's 2A" bug that used to need a bespoke plugin per case. `reconcileNpcHomesVsOwnership()` (apartments.js) runs once at boot (after `loadNpcs` + `loadApartments`, alongside `reconcileApartmentDoorLocks`) and rehomes any such squatter to the nearest vacancy via `rehomeNpc`, making ownership authoritative over homing everywhere. It's idempotent/converging — a corrected NPC's home is unowned, so the next boot re-checks and no-ops. `npcHomedInOwnedUnit(npc)` is the pure predicate it acts on (regress-covered). Note ownership itself is **player data** (the whole `apartments` table is `class: 'player'`), so a player's deed never round-trips through git — which is *why* content can't mark a unit as owned, and why this boot-time reconcile (reading live `owner_id` from the DB) is the enforcement point rather than a content flag.

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

## Player-owned shops (storefronts)

The [storefront plugin](../plugins/storefront/README.md); commands `deed` / `buyshop` /
`renameshop` / `stock` / `unstock` / `wares` / `buyware` / `till` / `sellshop`. A zone is a
claimable retail unit when `flags.is_storefront` is set.

**Source of truth — the same split as apartments, for the same reason:**

- **Authored config = content, on the zone.** `flags.shop_price` (total asking price,
  default 6000), `flags.shop_term` (instalments to clear it, default 8) and
  `flags.shop_upkeep` (per-cycle charge once paid off, default 40), read via
  `authoredTerms(zone)`. They ship in the zone file and return identically after any
  restart or rebuild.
- **The deed = player data, in the `storefronts` table** (`class: 'player'` in the content
  registry — never exported). Owner, shop name, payments made, missed count, due date and
  the till balance live only in the DB where the player plays. Exporting a deed would do to
  shops exactly what it once did to apartments: stamp phantom ownership over every DB, and
  make a deleted file a real player losing their shop.

**Listed stock is not a table of its own.** `stock` re-owns the player's *existing*
`player_inventory` row to the synthetic handle `_shopstock_<zoneId>` (the same convention as
`_ground_<zone>` / `_container_<id>`) and stamps `custom_data.list_price`. The buyer receives
that row, so condition, freshness, cook quality and potency all survive the counter — and
because nothing else in the game addresses that owner id, the display can be bought from but
never looted, `take`n or stack-merged.

- **`buyshop`:** pays the first instalment (`ceil(price / term)`) and transfers the deed.
- **`renameshop`:** the sign is written to the **deed**, never to `zones.name` — a zone is
  content, and writing a player's shop name into one would drift git against prod on the
  next export. The room description reads the name off the deed instead.
- **Billing** recurs every `RENT_PERIOD_DAYS` (7) **game** days on the game calendar, charged
  on the same `environment.dayRollover` event as apartment rent, so it scales with the
  game-speed knob. Payment is drafted **till → bank → pocket**: a shop that trades pays for
  itself.
- **Payoff:** clearing the term sets `paid_off` and the unit is owned outright — only
  `shop_upkeep` is charged from then on. That residual is deliberate: it means an abandoned
  shop eventually lapses instead of squatting a prime tile forever.
- **Default:** one short payment is a warning; **two consecutive misses repossess** the unit
  *and seize the stock on the shelf*. `sellshop` (a voluntary surrender) returns both the
  stock and the till but refunds nothing already paid in — that gap is the whole difference
  between walking away and defaulting.
- **The vault:** furniture flagged `shop_vault` holds the till and runs the same VAULT CRACK
  contract as a [vendor safe](../plugins/vendor-safe/index.js) — **both now require a carried
  `hack_device`**, like `jack` above, and both damage the deck on a failure — arm → client minigame →
  `tillcrackresolve`, with the amount re-read server-side under `SELECT … FOR UPDATE` so the
  payout can't be spoofed and two crackers can't both drain it. Arming pings the proprietor
  wherever they are.

`buy` (commerce's verb) means the same thing over a player's counter as over a vendor's, so
when commerce finds no vendor NPC in the room it re-dispatches to the `storefront.buy_by_name`
Action before refusing. Commerce never imports the plugin — the seam is a registered Action
name, and if storefront isn't loaded the dispatch is simply unknown and `buy` refuses as it
always did.

**Not built:** a hired clerk NPC (the stock model was chosen so a vendor NPC can later be
pointed at the same `_shopstock_<zoneId>` rows without a rewrite), corp-owned shops, and
buying stock *from* players over your own counter.

### Shop risk & counterplay

- **Shutters.** The front shutter is a real `doors` row on the interior↔facade link tagged
  `lock:shopshutter`, registered through the engine's `registerLockType` seam — so lock,
  unlock, the hack minigame, bashing and the burglary alarm all reach it unchanged. The plugin
  supplies only the auth rule (the proprietor) and durability: door state is runtime-only, so
  the deed carries `shutters_closed` and re-applies it at boot, exactly as
  `reconcileApartmentDoorLocks` does for `apartments.is_locked`. A vacant unit always ships
  with the shutter open — an unowned shop must never be sealed, the same law as an unrented
  apartment's door. A shut shop also takes no passing trade.
- **Shoplifting.** `pocket <item>` lifts stock off the display, marking the row
  `custom_data.shop_unpaid`. `buyware` settles it; carrying the mark out of the shop raises the
  `shoplifting` charge under the ordinary witness law. The one departure from an NPC shop:
  because this is a *player's* property, the proprietor is always notified — on the lift and
  again at the door — whether or not anyone could prove it.
- **Staff.** `hire clerk|guard` writes a `storefront_staff` row, **not an `npcs` row**. That's
  the content/player boundary: hiring is a player action and `npcs`/`npc_residences` are
  content-class tables, so a hired NPC would land in the git content tree on the next export
  (the regress suite asserts the `npcs` count is unchanged by a hire). Staff are presence in
  the room prose plus *odds* — a lift or a crack in front of them emits
  `storefront.staffWitnessed`, which surveillance charges as a **forced witness**, the same
  dedicated-event convention `vendor.safeHackWitnessed` and `burglary.reported` use. Wages ride
  the billing cycle from the same pot; if the shop can't cover everything, the staff walk
  *before* the lender forecloses.
- **Cameras** need no integration — `plant` (surveillance) works in any zone, and the vault
  crack's `hack.success` is already charged when a live camera sees it. `deed` simply reports
  whether the unit is covered, because otherwise nobody would discover it.

### Shop income while offline

- **Passing trade.** A 5-minute footfall tick sells to NPCs walking past, so a stocked shop
  earns with its owner logged off. Priced honestly: nothing above `FOOTFALL_MAX_MARKUP` (1.8×)
  the item's base `value` ever sells, so a shelf of absurd markups gathers dust as it should.
- **Buy orders.** `buyorder <item> for <price>` posts a standing offer that anyone can
  `supply` into. **The till is the wallet** — an order the till can't cover simply doesn't
  fill, which is the honest failure mode and needs no escrow. Supplied goods land on the shelf
  unpriced.
