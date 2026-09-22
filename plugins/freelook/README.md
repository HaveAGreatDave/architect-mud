# freelook

**Status — BUILT.**

**Purpose** — the detached camera, with nothing under it, and the fixed vantages that stand on it.

GLASS's free camera (`client/game/js/panels/freecam.js`) has always had one precondition nobody
argued for: you had to be in a **seat**. There are three mounts — a cab, a cockpit, a wheelhouse —
so looking at a corner of Coldwater meant buying a truck, driving it there, and pressing <kbd>O</kbd>.
For the person the camera was built for, that is the whole job with a vehicle bolted to the front.

`freelook` is the same camera with the vehicle removed: the server hands the client a world window
and a sky, the client opens the ordinary windshield with `hideOwnShip`, and the ordinary free camera
is bound to it.

## Commands

- `freelook` — open the camera over the tile you are standing on.
- `freelook <x> <y>` — open it, or re-centre an open one, over any `map_world` tile.
- `freelook close` — put it away. (The view's own <kbd>O</kbd> and ✕ fire this.)
- `telescope` — put your eye to the vantage in this room. Not staff-gated; see below.
- `telescope close` — step back. (Also fired by the view's <kbd>O</kbd> and ✕.)

Staff only: `admin`, `dev`, `builder`, `designer` — the same roster `fireworks` takes, and
deliberately wider than the helm console's `admin`, because the helm steers a boat and this looks at
a wall. `close` is handled **ahead of** the clearance gate, or a role change underneath an open view
would leave a pane nobody can shut.

## Rules worth knowing

**It is a camera and nothing else.** `current_zone` is never written, the body never moves, and the
view grants no reach. Closing hands the pane back with a `look`.

**The loaded window is the edge of the world** — one 73×73 window (`FLIGHT_RADIUS`, ≥ the renderer's
`VISIBLE_FAR_F`, so the whole drawable skyline is present from the first frame). Flying past its rim
runs out of city rather than crashing. Following the camera with fresh ground is the client asking
the server for a window somewhere else mid-flight, which is a much larger job than a camera —
`freelook <x> <y>` is the same affordance for a tenth of the machinery.

**Indoors resolves to the building's own tile**, by following `world_exit_zone` and stopping at the
first placed zone. ⚠ On an interior room that field is the **facade** and on the facade it is the
**street** — two meanings on one field name — so one hop from inside a shop is already placed and it
stops there. ⚠ And **0,0 is not a tile**: an interior zone carries grid 0,0 to mean *unset*, so a
placed test that only checks `grid_x != null` opens the camera over empty grass in the map's corner.

**This view opens with no user gesture, and a pointer lock needs one.** The cab and the cockpit
come off their mount on the <kbd>O</kbd> keypress, which carries its own activation; this one is
built because a `freelook_open` arrived over the socket, so the lock the camera asks for as it opens
can be refused by a browser that would grant the very same request off the next click. That refusal
is deliberately **not** taken as "this document cannot lock the pointer" — only a refusal of a
*click's* own request is (`lockError` in [freecam.js](../../client/game/js/panels/freecam.js)).
Taking it the other way left this view, and only this view, on the unlocked drag branch for the
whole session, where the reachable turn is one screen width — about **180°** on an ordinary pane,
because the deltas telescope and bringing the cursor back un-turns what it turned. The rim of the
glass now carries the turn on past that either way, so the fallback is usable rather than merely
present.

**No air traffic, deliberately.** The helm streams contacts to its chase view every 2s because it is
a seat somebody is using. A dev camera cannot justify that, and at any cadence it *can* justify an
aeroplane would jump rather than fly — worse than an empty sky, because a camera you are composing a
shot through is exactly where a stuttering object shows. The sky drifts slowly enough for the 15s
tick.

**The window is never re-sent by the tick.** Only the sky is. A 73×73 grid of derived cells every
fifteen seconds would be the largest recurring payload in the game for no observable difference.

## The nav marks

The renderer's screen-pinned navigation marks — the red chevrons that point at traffic out of shot,
and the waypoint ring / Home marker — are **off for the whole of this view**, and for a detached
camera in a seat too. They are built around the seat (pinned on a ring at `(W/2, 0.46H)`, answering
*which way do I turn*) and a detached camera is not in the seat. The switch is `navMarks()` in
`windshield.js`; <kbd>N</kbd> throws it by hand from a cab, a cockpit or a wheelhouse.

## Vantages — the same camera, bolted down

Furniture carrying `flags.telescope` is a **place you can stand and look from**. `telescope` opens
the identical view the staff camera opens — same window, same sky, same way out — with the camera on
its feet instead of flying: mouse-look and WASD inside a leash, no up-down, no orbit, no roll, and
an eye height that is not the camera's to set.

```jsonc
"telescope": {
  "mount": "yacht_scope",   // a fixture the RENDERER knows how to find
  "leash": 0.09,            // tiles you may step, from where you were put down
  "label": "TELESCOPE",     // the corner of the view
  "yaw": 200                // opening bearing — only for a vantage with no mount
}
```

**It lives in this plugin because there is one camera-over-a-tile on the wire.** One viewer set, one
15s sky push, one `freelook close`. A second plugin sending `freelook_open` would be a second owner
of a pane whose close reached only one of them.

**It is deliberately not behind the staff gate.** `freelook` is staff-only because it is a way to
look at ground you have not walked to; a telescope is a fitting in a room you already got into,
pointed at ground you can already see from it. The gate on a vantage is the door you came through.

⚠ **A vantage names a MOUNT rather than an eye height** whenever it stands on something whose shape
the server does not know. The Echelon's sun deck is a height that is a property of her **model** and
a position that is a function of the **swell**, so `mount: 'yacht_scope'` is answered by
`yachtScopeMount()` in `windshield.js` — the same function that decides where the instrument is
drawn, so what you look through and where you look from cannot drift apart. It is asked **every
frame**, which is what carries the shot up and down with her. Anything standing on ground that does
not move authors a plain `eye` instead, in world tiles.

⚠ **`self` is cleared on the centre cell.** `mapWindow` stamps it, which is what stops a cab being
drawn inside its own building — right for a camera in a vehicle and exactly wrong for a camera
standing **on** something, because the thing under your feet is then the one thing in the window
that is not drawn. This is `yachtHelmWindow`'s own line, for the same reason.

⚠ **The refusal names nothing.** `telescope` in a room with no vantage in it says only that there is
nothing here to look through — naming the flag, the fitting or the room would turn a verb anybody
may type into a detector for vantages they have not found.

⚠ **A vantage is not a re-centre.** The two arrive down the same wire, and `freelook <x> <y>` keeps
the shot while sliding the world under it — exactly wrong for somebody who has walked up to a
different telescope. The view tells them apart on the mount.
