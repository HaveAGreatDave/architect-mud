# fuelstation

The forecourt. Two pieces of furniture and no verbs at all.

## What it is

Flash Point Fuel (923,907, the Yards) is an open forecourt: no walls, a steel canopy on four
columns over two pump islands, and a price pylon out by the kerb. You park a rig under the canopy,
you fill a jerry can at a pump, and you read the board from the road.

Almost none of that needed code. A pump is a `furniture` row carrying `fuel_source`, which the
**fillable** plugin's `fill` has read since long before there was a forecourt; a `fuel_yard` tile
is what **trucking**'s `fuel` reads. This plugin makes those two things *say* what they afford,
and it renders the sign.

## The rule

**A price on a board is never a number this plugin knows.**

Three systems already take money for fuel, and none of them agrees with the others about what a
unit is:

| system | sells | priced in |
|---|---|---|
| trucking | a tank fraction into a rig | `FUEL_FULL` ₵ per full tank (`each` = per percent) |
| fillable (via a pump here) | fluid units into a can | `flags.fuel_source` ₵ per unit |
| flight | aircraft units at a field | `REFUEL_PRICE_PER_UNIT` |

The obvious build is a table of three rows in this file. That table is wrong the moment anybody
retunes diesel, and a sign that lies about a price is worse than no sign — a player reads it and
budgets a haul against it.

So the board is a **renderer over a gather hook**. `fuel.prices` asks the room "what does anybody
here sell, and for how much", and whoever is charging answers with the number they will actually
charge. Trucking's answer lives in trucking. The regress suite reads `FUEL_FULL` out of trucking
rather than writing `380`, deliberately: a hardcoded price in the test would pass forever while
the board drifted away from the till.

## The kiosk

The forecourt model has always drawn a shop: a white box under a red parapet on the back strip,
glazed front facing the pumps, lit after dark (`drawTypeModel`, the `fuel_yard` arm, with the
comment *"somebody works here, and a forecourt with nobody in it is a fuel dump"*). It is now a
room. **Flash Point Convenience** (`zone_flashpoint_shop`) sits east off the lot and west of the tank
yard, which is where the model puts it, and Nadine Quist works the counter there from two in the
afternoon until it gets light.

None of that is code in this plugin, and it should stay that way. A shopkeeper is a `vendor`
NPC, her stock is four `vendor_stock` containers, the urn is a `brew_tier` fixture and the cash
machine is an `atm` flag. The forecourt is a PLACE, and this plugin renders two of the things
standing on it.

One thing the kiosk did change, one plugin over: `fuel` used to refuse anybody who was not sitting
in a cab, which meant the pump's own `examine` line offered `fuel the rig` and the click landed on
"You are not driving anything". The verb now also fills a rig parked on the tile you are standing
on. See [systems-trucking.md](../../docs/systems-trucking.md).

## Authoring another one

Three things, none of which touch this plugin:

1. `flags.building_type = 'fuel_yard'` on the tile (or the `truck_fuel` zone flag on a depot that
   keeps a pump without being one) — this is what lets a rig fuel there, and what puts diesel on
   the board.
2. One or more furniture rows with `flags.fuel_source` set to ₵ per fluid unit. `0` or a bare flag
   is free, which is what every fuel source in the world was before forecourts existed.
3. One furniture row with `flags.fuel_price_sign`.

A board in a room where nothing is on sale renders as dark. That is a correct answer, not a
failure — it is the state of the same furniture anywhere else.

## The pylon you read from the road

There are two boards, and they are one derivation. `examine` prints the framed one above. The
**price pylon out the windscreen** — the tall sign the forecourt model raises by the kerb — is
painted by `drawPriceBoard` in `client/game/js/panels/windshield.js` from `brd` on the map cell,
which `deriveSurfaceCell` gathers from this same `fuel.prices` hook. Neither the renderer nor the
map cell knows what fuel costs, for exactly the reason above.

A pylon quotes a **retail rate per pump-unit** and prints it to two decimals — 3.80, not 380 —
because that is what makes a number read as a fuel price rather than a quantity. A contributor that
sells by something bigger than a pump-unit says so with an optional **`each`**, derived in its own
file from the same constant it charges by (trucking: `FUEL_FULL / 100`, one percent of a tank).
There is still exactly one number; `each` is a presentation of it, not a second entry of it, and
`regress.js` reads it back against `FUEL_FULL` rather than asserting `3.8`.

⚠ **`fuel.prices` is therefore a SYNC hook.** The map window derives ~5,300 cells per snapshot, so
the pylon's rows come through `gatherHookSync` (see the contract on it in
`server/engine/plugins.js`) rather than through an await. A contributor that turns `async` keeps
working for `examine` and silently disappears from the pylon; `regress.js` asserts the hook answers
without a promise and that both gathers return the same rows.

## Not here

Charging for the fill happens in **fillable**, because that is the plugin that owns `fill` and the
container schema. Fuelling a rig happens in **trucking**, including the cab's hold-to-pump handle
(`truckpump`). `refuel` is routed by **flight**, which already arbitrated that verb between
aircraft and generators and now also hands it to a driver sitting in a truck.
