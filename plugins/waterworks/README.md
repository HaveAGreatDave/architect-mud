# waterworks

The plants that decide whether a region's taps run, and what water costs while they don't.

## Purpose

The engine owns water supply (`server/engine/water.js`): what a water source is, which region's
mains it draws from, and the law every `drink`, `fill`, `wash`, `shower`, `soap` and `rinse` obeys.
This plugin is the one writer. It runs a small state machine per pumping station and turns a
region's stations into one supply with `setWaterSupply`. No reader imports it. See
[docs/systems-water-supply.md](../../docs/systems-water-supply.md).

## The stations

| State | At the tap | How it ends |
|---|---|---|
| `running` | flowing, clean | a fault, heavy rain at its intake, or a power cut |
| `fault` | low for `TOWER_MINUTES`, then dry | repaired after `REPAIR_MINUTES` (20–90), or `MAJOR_REPAIR_MINUTES` (6 hours) for one in ten |
| `unpowered` | as `fault`, on the same tower clock | its pump room gets power back |
| `turbid` | flowing, cloudy | clears after `TURBID_MINUTES` |
| `foul` | flowing, foul | staff only; clears after `TURBID_MINUTES` |

A region's stations are in series: one stopped puts the whole region on the tower, timed from the
first one to stop, and the water is as dirty as the worst station still pumping.

`TOWER_MINUTES` is four hours, Orla Kemp's figure in her own dialogue, so an ordinary fault is thin
taps and nothing worse; a burnt-out motor or a long blackout dries the city. A station that comes
back after the city ran dry runs `turbid` for `FLUSH_MINUTES` while the mains refill. The tower clock
carries across `fault` and `unpowered`, so a repair that ends in a blackout doesn't refill the
tower. The state is memory only: a restart puts every station back to `running`.

## The market

A vendor price rule (`registerVendorPriceRule` in `server/engine/vendor.js`) prices items tagged
`drinking_water` by the vendor's region's supply. The shelf, the till and commerce's checkout all
ask the same rule.

- `stored` water (bottles, cans) costs `STORED_MULT` more while the taps run thin or dry, or
  `QUALITY_MULT` more while they run cloudy or foul, whichever is higher. Through a dry spell each
  vendor sells out at its own point in `SELLOUT_MINUTES`, and stays out until `RESTOCK_MINUTES`
  after the water's back.
- `mains` water is never marked up, and isn't for sale while the main is dry.
- A vendor flagged `holds_water_price` charges list price whatever the supply.

Dry spells are tracked from `water.supply.changed`, in memory.

## Commands

| Verb | Does |
|---|---|
| `gauges` | Read the gauge board in the room: each station, the tower and the water. |
| `waterworks` | Staff only. `status`, `set running\|fault\|unpowered\|turbid\|foul` (a fault takes an optional length in minutes), `repair`. Acts on the station in the building you're standing in, or else the first in your region. |

## Content

Nothing here names a building. Three furniture flags carry a region id:

- `waterworks: <region>` on a pump set. Its room is the station's power: a pump room on a dead
  grid is an `unpowered` station.
- `water_intake: <region>` on an intake, where rain and frost are read. It silts only the station
  in the same building. Put it in an `open_sky` room or it never sees weather.
- `water_gauges: <region>` on the board `gauges` reads.

Coldwater has two stations: the Coldwater Waterworks at 919,901 (authored by
`scripts/content/waterworks/plant.mjs`) and the Halcyon Fields Pumping Station's beam engine. The
water run on the Halcyon Logistics board is an ordinary quest gated on the engine's `water_supply`
condition; nothing here posts it.

## Events

Consumes `water.supply.changed` (emitted by the engine on any change) to track dry spells and to
tell everyone standing at a mains tap in the region when the flow drops, stops or comes back.
Quality isn't announced: you find that out at the tap.

## Ticks

`1m`, skipped by the scheduler when nobody is online. No queries: power, weather and furniture all
come from memory.
