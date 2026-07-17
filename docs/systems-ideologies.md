# Ideologies (as built)

The old five seed **factions** were reworked into four **ideologies** plus a
lean-classification model (commits `c6ceccd9`, `e1a58b53`). This was partly a
rename and partly an addition — read the two carefully.

## What was renamed vs kept

**Renamed (faction → ideology):**
- Engine file `server/engine/factions.js` → `server/engine/ideologies.js`.
- Plugin `plugins/factions/` → `plugins/ideologies/` (`index.js`, `plugin.json`,
  `regress.js`).
- Table/column (idempotent guard in `schema.js`): `player_faction_rep` →
  `player_ideology_rep`, column `faction_id` → `ideology_id`.
- Content ids: the old `faction_*` orgs are now `ideology_*` rows in the unified
  `orgs` table (`is_npc=1`). There is no `factions` table — it was folded into
  `orgs` in an earlier corps Phase 0.

**Kept as "faction" (still correct — do not rename):** the raw `npcs.faction` and
`enemies.faction` columns (their *values* were migrated to ideology ids),
`atm_networks.faction_id` / `min_faction_rep`, `ships.faction`, and the AI
`FACTION_MATCH` / `CALL_BACKUP faction_only` condition/action names.

## The model (`server/engine/ideologies.js`, `design.md`)

Not "three axes" — it is **one bipolar axis + one categorical path + a dormant
third dimension**:

- **Stance** — a signed bipolar axis: `redeem +1 / renounce −1` (`STANCE_DIR`).
- **Path** — a *categorical* choice, not a spectrum:
  `PATHS = ['machine','flesh','mind','human']`.
- **Authority** — `AUTHORITY = ['architect','human']`, carried as data but **not
  yet scored** by `classifyLean`; it only separates two machine-path orders. A
  planned `authority_axis` flag + `ADJUST_AUTHORITY` action are noted as a
  follow-up, **not built**.

Each ideology JSON also carries a cosmetic `flags.values` array of five flavour
words (reader copy, not mechanical axes).

### The four canonical ideologies (owner-less `orgs`, `is_npc=1`)

| Ideology | id | Stance | Path |
|---|---|---|---|
| The Ascendants | `ideology_ascendants` | redeem | machine |
| The Long Watch | `ideology_long_watch` | redeem | human |
| The Wildblood | `ideology_wildblood` | renounce | flesh |
| The Exodus | `ideology_exodus` | renounce | mind |

Plus **5 gated expansion orders** (`flags.expansion: true`, preview-only, never
win the lean): `ideology_prometheans`, `ideology_synthesis`, `ideology_null`,
`ideology_pioneers`, `ideology_lucid`. Defined as content JSON under
`content/orgs/ideology_*.json`, positioned by `flags.stance` + `flags.path`.

## Actions (`plugins/ideologies/index.js`)

- **`ADJUST_REPUTATION`** `{ideology_id, delta}` — over `player_ideology_rep`
  (calls `adjustReputation`, six tiers — see
  [systems-economy.md](systems-economy.md#ideology-reputation)).
- **`ADJUST_STANCE`** `{delta}` — over player flag `stance_axis` (−100 renounce …
  +100 redeem).
- **`ADJUST_PATH`** `{path, delta}` — over player flags
  `path_machine`/`_flesh`/`_mind`/`_human` (0…100).

> There is **no** `ADJUST_AXIS` action or `architect_axis` flag. The stale
> `scripts/add-jobboard-content.js` still references old `faction_*` ids and an
> `ADJUST_ARCHITECT` action that has no handler — that script is dead.

## Player command & tablet reader

- **`ideologies`** (alias **`rep`**), `cmdIdeologies` — standing per order (tier +
  rep), a stance slider, strongest path, and the leaned ideology via
  `classifyLean`.
- **Tablet "Ideology" app** (`plugins/tablet/ideology-app.js`, id `ideology`,
  icon ◆) — a paged read-only reader (Overview / one page per order / the Field).
  The rich copy lives in each order's `flags.reader` object (`motto`, `experience`,
  `pull`, `tenets[]`, `path_text`, `relnote`). Horizontal swipe paging + the
  two-axis alignment field chart render in `client/game/js/panels/tablet-os.js`.
  See [[project_tablet_ideology_app]].

## Rivalry graph

`content/org_relations/ideology_*__ideology_*.json` — 8 directional
`{"stance":"hostile"}` edges among the 4 canon orders (Ascendants opposed by all
three others; Long Watch ↔ Wildblood; reciprocal rows each way). The tablet app
reads these via `org_relations rel JOIN orgs` and buckets `hostile` as "opposed".
Expansion orders have no relation rows yet. (This `org_relations` table supersedes
the old `hostile_to[]`/`friendly_to[]` fields.)
