# The Cherry Pit: the interior

**Status:** built 2026-11-08: the four room specs, the round pit, the backstage wall and stair, the stage, runway, banquette, bar, back bar, stools, booths, the VIP couch and table, the office desk and cot, the club dressing (`club: true`: dark paint, bills on the walls, the light rig) and Rudi Kask behind the bar. 2026-11-10: glow strips on the stage lip, runway sides, pit rim and back bar, with the key light, washes and bar lamp brighter; the booths moved west along the north wall, clear of the VIP doorway; the VIP dressed as `club: "vip"` (velvet `tone`, red neon, a ring of bulbs, a pole with its own spot, gl/room-mesh.js `vipRig`); and `lapdance`, a private dance in the VIP for a pass holder (plugins/strippers). The dancers' rotation and the bass through the walls are design.

The Cherry Pit is the strip club at 901,907 on Cinder Lane: four rooms on `map_int_mq_cherry`, the
floor, the VIP, the back office under the floor and the utility room behind it. The prose is
written and the people are in. None of the four rooms has a `flags.room`, so the Building Stage
draws it as a shut door. This doc gives each room its spec, lays the building out the way
`buildingLayout` will, and says what stands where.

The name does the work. The floor has a real pit in it, cut in the shape of a cherry: a round
sunken lounge in the middle of the room, with the runway running out over it as the stem. The
punters sit in the pit, under the runway, and look up at the dancer. It's the club's one idea.
`spec.pit` only cuts rectangles today, so the round pit is the one new piece of engine this needs.

## The plan

Facings come from the exits as they stand, so nothing in the zone files moves:

| Room | Zone | Faces | Why |
|---|---|---|---|
| The floor | `zone_mq_cherry_floor` | west | first compass exit is `east`, the street |
| VIP | `zone_mq_cherry_vip` | north | its one exit is `south` |
| Back office | `zone_mq_cherry_office` | south | first compass exit is `north` |
| Utility room | `zone_mq_cherry_util` | north | its one exit is `south` |

Seen from above, a metre a character, north up:

```
              +--------+
              |  VIP   |
              +---==---+
 +----------------==-------------+
 |  S|                      bar  |
 |  T|=====runway===.          |
 |  A|          .-'''''-.        == street door (east)
 |  G|         (  pit   )        |
 |sss|          '-.___.-'   booth|
 +-------------------------------+
  sss = stairs down, behind the stage's back wall
        back office below them, the utility room north of it
```

You come in through the padded door in the east wall, with Deacon on your right. The bar runs down
the north wall toward the stage. The stage is the west end of the room, and the runway comes off it
straight into the middle of the room and out over the cherry-shaped pit, its stem. The VIP's
doorway is in the north wall, behind the bar's far end, so you walk past Gita to get there.

The stairs down to the office are behind the stage. A wall stands across the back of the stage,
with a strip of backstage behind it, and the stair drops at the south end of that strip. From the
floor you can't see it at all; the dancers come and go round the wall's south end, and so does
anyone the club takes downstairs.

## The rooms

### The floor

```json
"room": { "w": 11, "d": 14, "h": 4.2, "studio": false, "balcony": false,
  "pit": { "shape": "round", "u": 0, "v": 8.5, "r": 3.0, "depth": 1.1, "step": 0.55 },
  "doors": { "north": 9.5, "down": [-4.6, 0.8] } }
```

Eleven across (north to south), fourteen deep (west to east), and high, because a club ceiling is
black and full of rig. The front wall is the stage, so there's no window: `window` stays out.

- **Backstage.** A wall across the room 1.4 m in from the front wall, full height, painted black,
  open only at its south end. Behind it, a dressing strip with a mirror and a rail of costumes, and
  the stair down at the strip's south end (`doors.down`, the stair's place in u and v). It's a
  partition, not a room: no zone of its own.
- **Stage.** A fitted piece against the backstage wall, full width, 2.2 deep, 0.9 up. Scuffed
  acrylic lit red from under it, one pole at its middle. Stations for `dance` and `tip`; the
  dancers stand on it, players only reach it.
- **Runway.** Fitted, 1.2 wide, from the stage's edge straight down the room's middle to v 10, at
  the stage's height, with the second pole at its tip. It's the cherry's stem. It crosses the pit
  on two thin chrome legs, so from the pit it's overhead: the pit floor is 1.1 below the room's,
  so the dancer's feet are 2.0 m above the people sitting under her. That's the shot the room is
  built for.
- **The pit.** Round, six metres across, with one step down all round it, cut in the shape of the
  cherry with a small notch at the top where the stem goes in. A curved banquette follows the pit
  wall all the way round except a gap for the steps, split red vinyl, taped. Every seat faces in
  and tips its look up at the runway (`pitch` up, not the usual small down). Ten seats on the
  banquette. A drinks rail follows the pit's rim at elbow height for the people standing at the
  top, eight stations round it. The pit floor is lit red from below like the stage, so the whole
  pit reads as the cherry from the door.
- **Bar.** Along the north wall from v 9 to the back. The counter (`furn_cherry_bar`) stands 1.2 m
  out from the wall so there's room to work behind it, with the back bar (`furn_cherry_backbar`, a
  `barwall`) against the wall and three stools along the front. Rudi Kask, the bartender
  (`npc_cherry_bartender`), stands behind it on shift: his `flags.post` is the counter, and
  roomstage's `deskPostOf` puts him there. Gita's end is the stage end, where she can see the door
  and the floor at once.
- **The rail.** The chrome rail round the pit's rim stops either side of the runway where it
  crosses, with a post at each end, so the runway isn't cut by it.
- **The dressing.** `club: true` in the room spec paints the walls and ceiling near black, pastes
  bills up the side and back walls at head height (clear of doorways and anything tall against a
  wall), runs pink neon round the walls, and hangs a truss over the pit with a moving head at each
  corner, two strobes and a mirror ball (`clubRig` in `gl/room-mesh.js`). Its six lamps are the
  spotlight over the runway's tip, a strobe that fires in bursts, a magenta and a cyan wash that
  wander the floor, a red wash off the stage on a 124 bpm beat, and an amber light over the bar.
  `gl/room.js` plays them each frame from the lamp's `tint` and `fx`; nothing goes to the server.
- **Booths.** Two along the south wall, facing the stage, for anyone who wants to watch without
  being looked down on.
- **The door.** Deacon's spot is inside the street door on the north side. The `eject` verb walks
  a player out through it rather than teleporting them.
- **The spotlight.** One, on a pipe over the runway's tip, the club's single working light per the
  prose. It's the room's key light; everything else is the red under the stage and the bar's
  bottle glow.

What's already in the room goes where it reads:

| Furniture | Spot |
|---|---|
| `furn_light_zone_mq_cherry_floor` | the spotlight above the runway's tip |
| `furn_wanted_board_cherry` (bounty terminal) | back wall, south of the street door |
| `furn_hero_poster_cyd` | back wall over the terminal, curling at one corner |
| `secdev_pd_zone_mq_cherry_floor` (PD camera) | high in the north-east corner, over the door |

### VIP

```json
"room": { "w": 5, "d": 4, "h": 2.8, "studio": false, "balcony": false }
```

Small on purpose: a curtained nook, not a suite. The door in its back (south) wall is a curtain on
a rail, not a door, and the rope stands outside it on the floor's side.

- The curved couch fills the front (north) wall, five seats.
- The low table in front of it, with `furn_cherry_hookah` standing on it.
- The camera dome in the north-west corner, where the prose puts it. It's a fixture, not a piece.
- `furn_light_zone_mq_cherry_vip`: one red-shaded lamp low on the right wall. The room is darker
  than the floor; the floor's red comes through the curtain.

### Back office

```json
"room": { "w": 6, "d": 5, "h": 2.4, "studio": false, "balcony": false }
```

Under the floor, low-ceilinged, carpet gone hard. The stairs land at its back (north) wall's east
end; the beaded curtain to the utility room is the same wall's west end, so `doors.north` needs a
value once the stair's own place is settled (see the open questions).

- Metal desk facing the stairs, chair behind it, so whoever's sitting there sees who comes down.
- The safe, bolted through the floor beside the desk. A piece, not furniture anyone moves.
- The monitor wall on the left (east) wall: six screens cycling the floor, the VIP, the door and the
  bar. The same feeds a player sees at Precinct 9 are a later idea, not this pass.
- The cot in the front-right corner, an unmade blanket on it.
- `furn_light_zone_mq_cherry_office`: a bare fluorescent tube over the desk, one end flickering.

### Utility room

```json
"room": { "w": 4, "d": 4, "h": 2.4, "studio": false, "balcony": false }
```

Behind the beads. Windowless and lit by the junction box's indicators more than its own bulb.

- `furn_jbox_zone_mq_cherry_util` on the front (north) wall, the hacking port under its latch.
- Dead neon tubes stacked against the left wall, the cracked mirror-ball on the floor in the
  corner, coils of stage cable hung on hooks.
- `furn_light_zone_mq_cherry_util`: one caged bulb, usually off.

This room is outside what a player needs to walk, and the walk doesn't need it, but it's four
metres and one piece, so it's specced with the rest.

## The people

Nobody moves zone. These are spots within the floor:

- **Jinx Marrick** on the main pole at the stage's middle.
- **Ruby Six** on the runway's tip pole, over the pit.
- **Vesper Cole** working the pit banquettes, between sets.
- The three rotate on a slow clock (stage, runway, floor), the same way the hockey crowd changes
  seats: a client-side cycle from the wall clock, no server state.
- **Deacon Ruhl** inside the street door. **Gita Halvard** at the stage end of the bar. **Rudi
  Kask** behind the bar, 19:00 to 03:00, selling drinks and bar food at club prices: swill, beer,
  whiskey, the plasma shot, static fizz, glow cocktail, neon martini, synth champagne, gin and cola,
  and nachos (`item_bar_nachos`), chips, jerky and pickled eggs. He shares Deacon's flat.

## Humidors

Two `vends` cabinets ([plugins/vending](../../plugins/vending/index.js)), so `vend humidor` asks
which one only where both could answer:

- `furn_cherry_humidor` on the floor's north wall, just short of the back bar: cherry cigarillos at 14.
- `furn_cherry_vip_humidor` on the VIP's left wall beside the couch: house cigars at 38.

## Sound

The floor wants its bass bed felt through the walls of the rooms around it: full in the floor,
thinned to the low end and quieter in the VIP and the office, and just a thump in the utility room.
That's the Room Stage's neighbour-room rule applied to the room's ambient, not a new system.

## Open questions

1. **The stairs.** The stair is behind the stage at the floor's south-west edge. `buildingLayout`
   stands `down` middle under middle and has no stairwell, so it needs to learn
   `flags.room.doors.down`: the stair's place on the upper room, which the office below lines its
   own stair foot up with. The office then sits under the stage end of the floor, not its middle.
2. **The round pit.** `spec.pit` is a rectangle. A `shape: 'round'` pit needs `pitFloorAt` to test
   a circle and a ring for the step, and `gl/room-mesh.js` to draw a curved wall. The notch for the
   stem is drawing only; the walk can treat it as round.
3. **Seats under the runway.** The runway is a solid box at stage height over the pit. Its legs
   are the only part that should block a walker in the pit; check its `solid` box doesn't stop
   people walking under it or sitting on the banquette beneath it.
4. **MIS.** The VIP is `mis_ok`. The stage and runway carry `dance` stations, not anything more;
   whatever the mature layer adds goes through its own gate in [systems-mis.md](../systems-mis.md),
   not through this layout.
