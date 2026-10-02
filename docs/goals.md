# Goals

What Architect is for, what's being worked on now, and what it won't become. Read this before choosing what to build next. The detail lives in the docs it links to; this page only points the way.

## What the game is

A real-time, text-first browser MUD in the HellMOO tradition, set after a machine superintelligence won. Brutal, funny, persistent. Full-loot PvP outside the safe core, a player-driven economy, and a world that keeps running whether anyone's online or not. The design doc sums up the feel as "reading a novel that hits back" ([design.md](design.md)).

A good change makes a story worth retelling: a choice with a consequence, a death people remember, a place that feels lived in. Tone is set by [story.md](story.md) and [house-voice.md](reference/house-voice.md).

THOMAS is the platform and Architect is one game built on it. Keeping that split clean is a goal in itself: a second game shouldn't have to undo Coldwater.

## Current priorities

In order. When two pieces of work compete, the higher one wins.

1. **The orders, in sequence.** Long Watch and the Ascendants get fully developed first, then Wildblood, then the Null, then Exodus. Psionics is Exodus's discipline, so it stays provisional: fix it only when it breaks something for other players. See [systems-ideologies.md](systems-ideologies.md) and [systems-faction-arcs.md](systems-faction-arcs.md).
2. **Fill the world that exists.** The canvas is built, so the work now is depth, not more tiles: the Glasshouse is thin for the Ascendants' seat, five districts have prose but no ground, and five built zone features are carried by no tile. The list is kept in [README.md#whats-next](../README.md#whats-next).
3. **GLASS 2 over GLASS 1.** The GPU path wins; the 2-D painter can be cut back to basic. Split `windshield.js`, building models first, and only on a clean tree. See [glass-notes.md](reference/glass-notes.md).
4. **Stay inside the free tier.** Egress and round trips cost money. See [ops-usage-watch.md](ops-usage-watch.md) and the read tiers in [architecture.md](architecture.md#read-tiers-where-data-lives-at-runtime).

## Non-goals

- **No build step, framework or ORM.** Vanilla JS clients, raw WebSockets, `query()`.
- **No content in engine files.** Content lives under `content/` and goes out through the pipeline.
- **No new sparse columns on `players` or `npcs`.**
- **No player readout for unrest.** It's meant to be felt, not read.
- **No graphics-first client.** GLASS serves the text; the text-only and log display modes stay first-class ([systems-display-mode.md](systems-display-mode.md)).
- **No polish on held-back systems** before their turn (psionics, bird seasons, which stay off until launch).

## Keeping this page true

When a priority ships or changes, edit this page in the same commit. If it disagrees with a `systems-*.md` doc about what's built, the systems doc wins and this page is the one to fix.
