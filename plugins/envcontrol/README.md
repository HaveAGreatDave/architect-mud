# envcontrol

**Purpose**: the control panel a high-end flat has on its wall. It runs the flat's lights, holds
its temperature, and shows the camera over its front door. You use it from its screen in the Room
Stage, docked or full screen, or by typing the same verbs. The first one is in Solenne Residence
30-B.

A panel is any furniture row with `flags.envctl`, so another flat gets one by adding a row:

```json
"envctl": { "camera": "<security_devices id>", "min_c": 16, "max_c": 28, "target_c": 21 },
"look": { "arche": "cabinet", "form": "cupboard", "dress": "envctl", "dims": [0.34, 0.04, 0.24] },
"spot": { "wall": "right", "along": 11.6 }
```

It runs the room it's in and that room's en-suite. `target_c` is the setting, and `null` is off.
The `look` makes it lay out as a hung cabinet, so it hangs at eye height, blocks nobody, and a click
on it runs the card's first line, `panel`. `dress: "envctl"` is what `gl/room-envctl.js` draws it by.

## Commands
- `panel`: the panel's state; the screen opens on it. `panel refresh` is the open screen asking
  again every few seconds, with nothing in the log; `panel close` puts it away.
- `lights [on|off]`: every light in the flat and its en-suite. Bare toggles.
- `thermostat <°C>|up|down|off`: hold the flat at a temperature inside the panel's range.
- `doorcam`: one frame from the door camera, to the log.

## Hooks
- `furniture.acts`: puts Panel, Lights and Doorcam on the Room Stage's card.
- Registers a **heat source** with the engine (`registerHeatSource`), like [warmth](../warmth/README.md).

## Nothing new underneath
- **Lights** are the ordinary light rows. `lights` takes the same four steps as `switch` does for
  one light (`updateFurniture`, `syncZoneLighting`, `recalcZoneLoad`, `recomputePower`), and won't
  bring them up with no power.
- **Climate** is a heat source. Unlike a heater, which only rescues a cold room, the plant drives the
  room toward the setting both ways, at 1 °C a real minute from wherever it was when you changed it.
  So the body-temperature drift, frostbite and the HUD thermometer all read it. Where the ramp has
  got to is RAM only; after a restart the room is at its setting. With no power it does nothing.
- **The door camera** is a SPECTER device (`security_devices`, wired, no owner), read through
  surveillance's `camPatchFrame`, so a jammer, a spoofer, a smashed lens or a dark grid shows on the
  panel exactly as it would on a spy-deck. It also counts as a witness in the hall, as any camera does.

## Gotchas
- A panel and a [warmth](../warmth/README.md) heater in the same room add up. Don't put both in one flat.
- Anybody standing in the flat can use the panel, as anybody can flick a light switch.
