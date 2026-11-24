# Wall signs in ROOM

**Status: built (2026-11-23).** A room's `flags.room.decor.signs` are painted in the house font
library and laid on the wall as decals. The legend-face letters built as boxes are retired.

## Why it changed

The old signs were the cockpit legend face (`client/shared/legend-font.js`) built as thin boxes a few
millimetres off a plate. They looked blocky up close, and from across a room the letters' faces fought
the plate's for depth and shimmered as the camera moved. They also came in one look: words on a dark
plate.

Now each sign is a canvas painted by [room-signs.js](../../client/game/js/panels/room-signs.js) in a
face from [fonts.md](fonts.md), uploaded mipmapped with anisotropic filtering (gl/room.js
`setDecals`), and laid 3.6 cm off the wall (10 cm on ribbed `sheet` cladding, whose girts stand 9 cm
proud). One flat face per sign means nothing fights for depth, and the mips keep small lettering
steady at any distance. A lit sign is two decals: the panel, painted and lit by the room, and its
light, added over it, so a dark plate doesn't swallow its letters.

`room-stadium.js` adds them to the room's decals beside the stadium signs and `decor.marks`, so the
Room Stage, the Room Lab and the one-world rooms all draw them. A sign an owner moved in arrange mode
arrives as a `walldecor` piece (plugins/roomstage/decor-pieces.js) and is painted the same way.

## A sign's row

Only `wall`, `along`, `y` and `text` are needed. Everything else has a default.

| Field | Meaning |
|---|---|
| `wall`, `along`, `y` | the wall, metres along it, the sign's middle up from the floor |
| `text`, `sub` | the words, and a smaller second line under them |
| `h` | a capital's height in metres (0.12) |
| `style` | how it's made: see below |
| `font`, `subFont` | a face by name (room-marks.js `MARK_FONTS`); each style has its own default |
| `hex` | the letters' colour, and a lit sign's light |
| `plateHex`, `rimHex` | the plate and its edge |
| `shape` | the plate's outline: `rect`, `round`, `pill`, `oval`, `chamfer`, `hex`, `shield`, `banner`, `arch` |
| `icon` | a device beside the words: `star`, `bolt`, `chevron`, `arrow-left`/`right`/`up`/`down`, `wing`, `crown`, `gear`, `claw`, `flame`, `wrench`, `cross`, `diamond`, `ring` |
| `emblem` | a maker's emblem from `client/shared/hover-car-emblems.js` (`brakk`, `vex`, `castellan`, `corvane`) instead of an icon |
| `frame` | `none`, `line`, `double`, or `tube` (a neon tube round it) |
| `track` | letter spacing in capitals (0.08 is wide) |
| `case` | `'none'` keeps the row's case; otherwise it's set in capitals |
| `lit` | false turns a lit style's light off; true lights a plate or badge's letters |

### Styles

| Style | What it is | Default face |
|---|---|---|
| `plate` | a painted metal plate, screwed on at the corners | Overpass |
| `enamel` | vitreous enamel with a raised rim and a sheen | Bowlby One SC |
| `lightbox` | a dark plate with letters lit from behind | Michroma |
| `paint` | lettering painted straight on the wall, a little worn | Staatliches |
| `cut` | brushed metal letters standing off the wall on pins | Michroma |
| `channel` | box letters with lit faces and dark returns | Righteous |
| `halo` | dark metal letters with their light thrown on the wall behind | Syncopate |
| `neon` | bent glass tube, pale when off | Tilt Neon |
| `badge` | a maker's badge: a chrome-rimmed shaped plate with its emblem | Black Ops One |

### The old rows

A row with no `style` gets one from the old fields, so the 62 rooms that had signs keep their meaning:
`plate` and unlit is `plate`, `plate` and lit is `lightbox`, `plate: false` and lit is `neon`,
`plate: false` and unlit is `paint`. Their `hex`, `plateHex` and `h` still apply.

## The first room

Higher Purchase's showroom (`zone_dealer_marrow_showroom`) uses four styles: the name over the desk
as halo-lit Syncopate under a chevron, Brakk's badge with its octagon emblem, Vex in pink neon round
its ringed V inside a tube, and STAFF ONLY on a red plate.

## Rules

- Nothing in room-signs.js names a place. The words, colours and emblems are the room's content.
- A new face goes in `MARK_FONTS` (room-marks.js) by its family name, with its file in
  `client/shared/fonts/` and a row in [fonts.md](fonts.md).
- A new emblem set goes in the `EMBLEMS` table at the top of room-signs.js, from a shared data file
  that GLASS and the cars read too, so one drawing serves all of them.
