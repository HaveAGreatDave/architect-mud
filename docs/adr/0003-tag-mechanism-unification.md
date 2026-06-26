# Unify the Tag mechanism across entities, keep typed columns

We extended the item Tag mechanism (catalog + `hasTag`/`tagValue` + Tag→Action registration) to every
Entity type — folding the existing `flags` JSONB on enemies, NPCs, and zones into the Tag system — so
furniture and doors become Tag-driven interactables (`container`, `lockable`, …). We deliberately did
**not** dissolve well-structured domain data (`body_parts`, `dialogue_tree`, `loot_table`, `exits`)
into Tags: Tags are behavior markers and cross-cutting properties, not a dumping ground.

## Considered Options

- **Full unification** (one generic tagged-object model; collapse `body_parts`/`dialogue_tree` into Tags
  too) — rejected: a regression in clarity for working combat/dialogue, with real migration risk and no
  payoff. The structured columns are good domain data, not markers.
- **Interactables only** (tags on items/furniture/doors; leave enemies/NPCs/zones on `flags`) — rejected:
  leaves the Tag mechanism inconsistent across the world for little saving.

## Consequences

- `flags` reads route through the Tag helpers for back-compat; the column stays as the physical store.
- The legacy `flags` name now collides with the new **Flag** primitive — see `CONTEXT.md` "Flagged
  ambiguities". `flags` JSONB = Tags; Flag = conditional state.
