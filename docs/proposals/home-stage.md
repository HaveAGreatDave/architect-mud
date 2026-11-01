# The Home Stage and the trophy wall

> **Status: design.** Nothing here is built. Where this doc disagrees with
> [plugins/furnishing/README.md](../../plugins/furnishing/README.md), the README wins.

## Why

A flat is the one room a player makes their own, and it's the one room with no picture. GLASS draws
the city, every cabin and cockpit, the Platinum Box and the Kitchen Stage, but `place` puts a sofa
into a room you can only read. And nothing you earn can go on the wall: a bounty head gets cashed, a
card stays in the binder, a crash leaves nothing behind.

Two pieces of work, built in this order:

1. **The Home Stage.** A first-person 3-D view of a room you control, drawn from the furniture rows
   already in it.
2. **The trophy wall.** Earned objects mounted where visitors can read them, each carrying the story
   of how it was got.

## The Home Stage

### Rules

1. **One payload, two renderers.** The room's text and the Stage read the same furniture rows.
   Every gesture on the Stage sends a verb a player could type (`sit sofa`, `watch tv`, `open
   fridge`). The Stage decides nothing.
2. **Typing never loses.** Text and log modes stay first-class
   ([systems-display-mode.md](../systems-display-mode.md)). Nothing in a flat is only reachable in 3-D.
3. **The look comes from data, never from a name.** A placed piece is drawn from an archetype
   picked by its item's flags, the way the Kitchen Stage picks a pan from `vessel_kind`. The
   renderer knows "a seat for one", not "wobbly barstool", so a second game on THOMAS gets the Stage
   without inheriting Coldwater's catalogue.
4. **Where a piece stands is server state.** Its spot is stamped on the furniture row at `place`, so
   every viewer sees the same room and the layout survives a restart.

### Archetypes

The 33 furniture items sold today fall into nine shapes. Size comes from the item's weight and a
`flags.look` override when the default is wrong, as `tags.matter` overrides `food_profile`.

| Archetype | Picked by | Today's items, for example |
|---|---|---|
| `seat` | `sit` only | barstool, mag-lev chair, lab stool |
| `bench` | `sit`, weight over 10 kg | corp-issue bench, diner booth |
| `sofa` | `sit` + `lie` | busted sofa, neural interface couch, surplus cot |
| `bed` | `lie` only | sleep pod |
| `screen` | `watch` | the nine TVs, from cathode box to ghost screen |
| `cold` | `container` > 0 | the five fridges and the deep-freeze |
| `hob` | `stove_tier` or `microwave` | Hobline Cooktop, Ember 300, Searmaster, the Pulsebox |
| `surface` | `lean`, no container | concrete counter, self-organizing desk |
| `small` | `lift` | space heater |

Each archetype is one named model in the Modelshop, bound by name
([tools/modelshop/README.md](../../tools/modelshop/README.md)), with a tint and a wear level from the
item. A tenth case, `poster` and `trophy`, hangs on a wall rather than standing on the floor.

### The room

Flats carry no size today. The proposal is a `flags.room` on apartment zones, `[w, d, h]` in metres
with a default of `[4, 5, 2.6]`, and one window wall taken from the building's facing so the view
out is the real street from GLASS. The 12-piece cap stays.

### Placing

`place` picks a free spot by archetype: a `screen` against the wall opposite the door, seats facing
whatever screen is in the room, `cold` and `hob` along one wall, `bed` in the far corner. The spot
goes on the row as `flags.spot: { wall, along, turn }`. A later `arrange <piece> <wall>` verb can
move it; the first phase doesn't need one.

### What it reuses

- The walk, the hands and first person from the Platinum Box suite (`stands.js`, `stands-hands.js`),
  lifted into a shared layer first: see [room-stage.md](room-stage.md).
- Toon bands, the ink outline and the cel setting from GLASS 2 (`gl/ink.js`, `toonBands`).
- The window: the same `paintWindshield` call freelook makes, framed by the window wall.

### Phases

| Phase | What ships |
|---|---|
| 0 | `flags.room` on apartment zones and `flags.spot` stamped at `place` (server only, regress-covered) |
| 1 | The Stage opens in your own flat: walls, floor, window, every piece as its archetype |
| 2 | Gestures: sit, lie, watch and open send their verbs |
| 3 | Visitors: anyone in the room sees it, and sees each other |
| 4 | `arrange` |

## The trophy wall

### Rules

1. **A trophy is an item that remembers.** It carries a provenance stamp written when it was made:
   who, where, when and how. That stamp is the whole feature; examine reads it out in the house voice.
2. **Mounting is a choice to show it.** `mount <item>` hangs a carried trophy in a room you control;
   `unmount` takes it down. Wall spots are their own count, 6 a room, apart from the 12 floor pieces.
3. **A mounted trophy is still an object.** It can be stolen by a burglar, and it keeps its stamp,
   so a stolen head turns up on someone else's wall still saying whose it was.

### What can be a trophy

| Trophy | Where its stamp comes from |
|---|---|
| A bounty head | Minted with the contract: target, killer, the board, the stake. Mounting it means not cashing it |
| A framed card | A trading card from the binder, framed: the card's own narration plus its serial |
| Wreckage | `salvage` on a wreck (flight plugin) already rolls scrap and parts; it would also be able to yield a skin panel stamped with the aircraft's name, owner and livery. Issue #53 (crash debris drops the livery) wants fixing first |
| A framed accolade | An accolade printed and framed. Accolades are private, so this is the only way one is ever seen |

Mounting reuses the furnishing plugin's funnel: a mounted trophy is a furniture row with
`origin='player'`, `object_type='furniture'`, `flags.trophy` holding the stamp and `flags.spot` on a
wall. Move-out boxes it back with everything else. On the Stage it's the archetype `trophy`, drawn
from what it is: a head on a plaque, a card in a frame, a bent panel in its livery.

### Phases

| Phase | What ships |
|---|---|
| T1 | The stamp on bounty heads and cards; `mount`/`unmount`; examine and `look` read them |
| T2 | Trophies on the Stage's walls |
| T3 | Wreckage panels from `salvage`, after #53 |
| T4 | Framed accolades |

## Open questions

- Is a mounted bounty head a forfeit of the payout for good, or can it come down and still be cashed
  while the contract is open? Cashing a head you'd hung for a week is a good story; so is a head
  nobody could ever collect on.
- Do heads rot? Nothing rots them today. A mounted head that needs a taxidermist would be a trade.
- Corp HQs and storefronts are rooms you control. Do they get the Stage and the wall in phase 1, or
  flats only?
- Should visitors be able to read a trophy's full stamp, or only the owner, with visitors getting a
  shorter line?
