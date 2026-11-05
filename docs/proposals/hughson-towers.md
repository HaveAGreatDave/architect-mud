# The Hughson towers *(as built)*

**Status: BUILT 2026-11-04, on the map only.** The Hughson Car Park and Hughson Green are gone. Their 59
tiles were 41 sealed buildings and three new streets. When the park moved two tiles west
([coliseum-five-tiles.md](coliseum-five-tiles.md#two-tiles-west)) four towers went to x 897 and 12 Yarrow
Lane came down, and when it moved two tiles north ([coliseum-five-tiles.md](coliseum-five-tiles.md#two-tiles-north))
19 Hughson Way went to 891,920 and 17 Hughson Way and 9 Hughson Court came down for the gates' streets. There
are 38 now, and none of them has a door yet.
[scripts/content/hughson-towers.mjs](../../scripts/content/hughson-towers.mjs) wrote the content and
refuses to run twice.

## Why

The lot west and north of the park was grass and tarmac, and it's the ground the field looks at. Home
plate is at 894.61,917.61 on a bearing of 315, so left field is the old car park, centre the old lawn
and right the old courtyard. Dave's call (2026-11-04) was to take up the car park and the parks and
make the ground part of the skyline.

## The map

```
        887 888 889 890 891 892 893 894 895 896 897
 y 909  ===== Halcyon Boulevard ==================
 y 910  50  30   Y  36  18   R  6HB 8HB INS LND  r
 y 911  42  24   Y  28  12   R   7   6   8  9HW  r
 y 912   B   B   +   B   B   R  2HW  6   8   7   r
 y 913  38  26   Y  30   a   R  SS   6   6 11HW  r
 y 914  34  22   Y  24  the park          R   r
 y 915   R   R   +   R                    R   r
 y 916  46  28   Y  26                    R   K
 y 917  36  20   Y   E                    R  12
 y 918   E   E   +   E                    R  10
 y 919  44  30   Y  22   R   R   R   R   R   R  14
 y 920  32  20   Y  14  10  3SW 5SW  w  7SW  R   8
 y 921  ===== Sorrel Way =========================
```

A number is the building's storeys. `Y` is Yarrow Lane, `B` Burnet Walk, `E` Teasel Walk, `K` Kerbstone Row
and `w` Grandstand Walk. `R` and `r` are Hughson Way, and `a` its short cut to the bleacher gate.

## The heights

- **The ridge is the River Road**, x 887, from 32 to 50 storeys. It joins the towers already on x 887
  and x 888 north of the boulevard, and 1 Halcyon Boulevard at 56 stays the tallest in the group.
- **Each column falls toward the park.** The towers left on x 891 and the four on x 897 are 8 to 18
  storeys, so the Coliseum isn't walled in from Hughson Way.
- **Hughson Court stays at 8 storeys or fewer.** The eight courtyard tiles stand between home plate and
  the Spire and Halcyon Towers, at bearings of about 345.
- The Spire draws about 108 storeys and Halcyon Towers about 69, so both stay the peak.

## The tiles

- **Every id stays.** A tile keeps `zone_ballpark_<x>_<y>` and takes a new role, as in
  [coliseum-five-tiles.md](coliseum-five-tiles.md). Each is an address, so x 887 is the River Road, x 888
  and x 890 Yarrow Lane, x 891 and x 897 the odd side of Hughson Way and the courtyard Hughson Court.
- **25 of the 38 count as skyline** (14 storeys or more, [skyline-tall.js](../../client/shared/skyline-tall.js)).
- **Ten are bound to an estate silhouette by name** in `NAMED_MODELS`, at new heights. The other 28
  draw by type. A second copy of a silhouette reads as the same architect, and the quarter's palette is
  narrow on purpose ([building-styles.md](../reference/building-styles.md)).
- ⚠ **`is_building` doesn't stop the grid.** Only `facade` does, so the script wrote 109 blocked
  connections round the sealed tiles. Without them the lanes open straight into the towers.
- **A door can come later.** `authorBuilding` turns a sealed tile into a facade without touching the
  street. Halcyon Fields' rule is that a clad, finished tower has a way in, so these are owed doors.

## The story

Sir Charles never sold, and the statue's "He would not sell" stays true. The towers stand on a ground
lease: Halcyon sent the cheque three times, got two tickets back each time, and in the end rented the
ground. 889,911 tells it.

The brass plate from the pond is set in the paving at 889,912, where Yarrow Lane crosses Burnet Walk. It
still says to walk on the grass. An attendant's folding chair is still chained to a lamp post at 889,916.

Lines that changed because they stopped being true: the street tiles round the lot, the windows and
descriptions of 2 and 11 Hughson Way and 5 and 7 Sorrel Way, the Sales Suite, the Recital Hall's foyer, 10 Cinder Lane, 8
Kettle Lane, the steamer chairs, one of Nadia Ferreira's idle lines and Lavinia Fairlie's greeting.

## On TV

⚠ **These towers aren't in the broadcast.** The set is composed round the whole lot (`site.set`, 887 to
897 by 910 to 920), which the true-size park fills, so `composeSet` skips every building on it. The city
past the wall on TV comes from the rest of the skyline and the quarter's own `towers` filler.

## After the deploy

- `scripts\oneshots.bat prod`: `set-aside-players.mjs` now also moves anyone who logged out on a sealed
  `zone_ballpark_*` tile, because those tiles have no exits.
- `node scripts/snapshot-flight-world.mjs`, `npm run shapes:bake` and `npm run wildlands:bake`.

## What isn't done

- **Doors.** None of the 38 has one, and there are no interiors, keepers or flats.
- **New silhouettes.** The ridge reuses the estate's. A landmark of its own would go on 1 or 9 River Road.
- **Sorrel Gardens and Windrow Corner.** The ten single garden tiles on y 922, y 920 and 898,919 stay.
  They sit between shops and are behind home plate or east of the park.
