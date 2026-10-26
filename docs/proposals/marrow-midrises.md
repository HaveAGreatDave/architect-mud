# Kestrel Court, Marrow House and Corbett Mansions *(as built)*

**Status: BUILT.** Two blocks of flats and a low office round Solenne Residences: Kestrel Court and
Marrow House on Marrow Street in Solenne's own glass, stone and bronze, and Corbett Mansions on
Lever Lane beside Watts The Damage, with Mixed Bag Variety Store in its ground floor. The Slip moved
to the old weigh-house off The Gate Road to make room. Unit 4 moved across Marrow Street, and Nuts
to That and Cash & Carrion closed. Four GLASS models, one painter fix.

Built 2026-10-08, and reshuffled the same day: Corbett first went up on 915,908, the tile Marrow
House has now.

## 1. Why

The block between Meltwater Row and Ironside Street had two towers (Solenne and the Meridian) and
five low shops. David wanted more mid-rises on it, shorter than the Meridian and taller than
everything else on the street, and then wanted the two on Marrow Street to belong to Solenne
rather than argue with it. Drawn heights, with each model's crown included:

| building | storeys drawn |
|---|---:|
| Solenne Residences | 28 |
| The Meridian | 22 |
| **Kestrel Court** | **12.6** |
| **Corbett Mansions** | **12**, plus its tank |
| Embassy Hotel & Bar | 8.7 |
| **Marrow House** | **6** |
| the rest of Marrow Street | 2.5 to 5 |

Every tile gets a ±10% height jitter (`floorHeight` in windshield.js), so a drawn height moves
about a storey either way of `floors`.

## 2. What moved and what went

| tile | was | is |
|---|---|---|
| 913,908 | Unit 4, Marrow Street | **Kestrel Court** (`apartment`, map code `KC`) |
| 915,908 | Nuts to That | **Marrow House** (`office`, `MO`) |
| 916,906 | The Slip | **Corbett Mansions** (`apartment`, `CN`), facing east onto Lever Lane |
| 917,917 | Where the Weigh Was, the lay-by | **The Slip** (`fence`, `SL`), facing east onto The Gate Road |
| 916,910 | Cash & Carrion | **Unit 4, Marrow Street** (`shop`, `M4`) |

- **Unit 4 is one of four storefronts a player can buy**, so it moved rather than closed.
  `zone_sf_marrow4` kept its id, price and terms, so any deed in the storefront tables follows it.
  Its authored model is bound by name and went with it. Denna Sorrel, who sits on its step, went too.
- **The Slip moved, it didn't close.** Its shop, back room, utility room, map, shop door, furniture
  and Sluice all kept their ids; only the facade tile changed. It took the old weigh-house at the
  top of the lay-by where the weighbridge stood, two tiles from the gate into the Shingles. A weigh
  slip is the ticket a weighbridge clerk hands a driver. The clerk's dial and his plated-over hatch
  are new furniture in the shop, and the plates' tile at 917,918 now mentions the hut.
- **Cash & Carrion** was the third fence within four tiles. Hock's radio and watch, which nobody
  else sold, went to Kade at Sentimental Value Pawn. Dell Fry took over Hock's row in
  `npc_residences` for Meridian 404.
- **Nuts to That** sold hardware one tile from Watts The Damage. The twelve items Watts didn't stock
  (the sledgehammer, the lockpick roll, the mining pick and the rest) went onto Watts's list, and
  Wendel Corry retired.

## 3. The blocks

Kestrel and Corbett have the same plan: a lobby, three landings, two flats a landing (A west, B
east), an en suite bathroom off every flat, a roof, and a utility room under the lobby. The
landings are storeys four apart (3, 7, 11 and 4, 8, 12) so the interior climbs the height the
street sees.

| | Kestrel Court | Corbett Mansions |
|---|---|---|
| look | Solenne's champagne glass between pale stone fins, built by Solenne's developers on the rest of the plot; a glass stair tower up the east end, bronze-railed balconies on the back over the Strand | interwar mansion flats: red brick banded in stone on a two-storey stone plinth, stepped back twice, a bay of windows up the front, a timber water tank on the roof |
| flats | woodblock floors, galley kitchen, balcony; white-tiled bathroom | high ceilings, boarded fireplace, butler sink; hex-tiled bathroom with a claw-foot bath |
| rent | 180 / 200 / 220 by landing | 240 / 260 / 280 by landing |
| roof | washing lines and the padlocked lift motor room | the tank and the chimney pots |

Every flat is `is_apartment` with a `rent_cost`, a hololock door and a privacy bolt on the bathroom.
Each flat has a bed, a wardrobe, a kitchen sink, a hob and a fridge; each bathroom has a shower (a
bath at Corbett), a toilet and a basin. Every room, the roofs included, has a light and a
`power_zones` row on its building's junction box. The roofs are `open_sky`, so they're in the power
network but climatically outdoors.

Corbett's A flats look west over the grass to the Strand and the Basin; the B flats look across
Lever Lane at Salvage Rites.

### Marrow House

Six storeys of offices: a reception hall, one empty floor to let (the Fourth Floor), and a plant
room under reception. The directory lists two tenants out of twelve. Nobody works there yet; the
lobby and the empty floor are the whole interior until somebody leases a floor.

### Mixed Bag Variety Store

Off Corbett's lobby to the south, through a bead curtain. Effie Lark runs it, 07:00 to 22:00 (23:00
Friday and Saturday, 09:00 to 18:00 Sunday), selling 23 everyday items: soap, socks, fuses, mugs,
tea, bandages, batteries, a torch. Every item is an existing one. The shop door off the lobby has a
shop lock that drops when she goes home. She sends anyone after tools next door to Watts.

She lives in Corbett 4A with her uncle Cyril Tolley, who had the shop for forty years and still does
the books. `npc_residences` names Effie for 4A; Cyril shares her `home_zone`.

## 4. Building it

```bash
node scripts/content/marrow-midrises.mjs
```

It moves The Slip, moves Unit 4, folds the two shops' stock, runs `authorBuilding` three times
(slugs `kestrel`, `corbett` and `marrowhouse`), then fits the flats, doors, grid positions and room
names, and deletes everything that belonged to Nuts to That and Cash & Carrion. Each deletion only
fires while the file still says what it used to, so a re-run is safe. Room names use a comma rather
than the lib's dash, and a flat's name ends `Unit 3A` so `floorDesignation` gives it a map marker.

- ⚠ **Corbett has to be authored before Marrow House.** Until it is, Corbett's rooms still name
  915,908 as their parent, and `authorBuilding` skips a tile's own rooms when it strips the links
  into a new facade.
- ⚠ **Corbett's shop moved from east of the lobby to south of it.** Facing east, the lobby's east
  slot is the street door. The script rewrites the shop's exits and the shop door, and deletes the
  old `conn_hf_corbett_lobby_east`.

The import's deletion pass only sees deletions that are committed, so it drops the removed rows on
deploy, not on a local import before the commit. Lights import off, so on prod run
`node --env-file=.env.prod scripts/content/seed-runtime.mjs` once after the deploy.

## 5. GLASS

Four authored models under `content/building_models/`, all bound by name: `kestrelcourt.json`,
`marrowhouse.json`, `corbettmansions.json` and `theslip.json`.

- **Kestrel and Marrow House wear Solenne's keys** (`ty_solenne`, `ty_marble_col`,
  `ty_marble_bronze`) rather than keys of their own, so they can't drift from it. Solenne's glass
  is blue panes in gold frames, and its stone fins carry the same gold run after dark. Neither has
  window repeats on the glass: a `GLASS_WALL` palette paints its own pane grid and floor plates.
- **Corbett is every-mass-square**: a stone plinth, the brick shaft, two setbacks under stone
  cornices, an attic carrying the tank, a bay up the front and a stair tower up the back. Its wall
  is in `BRICK_WALL`, which draws no window grid, so every sash is authored, one `repeat` a column.
- ⚠ **Corbett's name is the biggest lettering on its front, and it's above the shop's.**
  CORBETT MANSIONS is cut across the whole stone frieze at the top of the plinth; MIXED BAG over
  VARIETY STORE are boards on the shopfront under it. Two names on one front, belonging to two
  businesses, so it's allowed.
- ⚠ **Kestrel's slab is the only non-square box, and it's centred.** Off-centre masses are square,
  for the reason in the Sentinel's note (`F()` rotates position, not footprint).
- ⚠ **Each model has its own trade key and a `KIT_DECLINE` row** in
  [derived-kit.js](../../client/game/js/panels/glass/derived-kit.js). The derived kit fills any
  section an authored model leaves out, and it was hanging a fire escape across Marrow House's fins
  and offering all of them a roof hoarding. The Slip's row (`slipback`, its `replaces`) declines
  `sign` as well: it is the one building in Coldwater with no lettering at all.

### The painter fix

`balcony` and `fireEscape` in [authored-detail.js](../../client/game/js/panels/glass/authored-detail.js)
projected toward +y whatever face they were on, so on a back wall or the −x flank they drew inside
the building. The file's own note called this latent; it wasn't. Thirteen existing models hang a fire escape
there, the Embassy among them, and none of those fire escapes was visible. Both painters now take the
outward direction from the face's sign, as `windowBay` and `canopy` already did, so those fire
escapes appear on this change.

On the 2-D painter only the lowest of Kestrel's back balconies draws, which is the mean-depth sort
the Modelshop README describes for parts on a long wall. GLASS 2 draws all sixteen.

## 6. What isn't built

- **No new residents beyond Effie and Cyril.** Eleven flats are empty and lettable.
- **No tenants in Marrow House.** The two names on the directory are prose.
- **No lift in the flats.** Both lobbies have one, out of order, which is why the stairs are the
  way up. Marrow House's lifts work and go nowhere you can reach.
- **No balcony you can stand on.** The balconies are in the model and the flat descriptions; no
  zone or verb uses them.
