# district-ambience

**Purpose** — giving each neighbourhood a *felt* character rather than a stated one. Occasionally answers the ambient tick with a district-keyed leitmotif: a smell, a sound-texture, a quality of the air. Nobody is told which district they are in — they just notice, over time, that the Docks smell different.

## Hooks
- `zone.describeAmbient` — the occasional leitmotif line.
- `zone.smells` — the district's contribution to the smell pass.

## Outdoor only
You cannot smell the Docks from inside a sealed room, so indoor zones are excluded.

## Where the lines live
The plugin owns the **content selection and the gating**; the district registry (`server/engine/districts.js`) owns the lines themselves.

## Commands
None.
