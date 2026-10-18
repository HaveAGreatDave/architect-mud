# The Coldwater Palais *(as built)*

**Status: BUILT.** A music hall on Meltwater Row, three tiles across, in front of Fisherman's Green.
Two facades, one doorless stage tile, two interior maps, two keepers, four new items, three GLASS
arms and three map icons.

Built 2026-10-08.

## 1. What it is

The Palais went up in the Meridian's decade, out of the Meridian's stone, and somebody has kept it
up ever since. It's the only working venue in old Coldwater: a band most nights, dancing after, a
comedian on Tuesdays and a pianist on Sundays. The stage piano and the theatre organ are real
instruments (`flags.instrument`), so a player can sit down and play to the room.

It replaced three tiles of wasteland "Grasslands" (`terrain: forest`) between Voss Avenue and
Marrow Street.

## 2. The three tiles

It's laid out the way Coldwater Regional's terminal is: one building over several tiles, each tile
with its own `building_type`, all sharing one `building_name`. All three face north onto Meltwater
Row.

| tile | type | map | what |
|---|---|---|---|
| 908,909 | `palais_foyer` | BX | the box office foyer, door north. Interior map `map_int_palais` |
| 909,909 | `palais_stage` | MH | the auditorium and stage house. No door, no exits, like Priced to Sell |
| 910,909 | `palais_bar` | PB | the bar foyer, door north. Interior map `map_int_palais_east`. Its tile is named *The Coldwater Palais Bar* |

⚠ **The middle tile is walled on purpose.** `zone_edges` projects an exit between any two touching
cells, and a doorless building isn't exempt the way a facade is, so blocked connection files close
its north and south sides. The foyer and the dressing rooms touch on the interior grid and get the
same treatment.

## 3. Inside

| id | room | reached from |
|---|---|---|
| `zone_palais_foyer` | The Box Office Foyer | the west door |
| `zone_palais_stalls` | The Stalls, with the theatre organ | foyer east, bar west |
| `zone_palais_stage` | The Stage, with the concert grand | stalls south |
| `zone_palais_circle` | The Dress Circle | stalls up |
| `zone_palais_dressing` | The Dressing Rooms | stage west |
| `zone_util_zone_palais_stage` | The Trap Room, the west junction box | stage down |
| `zone_palais_east_bar` | The Crush Bar | the east door |
| `zone_util_zone_palais_east_bar` | The Cellar, the east junction box | bar down |

⚠ **The stalls are in the box office's map and the bar reaches them across maps**, the way the
airport's arrivals hall reaches check-in. The script writes that link after both
`authorBuilding` calls, because `authorUtilityRoom` walks the exits to decide what its junction box
feeds, and with the link in place either box would claim both halves.

| npc | where | sells |
|---|---|---|
| `npc_palais_boxoffice` Minnie Pruett | box office, 12:00 to 22:00 (23:00 Fri, Sat; 14:00 to 21:00 Sun) | programme 3, choc ice 4, box of chocolates 9 |
| `npc_palais_barman` Lionel Lasko | Crush Bar, 17:00 to 01:00 (03:00 Fri, Sat; midnight Sun) | sidecar 14, rust whiskey 10, beer 6, iced tea 4 |

Both live in Meridian unit 503, which was empty. `npc_residences` names Pruett.

## 4. Building it

```bash
node scripts/content/coldwater-palais.mjs [--dry-run]
```

Idempotent: every id derives from a slug. Lights import off (`light_on` is a runtime column), so on
prod run `node --env-file=.env.prod scripts/content/seed-runtime.mjs` once after the deploy.

## 5. GLASS

The three arms are in [downtown.js](../../client/game/js/panels/glass/models/downtown.js), beside
the terminal. The whole building is in one constants block, `PAL`, never in `fh` and `h`, for the
terminal's reason: both are rolled per tile, and three tiles sized off their own rolls would be
three buildings with three cornice heights. Parts are placed on the building's own axis `X` (0 is
the middle of the stage tile, +X is west) and each arm draws the parts on its own tile.

- **The foyers** (`palaisFoyer`, mirrored by `off`): a blind stone ground floor, two floors of the
  Meridian's own windowed limestone (`ty_meridian`), a copper-flashed cornice and an attic. A stone
  drum on the outer corner with bronze speed lines and a copper cap; its top line is a pink tube after
  dark. The door sits toward the stage, bronze, under a canopy, with BOX OFFICE or BAR in the transom.
- **The stage tile**: a blind auditorium the width of the tile, a stage house behind it a storey and
  a half higher with a smoke vent, a scene dock door over the park, and a stepped frontispiece on the
  centre line with fins and lit glass. The bronze blade stands off the bay with PALAIS down both
  faces (gilt by day, pink after dark). The marquee carries the bill on milk glass with a row of bulbs.
- New palette `ty_palais_stone` (STONE_WALL, so blind ashlar with no window grid). The foyers'
  windowed floors wear `ty_meridian`.
- The blade's word and the bill are on the registry rows (`blade`, `bill`, `door`), so the arm
  carries no Coldwater words. All three rows set `noKit`.
- The name appears once, on the blade. The marquee says what's on and the transoms say what's through
  each door.

## 6. What isn't built

- **The bill doesn't change.** The marquee and the box office both say a band plays most nights;
  nothing books one, and the stage is empty unless a player is on it.
- **No tickets.** The doors are open whenever the building is, and nobody checks.
- **The stage tile has no map icon.** The icon lookup is gated on `facade`, and the stage has no door.
  `bldg_palais_stage` is registered so the type isn't the one without an icon if that changes.
