# Batter Days Fish & Chips *(as built)*

**Status: BUILT.** A chip shop at 918,907 on Ironside Street, in the brick unit that was Tine &
Temper. One facade, two rooms and a cellar, one keeper, six new food items, one GLASS arm and one
map icon.

Built 2026-10-08.

## 1. Why Tine & Temper went

Tine & Temper sold pans, pots and utensils. Every item on its list was also on the kitchenware rack
at Ration Nine (920,908), across the road and one tile down, and nobody could say what the shop was
for. Its name didn't say what it sold either.

David chose the chip shop from a list of trades Coldwater had none of. It's cheap takeaway food on a
street of depots and yards: Nico's Noodle Bar is two doors along Marrow Street, and the chippy
sells what a driver eats out of paper in the cab.

## 2. The name says the trade

From this building on, a shop's name is a pun followed by what it sells: *Batter Days Fish & Chips*,
not *Batter Days*. The name board on the front carries the whole name. The kit's trade words
(`SIGN_WORD`, `SIGN_HANZI` in windshield.js) say TAKEAWAY and 炸魚 rather than repeat FISH & CHIPS.

## 3. What's there

| id | what |
|---|---|
| `zone_district_918_907` | the facade, `chip_shop`, entrance east onto Ironside Street, map code `BT` |
| `zone_batter_shop` | The Shop: counter, hot cabinet, fryers, menu board, bench, till |
| `zone_batter_prep` | The Prep Room, west of the shop: peeler, chipper, sink, prep table, the drum smoker and the charcoal grill |
| `zone_util_zone_batter_shop` | The Cellar, down from the shop: fat drums and the junction box |
| `npc_batter_fryer` | Gil Hesketh. Open 11:00 to 02:00, to 03:00 on Friday and Saturday, 12:00 to 22:00 on Sunday |

He sells a fish supper (16), chips (6), a battered sausage (7), mushy peas (4), a pickled egg (3),
scraps (1), vinegar and iced tea. The supper is the only `well_fed` item. Scraps at one credit are
the cheapest hot food in the city, on purpose.

Gil lives in Meridian unit 201 next door, the flat Tove Adaska had. `npc_residences` names Kessel
for that flat, so Gil is the second NPC on its `home_zone`.

⚠ **The drum smoker and the charcoal grill are the only public ones in the city.** They came in
with the cooking expansion and stood in the pan shop. They keep their ids (`furn_smoker_drum`,
`furn_charcoal_grill`) and moved to the prep room. Don't delete them with the next refit.

## 4. Building it

```bash
node scripts/content/batter-days.mjs
```

It runs `authorBuilding` under the slug `batter`, then deletes every file that was Tine & Temper's:
two rooms, the map, two power rows, the generator, nine pieces of furniture, the room's link to the
street and Tove. The old ids were the pre-slug kind (`zone_kitchenware`), so no slug could reach
them and the interior couldn't be kept and re-dressed the way Moor or Less kept `hulls`. Each
deletion only fires while the file still says what it used to, so a re-run is safe.

The import's deletion pass drops those rows on deploy. Lights import off (`light_on` is a runtime
column), so on prod run `node --env-file=.env.prod scripts/content/seed-runtime.mjs` once after the
deploy.

## 5. GLASS

The `chippy` arm in [twin-pass.js](../../client/game/js/panels/glass/models/twin-pass.js) replaces
`tine` and keeps its shell: brick on a stone plinth under a stepped slate roof. On it:

- a galvanised flue up the back corner, steaming at every hour, since the arm can't read opening hours;
- one wide lit window, its lower panes fogged, with the door in the middle;
- the name across the brick over the window, lettered from the tile's own name (the `marqueeBand`
  default), so the engine file carries no Coldwater name;
- a tin fish on a bracket over the pavement, drawn edge-on to the street so it reads from up and
  down Ironside;
- an empty hook rail each side of the window, which is what's left of the pan shop;
- three fat drums against the flank.

The registry entry is `batterdaysfishchips` with `trade: 'chip_shop'`. `KIT_DECLINE` drops the
kit's `ground`, `wall` and `signRoof` for the trade, for the reasons in the note above it in
[derived-kit.js](../../client/game/js/panels/glass/derived-kit.js). The type fallback for any
other `chip_shop` is the shop mesh in brick. The map icon is `bldg_chipshop.svg`, a paper cone of
chips.

## 6. What isn't built

- **Hot food goes cold.** A supper bought at two is as good at noon the next day.
- **The fish isn't supplied.** Gil says the Codfather delivers at six; nothing moves stock between
  the two vendors.
- **Smoked haddock.** Gil's line about smoking it on the drum has no item behind it.
