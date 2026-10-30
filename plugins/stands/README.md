# stands

Status: built.

A seat at the game, in the park it's played in. Golden Goose Gardens (`zone_slush_stands`) sells hockey seats and the Coliseum (`zone_hughson_stands`) baseball ones.

## Verbs

- `stands`: the seat chart. The client draws the venue from above with every section where its seat is, priced; the log gets the same list.
- `stands <section>`: buys a seat (by id or a word of its name) and opens the 3-D rink or park in first person from it. Refused when no game of that sport is on.
- `stands leave`: gets up. Walking out of the room does the same.
- `sit <chair>` on furniture carrying `flags.stands_section` in a stands room: a seat in that section for nothing, and standing up leaves it. The Platinum Box's armchairs.
- `watch <screen>` / `use <screen>` on furniture carrying `flags.stands_screen`: the game from the broadcast's own cameras in 3-D, with no seat under the camera. `watch` belongs to interactions (and broadcast); both ask here first through the `watch.furniture` hook. The Platinum Box's big screen.
- A section with a `room` (`{ at: [x, z], face, floor, w?, d?, h? }` in the field's feet, `at` the middle of the glass) is a box's suite: the Grandstand draws it round the seat (`client/game/js/panels/gl/booth-mesh.js`, `setRoom` in gl/ballpark.js) and you can get up and walk it: WASD walks, E sits in the nearest chair or sofa, T puts its big screen up full size. Its own screen shows the director's shot, drawn every third frame and blitted into the screen's texture (`renderTv`). A screen with `flags.stands_room` (the suite's zone) opens the suite on the sofa. Walking is the eye in your client; the server only knows you're in the box.
- `use <ticket machine>`: the same chart as `stands`, from a piece of furniture carrying `flags.ticket_machine` in the stands room. Examining the machine offers `use`.

## Content

`flags.stands` on a room: `{ sport: 'hockey' | 'baseball', sections: [{ id, name, price, eye, note, across?, rows?, pitch?, row? }] }`. `eye` is the seat's head in the 3-D view's frame, in feet: for hockey the sheet's (x 0..200 along, y 0..85 across with the near stands at y < 0, z up), for baseball the field's (home plate at the origin, +x toward third, +z to centre field, y up). The chart is laid out from the same numbers.

## How it works

A seat is a receiver. Buying one tunes the player to the channel carrying that sport's game (`liveSportsChannel` in plugins/broadcast) through the Tablet TV's per-player path (`tablet_tv.watch`), so the game is the broadcast's game. A player with the Tablet TV open on another channel loses it while seated.

The client (`client/game/js/panels/stands.js`) registers as one more TV view (`addTvView` in tv.js) and mounts the TV sub-screen's view with `opts.seat`: `gameday-rink.js` sets `R.seat`, which `rink/camera.js` turns into a free-heading camera (`seatFrame`, `C.ax`), and `gameday-grandstand.js` wraps the director's shot in `seatShot`. Following, the eye turns to what the director looks at; free look is drag, arrows and the wheel; F switches. Only GLASS 2 turns the rink's camera; the 2-D fallback shows the broadcast view.

A ticket is for a section, not a seat. A section is a block of seats round its `eye`, the best one: `across` seats a row (7) `pitch` feet apart (2), and `rows` rows (3), each `row: [back, up]` feet behind and above the one in front (the sport's default). A buyer gets the free seat nearest the eye, so a second buyer sits beside the first; a full section is sold out. Who is where lives in the seated map in RAM.

The ticket is paid once per seat; moving section is a new ticket.

A ballpark seat gets the day's weather cells in `stands_open` (`field`, every cell, not a crop) and draws them overhead (`gl/cloudvol.js` through `gl/ballpark.js`), moving them along itself with `client/shared/wx-cells.js`, as the windshield does. The server sends a fresh copy (`stands_sky`) only when the field changes: the weather plugin's `weather.field` event on a reseed or a moved cell, and `weather.event`. Nothing rides on the per-play payload.
