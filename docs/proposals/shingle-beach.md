# The Shingle

**Status: as built (2026-11-23).**

The coast behind No Regerts is a beach, with a lane down to it off Halcyon Boulevard and a small
white VTOL pad over the way in. `scripts/content/shingle-beach.mjs` made the change and refuses a
second run; read it for the full file list.

## What changed

- **The beach.** Twenty tiles from 896 to 902 and 901 to 904, everything north of No Regerts up to
  the Basin Jetty and the Codfather's quay wall, are `sand` with `flags.beach`, all named The
  Shingle. The beach plugin puts people on them. Kettle Lane (899,904) stays a road onto the sand.
- **Shingle Lane** (895,904) runs east off Halcyon Boulevard onto the beach at 896,904.
- **The Shingle Pad** (895,905) is a `vtol_bridge` tile: a white deck on four pylons, one VTOL bay
  wide, steps at both ends and the path underneath. It's airfield `af_shingle` (VTOL only, no
  charter or rental) and walkable from the boulevard, the lane and Kettle Green.
- **Stored:** Negative Equity and Chrome Court are rooms only ([stored-buildings.md](stored-buildings.md)).
  The Crown, the bar on Chrome Court's roof, went with it. Its residents moved: Polyester Grubb and Dequarius Bland to
  the Meridian's Unit 603, Rudi Kask, Deacon Ruhl and Juno Kael to 8 Kettle Lane Flat 3A,
  and Lux Ferraday and Lucia Etcheverry to Flat 3B. Benedetta Salis of Negative Equity has no work zone.

## The `vtol_bridge` arm

A TYPE arm in `glass/models/greenside.js`, in tile units like the car park, with nothing of
Coldwater's in it. It reuses the car park's `vtolPad` and `parkedVtol` (which takes a deck height,
`zb`). Its palette is `ty_atc_white`.
