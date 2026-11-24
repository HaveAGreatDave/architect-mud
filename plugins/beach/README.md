# beach

## Purpose

On a warm day people go to the beach. Marina Beach is the strip of sand that runs south-west from the Eastern Marina, 17 tiles from 918,901 to 911,906. Groups of friends walk down, put up a parasol, lay out their towels, lie in the sun, wade out and swim for a while, and go home in the afternoon. It's a daytime trip for the people `outings` takes out at night.

## How it works

- **The beach** is every surface zone with `flags.beach`. At boot each tile works out which way the water is, from the water tiles within two of it, so swimmers walk the right way.
- **Who goes.** `weightOf` decides by where somebody lives. Nobody comes from the slums (district `slum`, or anywhere south and east of 918,912). People from the west of the city (x 904 and below) are four times as likely as people from the east, and the middle (up to x 913) three times. The friend network is the one `outings` builds.
- **The plan.** `planDay(date)` seeds a generator from the date and books up to 12 trips of up to four friends. Each starts between 10:00 and 15:00 and lasts three game hours. Each trip goes to the emptiest stretch of beach. The same date gives the same plan on any server.
- **The weather.** A trip starts only when it's warm (the same switch that takes the coats off, `weatherHeat()` in `client/shared/summer-wear.js`, 20°C and up) and nothing is falling. Until then it waits, and it's dropped once it's too late. Rain sends everybody home.
- **At the beach.** A member is held by a life driver and walked there with `walkNpcToward`. The first to arrive puts up the parasol; the others lay their towels round it. Then each goes round: sun (20 to 50 game minutes), wading out (30 seconds), swimming (30 to 60 game minutes), wading back, sun. At the end a swimmer comes in first, then they pack up and go home.
- **Free** is `outings`' own test (awake, off shift, not busy), and not already at the beach. `outings` won't take somebody who's at the beach.

All state is RAM: `npc._beach` on each member. Nothing is queried or written.

## What you see

- In the text, `zone.describeRoom` says one sentence per party: who's on which towel under which parasol, who's swimming. Arrivals, wading out, coming back and leaving are room lines, and there's a line now and then on the towels with a player there.
- Clothes: `summerLayers` puts a beachgoer in swimwear, so examine and the figure agree.
- In GLASS, the hook `npc.streetPose` sends each beachgoer's state on their street actor as `b`. `windshield.js` (`beachPlace`, `drawBeachProps`) puts them on their towel in the `sunbathe` clip, walks them out into the water and sinks them to the chest, swims them round in a slow loop at the sea's height in the `swim` clip, walks them back, and draws the parasol and the towels.

## Commands

None.

## Seams

- **tick**: `1m`.
- **hooks**: `zone.describeRoom`, `npc.streetPose` (sync).
- **engine**: `registerLifeDriver` and `walkNpcToward` in `server/engine/ai-behaviour.js`.

## Content

- `zones.flags.beach`: a sand tile people go to the beach on.
- `npcs.flags.no_outings`: never goes out, to the beach either.
