# checkpoint

**Purpose** — security checkpoints as *content*, not code. A gate tile carries a `flags.checkpoint_cfg` object and this plugin turns it into a working border post. It replaces the two bespoke plugins that came before it (`govgate` and `perimeter`), which is the whole point: the next checkpoint should be a config object, not another plugin.

## The config object
`flags.checkpoint_cfg` = `{ guards, checks: [wanted|smuggle|contraband], wantedMode, insideFlag|fromFlag|fromDistrict }`

The entry predicate (`insideFlag` / `fromFlag` / `fromDistrict`) decides which *direction* through the tile is being policed.

## The three checks
- **wanted** — either a hard turn-away or a scaling **Deception** bluff; failing the bluff dispatches APPREHEND.
- **smuggle** — routes raw drugs through the smuggle economy via the `SMUGGLE_RAW_SCAN` action: a `cook_tier` difference decides detection, success pays `bm_trust`, failure is a manufacturing bust.
- **contraband** — a generic Deception scan into a `contraband_possession` bust.

## Implementation
A **single** `registerMoveGate`. No verbs at all — a checkpoint is a property of a tile you try to walk through.

## Load order
`after: ["surveillance", "smuggle"]` — both own the consequences this plugin triggers.

## Shipped recipes
The South Gate wanted+smuggle recipe is live. The gov-quarter recipe is authored but **dormant**, waiting on the North City rebuild.
