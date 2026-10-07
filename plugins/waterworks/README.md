# waterworks

The plant that decides whether a region's taps run.

## Purpose

The engine owns water supply (`server/engine/water.js`): what a water source is, which region's
mains it draws from, and the law every `drink`, `fill`, `wash`, `shower`, `soap` and `rinse` obeys.
This plugin is the one writer. It runs a small state machine per plant and turns it into a supply
with `setWaterSupply`. No reader imports it. See
[docs/systems-water-supply.md](../../docs/systems-water-supply.md).

## The plant

| State | At the tap | How it ends |
|---|---|---|
| `running` | flowing, clean | a fault, heavy rain at the intake, or a power cut |
| `fault` | low for `TOWER_MINUTES`, then dry | repaired after `REPAIR_MINUTES` (20–90), or `MAJOR_REPAIR_MINUTES` (6 hours) for one in ten |
| `unpowered` | as `fault`, on the same tower clock | the pump room gets power back |
| `turbid` | flowing, cloudy | clears after `TURBID_MINUTES` |
| `foul` | flowing, foul | staff only in phase 1; clears after `TURBID_MINUTES` |

`TOWER_MINUTES` is four hours, Orla Kemp's figure in her own dialogue, so an ordinary fault is thin
taps and nothing worse; a burnt-out motor or a long blackout dries the city. A plant that comes back after the city ran dry runs `turbid` for `FLUSH_MINUTES` while the mains
refill. The tower clock starts when the pumps stop and carries across `fault` and `unpowered`, so a
repair that ends in a blackout doesn't refill the tower. The state is memory only: a restart puts
every plant back to `running`.

## Commands

| Verb | Does |
|---|---|
| `gauges` | Read the gauge board in the room: the pumps, the tower and the water. |
| `waterworks` | Staff only. `status`, `set running\|fault\|unpowered\|turbid\|foul` (a fault takes an optional length in minutes), `repair`. Acts on the plant for the region you're standing in. |

## Content

Nothing here names a building. Three furniture flags carry a region id:

- `waterworks: <region>` on the pump set. Its room is the plant's power: a pump room on a dead
  grid is an `unpowered` plant.
- `water_intake: <region>` on the intake, where rain and frost are read. Put it in an `open_sky`
  room or it never sees weather. Optional; the pump room is the fallback.
- `water_gauges: <region>` on the board `gauges` reads.

Coldwater's plant is the Coldwater Waterworks at 919,901, authored by
`scripts/content/waterworks/plant.mjs`.

## Events

Consumes `water.supply.changed` (emitted by the engine on any change) to tell everyone standing at
a mains tap in the region when the flow drops, stops or comes back. Quality isn't announced: you
find that out at the tap.

## Ticks

`1m`, skipped by the scheduler when nobody is online. No queries: power, weather and furniture all come from memory.
