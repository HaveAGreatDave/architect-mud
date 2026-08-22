# storefront

Player-owned shops: buy a vacant unit on a mortgage, put your name over the door, and
sell to other players off a display counter whether or not you are online.

## The split (read this first)

The same law as apartments, for the same reason.

- **Authored config = content, on the zone.** `flags.is_storefront` marks a unit as
  claimable; `shop_price` / `shop_term` / `shop_upkeep` are the terms. These ship in the
  zone file and return identically after any restart or rebuild.
- **The deed = player data, in the `storefronts` table** (`class: 'player'` in the content
  registry — never exported). Owner, shop name, payments made, missed count, due date and
  the till balance live only in the DB where the player plays, so the deploy pipeline can
  never stamp a phantom deed over prod or delete a real one.

**Listed stock is not a table.** Putting something on the display re-owns that exact
`player_inventory` row to the synthetic handle `_shopstock_<zoneId>` (the same trick as
`_ground_<zone>` and `_container_<id>`) and stamps `custom_data.list_price`. Condition,
freshness, cook quality, potency — every instance key survives the counter, because the
buyer gets the row, not a fresh copy. Nothing else in the game can address that owner id,
so the shelf can be bought from but never looted or `take`n.

## Verbs

| Verb | Who | What |
|---|---|---|
| `deed` | anyone | The board: asking price, instalment, term — or, once sold, the proprietor, the mortgage progress and (owner only) the till. |
| `buyshop` | anyone | Sign the mortgage. First instalment down, deed transferred. |
| `renameshop <name>` | owner | Put your own name over the door. Written to the **deed**, never to the zone (a zone is content; a player's sign is not). |
| `stock <item> for <price>` | owner | Move an item from your pack onto the display at your asking price. Max 20 lines. |
| `unstock <item>` | owner | Take it back off. |
| `wares` | anyone | Read the display. |
| `buyware <item>` | anyone but the owner | Buy off the display. Plain `buy` also lands here — commerce hands off when there's no vendor NPC in the room. |
| `till` | owner | Empty the vault into your pocket. |
| `sellshop` | owner | Hand the keys back. Stock and till are returned; instalments already paid are **not**. |
| `hack <vault>` | anyone but the owner | VAULT CRACK the shop's safe and take the takings. |
| `shutters [up\|down]` | owner | Work the front shutter. Bare `shutters` toggles. |
| `hire clerk\|guard` / `sack <role>` / `staff` | owner | Payroll. |
| `pocket <item>` | anyone but the owner | Lift something off the display without paying. |
| `buyorder <item> for <price> [x<qty>]` | owner | Post a standing offer to buy. `buyorder cancel <item>` withdraws it. |
| `buyorders` | anyone | What this shop is buying. |
| `supply <item>` | anyone but the owner | Sell into a standing order, paid from the till. |

## Money

The instalment is `ceil(shop_price / shop_term)`, billed every `RENT_PERIOD_DAYS` (7)
**game** days on the game calendar — the same cadence and the same event
(`environment.dayRollover`) as apartment rent, so it scales with the game-speed knob.

Payment is drafted **till → bank → pocket**. A shop that trades pays for itself; a shop
that doesn't comes out of your account.

- Clear the term and the mortgage is **paid off** — the unit is yours outright and only
  `shop_upkeep` is charged per cycle thereafter. The upkeep is what stops an abandoned shop
  squatting a prime tile forever.
- Come up short and you get one warning. **Two consecutive misses and the lender
  repossesses** — the deed is cleared, the unit goes back on the board, and the stock on the
  shelf is seized along with it. That is the difference between defaulting and `sellshop`.

## Shutters

The front shutter is a **real `doors` row** on the interior↔facade link carrying a
`lock:shopshutter` tag, registered through the engine's `registerLockType` seam. Nothing here
re-implements a door: lock, unlock, hack (the electronic-lockpick minigame), bashing and the
burglary alarm all reach it unchanged. All the plugin adds is the auth rule — the proprietor,
nobody else — and durability.

Durability matters because **door state is runtime-only** (`world.doors` resets to authored
state on reboot). So the deed carries `shutters_closed` and the plugin re-applies it to the
physical door at load, exactly as `reconcileApartmentDoorLocks` does for `apartments.is_locked`.
A vacant unit always ships with the shutter open — an unowned shop must never be sealed, the
same law as an unrented apartment's door.

A shut shop also takes no passing trade. That's the cost of closing.

## Theft

Two surfaces, both deliberate.

**The shelf.** `pocket <item>` lifts something off the display without paying — the same shape
as a vendor's self-service cooler. The row leaves marked `custom_data.shop_unpaid`, `buyware`
settles it at the asking price, and carrying the mark out of the shop fires the `shoplifting`
charge. Whether that sticks is the ordinary witness law (a camera or a cop has to have seen
it). One difference from an NPC shop, because this is a *player's* property: **the proprietor
is always told**, witness or not — on the lift and again on the way out the door.

**The till.** The vault, below.

## Staff

`hire clerk` or `hire guard`. Staff are **not `npcs` rows**, and that is a boundary call, not
laziness: hiring is a player action, and `npcs` / `npc_residences` are *content-class* tables,
so a hired NPC would put player-created rows into the git content tree on the next
`content:export`. Staff are a `storefront_staff` row (player data) plus presence in the room
prose — the regress suite asserts that hiring writes no `npcs` row at all.

What the wage buys is **odds**. Staff don't stop a thief; they guarantee they were seen.
A lift or a vault crack in front of hired staff emits `storefront.staffWitnessed`, which
surveillance charges as a **forced witness** — the same convention `vendor.safeHackWitnessed`
and `burglary.reported` use. No camera needed, no dice.

Wages ride the billing cycle out of the same pot as the mortgage. If the shop can't cover
everything, **the staff walk before the lender forecloses** — losing your guard is the warning
shot before losing the building.

## Passing trade

A 5-minute footfall tick sells sanely-priced stock to people walking past, so a stocked shop
earns while its owner is logged off — the difference between a business and a mailbox. Two
rules keep it honest: nothing above `FOOTFALL_MAX_MARKUP` (1.8×) the item's base value ever
sells, so a shelf of absurdly-marked-up junk sits there gathering dust exactly as it should;
and a shuttered shop takes nothing.

## Buy orders

`buyorder <item> for <price>` posts a standing offer, and anyone can `supply` into it while
you're away. **The till is the wallet** — an order the till can't cover simply doesn't fill,
which is the honest failure mode and needs no escrow. Goods bought this way land on the shelf
unpriced, waiting for you to `stock`-price them.

## Cameras

Cameras are the [surveillance plugin's](../surveillance/), and they already work in your shop
with no integration on this side — `plant` drops one in any zone, and the vault crack's
`hack.success` is already charged if a live camera saw it. The only thing this plugin adds is
telling you so: `deed` reports whether the unit is covered and points at `plant` if it isn't.

## The vault

Furniture flagged `shop_vault: true` (with an optional `hack_difficulty`, default 6) holds
the till. It runs the same VAULT CRACK contract as a vendor safe — arm → client minigame →
`tillcrackresolve`, with the amount re-read server-side under a row lock so the payout
can't be spoofed and two crackers can't both empty it. Arming it pings the proprietor
wherever they are; a successful crack emits `hack.success` for surveillance to charge.

**A carried `hack_device` is required** (`hasHackDeck`, [hack-gear.js](../../server/engine/hack-gear.js)),
as it is for the ATM, the hololock and the vendor safe — and a failed attempt now costs the
deck condition (`damageHackDeck`). Both were missing: you could open a vault bare-handed while
the room-broadcast announced that you'd "jacked a deck" into it, and a botched crack was free,
which made the cheap high-penalty Pry-Bar strictly better than nothing and never worse. The gate
sits **after** the no-vault fall-through (`return undefined`) and **before** the lockout, so a
`hack` aimed at something else in the room still reaches it and an attempt you were never
allowed to make can't burn five minutes.

Leaving takings in the till is a real risk. `till` early and often.

## Flags

| Flag | Scope | Meaning |
|---|---|---|
| `is_storefront` | zone | This unit is claimable. |
| `shop_price` | zone | Total asking price. Default 6000. |
| `shop_term` | zone | Instalments to clear it. Default 8. |
| `shop_upkeep` | zone | Per-cycle charge once paid off. Default 40. |
| `shop_vault` | furniture | This piece holds the till and is `hack`able. |
| `shop_display` | furniture | Prose/affordance anchor for the counter. Listings are zone-scoped, so this is decoration, not storage. |
| `lock:shopshutter` | door tag | The front shutter. Auth = the proprietor; `canHack` so there's a way in. |

## Events

Emits `storefront.bought`, `storefront.sale`, `storefront.repossessed`, `shoplifting.caught`,
`hack.success` on a vault crack, and `storefront.staffWitnessed` (consumed by surveillance as
a forced witness).

## Shipped units

Four vacant units across Coldwater, priced by frontage:

| Unit | Where | Price | Term | Upkeep |
|---|---|---|---|---|
| Unit 4, Marrow Street | beside the KSAB/Sentinel media strip | 9000c | 10 | 60c |
| Unit 9, Marrow Street | the pawn-and-fence end | 6000c | 8 | 45c |
| Unit 7, Voss Avenue | a kiosk off the Voss parade | 4500c | 8 | 32c |
| Unit 3, Kessler Street | corner unit under the flats | 3200c | 8 | 24c |

## Not built yet

- **A clerk who is a real walking NPC.** A hired hand is presence + odds, for the content/player
  boundary reason above. Giving them a body means solving "a player action creates an NPC"
  first — probably a runtime-only NPC class the exporter skips.
- **Corp-owned shops.** Ownership is strictly personal (`ownsShop` is deliberately not
  `playerControlsApt`'s org-aware shape).
- **Hiring another *player* to mind the counter.** `isStaffOf()` is the stub seam for it.
- **Buying goods over the counter face-to-face** — that's what `trade <player>` is for, and it
  already works anywhere including inside your shop.
