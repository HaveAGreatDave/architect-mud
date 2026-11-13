# envcontrol

**Purpose**: the control panel a high-end flat has on its wall. It runs the flat's lights, holds
its temperature, shows the camera over its front door, and puts shutters or blinds over a glass
wall. You use it on its own glass in the Room Stage, standing at it; pop it out into a window
(docked or full screen) if you'd rather; or type the same verbs. The first one is in Solenne Residence
30-B.

A panel is any furniture row with `flags.envctl`, so another flat gets one by adding a row:

```json
"envctl": { "camera": "<security_devices id>", "min_c": 16, "max_c": 28, "target_c": 21 },
"look": { "arche": "cabinet", "form": "cupboard", "dress": "envctl", "dims": [0.46, 0.04, 0.6] },
"spot": { "wall": "back", "along": 3.4 }
```

It runs the room it's in and that room's en-suite. `target_c` is the setting, and `null` is off.
The `look` makes it lay out as a hung cabinet, so it hangs at eye height, blocks nobody, and a click
on it runs the card's first line, `panel`. `dress: "envctl"` is what `gl/room-envctl.js` draws it by.

## The screen
One OS (`client/game/js/panels/envctl.js`) on two screens:
- **The wall.** `room-envctl.js` lays the OS onto the panel's glass each frame, as a hololock's card is
  laid, so its buttons are real buttons in the room. It shows from the room's side within 9 m and takes
  touches within 2.6 m. Asleep it shows the time; a touch sends `panel`, and the answer wakes it with the
  welcome. It sleeps again when you walk 4.5 m off or leave it two minutes. ⧉ pops it out.
- **The window.** The same pages, docked bottom left or full screen. It opens on ⧉, or on `panel` where
  there's no wall screen to wake (typed away from the Stage).

## Commands
- `panel`: the panel's state; the screen wakes on it, says "Welcome, <name>" on screen and aloud (the
  owner, when you are the owner or they are online; plain "Welcome home" otherwise), then shows its
  home menu, a tile per app. `panel refresh` is the open screen asking
  again every few seconds, with nothing in the log; `panel close` puts it away.
- `lights [on|off]`: every light in the flat and its en-suite. Bare toggles.
- `dim [<light>] <0-100>`: one light (its number on the panel's list, or a word of its name), or all of
  them, to a level; 0 puts it out and keeps the level for next time. The level is `flags.dim` on the
  light's row, and the engine counts a dimmed light's lumens at that share (`computeZoneLighting`).
  On the screen, Lights is a list to pick from (with more than one light) and a dimmer bar. Dragging
  it moves the Room Stage's light live (the `envctl:light` window event, which room-stage.js takes for
  the room you're in); letting go sends `dim`.
- `thermostat <°C>|up|down|off`: hold the flat at a temperature inside the panel's range.
- `doorcam`: one frame from the door camera, to the log.
- `shutters [up|down|<scene>]`: digital shutters over the room's glass wall, showing a scene. Bare
  toggles. `shutters blinds <0-100>` (or `shutters <0-100>`) draws blue Venetian blinds instead,
  tilted to let in that per cent of the light, and `shutters colour <#rrggbb>` colours their slats;
  `shutters up` clears either. The screen's Shutters page has a button for each, and a colour wheel
  (hue round it, strength out from the middle) with Pale, Mid and Deep shades for the blinds.

## Shutters and blinds
Only a room with curtain glass (`flags.room.glass` on its zone) has them; anywhere else the verb
says so and the screen has no Shutters page.

- **The scenes are data**, in `scenes.js`: a name, the words `shutters <word>` answers to, a painter
  (`kind`) and three colours. `gl/room-shutters.js` in the client knows the painters (stars, water,
  storm, dunes, aurora, matte) and nothing else. A panel offers the scenes its row lists in
  `flags.envctl.scenes`, in that order, or all of them. The first is what bare `shutters` shows.
- **The blinds** are the `blinds` entry, kind `blinds`: no picture, and a light level and a colour
  instead. `paintOf` works the cloth's dark side and the light through it out from the colour.
- **The state** is `flags.envctl.shutters`, `{ down, scene, level, colour }`, on the panel row: one
  `updateFurniture` per change, so it's in the furniture cache for every read and survives a
  restart. Like `target_c`, a content deploy puts it back to the row's (up).
- **Everyone in the flat sees the same glass.** The Room Stage asks the sync hook `room.glass` when it
  builds `room_view`, and a change emits `room.glassChanged`, which roomstage sends to whoever has
  the room open as `room_glass`. Others in the room get a line in the log.
- **In the Room Stage** the slats come down from the head of each pane (the balcony doorway too),
  then the display pixelates in; a new scene pixelates the old one out first. The blinds. slats tilt
  in from edge on. A lowered shutter (not the blinds) stops you walking out onto the balcony, though
  not back in. Fully down and lit, the view out of the window stops painting. A phone gets the scene
  as a still picture.
- With no power the controls do nothing. Shutters already down show dark slats, but only from the
  next time the room is opened: nothing sends `room_glass` when the power goes.

## Hooks
- `furniture.acts`: puts Panel, Lights, Doorcam and (with a glass wall) Shutters on the Room Stage's card.
- `room.glass` (sync): the room's glass for `room_view`. Emits `room.glassChanged`.
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
- `shutters` is also storefront's verb, for a shop's roller shutter, and the loader keeps one handler per verb.
  This plugin loads after storefront (`after` in plugin.json) and hands every `shutters` away from a panel
  to storefront's handler. Drop that `after` and the panel's Shutters page answers "There's no shop unit here."
- A panel and a [warmth](../warmth/README.md) heater in the same room add up. Don't put both in one flat.
- Anybody standing in the flat can use the panel, as anybody can flick a light switch.
