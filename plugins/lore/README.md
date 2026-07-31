# lore

**Purpose** — first-visit tone-setting. The first time any player **looks at** a zone carrying authored `flags.intro_lore`, a deeper block about the place's history, who controls it and what it will do to you is woven into the room — shimmering in accent before settling to normal text.

## The only gate
A per-player `lore_seen:<zone>` marker, **committed on departure** (not on arrival — so a glance through a doorway does not burn it).

## Commands
- `lorereset` / `resetlore` — staff: clear the marker.
- `lorealways` — staff: keep showing it.

## Hooks
- `zone.introLore`

## Events consumed
- `zone.entered`

## Extension points
- `zones.flags.intro_lore` — the prose is content. Adding lore to a place is authoring, not coding.
