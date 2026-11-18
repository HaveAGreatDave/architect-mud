# posters

**Purpose** — portable hero posters. `takedown` peels one off the wall (furniture → a rolled item you carry); `putup` hangs a carried poster on the wall of the room you are in and tells you where it falls in the mural.

## Commands
- `takedown` / `take` — peel one off.
- `putup` — hang one. `putup kiyo on the left wall` (left, right, window or door) puts it on that wall, and the rest of the run in the room moves there with it.

## Provenance

The seven posters start as authored furniture (`furn_hero_poster_<key>`, one file each in `content/furniture/`), and the content import upserts those files over the DB on every deploy. So:

- `putup` never reuses the authored id. It inserts a new row with a `furn_<8hex>` id, `origin='player'` and the hanger in `owner_id`. The export skips it and the import's deletion pass can't touch it.
- Taking down an authored poster sets the world flag `poster_taken:<key>`. The import puts the row back; `reconcileTakenPosters()` runs when the plugin loads (after the deploy restart) and deletes authored posters whose key is flagged. Taking down a player copy sets nothing.
- The seam and mural match on `flags.poster_key` across whatever rows hang in a room, so authored and player rows mix freely.

## Hooks
- `furniture.describe`
- `room.sheets`: the posters hanging in a room as sheets for ROOM to draw (`sheets.js`)

## In ROOM
Each poster on a room's wall is drawn as one sheet of a run, hung edge to edge in mural order on the clearest stretch of wall, with a gap where a sheet is missing (`client/game/js/panels/room-sheets.js`). The sheets are cut from one painted print, `client/game/assets/posters/hellmoo.webp`: seven panels side by side, 1.2 m tall on the wall and about 2.2 m along it, each sheet its own panel cut inside the divider strips and torn at the edges. On its own, a sheet carries no lettering.

With all seven hung, ROOM plays the join once: the camera goes to the wall, the sheets close up and straighten under gold seams, they become the one print as the seams go, and then HELLMOO lights up one letter at a time. The lettering is `hellmoo-letters.webp`, drawn over the print as foil: it shimmers as you move, and from far enough round to the side it's gone and the comic under it shows. A tap, Space, Enter or Escape skips the join. A browser remembers that it saw a room's join (`localStorage` `rs-joined:<zone>:hellmoo`); taking a sheet down forgets it, so hanging the run again plays it again.

The lettering is baked from two versions of the same picture: the plain one, and `scripts/posters/hellmoo-lettered.webp` with the gold HELLMOO on it. `node scripts/posters/bake.mjs` keeps where they differ (it needs Chrome). Run it again after replacing either.

`sheets.js` holds the mural order, the word, where the panels' divider strips are in the print (`ART.cols`), and what ROOM paints a sheet from if the print can't load (ground, ink, accent, slogan, pose). It's a leaf with no server imports, so the Room Lab's `__labSheets()` hangs the run with no server. `putup` and a peel emit `room.sheetsChanged` so whoever has the room open sees it at once.

Where the run hangs is `flags.sheet_spot` (`{ wall, along? }`) on its rows: `putup … <wall>` sets it for the whole run, and the room's arrange mode drags the run along the wall tops and hangs carried rolls from its Posters menu (roomstage `arrange sheets` and `sheet+<inv>@<spot>`, answered here by `room.sheetStock` and `room.sheetHang`). No spot and ROOM picks the clearest wall.

## The two-layer easter egg
Kiyo and Cyd were printed as **one image**, so hanging that pair together reveals a hidden GRU at the seam on examine. Hanging **all seven** sheets in one room spells HELLMOO across the seams.
