# Ration Nine *(as built)*

**Status: BUILT.** The grocery at 921,908 on Ironside Street, redrawn as a grocer's with a market
front. One GLASS arm, one map icon and the facade tile's prose. The rooms, the keeper and the stock
didn't change.

Built 2026-11-22. Second pass the same day: a second storey, the awning raised over a person's head,
and the roundel redrawn as a neon sign that's lit at every hour, because the shop never shuts.

## 1. Why it changed

Ration Nine was drawn as a municipal ration depot: olive walls, two hatches, a canopy on posts and
no shopfront. It sells groceries, and nothing on it said so. The new front is a shop you can tell
is a grocer's before you can read a word on it.

## 2. What's on it

The `market` arm in [ration.js](../../client/game/js/panels/glass/models/ration.js), in the order a
passer-by takes it in:

- **The roundel**, on a raised cream bay over the door that rises through the parapet to a stepped
  top: a red disc in a cream ring with a green line in it, a sunburst and a ring of bulbs, Ration in
  pink script on a green ribbon across the upper half, tipped up 15 degrees with swallowtails behind,
  and a gold 9 under it, right of centre. The word goes over the numeral: with the 9 on top it read
  "9 rations". The rings, the ribbon's outline, the 9 and the word are neon, lit day and night, and
  the 9 and the word each have a dark outline: eight painted copies of the word behind the tube,
  since the sign baker has no outline of its own.
- **The awning**, green and cream, the whole width of the front, out over the pavement on four posts
  with a scalloped valance that comes down to about 2.5 m.
- **The stockroom floor** over the shop: green-framed windows either side of the bay, three down
  each flank and three at the back, each lit or dark at night by its own roll.
- **OPEN 24 HOURS** in red tube inside the right-hand window, always lit.
- **The stands** under it: three tiered timber stands, three bins to a tier, a price ticket on each,
  and two crates at the foot of every stand. Twelve kinds of produce by colour.
- **The windows**, stocked shelf by shelf, with sale bills stuck to the glass, and sliding doors
  between them.
- **The trolleys**: five nested in a rail bay at the corner.
- **GROCERY** across the fascia, once.

Round the sides: three high windows on each flank, the empties stacked on one, a roller door, a
pallet and the bins at the back, and two condensers and a rooflight on the roof.

## 3. Rules it keeps

- **The name appears once**, as the roundel. The fascia takes the trade word from the tile's
  `flags.sign_trade`, falling back to the model's `SIGN_WORD`.
- **The arm carries nothing of Coldwater's.** The roundel's two words are `mark: ['RATION', '9']` on
  the `rationnine` row in `NAMED_MODELS`, so another grocer could be bound to the arm with its own.
- **Two storeys, three units.** `S` is a storey and `G` (1.16 `S`) the shop floor. The shopfront
  and the awning are in `G`, the stands, trolleys and crates in `S`, and only the top cornice and
  roof in `h`. The valance is a plain fraction of `G` (never a max() against metres), so the
  capture stays affine.
- **The roundel is measured in `G` both ways**, so it stays round on a tile with a different footprint.
- **Mass never asks `near`.** The fruit, the shelves and the trolley baskets are flats and wires and
  are shed with distance; every box is drawn at every distance, because mass is captured once.
- **The roundel's lettering is tube, on a dark disc.** A tube 9 on a lit disc bloomed into a white
  blob from across the street, so after dark the painted faces go down to an unlit sign's colours and
  the tubes are the only light. Each tube is two strokes, a wide halo in the gas colour and a thin
  core mostly white, which is what makes it read as lit glass.
- **The word is authored `Ration`, never `RATION`.** `deadNeon` rolls on the label as written,
  and the capitals roll a dead letter; a shop open all hours keeps its sign whole.
- **The tubes cross the lettering's glow margin**, so the model is on `signfit`'s known list with
  that reason.
- **The pediment is braced by a buttress, not stay wires.** A raking stay crossed the roundel from
  three headings and `signfit` caught it.

## 4. Content

- `zone_district_920_908` is two floors (`flags.floors: 2`; it was 3, then 1). Its description
  matches the front. The upper floor has no rooms: only the shop floor is walked.
- **Open all hours.** Dell Fry, who keeps it, is on the timetable from 0:00 to 24:00 every day
  (`vendor_schedule` on `npc_ration_cook`), so the door never shuts. The sign says so; nothing
  new was needed on the server.
- The authored model `content/building_models/rationnine.json` is deleted. It overrode the old arm
  through `replaces`, and would have overridden this one.
- `grocery` tiles take `bldg_grocery.svg` on the map (an awning over a crate of fruit) instead of
  the generic shop.

## 5. What isn't built

- **Walking in.** The front has no Room Stage `face` or `street_door` yet; Screw It is the example
  to follow ([shop-interiors.md](shop-interiors.md)).
- **The stands sell nothing.** They're drawn; the shop's stock is still the shelves inside.
