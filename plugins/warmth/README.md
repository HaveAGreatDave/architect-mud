# warmth

**Purpose** — heat *sources*. The counterpart to insulation (what you wear) and shelter (where you
stand): the first things in the game that make you or your room actively warmer.

## Commands
None. A heater is an appliance with `power_draw_kw`, so it inherits **`plug` / `unplug`** from the
[appliances](../appliances/README.md) plugin for on/off and needs no verbs of its own.

## Hooks
- `tick.minute` — battery discharge/recharge for every heater in the world.
- `item.consumed` — the `warming` tag on carried heat (hand warmers, heat patches).
- Registers a **heat source** with the engine (`registerHeatSource`, environment.js), which folds
  into `getZoneTemperature` so the body-temp drift, frostbite's peripheral skin temperature and the
  HUD thermometer all read the same number. A fire that warmed your core but not your fingers would
  be a bug nobody could find.

## Why this needed a mechanic first
Until the drift's rewarming rate became a **gradient**, a heater would have been a decoration: a cold
player in a 20 °C room and a cold player beside a blazing brazier rewarmed at exactly the same flat
5 %/min. There was nothing a heat source could have *done*. Recovery now scales with how far past the
cold threshold you are (capped at 3×), which is what makes any of this worth authoring.

## Heaters are thermostats, not bonfires
`flags.heater_target_c` is the temperature the piece **holds its room at**, not degrees it adds. That
is self-limiting: it rescues a freezing room and does nothing to a warm one, so leaving one running
in summer is wasteful rather than lethal. **Two heaters are not twice as warm** — the higher
thermostat wins, or a stack of cheap ones would cook an apartment.

## The battery is the point
`flags.heater_battery_min` (default **720** = 12 in-game hours). On mains it runs off the wall and
tops itself up at *half* the discharge rate, so a full recharge is a day and a heater that carried
you through last night is not automatically ready for tonight. The charge only matters when the grid
drops — which is exactly the [no-free-safe-haven](../../docs/systems-weather-extreme.md) scenario:
HVAC dies in a blackout and an unheated room bleeds toward outdoor temperature. This is a UPS for
your body. When it runs out, the room is told.

Charge lives in RAM and flushes in 10 % bands — a twelve-hour discharge costs ten writes, not seven
hundred. Writing a furniture row every tick is exactly what the persistence tiers forbid.

## Carried warmth
`tags.warming = { degrees, minutes }` on a consumable, tapering linearly to nothing over that many
**game**-minutes. Cold side only, and see [warmth.js](../../server/engine/warmth.js) for why: a mug
of cocoa carries ~40 kcal against 70 kg of body, so what it really does is peripheral vasodilation
and morale — a defence against cold, not calories added. A stronger source refreshes rather than
stacks, or the optimal play in a blizzard would be to carry six mugs.

**Hot drinks do not use this tag.** A vessel never passes through `applyItemUse`, so the
[drinks](../drinks/README.md) plugin applies warmth itself inside `drinks.finishServing`, scaled by
`hotMultiplier` — a mug you left on the desk warms you as little as it refreshes you, and a thermos
(`tags.insulated`) stays useful far longer.

## See also
[systems-survival.md](../../docs/systems-survival.md#body-temperature--thermal-comfort) for the drift
this feeds, and [frostbite](../frostbite/README.md) for the peripheral injury a heater also relieves.
