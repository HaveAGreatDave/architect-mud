# stands

Status: built.

A seat at the game, in the park it's played in. Golden Goose Gardens (`zone_slush_stands`) sells hockey seats and the Coliseum (`zone_hughson_stands`) baseball ones.

## Verbs

- `stands`: the seat chart. The client draws the venue from above with every section where its seat is, priced; the log gets the same list.
- `stands <section>`: buys a seat (by id or a word of its name) and opens the 3-D rink or park in first person from it. Refused when no game of that sport is on.
- `stands leave`: gets up. Walking out of the room does the same.

## Content

`flags.stands` on a room: `{ sport: 'hockey' | 'baseball', sections: [{ id, name, price, eye, note }] }`. `eye` is the seat's head in the 3-D view's frame, in feet: for hockey the sheet's (x 0..200 along, y 0..85 across with the near stands at y < 0, z up), for baseball the field's (home plate at the origin, +x toward third, +z to centre field, y up). The chart is laid out from the same numbers.

## How it works

A seat is a receiver. Buying one tunes the player to the channel carrying that sport's game (`liveSportsChannel` in plugins/broadcast) through the Tablet TV's per-player path (`tablet_tv.watch`), so the game is the broadcast's game. A player with the Tablet TV open on another channel loses it while seated.

The client (`client/game/js/panels/stands.js`) registers as one more TV view (`addTvView` in tv.js) and mounts the TV sub-screen's view with `opts.seat`: `gameday-rink.js` sets `R.seat`, which `rink/camera.js` turns into a free-heading camera (`seatFrame`, `C.ax`), and `gameday-grandstand.js` wraps the director's shot in `seatShot`. Following, the eye turns to what the director looks at; free look is drag, arrows and the wheel; F switches. Only GLASS 2 turns the rink's camera; the 2-D fallback shows the broadcast view.

The ticket is paid once per seat; moving section is a new ticket.
