# aa-sites

**Purpose** — anti-aircraft emplacements as they exist *on foot*. A battery is a two-part installation: an exposed deck tile where the gunners stand, and a sheltered bunker where the engineer works. Walking onto the deck tells you whose guns these are and whether they are live; strafing them from the air is what makes that status change. This is the ground-side half of the flight plugin's AA — it owns none of the shooting, only what a battery looks like from the dirt and how it comes back after being wrecked.

## Hooks
- `zone.describeRoom` — a panel on each `aa_sites` deck tile: the battery's name, its faction, and live status — MANNED / ● FIRING / OFF-LINE UNDER REPAIR / a cold ruin.
- `aa.state`: **sync**, gathered by `deriveSurfaceCell` for the deck tile's map cell: `{ s }`, 1 manned, 2 under repair, 0 a ruin. Answered from the roster in RAM (loaded at boot, refreshed each minute, written as batteries fall and come back), never a query.

## What the battery looks like
Every 3D view (cockpit, cab, boat, helm, free camera) draws the emplacement on its deck, as built:
the `aa` map mark, modelled in [glass/aa-emplacement.js](../../client/game/js/panels/glass/aa-emplacement.js).
`flags.aa_kind` on the deck zone picks the build (`guardian`, `sam`, `flak`, `truck`); write the room
description first and pick the build that matches it. A change the open views have to see is pushed
to every client: `aa_state` `{ x, y, s }` when a battery is silenced, repaired or loses its engineer,
and `aa_fire` `{ x, y, t }` (at most every 1.5 s a battery) when it opens up, `t` being the aircraft it
is shooting at, so the guns lay on it in any view that can see it.

## Events consumed
- `flight.aaFired` — the guns have opened up (`target` is the aircraft id); throttled room broadcast so anyone standing there hears it, and the `aa_fire` push.
- `flight.aaSilenced` — the battery has been strafed off-line (`active=0`), starting the repair clock.

## Events emitted
- `flight.aaRepaired` — the bunker engineer has brought the battery back after `REPAIR_MS`.

## The repair loop
A silenced battery is restored by its **sheltered bunker engineer**, not by a timer alone — kill the engineer and the guns stay cold. Exposed gunners are ordinary stationed NPCs; the engineer is the one flagged `aa_engineer`. That asymmetry is the point: the crew you can see from the air are not the crew that matter.

## Extension points
- `aa_sites` — a new battery is content. Nothing here is hardcoded to a particular emplacement.
