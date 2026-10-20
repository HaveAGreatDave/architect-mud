# posters

**Purpose** — portable hero posters. `takedown` peels one off the wall (furniture → a rolled item you carry); `putup` hangs a carried poster on the wall of the room you are in and tells you where it falls in the mural.

## Commands
- `takedown` / `take` — peel one off.
- `putup` — hang one.

## Provenance

The seven posters start as authored furniture (`furn_hero_poster_<key>`, one file each in `content/furniture/`), and the content import upserts those files over the DB on every deploy. So:

- `putup` never reuses the authored id. It inserts a new row with a `furn_<8hex>` id, `origin='player'` and the hanger in `owner_id`. The export skips it and the import's deletion pass can't touch it.
- Taking down an authored poster sets the world flag `poster_taken:<key>`. The import puts the row back; `reconcileTakenPosters()` runs when the plugin loads (after the deploy restart) and deletes authored posters whose key is flagged. Taking down a player copy sets nothing.
- The seam and mural match on `flags.poster_key` across whatever rows hang in a room, so authored and player rows mix freely.

## Hooks
- `furniture.describe`

## The two-layer easter egg
Kiyo and Cyd were printed as **one image**, so hanging that pair together reveals a hidden GRU at the seam on examine. Hanging **all seven** sheets in one room spells HELLMOO across the seams.
