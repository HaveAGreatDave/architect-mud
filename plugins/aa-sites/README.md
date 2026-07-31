# aa-sites

**Purpose** — anti-aircraft emplacements as they exist *on foot*. A battery is a two-part installation: an exposed deck tile where the gunners stand, and a sheltered bunker where the engineer works. Walking onto the deck tells you whose guns these are and whether they are live; strafing them from the air is what makes that status change. This is the ground-side half of the flight plugin's AA — it owns none of the shooting, only what a battery looks like from the dirt and how it comes back after being wrecked.

## Hooks
- `zone.describeRoom` — a panel on each `aa_sites` deck tile: the battery's name, its faction, and live status — MANNED / ● FIRING / OFF-LINE UNDER REPAIR / a cold ruin.

## Events consumed
- `flight.aaFired` — the guns have opened up; throttled room broadcast so anyone standing there hears it.
- `flight.aaSilenced` — the battery has been strafed off-line (`active=0`), starting the repair clock.

## Events emitted
- `flight.aaRepaired` — the bunker engineer has brought the battery back after `REPAIR_MS`.

## The repair loop
A silenced battery is restored by its **sheltered bunker engineer**, not by a timer alone — kill the engineer and the guns stay cold. Exposed gunners are ordinary stationed NPCs; the engineer is the one flagged `aa_engineer`. That asymmetry is the point: the crew you can see from the air are not the crew that matter.

## Extension points
- `aa_sites` — a new battery is content. Nothing here is hardcoded to a particular emplacement.
