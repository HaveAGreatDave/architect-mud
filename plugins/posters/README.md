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
- `room.sheets`: the posters hanging in a room as sheets for ROOM to draw (`sheets.js`)

## In ROOM
Each poster on a room's wall is drawn as one sheet of a run, hung edge to edge in mural order on the clearest stretch of wall, with a gap where a sheet is missing (`client/game/js/panels/room-sheets.js`). The sheets are slices of one print: the grounds run into each other, a sunburst and a skyline cross every tear, and each sheet carries its letter of HELLMOO faint in the ground behind its hero. Cyd's wing runs off his sheet over Kiyo's, and GRU is printed across their tear.

With all seven hung, ROOM plays the join once: the camera goes to the wall, the letters light up in turn, the sheets close up under gold seams, and the seams go, leaving one long poster whose letters keep a low gleam. A tap, Space, Enter or Escape skips it. A browser remembers that it saw a room's join (`localStorage` `rs-joined:<zone>:hellmoo`); taking a sheet down forgets it, so hanging the run again plays it again.

`sheets.js` holds the mural order, the word and how each sheet is printed (ground, ink, accent, slogan, pose). It's a leaf with no server imports, so the Room Lab's `__labSheets()` hangs the run with no server. `putup` and a peel emit `room.sheetsChanged` so whoever has the room open sees it at once.

## The two-layer easter egg
Kiyo and Cyd were printed as **one image**, so hanging that pair together reveals a hidden GRU at the seam on examine. Hanging **all seven** sheets in one room spells HELLMOO across the seams.
