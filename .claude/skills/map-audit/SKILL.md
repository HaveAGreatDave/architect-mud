---
name: map-audit
description: Audit the world map tile-by-tile for structural and content defects — broken exits, buildings you can walk through the wall of, entrance/door/world-exit misalignment, enemies on facades, missing loot tables, leftover terrain palettes — then fix them in reviewed batches. Use when the user says "audit the map", "check the tiles", "scrub the map", "what's wrong with the world map", or names a specific tile/building that looks wrong.
---

# MAP AUDIT — tile-by-tile correctness for the overworld

The world is ~5,400 tiles authored over many passes by scripts, the zone planner, the
terrain painter and by hand. Nothing enforces agreement between them, so defects are
**silent**: a building whose door faces one way but whose exits face another still
renders fine, still lets you in, and still reads correctly in the dev panel. You only
find it by cross-referencing.

This skill does that cross-referencing, presents findings **grouped by rule with a
recommendation**, applies the fixes you approve, and **records the calls you make so a
deliberate choice never gets re-flagged.**

## The architecture — read this before doing anything

**The mechanical checks are a script, not an agent.** `scripts/audit-map.mjs` reads the
`content/` tree directly (no DB, no server boot, no tokens) and produces identical
findings on every run. Do not re-derive them by reading tile JSON yourself — you will be
slower, more expensive, and less complete.

**Agents are only for judgement.** Rules marked `judgement` by `--list-rules` are ones
the script deliberately refuses to guess at — does this tile deserve a loot table, is
this description a leftover, is this name right for its terrain. Those get sub-agents,
batched by *group*, never one per tile.

```bash
node .claude/skills/map-audit/scripts/audit-map.mjs --list-rules
```

[`rules.md`](rules.md) is the criteria catalog — what each rule checks, why it matters,
and the fix playbook. **The `RULES` array in the script is the authority**; `rules.md`
is its prose mirror. Change both together or they drift.

## Reading the output

Three levels, cheapest first. Don't jump to the bottom one.

**1. The summary** answers "how bad is it and where do I start". Counts by rule, banded by
severity, `[auto]` marking what a fixer can repair. The `clean:` line is load-bearing —
it names rules that found nothing, which is how you tell "we check for that and it's
fine" from "we never checked".

**2. `--rule <CODE>`** answers "what exactly is wrong". Prints the rule's own `why` and
`rec` first, then every finding. Add `--coarse` (or `--groups`) on the high-volume
judgement rules — a 4,800-line list is not analysis.

**3. `--json <path>`** for anything the CLI can't shape. Every finding carries
`rule, sev, zone, name, x, y, z, region, terrain, detail`, plus rule-specific fields
(BLD-1 carries `trespass`, GEO-1 carries `swapWith`, WEZ-3 carries `want`). The
coordinates are there because **map defects cluster** — that's the analysis the terminal
can't show you:

```bash
node -e "const d=require('./findings.json');const b={};for(const f of d.findings.filter(f=>f.sev==='critical'&&f.x!=null)){const k=Math.floor(f.x/20)*20+','+Math.floor(f.y/20)*20;(b[k]||=[]).push(f.rule)};console.log(Object.entries(b).sort((a,b)=>b[1].length-a[1].length))"
```

On the 2026-07 baseline that one line shows **15 of 23 critical findings sitting in a
single 20×20 block** — the Yards. Which reframes the whole job: it isn't a map-wide
crisis, it's one bad authoring session with a long blast radius.

**Re-run the summary after each batch.** The delta is the progress report, and rules
moving into `clean:` is the signal you're done with them. Anything the user declined
shows up on the `suppressed by …` line rather than vanishing, so a shrinking total is
never hiding an accepted exception.

## Workflow

### Phase 0 — Scope and baseline

```bash
node .claude/skills/map-audit/scripts/audit-map.mjs
```

Whole map by default. Narrow with `--region region_coldwater` or `--bbox x1,y1,x2,y2`
when the user names an area. Report the summary to the user before drilling in — it is
short, and it tells them how big the job is.

### Phase 1 — Critical structural, in order

Work `critical` before `high` before `medium` before `judgement`. The order matters:
**GEO-1 must be resolved first.** The script itself is immune — it keys its position
index on `(x, y, z)`, so the 2026-07 run cleared GEO-1 and *no other count moved*. The
damage is to everything that isn't this script: `_districtTileId()` in the dev panel
mints ids **from** coordinates, `diagnose-prod-exits.mjs` parses coordinates **out of**
ids, and every human reading `zone_district_920_911` believes it. It also makes other
findings unreadable — the three BLD-2 tiles in that run were real, but their cause
(a dragged tile leaving `flags.entrance` behind) only became visible once the ids told
the truth. The fixers refuse to touch a GEO-1 tile for the same reason.

GEO-1's usual provenance is the dev-panel map editor: **moving a tile rewrites
`grid_x/grid_y` and rewires exits, but never renames the id.** So the coordinates are
almost always right and the id is the liar — confirm it by counting how many *inbound*
links from unaffected neighbours fit the coords vs. the id, then rename the ids. A
swapped pair renames within the existing filename set, so the deploy sees plain UPDATEs.
Every reference must follow the **entity** it currently points at, not the coordinate its
name implies — a reference-preserving rename leaves genuine defects like EXIT-2 standing,
which is correct; fix those on their own merits afterwards.

GEO-1 is **never auto-fixed** — both repairs (move the coords, or rename the id) break
inbound references from exits, spawns, doors, maps and quests. Present the swapped pair
with full context and let the user decide.

### Phase 2 — Batch by rule

For each rule, in severity order:

```bash
node .claude/skills/map-audit/scripts/audit-map.mjs --rule BLD-1
```

Present to the user: **what the rule checks, why it matters, every affected tile, and
your recommendation.** Then ask for a decision on the batch. The user can approve the
whole batch, approve with exceptions, or decline.

**Ordering dependencies between rules.** Some fixers consume a field another rule is
still repairing. Run these in order or the first fix bakes in the second's defect:

| run this first | …before this | because |
|---|---|---|
| GEO-1 | everything | ids that lie make every other finding unreadable |
| WEZ-3 | SPAWN-1 | SPAWN-1 relocates spawns **to `world_exit_zone`** — repair it first or they land on the wrong street. In the 2026-07 run three tiles were in both lists |
| DIR-1 | DOOR-1 | DIR-1 rewrites `in` links to cardinals; a door authored on an `in` link is orphaned the moment it runs |
| BLD-2 | BLD-1 | BLD-1 measures trespass **against `entrance`** — a stale entrance turns the legitimate door into a false positive. Fixing BLD-2 first dropped BLD-1 from 10 to 8 |

The generic form: if a fixer *reads* a field another rule *repairs*, the repair goes
first. Check this before running any two fixers in the same session.

Rules flagged `[auto]` have a fixer:

```bash
node .claude/skills/map-audit/scripts/audit-map.mjs --fix BLD-1           # dry run
node .claude/skills/map-audit/scripts/audit-map.mjs --fix BLD-1 --write   # apply
```

Dry-run first, always — show the file list before writing. Fixers write through the
CODEX pipeline's own `canonicalJson`, so a fix produces a minimal diff rather than a
whole-file reformat.

Rules without a fixer get hand edits to `content/<table>/<id>.json`. Never write to the
DB and never use the dev API for these — git is the source of truth.

### Phase 3 — Judgement rules, via sub-agents

These are the high-volume rules (SCAV-1 alone is ~5,000 tiles). **Always start at
`--coarse`, not `--groups`:**

```bash
node .claude/skills/map-audit/scripts/audit-map.mjs --rule SCAV-1 --coarse   # 17 groups
node .claude/skills/map-audit/scripts/audit-map.mjs --rule SCAV-1 --groups   # 520 groups
```

`--coarse` keys on `(terrain, region)` and lists the distinct names inside each group.
`--groups` adds the name to the key. For the wilderness the name is decoration — the
generator painted ~20 names over one redrock terrain with three recycled descriptions —
so the coarse view is where the real decisions are. Drop to `--groups` only to carve out
exceptions the user names.

**Batching rules — this is where token cost lives:**

- **Never one agent per tile or per zone.** One agent handles a *slice of groups*.
- Slice by region first, then by group count. Aim for **4–6 concurrent agents**, each
  covering 40–80 groups.
- Give each agent the group key, the tile count, and **two or three representative
  tiles** (name, terrain, region, description) — not the whole group. The tiles in a
  group are near-identical by construction; that is what makes it a group.
- Ask the agent for a *proposal per group* — recommended table (or "none, and why"),
  and a confidence. Agents propose; they never write content files and never write the
  decision log.
- The long tail is real: for SCAV-1 the top ~20 groups cover most of the tiles. Work
  top-down and stop when the user says stop. Say so explicitly rather than implying
  full coverage.

**What to put in the agent prompt** (validated on a live run):

- The group key, tile count, and 2–3 representative tile ids.
- The list of existing table/asset ids, so it proposes reuse before inventing.
- A pointer to the relevant system doc (`docs/systems-scavenging.md`) and an instruction
  to skim 2–3 real examples — agents that read the schema propose usable ids; agents
  that don't invent plausible-sounding fiction.
- **An explicit output contract**: a markdown table, one row per group, with a
  `confidence` column, capped at ~60 lines.
- **An explicit prohibition**: propose only. Never edit files, never write the decision
  log.

Ask agents to flag anything they notice that isn't the rule they were given — the trial
run found four real defects that way (the `[PLANNER STUB]` prose class, the terrain/prose
mismatches, the two orphan loot tables, and the missing `underwater` flags), all of which
became rules.

Then present the proposals to the user in batches, same as Phase 2. **Sanity-check agent
claims against the code before acting on them** — they are usually right and occasionally
confidently wrong.

### Phase 4 — Record the decisions

**Any time the user declines a finding, or accepts an exception, write it to
[`docs/audits/map-audit-decisions.json`](../../../docs/audits/map-audit-decisions.json).**
This is the whole point of the skill being repeatable — an accepted exception must not
come back next run.

```json
{
  "rule": "SCAV-1",
  "scope": { "terrain": "water", "name": "Coldwater Basin" },
  "verdict": "accepted",
  "decided_by": "Dave",
  "decided_on": "2026-07-25",
  "reason": "Open bay — fishing is the water verb here, and the fishing tables are on the shoreline tiles by design. No scavenging."
}
```

Rules for the log:

- **Only a human decides.** Write an entry only when John or Dave actually said so, and
  attribute it to whoever said it. Never log your own judgement as a decision.
- **Prefer the widest scope the user's reasoning actually supports.** If they said "no
  loot in open water", scope it `{"terrain": "water"}`, not 715 individual zone ids. If
  they said "not this one", scope it to the one `zone_id`.
- `verdict: "todo"` records a decision *without* suppressing — for things deferred
  rather than accepted. Use it so a "not now" doesn't get mistaken for a "never".
- The `reason` is for whoever finds this in a year. Write it for them.

### Phase 5 — Exit gate

Content changed, so this is a CODEX shipment. Do not stop before:

```bash
npm run content:import
npm run content:lint
npm run test:regress
```

**`content:import` FIRST — this is not optional, and skipping it produces a false green.**
The audit reads `content/`; **`test:regress` boots the world from the DATABASE.** So a
regress run over un-imported edits validates the *old* data and passes no matter what you
just broke. In the 2026-07 run that hid a real defect through two consecutive
"1591/1591 passed" reports and let it reach a commit — it only surfaced on the first
regress that followed an import.

Note the import's deletion pass is git-diff-driven (`marker..HEAD`), so **if your batch
deleted any content file, commit before importing** or the row survives locally. That
same run had a deleted spawn row that would otherwise have sat in the DB re-creating the
SPAWN-1 defect the batch had just fixed.

Order that actually works: `commit` → `content:import` → `content:lint` → `test:regress`.
If regress then fails, fix, re-import, re-run, and amend.

Then invoke the **`codex`** skill to commit and ship. Zone exits and flags are read by
the movement pipeline, so regress is not optional here.

## When the content is right and the map still looks wrong

This audit reads `content/`. It cannot see a defect that lives in the **renderer**, and
there are two of those — the sidebar minimap
([minimap.js](../../../client/game/js/panels/minimap.js)) and the tablet map
([tablet-os.js](../../../client/game/js/panels/tablet-os.js)) — which lay tiles out by
**different methods** and therefore fail differently:

| | minimap | tablet |
|---|---|---|
| layout | BFS along the exit graph from where you stand | raw `grid_x`/`grid_y` |
| blind to | bad coords (MAP-1 is invisible here) | nothing — collisions overwrite |

So **"the minimap looks fine" is not evidence the map is fine.** Check both.

The trap that produced this section: painting `flags.terrain` used to *blank the tile's
contents* in both renderers. A ground surface silently deleted whatever was standing on
it — the authored `flags.icon` SVG and the building's glyph/label. Painting the
Fisherman Statue's square `park` deleted the statue; Halloran's Fix-It sat on `grass`
and showed no lettering. Both were fixed by making terrain paint the ground *under* the
icon layer rather than replacing it.

The general shape is worth remembering, because a content linter structurally cannot
catch it: **one content field silently suppressing another through code neither field
mentions.** `flags.terrain` and `flags.icon` are both valid, both authored, and the
tile JSON looks perfect. When a fix batch paints a field across many tiles, spot-check a
few tiles that carry *other* optional fields and confirm those still render.

## Things that are correct and look wrong

Do not "fix" these:

- **`is_safe_zone` on ~61% of zones** is a sleep marker, not sanctuary. Never blanket-convert it.
- **A facade with no cardinal interior exit still works** — the revolving-door seam
  forwards on arrival. BLD-3 is about the authored record (and the door lock it hangs
  off), not about whether the building is enterable today.
- **`is_building` on a street tile is not automatically wrong.** The `facade` tag is
  deliberately opt-in because real street tiles host buildings without being one.
  BLD-6 only matters when there is also an interior map.
- **Missing links at a terrain boundary** (shore, cliff, region rim) are usually
  intentional. LINK-1 groups by terrain pair precisely so you can accept a whole
  boundary in one decision.
- **Transient waste rooms off a region's rim** are not in `content/` at all — they are
  registered at runtime. A rim tile with no outward link is not necessarily orphaned.

## Reference

- [`rules.md`](rules.md) — the criteria catalog and fix playbook
- [docs/reference/land-taxonomy.md](../../../docs/reference/land-taxonomy.md) — region vs district vs terrain vs biome
- [docs/systems-terrain.md](../../../docs/systems-terrain.md) — `flags.terrain` SSOT
- [docs/flags-keys.md](../../../docs/flags-keys.md) — who reads each zone flag
- [docs/story.md](../../../docs/story.md) — **read before rewriting any tile prose**
- [docs/content-pipeline.md](../../../docs/content-pipeline.md) — how these files ship
- `tile-palette` skill — designing bg/text colours when fixing PAL-1
