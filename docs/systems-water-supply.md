# Water supply and the Coldwater Waterworks

**Status:** Phase 1 built; phases 2–3 are design.

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

**Finding a plant.** Nothing in the plugin names a building. Three furniture flags carry a region
id: `waterworks` on the pump set (its room is the plant's power), `water_intake` on the intake
(where rain and frost are read, so it stands in an `open_sky` room), and `water_gauges` on the
board `gauges` reads. `scripts/content/waterworks/plant.mjs` authors Coldwater's.

**The plant state**, on a `1m` tick which the scheduler skips when nobody is online, with no queries:

| State | At the tap | How it ends |
|---|---|---|
| `running` | `flowing`, `clean` | a fault, heavy rain at the intake, or a power cut |
| `fault` | `low` while the tower drains (`TOWER_MINUTES`), then `dry` | repaired after 20–90 minutes, or 6 hours for one fault in ten |
| `unpowered` | as `fault`, on the same tower clock | the pump room gets power back |
| `turbid` | `flowing`, `cloudy` | clears after `TURBID_MINUTES` |
| `foul` | `flowing`, `foul` | staff only in phase 1; clears after `TURBID_MINUTES` |

- **The tower** holds the city for four hours (`TOWER_MINUTES`), Kemp's own figure. So an ordinary
  fault is thin taps and nothing worse; a burnt-out motor or a long blackout dries the city. The
  clock starts when the pumps stop and carries across `fault` and `unpowered`.
- **Faults** roll per minute at `FAULT_CHANCE` (about one a day and a half of play), four times
  likelier in a storm or at or below −5 °C at the intake.
- **Power** is read from the grid (`getZonePowerStatus` on the pump room). A blackout at the
  turbine hall stops the water too, four hours later, which is the tower doing its job.
- **Turbidity** follows heavy rain at the intake: the screens pull silt and the beds can't keep up.
  A plant that comes back after the city ran dry also runs `turbid` for `FLUSH_MINUTES` while the
  mains refill.

**Verbs.** `gauges` at the board reads the pumps, the tower and the water in plain language.
`waterworks` is the staff verb (`status`, `set running|fault|unpowered|turbid|foul [minutes]`,
`repair`) for testing and for staff events. It acts on the plant for the region you stand in.

**Announcements.** On a change of flow the plugin sends one line to every player standing at a mains
tap in the region: the pipes shuddering, knocking and going quiet, the water coming back. Quality
isn't announced: you find that out at the tap.

**The people.** Dagny Holm is the plant's engineer, in the control room. She sells jerry cans of
water and explains the gauges and the city's one pipe.

## Phases

1. **Built.** The substrate and law, the readers converted, the plant building and its keeper,
   faults, power dependence, turbidity, the tower buffer, announcements, `gauges` and the staff verb.
2. **Design.** The market: Quell's and Orla Kemp's prices follow supply, through a vendor price hook
   rather than a special case. A water-run job off the Halcyon Logistics board. Bottled-water stock
   runs down during an outage. The Halcyon Fields Pumping Station as a second point of failure
   between the plant and the tower.
3. **Design.** Sabotage and politics: the intake and the filter gallery as demolition and hacking
   targets, a faction arc over who controls the plant, unrest pressure in cells that have been dry
   for a day, and acid rain fouling the open beds.

## Traps

- **One writer.** Only `waterworks` calls `setWaterSupply`. A second writer is the posture-bug
  class: two systems disagreeing on whether the taps run.
- **Read the law, not the plugin.** No reader imports `waterworks`; they call `drawWater`.
- **Sync on read.** `getWaterSupply` is a Map lookup and `waterNetworkOf` walks two or three zones
  through the world Map. Neither is memoised, so a zone the dev panel moves is read fresh.
- **A new verb that takes water** calls `drawWater` with the right `use`, or a dry city still fills
  its kettle.
