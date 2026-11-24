# Coldwater Financial on Marrow Street (once Compound Interest)

**Status: as built, 2026-11-22.** It opened as Compound Interest and was renamed Coldwater Financial and given its portico the same week. The file keeps its old name so links hold.

Compound Interest moved from the residential district to Marrow Street and was rebuilt as an Art Deco
bank, two doors from the Meridian. Loan Wolf, at 917,913, is the other bank on the strip and didn't
change.

## Where things are

| | Before | Now |
|---|---|---|
| The bank | 922,911, facing south over its own forecourt | **917,910**, facing north onto Marrow Street |
| 917,910 | Unit 4, Marrow Street, a storefront to buy | Coldwater Financial (`bank`, map code `CF`) |
| 922,911 | Compound Interest | a fenced vacant plot (`vacant_plot`) |
| 922,912 | Compound Interest Forecourt | Old Bank Forecourt, still the plot's only way to the road |

Zone ids east of column 914 are one less than the grid, so the bank's tile is
`zone_district_916_910` and the old site is `zone_district_921_911`.

## The building

The model is `content/building_models/coldwaterfinancial.json`, bound by name. It uses the Meridian's
materials and adds no palette key: `ty_palais_stone` on a `ty_hc_granite` plinth, columns and piers in
`ty_marble_col`, frames and bands in `ty_meridian_bronze`, and a `ty_verdigris` cap.

- **The portico.** The hall's front wall is set back to y 0.26. Four round marble columns stand on a
  granite step in front of it and carry the frieze where it oversails the recess, between two solid
  end piers. Each column is a granite plinth, a bronze base ring, a tapered sixteen-sided shaft with
  a gilt band halfway up, a flaring capital and a bronze abacus. They're `drum` segs, not a
  `pilaster` rank, because they stand free and hold something up.
- The bronze doors, the window over them and four tall windows are on the recessed wall, behind the
  columns.
- Above the frieze a two-step crest over the door leads into two setbacks and a faceted copper cap.
  Each step ends in a bronze band. The flanks, back and setbacks keep their pilaster ranks.
- The name is cut into the frieze in the `deco` hand and gilded. Nothing hangs off the building. The
  second line is the tile's `sign_trade` (BANK).
- It has no `neon` key and no `keepsReach`: it faces a carriageway and stays on its plot.
- At night the portico is lit from the doors, each column is uplit at its base, and the crest is
  floodlit.

The map icon is [bldg_compound_interest.svg](../../client/game/assets/zone-icons/bldg_compound_interest.svg),
a stepped tower over three piers, pinned on the tile with `flags.icon`. Loan Wolf keeps the generic
`bldg_bank` pediment, so the two banks read apart on the map.

## The rooms

The four rooms kept their ids, so the tellers, the guards, the ATMs, the card mint, the cameras, the
junction box and the vault's loot table all came with them. The plan was turned round to put the
street door on the north side:

```
Marrow Street
   | north
zone_citadel_hall        the banking hall, full height, behind the portico
   | south   (the mantrap door)
zone_citadel_vestibule   the security vestibule and the junction box
   | south   (the gallery door)
zone_citadel_gallery     safe deposit
   | down    (the vault door)
zone_citadel_vault
```

The two connections that changed direction kept their ids (`conn_citadel_hall_north_nuly` is now a
`south` connection), because the doors name them. Each camera's `direction` was flipped, and the
floor guard ejects to the new tile. The rooms were already wired: a power zone and a light each, fed
by `gen_citadel_util` in the vestibule.

None of the rooms has a Room Stage spec, so the bank is text inside.

## Unit 4

Unit 4, Marrow Street is off the market. Its rooms are stored the way Lather & Lye's are (see
[stored-buildings.md](stored-buildings.md)): `zone_sf_marrow4` and its utility room have no parent
and no exit to the street, the `is_storefront` and `shop_*` flags are gone, and the street
connection and shutter door were deleted. Its counter, floor safe, lights and junction box are still
in the rooms, and its model file is still bound to the name, which no tile carries.

Three storefronts are left to buy, and `plugins/storefront/regress.js` now asks for three.

⚠ A `storefronts` row is player data, and the content pipeline doesn't touch it. If anybody owned
Unit 4 on prod, their row still names `zone_sf_marrow4`. Check before the deploy:
`SELECT * FROM storefronts WHERE zone_id = 'zone_sf_marrow4'`.

Denna Sorrel (`npc_lapsed_client`) sat on Unit 4's step. She sits on Unit 9's now, next door.

## The old site

922,911 is a concrete slab behind mesh fencing with a letting board, using the generic
`vacant_plot` arm. The forecourt at 922,912 is unchanged apart from its name and prose, and it's
still the only way from the plot to the road, so don't build on it.

The old model, a grey stone strongroom with a porte-cochère over the forecourt, is in git before
2026-11-22.

## To check after changing it

- `npm run models:bake` and `npm run shapes:bake` after editing the model file, then `npm run lite:bake`.
- `npm run shapes:smoke` and `node scripts/content/building-stage.mjs`.
