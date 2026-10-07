# Water supply and the Coldwater Waterworks

**Status:** Phases 1–2 built; phase 3 is design.

Coldwater's taps run off one plant. When the plant stops, the city's sinks, showers and kitchen
taps run thin, then stop, and the people selling water by the cup have a good week. This doc covers
the supply substrate in the engine, the law every water reader obeys, and the `waterworks` plugin
that runs the plant.

## Why the engine owns supply

Seven verbs take water from a source: `drink` (water plugin), `fill` (fillable), cooking's `fill`
and the pan loading behind `cook`, `rinse` (drinks), `wash` (MIS), and `shower` and `soap`
(bodily). They are unrelated systems reading one fact, which is the substrate test in the change
gate. Before this they also disagreed on what a water source *is*: bodily and MIS carried their
own predicates, and cooking and drinks asked the database.

So the engine owns two things:

- **What a water source is.** `isWaterSource`, `isDrinkingSource` and `isShower` in
  `server/engine/water.js`. Bodily, MIS, fillable, cooking, drinks and the water plugin call these.
- **Whether it is running.** `getWaterSupply(zoneId)` and the law `drawWater(f, zoneId, { use })`.

Two readers don't change. `use <furniture>` (inventory) hands a tap to `drink`, which runs the law.
The furniture classifier groups taps under Plumbing and takes no water.

The plant is a leaf: nothing outside it reads the pumps, the fault clock or the tower. It lives in
`plugins/waterworks/` and reports to the engine through the one writer, `setWaterSupply`.

## The substrate

`server/engine/water.js`, in memory, synchronous on read.

| Function | Shape | Who calls it |
|---|---|---|
| `isWaterSource(f)` | `bool`: a shower, a sink, or `flags.water_source`. Somewhere you can wash | mis, bodily |
| `isDrinkingSource(f)` | `bool`: `flags.water_source` only. A shower is not a tap | water, fillable, cooking, drinks |
| `isShower(f)` | `bool`: `object_type` shower, `flags.shower`, or "shower" in the name | bodily, ambient-life |
| `waterNetworkOf(zoneId)` | a region id, or `null` | the law, the plugin |
| `getWaterSupply(zoneId)` | `{ state, quality, reason }` | the law |
| `getNetworkSupply(region)` | the same, by region | the plugin |
| `setWaterSupply(region, { state, quality, reason })` | the one writer | `waterworks` only |
| `drawWater(f, zoneId, { use })` | `{ ok, quality, message \| note }` | every verb that takes water from a source |

`state` is `flowing`, `low` or `dry`. `quality` is `clean`, `cloudy` or `foul`.

**A network is a region.** A zone's network is the `region_id` of the map tile it belongs to: the
zone itself if it's on the world map, otherwise the facade its `parent_zone` chain leads to. The
engine names no region. Every region is `flowing`/`clean` until a plant writes otherwise, so the
truck-stop bunkrooms in Deadwater, the Reach, Terminus and the Scarletwastes never fail, because
nothing runs a plant there.

**Off the mains.** A zone or a source flagged `water_local: true` never fails (a tank, a well, a
rain butt), and nor does a zone with no region (a transient room out in the void). Old Coldwater
has been off the mains since the Curtain cut them (`docs/proposals/old-coldwater.md`), which is why
Quell's Water exists. It has no taps today. A tap added there should carry `water_local` or not
exist; district is no use as the marker, because Old Coldwater's buildings carry `residential`.

**The event.** `setWaterSupply` emits `water.supply.changed` with `{ network, from, to }` when the
state or quality changes. Nothing persists: at boot every region is `flowing`/`clean`, and the plugin
re-asserts its state on its first tick.

## The law

`drawWater(f, zoneId, { use })` is what a verb calls at the moment a player takes water. `use` is
`'drink'` (drink, fill, cook) or `'wash'` (wash, shower, soap, rinse).

| Supply | `drink` | `wash` |
|---|---|---|
| `dry` | refused, with a line about the pipes | refused |
| `low` | works, with a line about the pressure | works, with the line |
| `cloudy` | works, with a line | works, with a line |
| `foul` | works, with a line | refused: you'd come out dirtier |

What each reader does with `quality`:

- `drink` at a foul tap slakes and makes you `sick`.
- `fill` from a foul tap marks the container `contaminated: 'mains'`, which drinks later as foul
  water with a river line rather than a toilet one. `pour` keeps the mark.
- Cooking's `fill` gives a foul pan the same `disease_risk` hazard as water out of a fouled bowl.
  Boiling sees to cloudy water, so cloudy carries no hazard.
- `wash` with a dry or foul tap falls back to rain or a bottle, and refuses with the tap's line if
  there's neither.

The capability check still decides whether a verb is offered at all, so a dry sink still shows
`drink` and `wash`. The refusal is the information.

## The plant (`plugins/waterworks`)

The Coldwater Waterworks stands at the head of Ironside Street (919,901), on the Basin shore. Water
comes in through the intake screens, settles in two open beds (920–921,901, mass tiles with no
door), goes through sand filters and is pumped into the mains. The Halcyon Fields Pumping Station
lifts the mains into the Coldwater Water Tower (910,907), which feeds the city by gravity. Orla
Kemp's and Roke's dialogue already said so.

**Stations.** Nothing in the plugin names a building. A station is furniture flagged `waterworks:
<region>` (its pump set); its room's power is the station's power. Coldwater has two, in series: the
Waterworks' pump set and the Halcyon Fields Pumping Station's beam engine, which lifts the mains into
the tower. One stopped is the whole city on the tower. Two more flags carry a region id:
`water_intake` (where rain and frost are read; heavy rain silts only the station in the same
building, so it stands in an `open_sky` room) and `water_gauges` (the board `gauges` reads).
`scripts/content/waterworks/plant.mjs` authors the Waterworks.

**Each station's state**, on a `1m` tick which the scheduler skips when nobody is online, with no
queries:

| State | At the tap | How it ends |
|---|---|---|
| `running` | `flowing`, `clean` | a fault, heavy rain at its intake, or a power cut |
| `fault` | `low` while the tower drains (`TOWER_MINUTES`), then `dry` | repaired after 20–90 minutes, or 6 hours for one fault in ten |
| `unpowered` | as `fault`, on the same tower clock | its pump room gets power back |
| `turbid` | `flowing`, `cloudy` | clears after `TURBID_MINUTES` |
| `foul` | `flowing`, `foul` | staff only; clears after `TURBID_MINUTES` |

A region's supply is its stations together: stopped if any is stopped, timed from the first one to
stop, and as dirty as the worst station still pumping.

- **The tower** holds the city for four hours (`TOWER_MINUTES`), Kemp's own figure. So an ordinary
  fault is thin taps and nothing worse; a burnt-out motor or a long blackout dries the city. The
  clock starts when a station stops and carries across `fault` and `unpowered`.
- **Faults** roll per station per minute at `FAULT_CHANCE` (about one a day and a half of play
  each), four times likelier in a storm or at or below −5 °C at the intake.
- **Power** is read from the grid (`getZonePowerStatus` on each pump room). A blackout at the
  turbine hall stops the water too, four hours later, which is the tower doing its job.
- **Turbidity** follows heavy rain at the intake: the screens pull silt and the beds can't keep up.
  A station that comes back after the city ran dry also runs `turbid` for `FLUSH_MINUTES` while the
  mains refill.

**Verbs.** `gauges` at the board reads each station, the tower and the water in plain language.
`waterworks` is the staff verb (`status`, `set running|fault|unpowered|turbid|foul [minutes]`,
`repair`) for testing and for staff events. It acts on the station in the building you stand in,
or else the first in your region.

**Announcements.** On a change of flow the plugin sends one line to every player standing at a mains
tap in the region: the pipes shuddering, knocking and going quiet, the water coming back. Quality
isn't announced: you find that out at the tap.

## The market

Water is priced by the supply through the engine's vendor price rule (`registerVendorPriceRule`,
[systems-economy.md](systems-economy.md)), which the shelf, the till and commerce's checkout all
ask. Items opt in with the `drinking_water` tag; the vendor's region is its work zone's.

| Tag | While the taps fail | Dry spell |
|---|---|---|
| `stored` (filtered water, jerry cans) | ×1.5 when `low`, ×3 when `dry`; ×1.25 `cloudy`, ×2 `foul`; the higher wins | each vendor sells out at its own point 60–180 minutes in, and stays out until `RESTOCK_MINUTES` after the water's back |
| `mains` (Kemp's cup, Roke's bottle) | never marked up | not for sale while the main is dry |

So the city's shelves empty one after another rather than all at once, and Quell does well out of
it. A vendor flagged `holds_water_price` charges list price whatever the supply (Dagny Holm at the
plant, the Water Warden at Precinct 9) but still runs out.

**The water run.** The Halcyon Logistics board on floor 54 of Halcyon Towers posts runs on foot.
One of them, *Water Run* (`quest_hal_water_run`), is only on offer while the mains are `low` or
`dry`: its `available.when` is the engine's `water_supply` condition. Sign for cans at the plant,
carry them up to the Halcyon Arcade kiosk, 60₵. The board re-rolls hourly, so a run appears within
the hour of an outage and can't be taken once the water's back.

**The people.** Dagny Holm is the plant's engineer, in the control room. She sells jerry cans of
water, explains the gauges and the city's one pipe, and has a line for thin, dry and grey water.
Orla Kemp at the tower has two: holding, and empty. Both are dialogue options gated on the same
condition.

## Phases

1. **Built.** The substrate and law, the readers converted, the plant building and its keeper,
   faults, power dependence, turbidity, the tower buffer, announcements, `gauges` and the staff verb.
2. **Built.** The vendor price rule and the market, sell-outs through a dry spell, the
   `water_supply` condition, the Halcyon Logistics board and its water run, outage dialogue, and
   the Halcyon Fields Pumping Station as a second station in series.
3. **Design.** Sabotage and politics: the intake and the filter gallery as demolition and hacking
   targets, a faction arc over who controls the plant, unrest pressure in cells that have been dry
   for a day, and acid rain fouling the open beds.

## Traps

- **The shelf and the till must agree.** A price change goes through `registerVendorPriceRule`,
  never a `shop.stock` handler: that hook only changes what the shelf shows, and `buy` would charge
  the old price.
- **One writer.** Only `waterworks` calls `setWaterSupply`. A second writer is the posture-bug
  class: two systems disagreeing on whether the taps run.
- **Read the law, not the plugin.** No reader imports `waterworks`; they call `drawWater`.
- **Sync on read.** `getWaterSupply` is a Map lookup and `waterNetworkOf` walks two or three zones
  through the world Map. Neither is memoised, so a zone the dev panel moves is read fresh.
- **A new verb that takes water** calls `drawWater` with the right `use`, or a dry city still fills
  its kettle.
