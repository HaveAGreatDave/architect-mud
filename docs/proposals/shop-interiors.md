# Shop interiors: a shop you walk into

> **Status: built for one shop.** Screw It, the chem supply at 921,907 on Ironside Street, is the first shop with a
> Room Stage, and it's the example every shop after it follows. The fittings, the shopfront glass, the one-room plan
> and the counter that sells are engine and plugin code any shop can use; a second shop is content.

A shop is a front you see from the street in GLASS, a door you walk through, and a room on the Room Stage where
somebody serves you over a counter. Each of the three already existed for some building. This doc is what a shop
needs from each so they agree with each other, and how buying works once you're inside.

## The street front (GLASS)

The building model carries the name, the door and the window, in the same places the room has them.

- **The name in neon.** A shop with a name worth lighting gets a hand-bent sign in `client/shared/neon-signs.js`
  (`NEON_SIGNS`, merged into `NEON_ART`), mounted with a `neonArt` detail on a dark fascia between the canopy and
  the parapet. Screw It's is a slotted screw head whose slot turns on a flasher, SCREW IT in tube capitals with the
  IT on a bad circuit, and a run of thread underneath. Tube capitals (`tubeWord`, `tubeLeft`) cover C E G I L N O
  P R S T V W X; add a glyph to `GLYPH` for any other letter.
- **A flasher's other positions are `ghost` runs.** A run with `ghost: true` is drawn only while it's lit, so the
  three positions of a turning slot don't show by day as three dead tubes in a star.
- **`open`** is a generic OPEN sign any shop can hang over its door or in its window.
- **The door is a `windowBay` with `door: 1`**, between the shop window and the goods side, with whatever marks the
  trade (Screw It's hazard-yellow posts and striped kerb). One lit canopy runs across the front.
- **The trade line goes under the name**, smaller, on a `signBoard`. The name appears once ([building-styles.md](../reference/building-styles.md)).

After editing the model run `npm run models:bake`, `npm run shapes:bake` and `npm run lite:bake`, or
`shapes:smoke` and `lite/smoke.mjs` fail the push.

## The room

The shop floor's zone carries `flags.room`. Screw It's (`content/zones/zone_chemsupply_interior.json`) is the one
to copy from.

| Key | What a shop sets | Why |
|---|---|---|
| `w`, `d`, `h` | the floor, a warehouse shop 12 x 10 x 4.2 | A shop is taller than a flat |
| `face` | the bearing of the street, so the front wall is the street wall | Puts the door and the window in the wall you came through |
| `studio`, `balcony` | `false` | A shop isn't a flat |
| `doors` | `{ <street exit>: <metres along the wall> }` | Where the street door is, matching the model's door |
| `street_door` | `{ kind: 'swing', w: 1.2 }` | A glazed door you see the street through. From the street it stands in the model's own doorway ([street-doors.md](../reference/street-doors.md)) |
| `panes` | `[{ wall: 'front', a, b, y0, y1 }]` | The display window: black-framed glass from `a` to `b` along the wall, sill `y0`, head `y1`. Plain wall past it |
| `ground`, `tone` | `concrete` and the trade's paint | |
| `decor.rug` | `false` | Every room gets a rug otherwise |
| `decor.strips` | the ceiling lights | Fluorescent battens light a shop, not a pendant |
| `decor.signs` | the name behind the counter, then STAFF ONLY, NO NAKED FLAMES and the like | Lit lettering on a plate |
| `decor.paint`, `pipes`, `doors`, `lamps`, `grates` | as the trade needs | A steel door to the back that doesn't open is `decor.doors` |

**A one-room shop is planned like a building.** The building planner (`walkPlans` in
`client/shared/building-graph.js`) used to plan only buildings of two or more rooms, so a lone room kept a flat's
door in its back corner. A one-room building is planned now when its room authors its own door (`street_door` or
`doors`). The door goes in the wall the street is through, and walking out of it on the Stage is the ordinary
`move <dir>`. Only Screw It changed when this went in; every other lone room keeps its old door.

**`panes` is the shopfront window.** `glass` glazes a whole wall, which suits a lobby. A shop has a door, a window
and wall, so `panes` places each pane (`roomSpecOf` in `client/shared/room-layout.js`). It's ignored beside `glass`.

## The fittings

`client/game/js/panels/gl/room-shop.js` draws them. Each is a furniture row with `flags.look` and an authored
`flags.spot`.

| Form | Archetype | What it is |
|---|---|---|
| `tradecounter` | `surface` | Steel and ply, ribbed front, hazard-taped kick plate, a till, a card reader and the sign-out clipboard on top, two shelves of stock on the staff's side |
| `racking` | `store` | Orange frames and blue beams, a pallet on every bay of every level with the trade's load: drums, sacks or courses of boxes. Free-standing racking is open both sides |
| `drawers` | `store` | A wall of small steel drawers with labels and pulls |

**`look.stock` is the trade**: `hardware`, `chem` or `safety` (`SHOP_STOCKS`). The counter's shelves, the racking,
steel `shelves` and a `vitrine` carry that trade's goods: boxes, tape, paint tins, spray cans and coils for
hardware; amber bottles, solvent cans, reagent boxes, carboys and drums for chem; hard hats, boxed respirators and
gloves for safety. It says what kind of shop this is. The shop panel says what's for sale, and nothing on a shelf
is the vendor's catalogue.

A new trade adds a name to `SHOP_STOCKS` and a branch to `goodsOf` in `room-shop.js`.

## How it sells

Buying is the commerce plugin's, as it is in text. The room adds ways in and decides nothing.

- **The counter stands for the vendor.** A counter flagged `serves: <npcId>` offers Shop: on its card on the Stage,
  and on `examine`. The card sends `shop <counter>`, and `shop` takes a counter's name for the vendor who serves
  over it, if they're in the room (`cmdShop` in `plugins/commerce/index.js`). That opens the same shop panel as
  talking to them, over the Stage.
- **Bare `shop`** opens the one vendor in the room. With two it asks whose.
- **Talking to the vendor** still works: their card's Talk sends `talk <name>`, and the dialogue's shop node opens
  the panel.
- **The vendor stands behind the counter.** `flags.post` on the NPC names the counter, and `post_gap` how far
  behind it (0.45 at Screw It). The counter's spot must be `{ at: [u, v], turn }` with `look.dims`, or they stand by
  the door. They're at the counter only on shift (`isNpcAtWork`); off shift the shop is shut anyway.
- **Hours, the door and the lock** are commerce's as they were: a shut shop's door is locked, and the closing sweep
  puts you out.

A shop where you take goods off the shelf and pay at the till is the self-service shape that already exists: a
container flagged `vendor_stock: <npcId>` and a counter flagged `checkout: <npcId>`. A shop can have both a served
counter and self-service shelves.

## A new shop, in order

1. Model: name in neon, door, window, trade line ([building-styles.md](../reference/building-styles.md)), and the
   three bakes.
2. Room: `flags.room` as in the table, with `face`, `doors`, `street_door` and `panes` matching the model's door
   and window.
3. Rows: a `tradecounter` with `serves`, shelving, racking or cabinets with `look.stock`, all with authored spots.
4. Vendor: `post` and `post_gap` on the NPC.
5. Check it in the Room Lab (`/room-lab.html?zone=<id>&glass=1` on the Modelshop, restarted after the room first
   gets `flags.room`, since it plans buildings at start), then run `scripts/shapes/room-stage.mjs` and
   `scripts/content/building-stage.mjs`.

## Not built

- Taking a thing off a shelf on the Stage to buy it. The panel is the shop.
- Stock on the shelves that follows the catalogue or empties as it sells.
- The till as something you use; it's drawn.
- The goods bay behind Screw It's roller shutter. Inside, that end of the front wall is plain wall with racking
  against it.
