# Em Dash Sweep — status

**STATUS: DONE. Every player-facing prose surface in `content/` is swept.**

The rule this tracks lives in [story.md](../story.md) under Tone → "The em dash rule": the em dash is a
voice marker reserved for **the Architect and NPCs with `faction: ideology_ascendants`**, who over-use
it on purpose. Everybody else writes without one. This file records how much of the world has actually
been brought in line, so a future pass starts from a count rather than a fresh grep.

Counts below are em dash *occurrences* in `content/`, taken 2026-08-03 after the third sweep.

## Done

| Pass | Scope | Fixes |
| --- | --- | --- |
| 1 (2026-08-03) | All spoken dialogue: NPC `dialogue_tree` text + option labels, `chitchat`, `banter`, `npc_banter_threads`, `mis_fit_lines` actor lines, quest objective emotes, `scripts` graph speech | 354 across 108 files |
| 2 (2026-08-03) | All broadcast copy, in **both** layers: `data/scripts/*.bsm` and `content/media_broadcasts/*.json` | ~1730 across 53 files |
| 3 (2026-08-03) | **All remaining descriptive prose**: `zones` (`description`, `ambient_events`, `flags.intro_lore`, greeter/gate lines), `furniture`, `items` (incl. `tags.description`), `npcs.description`, `orgs` (creeds, tenets, `flags.reader.*`), `quests`, `glossary`, `enemies`, `drugs`, `global_ambient_events`, `augments`, `districts`, `dream_templates`, `aircraft_types`, `ambient_routines`, `recipes`, `scavenging_tables`, `script_triggers`, `sounds`, `windows`, `job_boards` | 555 unique spans, 2445 occurrences across ~2000 files |

**Broadcasts are two layers.** Five shows compile from a `.bsm` through `scripts/content/build-*.mjs`
(`cluster-puck`, `jackpot-protocol`, `news-weather`, `open-signal`, `tonight-show`). Fix the `.bsm` and
re-run its builder; editing the JSON alone is silently reverted on the next build.

## What is deliberately left — 56 occurrences

Every dash still in `content/` is in one of these five buckets. A grep hitting 3900 and a grep hitting
56 mean the same thing now: clean.

- **`books` (766, not counted above).** The nine public-domain texts behind the tablet reader. Their
  prose is reproduced verbatim and is **never rewritten** — that is the whole contract of
  [systems-library.md](../systems-library.md). Melville's dashes stay Melville's.
- **`media_broadcasts` (115, not counted above).** Every one is a `CAM — n — …` node label **generated
  by the BSM compiler**, not authored, and shown only in the VINE editor. Rewriting them is undone by
  the next `.bsm` import.
- **Ascendant dialogue (21).** The `npc_asc_*` and `npc_custodian_*` speech that the rule explicitly
  exempts: Duc, Kesh, Orrin, Maresh, Vess, the Registrar, the Warden, The First Ascended. Their
  *descriptions* were swept in pass 3 — a description is the narrator, not the speaker. **If you add an
  Ascendant, their dialogue keeps its dashes and their description does not.**
- **Name labels (7 + the `name` column everywhere).** The dash in a `name` is a field separator, not a
  voice: `"Adequate! — Housewares"`, `"Guardian Battery — Bunker — Utility Room Junction Box"`. Scoped
  out on 2026-08-03 — sweeping it would have meant renaming ~477 labels in lockstep across `zones`,
  `power_zones`, `generators` and `maps` for no tonal gain. The same call covers the sibling label
  fields: `flags.building_name`, `flags.elevator_floors[].label`, `vendor_shop_name`, and the one quest
  objective that quotes a zone name verbatim (`"The Layover — Front Office"`).
- **Author notes (28).** `_comment`/`_props_comment` blocks in `content/map/`, `<!-- -->` comments
  inside `media_graphics` SVG assets, and `#` lines in `data/scripts/*.bsm`. Never player-facing. The
  one ASCII-art card (`BOOKING — PRECINCT 9 HOLDING`) is a box-drawn header whose column widths are
  load-bearing.

## How the passes were run

The method, rather than editing files one at a time:

1. Walk every JSON value in `content/`, keyed on the **whole string**, and dedupe. The collapse is
   hard: pass 3's 2445 occurrences were only 555 distinct strings, and a single streetlight
   description covered 92 files.
2. Rewrite each unique string into a `[index, old, new]` patch table — either as a full replacement or,
   for long multi-dash prose, as a list of `[oldSpan, newSpan]` edits applied to the extracted value.
3. Apply by **exact whole-value match** on the parsed JSON (not text search-and-replace), skipping any
   key named `name`, and **fail loudly on any patch that matches nothing** — a silent miss is how a
   half-swept file happens. The span form additionally throws if a residual dash survives the edit.
4. Re-scan to the excluded floor, then run `content:lint` and `test:regress`.

The replacement is almost always already in the sentence: comma for an appositive, colon for a list or
a restatement, semicolon where the second half explains the first, full stop where a second thought
lands hard, paired commas for an aside, ellipsis for an interruption or a trailing-off. Never trade a
dash for ` - `, ` -- `, or an en dash — that is the same tic wearing a hat.
