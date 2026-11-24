# Coldwater Regional's landside

Status: as built 2026-11-22 (content, the Wing and the tower). Rooms inside the terminal are unchanged.

Before this, the only way to the terminal on foot was up the runway from Kessler Street, because the
terminal stood on the strip's west edge with water behind it and every door opened onto the runway.

## The layout

| Grid | Tile | What it is |
|---|---|---|
| 925,901 | `zone_district_924_901` | Coldwater Regional Tower (door east, onto the apron: staff walk airside) |
| 925,902 | `zone_district_924_902` | the Wing's north half, `arrivals` (door east, onto the apron) |
| 925,903 | `zone_district_924_903` | the Wing's south half, `departures`. Its door faces **south** onto the forecourt; the apron door east is a connection file (`conn_district_924_903_east_apron`) |
| 925,904 | `zone_district_924_904` | Departures Forecourt, concrete |
| 924,904 | `zone_district_923_904` | Airport Parking Plaza, door east onto the forecourt |
| 925,905..907 | `zone_district_924_905..907` | Airport Road, north off Kessler Street |

The landside tiles have no exits onto the runway: `conn_district_924_90{4..7}_east_fence` are blocked
connections. Stack Overflow, the container yard that stood at 925,907, is stored
([stored-buildings.md](stored-buildings.md)).

`scripts/content/airport-landside.mjs` made the change and refuses a second run. Read it for the full
file list.

## Airport Parking Plaza

A copy of Marrow Street Parking (`af_stackeddeck`): the same lobby, lift, four levels of three slots
and a roof pad, under ids `zone_apark_*`, `furn_apark_*`, `conn_apark_*`, `map_int_apark` and the
airfield `af_apark`. The flight plugin keys a parked craft to its field, so the two garages don't share
slots. It draws Marrow Street's model: `building_models/stackeddeck.json` binds both names.

## The Wing and the tower (GLASS)

The terminal is one catenary roof slung between two rows of raked pylons over both tiles, with a glass
hall under it, jet bridges airside and the entrance canopy over the forecourt carrying the building's
name and DEPARTURES. The pylons light in rolling colours at night. It lives in `WING` constants in
`glass/models/downtown.js`, never `fh`/`h`, so the halves meet.

Both halves draw in one airside frame. Departures faces south now, so its arm turns `E` back a
quarter (`airE`). Turn `E`, never the world: the mesh is captured at a canonical facing and rotated by
the tile's.

The tower is a hyperboloid lattice of straight members round a white core, under a cab whose glass
flares out to a wide steel brim, with a radome, a sweeping radar bar and a spire.
