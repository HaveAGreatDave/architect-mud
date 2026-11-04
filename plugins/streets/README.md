# streets

**Status: built, off.** Coldwater Streets phases 4 and 5, as far as the design goes. See
[docs/proposals/coldwater-streets.md](../../docs/proposals/coldwater-streets.md).

`STREET_SYSTEMS=1` in the server's environment turns it on. Leave it off until `RENDER_TUNE.streetKit`
is on: nobody should be charged for a street they can't see.

| Verb | What it does |
|---|---|
| `belt <dir>` | ₵1. Carries you to the end of the block where the belt runs; where it's stopped, you pay and walk one tile |

It also adds a line to each kit street room in its level's voice and sends a passing vehicle to
occupied street rooms. The rules and text are in `rules.js`, which reads `kitPlace`, so what a player
can use is what the street draws. `scripts/shapes/street-systems.mjs` checks them.
