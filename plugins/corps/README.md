# corps

**Purpose** — player-run corporations. Found or join a corp, define your own rank ladder, share an **atomic** treasury, talk on a private corp channel, and claim an HQ. NPC factions are not a separate concept — they share the unified `orgs` table, so a player corp and a world faction are the same kind of thing.

## Commands
- `corp` / `org` — the hub verb (found, join, ranks, treasury, territory, HQ).

## Hooks
- `furniture.describe` — corp terminals report their state.

## Specialized actions
- `use` on anything tagged `corp_terminal`.

## See also
[docs/systems-corps.md](../../docs/systems-corps.md) — influence tug-of-war and the five power levers. Phases 0–3 are built; espionage and NPC corp AI are still design.
