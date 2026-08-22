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

## Standing is maintained, not banked (as built)

Reputation **slides back toward a resting point** over time. Two consequences, both deliberate:

- **Positive standing decays.** Being Trusted is something you keep being, not something you did once. Stop showing up for an order and you drift back to being nobody in particular.
- **Negative standing also decays.** A grudge is not a life sentence; the street forgets. You can burn a bridge and, given long enough, walk back across it — which is what stops a bad early decision from permanently closing off a quarter of the game's content.

**Half-life: 30 real days**, applied to the *distance from the resting point*, so it asymptotes and never crosses.

### The exception: a major ideological difference

If you are genuinely, ideologically opposed to an order, the drift stops short of neutral at a **floor of −200** (the top of Hostile / bottom of Unknown). They stop actively hating you; they never forget what you are. It's a floor, not a sentence — you can still climb out by acting, the world just won't do the climbing for you.

"Opposed" requires **both halves** (`restingRep`), and this is the load-bearing bit:

| Player vs. order | Resting point |
|---|---|
| opposite stance (\|stance\| ≥ 50 the other way) **and** a different path | **−200** |
| opposite stance only | 0 |
| different path only | 0 |
| lukewarm opposition (\|stance\| < 50) | 0 |
| no position taken yet | 0 |

Either half alone is a *disagreement*. Both together is being a different kind of thing.

### How it's computed

**Lazily, with no sweep tick** — the same treatment relations gets. `player_ideology_rep.updated_at` stamps the last real change; every reader ages the stored value forward to now (`decayRep`). The stored number is a *checkpoint, not the truth*.

- `adjustReputation` decays **before** applying the delta — otherwise a player who's been away has their stale standing resurrected by earning one more point — and the write restarts the clock with the already-decayed value, so drift is never double-counted.
- `getIdeologyDiscount` / `isIdeologyHostile` / `getPlayerIdeologyRep` all read the decayed value. An order that wanted you dead a season ago has cooled to merely not liking you, with no job run to make that true.
- The player's own position (`stance_axis` + strongest `path_*`) is **hydrated at login** onto the live player, because `restingRep` is consulted on every vendor price lookup and five flag round trips there would be indefensible. `ADJUST_STANCE` / `ADJUST_PATH` re-hydrate it so the cache stays coherent — the flag write is the only way it moves.
- An offline player costs nothing and comes back to standing that has cooled on its own.

A row that was never stamped (pre-existing rows before this shipped) is **left alone** until something touches it — no retroactive mass decay on deploy.

### The five canonical ideologies (owner-less `orgs`, `is_npc=1`)

| Ideology | id | Stance | Path |
|---|---|---|---|
| The Ascendants | `ideology_ascendants` | redeem | machine |
| The Long Watch | `ideology_long_watch` | redeem | human |
| The Wildblood | `ideology_wildblood` | renounce | flesh |
| The Exodus | `ideology_exodus` | renounce | mind |
| The Null | `ideology_null` | renounce | machine |

**The Null were promoted off `flags.expansion` when Deadwater shipped**, and the
reason is worth keeping: `classifyLean` scores stance × path, and the four orders
above left **renounce·machine empty**, so a player who had renounced the world
*and* leaned machine leaned **Ascendants** — the order they were most specifically
not. Promotion closed a hole rather than adding an option. It was also the cheapest
of the five to promote: the Null share their cell with nobody, so unlike the
**Prometheans** (who would sit on redeem·machine beside the Ascendants) they needed
no authority axis. Existing renounce·machine characters silently re-lean on their
next `rep`. See [proposals/deadwater.md](proposals/deadwater.md).

Plus **4 gated expansion orders** (`flags.expansion: true`, preview-only, never
win the lean): `ideology_prometheans`, `ideology_synthesis`,
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

## What actually moves standing (added 2026-08-22)

Worth stating plainly, because it was not true until now and the decay above was
built assuming it would be. **Every caller of `adjustReputation`:**

| Path | Direction |
|---|---|
| `ADJUST_REPUTATION` (the dialogue Action above) | either — authored on ~24 dialogue options across 13 NPCs |
| `plugins/augments/install.js` — fitting chrome | **negative only**, to the three orders opposed to it |
| `quests.penalties.rep` — a quest you blew | **negative only** |
| `quests.rewards.rep` — a quest you finished | either — **new** |

Until the last row existed, that table read as: talking to somebody moves your
standing, and everything you *do* can only ever lower it. No kill, crime, trade,
delivery or favour paid a single point to anybody. That is the gap
`rewards.rep` closes ([plugins/quests](../plugins/quests/README.md)).

**The decay is what makes it a requirement rather than a nicety.** Standing slides
back toward its resting point on a 30-day half-life *on purpose* — being Trusted is
something you keep being. An order with only a one-off intro arc therefore has no
mechanism by which a player stays in it: they finish the arc, stop, and drift back
to nobody in particular with nothing they could have done about it. **An order
meant to be lived in needs repeatable work that pays `rep`.** As of this writing
none of the five has any — every repeatable quest in the game is a job-board gig, a
flight contract or a Reach errand, and none of them touches an ideology.

## Player command & tablet reader

- **`ideologies`** (alias **`rep`**), `cmdIdeologies` — standing per order (tier +
  rep), a stance slider, strongest path, and the leaned ideology via
  `classifyLean`.
- **Tablet CODEX app, "Orders" section** (`plugins/tablet/codex/section-orders.js`,
  app id `codex`, section id `orders`) — a paged read-only reader (Overview / one
  page per order / the Field). **This was the standalone "Ideology" app** (id
  `ideology`, `plugins/tablet/ideology-app.js`) until it was folded into the CODEX
  shelf alongside the lore volumes; the payload and every client renderer are
  unchanged, only the doorway moved. See [systems-codex.md](systems-codex.md).
  The rich copy lives in each order's `flags.reader` object (`motto`, `experience`,
  `pull`, `tenets[]`, `path_text`, `relnote`). Horizontal swipe paging + the
  two-axis alignment field chart render in `client/game/js/panels/tablet-os.js`.
  See [[project_tablet_ideology_app]].

## Rivalry graph

`content/org_relations/ideology_*__ideology_*.json` — 10 directional
`{"stance":"hostile"}` edges among the 5 canon orders (Ascendants opposed by all
four others; Long Watch ↔ Wildblood; reciprocal rows each way). The tablet app
reads these via `org_relations rel JOIN orgs` and buckets `hostile` as "opposed".
The remaining expansion orders have no relation rows yet. (This `org_relations`
table supersedes the old `hostile_to[]`/`friendly_to[]` fields.)

**The Null have exactly one authored pair, with the Ascendants, and the two edges
they do *not* have are deliberate.** No Wildblood edge: both are `renounce`, so
`restingRep` puts them at 0 on its own and an authored hostile row would invent a
quarrel the fiction does not have. No Long Watch edge either: opposite stance
**and** a different path already drives the −200 floor, so a row there would be
redundant rather than wrong. Authored edges are for hostility the axes cannot
derive.
