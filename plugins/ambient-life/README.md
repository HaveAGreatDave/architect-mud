# ambient-life

## Purpose

The city's daily **routine**. The engine's ambient pool (`getRandomAmbient`) is a flat,
one-shot, theme-keyed list with no sense of *when* or *where* something belongs. This plugin
is the layer that gives street zones a lived-in rhythm — the right vignette in the right place
at the right time of day. Kids play by daylight; buskers set up at dusk; a delivery drone
whirs overhead and banks north; dogs bark two rooms over at any hour. It's the world breathing.

All nine categories ship as content: **kids playing, delivery drones, street musicians,
construction, traffic, maintenance crews, food vendors, arguments, dogs barking.**

### How it works

- **Content, not code.** The library lives in the `ambient_routines` table (loaded by
  `loadRoutines()` at boot and after a dev edit). Each row is a vignette gated by day-phase,
  `ambient_theme`, weather, and/or an explicit zone allowlist, with an ordered `lines` array —
  one entry is a one-shot, several play out as a paced scene (like `npc-banter`). Adding life is
  a data row, not a code change.
- **Opt-in zones.** A zone only feels routine life if it carries `flags.street_life` (the
  fishing/mining opt-in convention), so nothing sprays across the frozen bay or a quiet
  apartment — only the pedestrian hubs. Seeded on a curated set (North City grid, Marquee
  exterior, Civic commons, Docks, Media plaza).
- **Sound.** A routine with `loudness > 0` (drones, construction, traffic, dogs, arguments)
  bleeds muffled into neighbouring rooms through the engine's own `propagateSound`; quiet ones
  (kids, buskers, food-cart calls) stay in the room they happen in.
- **Two interactive routines.** A routine tagged `interactive` ('tip' | 'order') arms a
  short-lived per-zone opportunity and appends a clickable link:
  - **Street musician → `tip`** (`[Tip ₵5]`) — a few credits into the case + a small sanity lift.
  - **Food cart → `order`** (`[Buy a skewer ₵3]`) — restores hunger on the spot.
  Both resolve whatever opportunity is live in the player's room — no target to disambiguate.

### Tick / pacing

A `30s` tick scans zones that currently hold a player, are opted in, and aren't resting; it
rolls `START_CHANCE` per zone and fires a matching routine. Paced vignettes re-check the room
still has an audience before each line. After any scene a zone rests for `ZONE_COOLDOWN_MS`.

## Commands

| Verb | Effect |
|---|---|
| `tip` | Tip the busker currently playing in your room (clickable `[Tip ₵5]`). |
| `order` | Buy a skewer off the food cart currently in your room (clickable `[Buy a skewer ₵3]`). |

## Seams

- **command** — `tip`, `order` (resolve the live per-zone opportunity).
- **tick** — `30s` routine driver.
- **dataSchema** — owns `ambient_routines` (classified `content` in the content registry).

## Content

- `scripts/seed-ambient-life.mjs` — flags the street zones and seeds the 9-category library
  (idempotent; re-run after edits). Needs `npm run db:schema` first (adds `ambient_routines`).

## Notes

- Reads `getEnvironmentState()` for the current day-phase + weather, `world`/`getZonePlayers`
  for witnesses, `propagateSound`/`sendToZone` to emit, `adjustCredits` + hunger/sanity for the
  two interactions. No engine changes — a pure leaf plugin over existing seams.
