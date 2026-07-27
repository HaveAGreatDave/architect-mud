#!/usr/bin/env node
/**
 * MAP AUDIT — deterministic tile linter for the Architect MUD overworld.
 *
 * Reads the `content/` tree directly (git is the source of truth; no DB, no
 * server boot, no tokens). Every MECHANICAL rule lives here so the same tile
 * produces the same finding on every run — agents are only ever asked to make
 * the JUDGEMENT calls the script deliberately refuses to guess at.
 *
 * The rule catalog below is the single source of truth for what we check.
 * `.claude/skills/map-audit/rules.md` is its prose mirror — change both together.
 *
 * Usage:
 *   node audit-map.mjs                        # severity-ordered summary
 *   node audit-map.mjs --rule BLD-1           # every finding for one rule
 *   node audit-map.mjs --rule SCAV-1 --groups # grouped (for judgement rules)
 *   node audit-map.mjs --json out.json        # full findings dump
 *   node audit-map.mjs --region region_coldwater
 *   node audit-map.mjs --bbox 918,900,926,915
 *   node audit-map.mjs --fix BLD-1            # apply the auto-fix for one rule
 *   node audit-map.mjs --fix BLD-1 --write    # ...and actually write the files
 *   node audit-map.mjs --list-rules
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../../..');
// Reuse the CODEX pipeline's own serializer so a fix writes a file byte-identical
// to what `content:export` would produce — otherwise every fix shows up as a
// whole-file reformat in the diff and fights the next export.
const { canonicalJson } = await import(
  'file://' + path.join(REPO, 'scripts/content/lib.mjs').replace(/\\/g, '/')
);
// Read the district registry itself rather than mirroring its keys here — FLAG-3
// asks "can the engine resolve this override", so it has to ask the engine.
const { DISTRICTS } = await import(
  'file://' + path.join(REPO, 'server/engine/districts.js').replace(/\\/g, '/')
);
// Same reason as DISTRICTS: TERRAIN-2 asks "what ground does the engine actually
// draw here", which only the engine can answer. Mirroring zoneTerrain's inference
// chain here would drift the moment someone adds a fallback to it — and an
// unnoticed fallback is the entire defect this rule exists to catch.
const { zoneTerrain } = await import(
  'file://' + path.join(REPO, 'server/engine/world.js').replace(/\\/g, '/')
);
// The marker derivation the AUTHORING side uses (scripts/place-building.mjs stamps
// with these). MARK-2 suggests and MARK-5 tests against the same functions the
// stamper called, so the grader and the stamper cannot disagree.
const { twoLetterAbbrev, nameDerivedMarkers, sigWords } = await import(
  'file://' + path.join(REPO, 'tools/lib/marker.mjs').replace(/\\/g, '/')
);
const CONTENT = path.join(REPO, 'content');
const DECISIONS = path.join(REPO, 'docs/audits/map-audit-decisions.json');

const CARD = ['north', 'south', 'east', 'west'];
const DELTA = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
const OPP = { north: 'south', south: 'north', east: 'west', west: 'east' };

// ─────────────────────────────────────────────────────────────────────────────
// RULE CATALOG — the criteria. `kind: 'mechanical'` means the script decides;
// `kind: 'judgement'` means the script only *surfaces candidates* and a human
// or agent decides. `fix` names an auto-fixer implemented in FIXERS below.
// ─────────────────────────────────────────────────────────────────────────────
const RULES = [
  // ---- CRITICAL: the tile graph is broken ----
  { code: 'GEO-1', sev: 'critical', kind: 'mechanical', fix: null,
    title: 'Zone id disagrees with its own grid coordinates',
    why: 'Every neighbour lookup, entrance bake and map render trusts grid_x/grid_y. A tile whose id says one place and whose coords say another silently corrupts anything that reasons about adjacency.',
    rec: 'NEVER auto-fix. Both repairs (move the coords, or rename the id) break inbound references. Inspect the pair by hand.' },
  { code: 'EXIT-1', sev: 'critical', kind: 'mechanical', fix: null,
    title: 'Exit points at a zone that does not exist',
    why: 'Walking that direction throws or dead-ends.',
    rec: 'Delete the exit, or repoint it at the intended tile.' },
  { code: 'EXIT-2', sev: 'critical', kind: 'mechanical', fix: null,
    title: 'Cardinal exit does not lead to the geometrically adjacent tile',
    why: 'A "north" that lands you three tiles east breaks the minimap, pathfinding and player trust.',
    rec: 'Repoint the exit at the true neighbour, or delete it if the link was never intended.' },
  { code: 'EXIT-3', sev: 'critical', kind: 'mechanical', fix: null,
    title: 'One-way exit — the target has no return link',
    why: 'Players walk in and cannot walk back. Almost always an authoring slip rather than intent.',
    rec: 'Add the mirrored exit on the target tile, unless the one-way is deliberate (a drop, a chute).' },
  { code: 'EXIT-4', sev: 'critical', kind: 'mechanical', fix: null,
    title: 'Zone has no exits at all',
    why: 'Unreachable and unleavable. Anything spawned or teleported there is stranded.',
    rec: 'Wire it into its neighbours, or delete the tile if it is orphaned scaffolding.' },
  { code: 'BLD-1', sev: 'critical', kind: 'mechanical', fix: 'sealFacade',
    title: 'Building is enterable from a non-entrance side (walk-through-wall)',
    why: 'A facade is non-standable: stepping onto it forwards you straight inside. Any neighbour with an inbound link is a door, whatever the entrance flag says — so extra links let players walk through the wall.',
    rec: 'Keep only the link on the entrance side. Removes BOTH the facade exit and the neighbour inbound exit.' },
  { code: 'BLD-2', sev: 'critical', kind: 'mechanical', fix: null,
    title: 'flags.entrance names a direction with no matching exit',
    why: 'facadeStreetTile() resolves the exit-side street via exits[entrance]. With no exit there it falls through to guesswork, so leaving the building lands you somewhere arbitrary.',
    rec: 'Add the exit on the entrance side, or correct the entrance flag to a side that has one. Check GEO-1 first — a scrambled tile produces this as a symptom.' },
  { code: 'BLD-3', sev: 'critical', kind: 'mechanical', fix: null,
    title: 'Facade has an interior map but no exit into it',
    why: 'Survives today only because the revolving-door seam forwards on arrival. The link is the authored record of the door; without it the front door lookup finds nothing and door locks stop being enforced.',
    rec: 'Add the interior exit on the cardinal opposite of the entrance.' },

  // ---- HIGH: building metadata integrity ----
  { code: 'BLD-4', sev: 'high', kind: 'mechanical', fix: 'setIsBuilding',
    title: 'building_type set but is_building is not',
    why: 'is_building is what groups interior zones into one building for the power network and junction-box scope. A typed building without it is invisible to those systems.',
    rec: 'Set flags.is_building: true.' },
  { code: 'BLD-5', sev: 'high', kind: 'judgement', fix: null,
    title: 'is_building true but no building_type',
    why: 'building_type drives the 2-D rooftop footprint and the 3-D windshield shape. Untyped buildings fall back to a generic office block on both.',
    rec: 'Pick the type from the building name and interior. A new type needs BOTH a footprint in BUILDING_TYPE_ICON and a shape in BLDG_TYPE_3D.' },
  { code: 'BLD-6', sev: 'high', kind: 'judgement', fix: null,
    title: 'is_building set on a tile with no facade tag',
    why: 'facade is deliberately opt-in — plenty of legitimate street tiles HOST a building without being one. But an is_building tile with an interior map and no facade tag is a building that never became enterable.',
    rec: 'Add the facade tag if it should be enterable; otherwise this is a street tile and is_building is the wrong flag.' },
  { code: 'BLD-7', sev: 'high', kind: 'judgement', fix: null,
    title: 'Facade with no interior map — an unenterable building',
    why: 'isEnterableFacade() needs a maps row with parent_zone_id = this zone AND a live entry_zone_id. Without one the tile stays standable and the building is scenery.',
    rec: 'Build the interior, or drop the facade tag and treat it as scenery.' },
  { code: 'BLD-8', sev: 'high', kind: 'mechanical', fix: null,
    title: 'Building has no building_name',
    why: 'Used for map labels and for grouping interior rooms under one building.',
    rec: 'Set flags.building_name to the zone name.' },
  { code: 'BLD-9', sev: 'high', kind: 'judgement', fix: null,
    title: 'Facade has no entrance flag, or a non-cardinal one',
    why: 'entrance is the AUTHORED door side — deliberately not inferred, so terrain painting cannot relocate a door. Absent, the map draws no entrance arrow and the exit-side street is guessed.',
    rec: 'Set flags.entrance to the cardinal side the door actually faces (the side with the street link).' },
  { code: 'WEZ-1', sev: 'high', kind: 'mechanical', fix: 'setWez',
    title: 'Building has no world_exit_zone',
    why: 'The declared "where you come out" tile. Read by NPC routines walking actors out of a building and as the fallback landing when exits[entrance] cannot resolve.',
    rec: 'Set it to the entrance-direction neighbour.' },
  { code: 'WEZ-2', sev: 'high', kind: 'mechanical', fix: 'setWez',
    title: 'world_exit_zone points at a zone that does not exist',
    why: 'Actors routed out of the building have nowhere to land.',
    rec: 'Repoint at the entrance-direction neighbour.' },
  { code: 'WEZ-3', sev: 'high', kind: 'mechanical', fix: 'setWez',
    title: 'world_exit_zone is not the entrance-direction neighbour',
    why: 'Players spill out via exits[entrance], but NPC walk-out routines use world_exit_zone. When they disagree, NPCs leave the building onto a different tile than players do.',
    rec: 'Repoint at the entrance-direction neighbour so both paths agree.' },
  { code: 'DOOR-1', sev: 'high', kind: 'judgement', fix: null,
    title: 'Building has no door record on its facade/interior seam',
    why: 'No door means no lock, no hololock, no breaking in, no closing time. The whole security surface of the building is absent.',
    rec: 'Add a doors row on the facade↔interior link. Decline for buildings that are genuinely open-air or always-open.' },
  { code: 'DIR-2', sev: 'high', kind: 'mechanical', fix: null,
    title: 'Interior out-exit does not point the way the entrance faces',
    why: 'The interior map draws its way-out arrow from this exit, and tests/regress.js asserts it matches the door. A stale entrance and a stale interior link can agree with each other while both are wrong — correcting only one surfaces the mismatch, which is how this rule was found.',
    rec: 'Point the interior exit the SAME way as flags.entrance (not the mirror of the facade→interior link), and move the interior-side door record to match.' },
  { code: 'SPAWN-1', sev: 'high', kind: 'mechanical', fix: 'moveSpawn',
    title: 'Enemy spawn sits on a building facade tile',
    why: 'A facade is never stood on — the spawn is unreachable, and anything that does resolve there is inside a wall.',
    rec: 'Relocate the spawn to the entrance-side street tile (world_exit_zone).' },

  // ---- MEDIUM: convention drift ----
  { code: 'DIR-1', sev: 'medium', kind: 'mechanical', fix: 'cardinaliseInterior',
    title: '`in`/`out` used as a direction on a world-map tile',
    why: 'interiorExitDirs() only draws exit arrows for cardinal links, so an `in` link leaves the interior map with no way-out arrow. Movement resolves both, so this is consistency, not breakage.',
    rec: 'Rewrite the interior link to the cardinal opposite of the entrance (entrance:east → interior:west).' },
  { code: 'LINK-1', sev: 'medium', kind: 'judgement', fix: null,
    title: 'No link to an existing walkable neighbour',
    why: 'Usually intentional at a terrain boundary (shore, cliff, rim) and usually a mistake between two tiles of the same kind. Grouped by terrain pair so a whole boundary is one decision.',
    rec: 'Link identical-terrain neighbours. Decline across deliberate boundaries and at the map rim.' },
  { code: 'LINK-2', sev: 'medium', kind: 'mechanical', fix: null,
    title: "Facade's door faces this tile but there is no link into it",
    why: 'The building declares its entrance on this side and yet cannot be entered from it — an unreachable building.',
    rec: 'Add the link on both sides.' },
  { code: 'FLAG-1', sev: 'medium', kind: 'judgement', fix: null,
    title: 'Tile has no flags.terrain',
    why: 'terrain is the ground-surface SSOT — it drives the minimap, the tablet bigmap and movement pacing. Unset renders as undefined ground.',
    rec: 'Paint the terrain that matches the description.' },
  { code: 'FLAG-2', sev: 'medium', kind: 'mechanical', fix: null,
    title: 'Tile has no flags.region_id',
    why: 'Region drives weather, climate profile and overland/void travel rim detection.',
    rec: 'Set the region that geographically contains the tile.' },
  // Replaced the old "tile has no flags.district" check (2026-07). Absence is
  // BENIGN — districtFor() derives from the id prefix and always returns a real
  // entry, so 962 tiles were flagged for omitting an optional override. The rule
  // also missed the actual defect: an override the engine cannot resolve is
  // silently DROPPED, and 2,993 wilderness tiles were reading as 'residential'.
  // Flag invalidity, not absence.
  { code: 'MARK-1', sev: 'medium', kind: 'mechanical', fix: 'clearMarker',
    title: 'Interior room carries a map marker',
    why: 'zones.marker is the <=2-char glyph a tile draws on the MAP — the sidebar minimap in Labels mode, the tablet bigmap in Labels mode, the flight cockpit ground strip and the dev-panel badge. An interior room is not a place on the map you navigate by, and it inherits flags.building_name from its parent, so a marker on it renders the building acronym on a room that is not the building. The world-map underground level (map_world, z<0) is excluded: the sewer network IS drawn on the map, and its box-drawing markers are the authored corridor art. Apartments are excluded too — MARK-3 makes the opposite demand of them.',
    rec: 'Clear the marker (marker: null). The building the room belongs to carries the acronym on its facade — that is the one that renders.' },
  { code: 'MARK-3', sev: 'medium', kind: 'mechanical', fix: 'setMarker',
    title: 'Apartment has no floor designation as its marker',
    why: 'The one interior that IS a distinct place worth marking: an apartment stack is dozens of near-identical rooms whose only distinguishing feature is which floor it is on, and the interior map is the only view that shows them all at once. Halcyon 41-A..E each carry "41" and read as a floor; the other 111 units carry nothing and read as an undifferentiated grid.',
    rec: 'Set the floor designation from the unit name. `want` carries it: the full designation when it fits in 2 glyphs ("Unit 2A" -> "2A"), otherwise the floor alone ("Unit 1001" -> "10", "Halcyon Residence 41-A" -> "41"), so units sharing a floor share a marker.' },
  { code: 'MARK-2', sev: 'medium', kind: 'mechanical', fix: null,
    title: 'Building tile has no 2-character map marker',
    why: 'A building is the one thing on the map a player navigates BY, and marker is the label it wears in Labels mode on every map surface. Nothing derives one any more — the renderers each derived a DIFFERENT acronym from the same name ("Hall of Records" read "HA" on the sidebar and "HO" on the tablet while the authored "HR" rendered nowhere), so the derivation moved to authoring time and an unmarked building draws no letters at all. The convention across the 54 buildings that have one is a 2-letter acronym of the building name — a 1-glyph marker is a leftover terrain glyph (the "#" the planner stamped on grassland) or a decorative emoji, neither of which reads as a building.',
    rec: 'Set a 2-character acronym from the building name. `want` carries the derived suggestion — check it against the markers already in use before accepting it.' },
  { code: 'TERRAIN-2', sev: 'high', kind: 'mechanical', fix: null,
    title: 'Interior room draws as outdoor ground it never declared',
    why: 'An interior legitimately carries no flags.terrain — but zoneTerrain() does not stop at the authored value. It falls through to an inference chain ending in "green-dominant bg_color => grass", and an interior\'s bg_color is authored for the map tile, not for a ground surface. So a room with a green swatch draws as a field: Ration Nine and its stockroom, all 33 Meridian hallways. FLAG-1 could never catch this — it asks whether terrain is ABSENT, which for an interior is correct and expected. The question that matters is what the engine RENDERS, which is why this rule calls zoneTerrain() rather than reading the flag.',
    rec: 'Fix in the engine, not the content: an interior has no ground surface to infer, so zoneTerrain() should return null for one before it reaches the bg_color rule. There is no indoor value to author instead — the terrain enum is all outdoor surfaces (water/road/grass/sand/...) — so repainting the content cannot express "this is a floor", and recolouring the tiles would be fixing the symptom by making the swatch uglier.' },
  { code: 'MARK-4', sev: 'medium', kind: 'mechanical', fix: null,
    title: 'Two buildings wear the same map marker',
    why: 'The marker IS the building\'s identity on the map now that no renderer derives one — two buildings sharing a code are indistinguishable on the tablet bigmap, which shows both at once. This is only worth checking BECAUSE the derivation is gone: the old fallback gave 61 buildings just 33 distinct codes (fifteen of them read "Th"), so collisions were the norm and unmeasurable.',
    rec: 'Rename the less-established one. The authored set already namespaces deliberately — the Ascendant campus is AV/AS/AR/AC/AG/AW — so pick a code that keeps its neighbours legible rather than the first free pair of letters.' },
  { code: 'MARK-5', sev: 'medium', kind: 'judgement', fix: null,
    title: 'Building marker is not derivable from its name',
    why: 'The marker and the name are the two things that identify a building to a player, and they are authored separately, so nothing keeps them in step. A code that does not read as an acronym of the name is often a good choice — `GN` on the gunshop Ironside Arms says what the shop SELLS, which is more use on a map than `IA` — and just as often a leftover from a rename nobody carried through. The script cannot tell those apart, so it asks. NOT a defect list: the outcome of a MARK-5 review is usually a decision-log entry, not an edit.',
    rec: 'Keep the thematic code and record the call in map-audit-decisions.json, or rename to `want` (the acronym of the name). Read the `group`: "article kept" is an acronym under a different convention, "namespace prefix" is the deliberate campus grouping MARK-4 tells you to preserve, and only "unrelated" is worth reading building by building.' },
  { code: 'FLAG-3', sev: 'high', kind: 'mechanical', fix: null,
    title: 'flags.district names a district the engine cannot resolve',
    why: 'districtFor() honours an override only if DISTRICTS[value] exists; anything else is silently dropped and the tile falls back to residential (or hazard if lethal). That wrong district then drives ambience lines, the district shown on look, the minimap colour and the regional map.',
    rec: 'Add the missing entry to DISTRICTS in server/engine/districts.js. Do NOT remap the content instead if the value is load-bearing elsewhere — `wilds` is read literally by the city↔wilds curtain, so renaming it would re-open the boundary.' },

  // ---- JUDGEMENT: content quality ----
  { code: 'SCAV-1', sev: 'judgement', kind: 'judgement', fix: null,
    title: 'Non-building tile with no scavenging / fishing / mining table',
    why: 'A tile with no loot table is a tile where the search, fish and mine verbs do nothing. NOT a defect list — only 6.5% of world tiles carry a table and they are hand-placed on city, road and sewer ground (4 of 2,996 redrock tiles have one). This is a coverage BACKLOG measuring how much of the map the search verbs reach, so read the count as "how far could loot extend", never as "how many tiles are broken".',
    rec: 'Decide once per (terrain, name, region) group — the wilderness is thousands of tiles across a few dozen distinct kinds. Work top-down and stop when the coverage feels right; finishing the list is not the goal.' },
  { code: 'SCAV-2', sev: 'high', kind: 'mechanical', fix: null,
    title: 'Loot table id points at a table that does not exist',
    why: 'The verb resolves to nothing at runtime.',
    rec: 'Repoint at a real table, or create the missing one.' },
  { code: 'PROSE-1', sev: 'judgement', kind: 'judgement', fix: null,
    title: 'Placeholder or thin description',
    why: 'Generated stubs ("The face of X.", "An empty place.") ship as final prose. Read docs/story.md before rewriting.',
    rec: 'Rewrite in the story voice, or accept the stub for tiles a player never reads.' },
  { code: 'TERRAIN-1', sev: 'judgement', kind: 'judgement', fix: null,
    title: 'flags.terrain contradicts the tile description',
    why: 'terrain is the ground-surface SSOT for the minimap, tablet and movement pacing; the description is what the player actually reads. When they disagree one of them is a lie — usually a bulk terrain paint that missed, or prose copy-pasted across a boundary.',
    rec: 'The description is normally the half a human wrote — repaint the terrain to match it. Check a few neighbours before deciding; these come in runs.' },
  { code: 'FLAG-4', sev: 'high', kind: 'mechanical', fix: null,
    title: 'Sub-surface water tile with no flags.underwater',
    why: 'isUnderwater() (swimming) and the water-temperature model both key off flags.underwater. Without it a tile below the surface never arms the breath timer and reads as surface-temperature water — you can stand on the basin floor and never drown.',
    rec: 'Set flags.underwater: true on water tiles below z=0, or confirm they were meant to be surface water.' },
  { code: 'MAP-1', sev: 'high', kind: 'mechanical', fix: null,
    title: 'Two zones share one grid coordinate on the same map',
    why: 'The tablet map lays a map out by raw grid coords — `cell[rowOf(t)][colOf(t)] = t` — so colliding tiles overwrite each other and only the last one survives. Every other room vanishes and the you-are-here marker lands in whichever room won, which is how Halloran\'s Fix-It came to draw its whole interior as a single square. The sidebar minimap hides this, because it derives its layout by walking the exit graph instead, so the bug only shows on one of the two maps.',
    rec: 'Give each room its own coord. Where the rooms are linked by compass exits the layout is derivable exactly — a room exiting south sits north of what it exits into. Where they are linked only by in/out or up/down there is no derivable answer and it needs a convention (see the Ascendant interiors, deferred in the decision log). One legitimate collision exists: the Echelon moors on a bay tile.' },
  { code: 'NAME-2', sev: 'medium', kind: 'judgement', fix: null,
    title: 'Interior room name repeats the building it is inside',
    why: '"Hall of Records — The Stacks" spends half the room title telling you something you already know: you walked through that door, the map is labelled with it, and flags.building_name carries it for the directory and the exit links. The prefix is the most-repeated redundant text a player reads.',
    rec: 'Strip the prefix — "The Stacks". Two classes are deliberately exempt and the check already skips them: zone_util_* power rooms (named after their parent ROOM, so stripping half-strips them) and single-room interiors (where the building name IS the room\'s identity — four AA bunkers must not all become "Bunker").' },
  { code: 'GATE-1', sev: 'critical', kind: 'mechanical', fix: null,
    title: 'Nothing crosses the city↔wilds curtain — the wilds are unreachable',
    why: 'The curtain is code-enforced (the map editor refuses to wire across it, seal-wilds-boundary.mjs strips crossings), so LINK-1 deliberately ignores its ~266 sealed edges. That silence is only safe while at least one gate survives. Today there is exactly one — The South Gate ↔ The Glacis — and if it is ever sealed too, 3,471 wilderness tiles become unreachable on foot with nothing else to report it.',
    rec: 'Restore a crossing. Check The South Gate (zone_district_918_919) ↔ The Glacis (zone_district_918_920) first — that is the authored way out.' },
  { code: 'TABLE-1', sev: 'medium', kind: 'judgement', fix: null,
    title: 'Loot table is defined but no tile references it',
    why: 'Dead content — someone wrote the items and the messages and it can never fire. Usually means the table was authored ahead of the tiles that were meant to use it.',
    rec: 'Assign it to the tiles it was written for, or delete it. Check the item flavour — it usually names its intended home.' },
  { code: 'TABLE-2', sev: 'medium', kind: 'mechanical', fix: null,
    title: 'Loot table lists the same item more than once',
    why: 'weight is a column, so a duplicate row is not a way to weight an item — it silently doubles that item\'s share of both the per-attempt pick and the replenish pick, and doubles the stock the zone initialises. Almost always an accidental double-insert.',
    rec: 'Delete the extra rows. If the item really should be commoner, raise its weight instead.' },
  { code: 'NAME-1', sev: 'judgement', kind: 'judgement', fix: null,
    title: 'Placeholder zone name (coordinates, or "<Terrain> Ground")',
    why: 'The generator names a tile after its own grid position ("The Reach 863,1948") or its raw terrain ("Sand Ground") when no one has named it. The player reads that name on every look, on the minimap and in the tablet — it is the most visible unfinished thing on the map.',
    rec: 'Name the area, not the tile: pick a handful of place names and paint them across contiguous runs the way the rest of the world does (Ochre Draw, Slateback Rise). Read docs/story.md first.' },
  { code: 'PROSE-2', sev: 'judgement', kind: 'judgement', fix: null,
    title: 'Zone name contradicts its terrain',
    why: 'Tiles repainted to road/water keep the name of whatever was there before, so a street is called Grasslands.',
    rec: 'Rename to match the terrain, or repaint the terrain to match the name — whichever the description supports.' },
  { code: 'PAL-1', sev: 'judgement', kind: 'judgement', fix: null,
    title: 'Palette or ambient_theme left over from the previous terrain',
    why: 'A road carrying the grassland green and ambient_theme:forest reads as grass on the map and sounds like woodland underfoot.',
    rec: 'Restyle to the terrain palette. The tile-palette skill designs the bg/text colours.' },
];
const RULE = new Map(RULES.map((r) => [r.code, r]));
const SEV_ORDER = { critical: 0, high: 1, medium: 2, judgement: 3 };

// Palette/theme expectations per terrain — used only to SURFACE drift (PAL-1),
// never to auto-restyle. Colours are the grassland/forest values the planner
// stamped before the terrain was repainted.
const STALE_NATURAL = { colors: new Set(['#8ba36a', '#7f9e5c']), themes: new Set(['forest']) };
const BUILT_TERRAIN = new Set(['road', 'asphalt', 'concrete', 'park']);
// `park` is built ground that is SUPPOSED to look natural — it is a green with trees.
// All 8 Fisherman's Green tiles carry the same green/forest palette deliberately, so
// PAL-1 excludes park while PROSE-2 (a natural NAME on built ground) still covers it.
const PALETTE_EXEMPT = new Set(['park']);
const NATURAL_NAME = /\b(grass|grassland|meadow|field|scrub|moor|heath|prairie|wood|forest)s?\b/i;
const PLACEHOLDER_DESC = [/^The face of /i, /^An empty place\.?$/i, /^A nondescript /i, /\[PLANNER STUB\]/i, /^A raw, undeveloped stretch of ground/i];
// Ground words that betray the real surface, for TERRAIN-1. Deliberately narrow —
// this only fires when the prose names a surface the terrain flag contradicts.
const TERRAIN_WORDS = {
  redrock: /\b(hardpan|red rock|redrock|mesa|ochre|rust-stained|iron-red|scoured rock)\b/i,
  water: /\b(swell|open water|deep water|the surface|waves|tide)\b/i,
  marsh: /\b(marsh|bog|reed|reeds|fen|swamp|brackish)\b/i,
  sand: /\b(sand|dune|dunes|beach|strand|shingle)\b/i,
  ash: /\b(ash|cinders|soot|ashfall)\b/i,
  grass: /\b(grass|grassland|seedhead|meadow)\b/i,
};
// A name the generator produced rather than a person: the tile's own grid position,
// or its raw terrain word plus a noun.
const PLACEHOLDER_NAME = [/\d+\s*,\s*\d+/, /^(water|sand|dirt|rock|grass|ash|mud|stone) (ground|tile|area)$/i, /^(zone|tile|room)[ _-]?\d+$/i, /^untitled\b/i, /^new zone\b/i];

// The marker column is a <=2-char glyph, so count GLYPHS, not UTF-16 units — a
// single emoji marker ("🔧") is length 2 by `.length` and would pass a naive check.
const markerOf = (z) => (z.marker == null ? '' : String(z.marker).trim());
const glyphLen = (s) => [...s].length;
// twoLetterAbbrev (MARK-2's suggestion) and nameDerivedMarkers (MARK-5's test) are
// IMPORTED, not defined here: the placement CLI stamps markers with the same two
// functions, and a grader that derives differently from the stamper would report
// findings on content it just produced. Same reason as DISTRICTS and zoneTerrain above.
// See the import block at the top of this file.
// WHY a marker isn't name-derived — the field MARK-5 groups on, because each class is a
// different decision rather than a different tile:
//   'article kept'     the initials taken WITHOUT dropping the article ("The Cherry
//                      Pit" → TC). Still an acronym; just a different convention.
//   'namespace prefix' the last glyph is a significant word's initial and the first is
//                      not — a shared letter grouping a campus, which is the authored
//                      Ascendant set (AV AS AR AC AG AW) and exactly what MARK-4's
//                      recommendation tells you to preserve.
//   'unrelated'        neither. The code encodes something outside the name (the trade,
//                      usually) and only the author knows whether that was the point.
function markerDivergence(mk, name) {
  const up = mk.toUpperCase();
  const all = String(name || '').replace(/['’]s\b/g, '').replace(/[^A-Za-z0-9\s]/g, ' ')
    .split(/\s+/).filter(Boolean);
  if (all.length >= 2 && (all[0][0] + all[1][0]).toUpperCase() === up) return 'article kept';
  const ini = new Set(sigWords(name).map((w) => w[0].toUpperCase()));
  const [first, last] = [...up];
  if (ini.has(last) && !ini.has(first)) return 'namespace prefix';
  return 'unrelated';
}
// MARK-3's suggestion: the floor designation carried in an apartment's own name
// ("Unit 2A", "Unit 1001", "Halcyon Residence 41-A"). Keep the whole designation
// when it fits the 2-glyph column; otherwise drop to the FLOOR, so the units on one
// floor share a marker — which is what the authored Halcyon stack already does
// (41-A..E all carry "41"), and the only precedent there is.
function floorDesignation(name) {
  const m = /(?:unit|apt|apartment|residence|room|suite)\s+([A-Za-z0-9][A-Za-z0-9-]*)\s*$/i.exec(String(name || '').trim());
  if (!m) return null;
  const desig = m[1].toUpperCase();
  if (glyphLen(desig) <= 2) return desig;
  // "41-A" → the part before the separator. "1001" → all but the last two digits
  // (the unit within the floor), which is the numbering these stacks are authored in.
  const head = desig.split('-')[0];
  if (glyphLen(head) <= 2) return head;
  return /^\d+$/.test(head) ? head.slice(0, -2) : head.slice(0, 2);
}

// ─────────────────────────────────────────────────────────────────────────────
function loadDir(dir) {
  const p = path.join(CONTENT, dir);
  if (!fs.existsSync(p)) return [];
  return fs.readdirSync(p).filter((f) => f.endsWith('.json'))
    .map((f) => ({ __file: path.join(p, f), ...JSON.parse(fs.readFileSync(path.join(p, f), 'utf8')) }));
}
function writeEntity(e) {
  const { __file, ...rest } = e;
  fs.writeFileSync(__file, canonicalJson(rest), 'utf8');
}

function loadDecisions() {
  if (!fs.existsSync(DECISIONS)) return { decisions: [] };
  return JSON.parse(fs.readFileSync(DECISIONS, 'utf8'));
}
// A decision suppresses a finding when the rule matches AND every scope key it
// declares matches the tile. Scope keys: zone_id, terrain, region_id, district,
// name, name_pattern, map_id. An empty scope matches the whole rule.
function makeSuppressor(log) {
  const byRule = new Map();
  for (const d of log.decisions || []) {
    if (d.verdict !== 'accepted') continue;
    if (!byRule.has(d.rule)) byRule.set(d.rule, []);
    byRule.get(d.rule).push(d);
  }
  return (code, zone) => {
    for (const d of byRule.get(code) || []) {
      const s = d.scope || {};
      const f = zone.flags || {};
      if (s.zone_id && ![].concat(s.zone_id).includes(zone.id)) continue;
      if (s.terrain && ![].concat(s.terrain).includes(f.terrain ?? null)) continue;
      if (s.region_id && ![].concat(s.region_id).includes(f.region_id ?? null)) continue;
      if (s.district && ![].concat(s.district).includes(f.district ?? null)) continue;
      if (s.name && ![].concat(s.name).includes(zone.name)) continue;
      if (s.map_id && ![].concat(s.map_id).includes(zone.map_id)) continue;
      if (s.name_pattern && !new RegExp(s.name_pattern, 'i').test(zone.name || '')) continue;
      return d;
    }
    return null;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
export function audit({ region = null, bbox = null } = {}) {
  const zones = loadDir('zones');
  const maps = loadDir('maps');
  const spawns = loadDir('zone_spawns');
  const doors = loadDir('doors');
  const tables = loadDir('scavenging_tables');
  const tableItems = loadDir('scavenging_table_items');

  const byId = new Map(zones.map((z) => [z.id, z]));
  const mapByParent = new Map(maps.filter((m) => m.parent_zone_id).map((m) => [m.parent_zone_id, m]));
  const tableIds = new Set(tables.map((t) => t.id));
  const spawnsByZone = new Map();
  for (const s of spawns) (spawnsByZone.get(s.zone_id) ?? spawnsByZone.set(s.zone_id, []).get(s.zone_id)).push(s);
  const doorsByZone = new Map();
  for (const d of doors) (doorsByZone.get(d.zone_id) ?? doorsByZone.set(d.zone_id, []).get(d.zone_id)).push(d);

  const world = zones.filter((z) => z.map_id === 'map_world');
  // Position index is z-aware — the overworld has z-1 basin floors stacked under
  // it, and ignoring grid_z silently cross-links two different levels.
  const K = (x, y, z) => `${x},${y},${z || 0}`;
  const pos = new Map();
  for (const z of world) {
    const k = K(z.grid_x, z.grid_y, z.grid_z);
    // One legitimate collision exists (the Echelon parks on a basin tile). Keep
    // the district tile as the canonical occupant so neighbour maths is stable.
    if (!pos.has(k) || /^zone_district_/.test(z.id)) pos.set(k, z);
  }
  const inbound = new Map();
  for (const z of world) {
    for (const [d, t] of Object.entries(z.exits || {})) {
      if (!inbound.has(t)) inbound.set(t, []);
      inbound.get(t).push({ from: z.id, dir: d });
    }
  }

  const inScope = (z) => {
    if (region && (z.flags?.region_id ?? null) !== region) return false;
    if (bbox && !(z.grid_x >= bbox[0] && z.grid_y >= bbox[1] && z.grid_x <= bbox[2] && z.grid_y <= bbox[3])) return false;
    return true;
  };

  const suppressed = makeSuppressor(loadDecisions());
  const findings = [];
  const referenced = new Set(); // loot tables some tile actually uses — for TABLE-1
  const skipped = new Map();
  const emit = (code, zone, detail, data = {}) => {
    const d = suppressed(code, zone);
    if (d) { skipped.set(code, (skipped.get(code) || 0) + 1); return; }
    // Carry the coordinates on every finding: the whole point of a MAP audit is
    // that defects cluster spatially, and you can't see a cluster without them.
    // Null for the table-level rules, which have no tile.
    findings.push({
      rule: code, sev: RULE.get(code).sev, zone: zone.id, name: zone.name,
      x: zone.grid_x ?? null, y: zone.grid_y ?? null, z: zone.grid_z ?? null,
      region: zone.flags?.region_id ?? null, terrain: zone.flags?.terrain ?? null,
      detail, ...data,
    });
  };

  const targets = world.filter(inScope);
  for (const z of targets) {
    const f = z.flags || {};
    const ex = z.exits || {};
    const isFacade = !!f.facade;
    const interior = mapByParent.get(z.id);
    const enterable = !!(interior?.entry_zone_id && byId.has(interior.entry_zone_id));
    const streetExits = Object.entries(ex).filter(([, t]) => byId.get(t)?.map_id === 'map_world').map(([d]) => d);
    const interiorExits = Object.entries(ex).filter(([, t]) => interior && byId.get(t)?.map_id === interior.id).map(([d]) => d);

    // ---- GEO-1: id ↔ coords ----
    const m = /^zone_district_(\d+)_(\d+)(?:_z(-?\d+))?$/.exec(z.id);
    if (m) {
      const [ex_, ey, ez] = [+m[1], +m[2], m[3] ? +m[3] : 0];
      if (z.grid_x !== ex_ || z.grid_y !== ey || (z.grid_z || 0) !== ez) {
        const occupant = pos.get(K(ex_, ey, ez));
        emit('GEO-1', z, `id implies (${ex_},${ey},${ez}) but sits at (${z.grid_x},${z.grid_y},${z.grid_z || 0}); that slot is held by ${occupant?.id ?? '(empty)'}`,
          { swapWith: occupant?.id ?? null });
      }
    }

    // ---- exit graph ----
    if (!Object.keys(ex).length) emit('EXIT-4', z, 'no exits');
    for (const [d, t] of Object.entries(ex)) {
      const tz = byId.get(t);
      if (!tz) { emit('EXIT-1', z, `${d} → ${t} (no such zone)`, { dir: d, target: t }); continue; }
      if (!CARD.includes(d)) continue;
      if (tz.map_id !== 'map_world') continue;
      const [dx, dy] = DELTA[d];
      if (tz.grid_x !== z.grid_x + dx || tz.grid_y !== z.grid_y + dy || (tz.grid_z || 0) !== (z.grid_z || 0))
        emit('EXIT-2', z, `${d} → ${t} at (${tz.grid_x},${tz.grid_y}), expected (${z.grid_x + dx},${z.grid_y + dy})`, { dir: d, target: t });
      // Facades are entered by forwarding, so a missing return on a facade link is normal.
      else if (!isFacade && !tz.flags?.facade && tz.exits?.[OPP[d]] !== z.id)
        emit('EXIT-3', z, `${d} → ${t} has no ${OPP[d]} return`, { dir: d, target: t });
    }

    // ---- buildings ----
    if (f.building_type && !f.is_building) emit('BLD-4', z, `building_type=${f.building_type}, is_building unset`);
    if (f.is_building && !f.building_type) emit('BLD-5', z, 'is_building with no building_type');
    if (f.is_building && !isFacade) emit('BLD-6', z, `is_building with no facade tag${interior ? ' (has an interior map!)' : ''}`);
    if (f.is_building && !f.building_name) emit('BLD-8', z, 'no building_name');
    // MARK-2 — the map glyph, on the world tile that IS the building. Keyed on
    // facade OR is_building rather than facade alone so a building whose facade tag
    // is missing (BLD-6) is still asked for its acronym.
    if (isFacade || f.is_building) {
      const mk = markerOf(z);
      const bName = f.building_name || z.name;
      const want = twoLetterAbbrev(bName);
      if (glyphLen(mk) !== 2)
        emit('MARK-2', z, `${bName} — marker=${mk ? `"${mk}"` : '(unset)'}${want ? `, suggest "${want}"` : ''}`,
          { group: mk ? `${glyphLen(mk)}-glyph marker` : 'no marker', want });
      // MARK-5 — the marker is the right SHAPE (MARK-2 already covers the rest) but
      // does not read as derived from the name. A judgement call, grouped by WHY it
      // diverges so a whole convention can be accepted in one decision.
      else if (!nameDerivedMarkers(bName).has(mk.toUpperCase()))
        emit('MARK-5', z, `"${mk}" on ${bName}${want ? ` — the name gives "${want}"` : ''}`,
          { group: markerDivergence(mk, bName), want });
    }

    if (isFacade) {
      const entr = f.entrance;
      if (!enterable) emit('BLD-7', z, interior ? `map ${interior.id} has no live entry_zone_id` : 'no interior map');
      if (!entr || !CARD.includes(entr)) emit('BLD-9', z, `entrance=${entr ?? '(unset)'}`);

      if (entr && CARD.includes(entr)) {
        if (!ex[entr]) emit('BLD-2', z, `entrance=${entr} but exits are ${Object.keys(ex).join('/') || '(none)'}`);
        // The real gate: who can walk in.
        const doorTile = ex[entr];
        const trespass = (inbound.get(z.id) || []).filter((i) => i.from !== doorTile);
        if (trespass.length)
          emit('BLD-1', z, `entrance=${entr} (street ${doorTile ?? '—'}), but also enterable from ${trespass.map((i) => `${i.from} via ${i.dir}`).join(', ')}`,
            { keep: doorTile, trespass });
        if (enterable && !interiorExits.length) emit('BLD-3', z, `interior ${interior.entry_zone_id} has no exit from the facade`);
        if (enterable && interiorExits.some((d) => !CARD.includes(d)))
          emit('DIR-1', z, `interior link is '${interiorExits.join('/')}'; entrance=${entr} ⇒ should be '${OPP[entr]}'`, { from: interiorExits, to: OPP[entr] });

        // The interior side of the same seam. The facade→interior link is the
        // OPPOSITE of the entrance, but the interior's way out is the SAME as it —
        // you walk out through the door, in the direction the door faces. Getting
        // this backwards is the "reverted intuition" tests/regress.js warns about.
        if (enterable) {
          const entryZone = byId.get(interior.entry_zone_id);
          const outs = Object.entries(entryZone?.exits || {})
            .filter(([d, t]) => t === z.id && CARD.includes(d)).map(([d]) => d);
          if (outs.length === 1 && outs[0] !== entr)
            emit('DIR-2', z, `${entryZone.id} leaves '${outs[0]}' but entrance=${entr} — interior must leave the way the door faces`,
              { interior: entryZone.id, from: outs[0], to: entr });
        }

        const [dx, dy] = DELTA[entr];
        const nb = pos.get(K(z.grid_x + dx, z.grid_y + dy, z.grid_z));
        if (!f.world_exit_zone) emit('WEZ-1', z, `no world_exit_zone (entrance ${entr} ⇒ ${nb?.id ?? '?'})`, { want: nb?.id ?? null });
        else if (!byId.has(f.world_exit_zone)) emit('WEZ-2', z, `world_exit_zone=${f.world_exit_zone} does not exist`, { want: nb?.id ?? null });
        else if (nb && f.world_exit_zone !== nb.id) emit('WEZ-3', z, `world_exit_zone=${f.world_exit_zone}, entrance ${entr} ⇒ ${nb.id}`, { want: nb.id });
      }

      const seamDoors = (doorsByZone.get(z.id) || []).length + (doorsByZone.get(interior?.entry_zone_id) || []).length;
      if (enterable && !seamDoors) emit('DOOR-1', z, `${f.building_name || z.name} — no door on the facade↔interior seam`);

      const sp = spawnsByZone.get(z.id);
      if (sp) emit('SPAWN-1', z, `${sp.map((s) => s.enemy_id).join(', ')} spawn${sp.length > 1 ? '' : 's'} on a facade`,
        { spawns: sp.map((s) => s.id), want: f.world_exit_zone || (CARD.includes(f.entrance) ? ex[f.entrance] : null) });
    } else {
      // `in`/`out` on a non-facade world tile is not the building seam — flag for review.
      for (const d of ['in', 'out']) if (ex[d]) emit('DIR-1', z, `'${d}' → ${ex[d]} on a non-facade world tile`, { from: [d], to: null });
    }

    // ---- missing neighbour links ----
    for (const d of CARD) {
      if (ex[d]) continue;
      const [dx, dy] = DELTA[d];
      const nb = pos.get(K(z.grid_x + dx, z.grid_y + dy, z.grid_z));
      if (!nb) continue;
      if (nb.flags?.facade) {
        if (nb.flags.entrance === OPP[d]) emit('LINK-2', z, `${nb.name} (${nb.id}) has its door facing ${OPP[d]} — at this tile — but there is no ${d} link`, { dir: d, target: nb.id });
        continue;
      }
      if (isFacade) continue;
      // The city↔wilds curtain is a CODE-ENFORCED invariant, not an oversight: the map
      // editor refuses to wire across it (_crossesWildsBoundary), routes.js won't
      // re-open it, and seal-wilds-boundary.mjs strips any crossing that appears. It is
      // deliberately pierced in exactly one place — The South Gate — which GATE-1 guards.
      if ((f.district === 'wilds') !== (nb.flags?.district === 'wilds')) continue;
      // Hand-authored underground networks have authored topology: the sewer rooms are a
      // maze where grid adjacency is not connectivity (Rat Warren is a one-exit "drowned
      // side-chamber", Silt Pocket is "a blind pocket"). Only open surface ground carries
      // the "adjacent means walkable" expectation this rule tests.
      if (f.is_interior || nb.flags?.is_interior || (z.grid_z ?? 0) < 0) continue;
      const pair = [f.terrain ?? '(none)', nb.flags?.terrain ?? '(none)'];
      emit('LINK-1', z, `${d} → ${nb.id} (${nb.name})`, { dir: d, target: nb.id, group: `${pair[0]} → ${pair[1]}`, sameName: nb.name === z.name });
    }

    // ---- flags ----
    // Outdoor only. terrain is the GROUND-SURFACE ssot; 0 of 384 interior tiles carry
    // one, so flagging interiors was 120 false positives. Sub-surface open water still
    // counts (the 82 basin/channel tiles are authored terrain:water).
    if (!isFacade && !f.terrain && !f.is_interior) emit('FLAG-1', z, `no terrain (${z.name})`, { group: z.name });
    // Surface only. region_id is an outdoor-surface property by design — environment.js
    // scopes regional weather/power to "the region's outdoor tiles (facades included;
    // interiors never carry region_id)". Every one of the 5,168 surface tiles has one and
    // none of the 271 sub-surface tiles do, so flagging z<0 was 202 false positives.
    if (!f.region_id && (z.grid_z ?? 0) >= 0) emit('FLAG-2', z, 'no region_id', { group: z.name });
    // Absence is fine — districtFor() falls back to the id-prefix table. An
    // override the registry doesn't know is what silently resolves to residential.
    if (f.district && !DISTRICTS[f.district])
      emit('FLAG-3', z, `flags.district='${f.district}' is not a district — override dropped, falls back`, { group: f.district, want: f.district });

    // ---- loot coverage ----
    const tbl = ['scavenging_table_id', 'fishing_table_id', 'mining_table_id'].map((k) => f[k]).filter(Boolean);
    for (const t of tbl) if (!tableIds.has(t)) emit('SCAV-2', z, `table ${t} does not exist`);
    for (const t of tbl) referenced.add(t);
    // The fishing plugin gives any tile orthogonally touching water the common bay
    // table for free (fishingTableFor → bordersWater), so a shoreline tile is
    // already covered and must not be reported as a dead spot. Water tiles
    // themselves are the inverse: the plugin returns null by design — you cast from
    // the bank, not while treading water — so they can only ever be scavenged.
    const isWater = f.terrain === 'water';
    const nearWater = !isWater && CARD.some((d) => {
      const [dx, dy] = DELTA[d];
      return pos.get(K(z.grid_x + dx, z.grid_y + dy, z.grid_z))?.flags?.terrain === 'water';
    });
    if (nearWater) referenced.add('fish_coldwater_bay');
    if (!isFacade && !tbl.length && !nearWater)
      emit('SCAV-1', z, `${z.name} / ${f.terrain ?? '(none)'}`, {
        group: `${f.terrain ?? '(none)'} · ${z.name} · ${f.region_id ?? '(no region)'}`,
        // The wilderness was generated with many decorative names over a handful of
        // actual terrains ("Ochre Draw", "Cinder Mesa" and "Ferric Wash" are the same
        // redrock with the same prose). Loot-worthiness follows the terrain, not the
        // name — so --coarse collapses them into one decision.
        coarse: `${f.terrain ?? '(none)'} · ${f.region_id ?? '(no region)'}`,
      });

    // ---- prose & palette ----
    const desc = z.description || '';
    if (!desc || desc.length < 40 || PLACEHOLDER_DESC.some((r) => r.test(desc)))
      emit('PROSE-1', z, `"${desc.slice(0, 60)}${desc.length > 60 ? '…' : ''}"`, { group: desc.slice(0, 30) || '(empty)' });
    if (isWater && (z.grid_z || 0) < 0 && !f.underwater)
      emit('FLAG-4', z, `${z.name} at z=${z.grid_z} — water with no underwater flag`, { group: z.name });

    // TERRAIN-1: only fire when the prose names a DIFFERENT surface than the flag,
    // and the flag's own surface is absent from the prose. One-sided evidence only.
    // Water is excluded as the FLAGGED terrain: a water tile's prose describes its
    // margins by nature ("reeds have got a foothold", "cut deep into the hardpan"),
    // which is the bank, not the tile. Including it produced ~120 false positives.
    if (f.terrain && f.terrain !== 'water' && TERRAIN_WORDS[f.terrain] && desc) {
      const said = Object.entries(TERRAIN_WORDS).filter(([t, re]) => t !== f.terrain && re.test(desc)).map(([t]) => t);
      if (said.length && !TERRAIN_WORDS[f.terrain].test(desc))
        emit('TERRAIN-1', z, `terrain=${f.terrain} but the description reads as ${said.join('/')}`, { group: `${f.terrain} → ${said.join('/')}`, coarse: `${f.terrain} → ${said[0]}` });
    }

    const ph = PLACEHOLDER_NAME.find((r) => r.test(z.name || ''));
    if (ph) emit('NAME-1', z, `"${z.name}"`, { group: ph.source, coarse: `${f.region_id ?? '(no region)'} · ${f.terrain ?? '(none)'}` });
    if (BUILT_TERRAIN.has(f.terrain) && NATURAL_NAME.test(z.name || ''))
      emit('PROSE-2', z, `name "${z.name}" vs terrain "${f.terrain}"`, { group: `${z.name} · ${f.terrain}` });
    if (BUILT_TERRAIN.has(f.terrain) && !PALETTE_EXEMPT.has(f.terrain) && (STALE_NATURAL.colors.has(z.color) || STALE_NATURAL.themes.has(z.ambient_theme)))
      emit('PAL-1', z, `terrain=${f.terrain} but color=${z.color} theme=${z.ambient_theme}`, { group: `${f.terrain} · ${z.color} · ${z.ambient_theme}` });
  }

  // TABLE-1 is a whole-tree question, not a per-tile one — only meaningful on a
  // full-map run, since a scoped run legitimately won't reference most tables.
  if (!region && !bbox) {
    // Reference-counting spans EVERY zone, not just the overworld tiles this audit
    // walks: interiors carry loot flags too (the Echelon's stern fishes its own
    // table from map_echelon). Counting only world tiles reported live tables as
    // dead content.
    for (const z of zones)
      for (const k of ['scavenging_table_id', 'fishing_table_id', 'mining_table_id'])
        if (z.flags?.[k]) referenced.add(z.flags[k]);
    // GATE-1 — the counterweight to LINK-1 skipping the curtain. LINK-1 stays quiet
    // about the ~266 sealed edges because sealing them is the design; the failure that
    // silence could hide is the opposite one, where the last gate gets sealed too and
    // the wilds become unreachable. This is a whole-map assertion, not a per-tile check.
    {
      const W = (z) => z?.flags?.district === 'wilds';
      const gates = [];
      for (const z of zones)
        for (const [d, t] of Object.entries(z.exits || {})) {
          const n = byId.get(t);
          if (n && W(z) !== W(n)) gates.push(`${z.name} (${z.id}) --${d}--> ${n.name}`);
        }
      const pseudo = { id: 'city_wilds_curtain', name: 'city↔wilds curtain', flags: {}, map_id: null };
      if (!gates.length && !suppressed('GATE-1', pseudo))
        findings.push({ rule: 'GATE-1', sev: 'critical', zone: 'city_wilds_curtain', name: 'city↔wilds curtain',
          detail: 'no exit anywhere crosses the city↔wilds boundary — the wilds are unreachable on foot', group: 'curtain' });
    }

    // TERRAIN-2 — interiors, which `targets` (map_world only) never walks. Ask the
    // engine what ground it draws; anything non-null on a tile that authored no
    // terrain came from the inference chain, not from an author.
    for (const z of zones) {
      const f = z.flags || {};
      if (f.terrain) continue;                              // authored — TERRAIN-1's problem, not this one
      if (!f.is_interior && (!z.map_id || z.map_id === 'map_world')) continue;
      const drawn = zoneTerrain(z);
      if (!drawn) continue;
      emit('TERRAIN-2', z, `draws as '${drawn}' — no flags.terrain, inferred from bg_color ${z.bg_color || '(none)'}`,
        { group: `${drawn} · ${z.bg_color || '(none)'}`, coarse: z.map_id, drawn });
    }

    // MARK-4 — a whole-map question like TABLE-1: you cannot see a collision from one
    // tile. Scoped to world buildings, which are the only tiles whose marker is a
    // building identity (a terrain glyph like `≈` is SUPPOSED to repeat across the bay).
    {
      const byMark = new Map();
      for (const z of world) {
        const f = z.flags || {};
        if (!f.facade && !f.is_building) continue;
        const mk = markerOf(z);
        if (!mk) continue;
        if (!byMark.has(mk)) byMark.set(mk, []);
        byMark.get(mk).push(z);
      }
      for (const [mk, group] of byMark) {
        if (group.length < 2) continue;
        // Anchor on every member: which one gets renamed is the human's call, so
        // reporting them all lets a decision except whichever holds the code.
        for (const z of group) {
          const others = group.filter((o) => o !== z).map((o) => o.flags?.building_name || o.name);
          emit('MARK-4', z, `"${mk}" is also worn by ${others.join(', ')}`, { group: mk, collidesWith: others });
        }
      }
    }

    // MARK-1 — the inverse of MARK-2, and like MAP-1/NAME-2 it is about INTERIORS,
    // which `targets` (map_world only) never walks. The exclusion is deliberate: a
    // tile ON map_world draws on the map by definition, so its marker is legitimate
    // however interior it feels — that covers the 117 z<0 sewer tiles whose
    // box-drawing markers ARE the underground level's corridor art.
    for (const z of zones) {
      if (!z.map_id || z.map_id === 'map_world') continue;
      // An apartment is the exception in both directions: it SHOULD carry its floor
      // designation, so MARK-1 leaves it alone and MARK-3 asks for the missing one.
      // Only absence is reported — an authored marker that disagrees with the derived
      // designation is the author's call, not a defect.
      if (z.flags?.is_apartment) {
        if (markerOf(z)) continue;
        const want = floorDesignation(z.name);
        emit('MARK-3', z, `${z.name} — no marker${want ? `, suggest "${want}"` : ' (no designation in the name)'}`,
          { group: z.map_id, want });
        continue;
      }
      if (!markerOf(z)) continue;
      emit('MARK-1', z, `"${markerOf(z)}" on ${z.name} (${z.map_id})`, { group: z.map_id });
    }

    // MAP-1 / NAME-2 — whole-tree questions like TABLE-1, and both about INTERIORS,
    // which `targets` (map_world only) never walks. They have to iterate `zones`.
    {
      const slot = new Map();
      for (const z of zones) {
        if (!z.map_id || z.grid_x == null) continue;
        const k = `${z.map_id}|${K(z.grid_x, z.grid_y, z.grid_z)}`;
        if (!slot.has(k)) slot.set(k, []);
        slot.get(k).push(z);
      }
      for (const [k, group] of slot) {
        if (group.length < 2) continue;
        const coord = k.split('|')[1];
        // Anchor on every member but the first, so the surviving canonical occupant
        // isn't itself reported and a per-zone decision can except one intruder.
        for (const z of group.slice(1)) {
          const others = group.filter((o) => o !== z);
          emit('MAP-1', z, `shares (${coord}) on ${z.map_id} with ${others.map((o) => o.name).join(', ')}`,
            { group: z.map_id, coord, collidesWith: others.map((o) => o.id) });
        }
      }
    }
    {
      // The building an interior belongs to has three records, descending authority.
      // Keying on flags.building_name alone misses every room that never carried the
      // flag — which was all ten Yards Tenement floors.
      const isUtil = (id) => id.startsWith('zone_util_');
      const roomsPerMap = new Map();
      for (const z of zones)
        if (z.flags?.is_interior && z.map_id && !isUtil(z.id))
          roomsPerMap.set(z.map_id, (roomsPerMap.get(z.map_id) || 0) + 1);
      const mapById = new Map(maps.map((m) => [m.id, m]));
      const SEP = /^\s*[—–:-]\s*/;
      for (const z of zones) {
        if (!z.flags?.is_interior || !z.name) continue;
        if (isUtil(z.id) || (roomsPerMap.get(z.map_id) || 0) < 2) continue;
        const m = mapById.get(z.map_id);
        const par = m?.parent_zone_id ? byId.get(m.parent_zone_id) : null;
        const bn = z.flags.building_name || par?.flags?.building_name || par?.name
          || String(m?.name || '').split(/\s*[—–]\s*/)[0];
        if (!bn) continue;
        const n = z.name.trim(), b = String(bn).trim();
        if (n === b || !n.toLowerCase().startsWith(b.toLowerCase())) continue;
        const rest = n.slice(b.length);
        if (!SEP.test(rest)) continue;
        const short = rest.replace(SEP, '').trim();
        if (short) emit('NAME-2', z, `"${z.name}" → "${short}"`, { group: b, want: short });
      }
    }

    const rowsByTable = new Map();
    for (const it of tableItems) {
      if (!rowsByTable.has(it.table_id)) rowsByTable.set(it.table_id, new Map());
      const m = rowsByTable.get(it.table_id);
      m.set(it.item_id, (m.get(it.item_id) || 0) + 1);
    }
    for (const [tid, m] of rowsByTable) {
      const dups = [...m].filter(([, n]) => n > 1);
      if (!dups.length) continue;
      const pseudo = { id: tid, name: tid, flags: {}, map_id: null };
      if (suppressed('TABLE-2', pseudo)) { skipped.set('TABLE-2', (skipped.get('TABLE-2') || 0) + 1); continue; }
      findings.push({ rule: 'TABLE-2', sev: 'medium', zone: tid, name: tid, group: 'duplicate rows',
        detail: `${dups.map(([i, n]) => `${i} ×${n}`).join(', ')}` });
    }

    for (const t of tables) {
      if (referenced.has(t.id)) continue;
      const pseudo = { id: t.id, name: t.name || t.id, flags: {}, map_id: null };
      const d = suppressed('TABLE-1', pseudo);
      if (d) { skipped.set('TABLE-1', (skipped.get('TABLE-1') || 0) + 1); continue; }
      findings.push({ rule: 'TABLE-1', sev: 'medium', zone: t.id, name: t.name || t.id, detail: `${t.name || t.id} — referenced by 0 tiles`, group: 'unreferenced' });
    }
  }

  return { findings, skipped, stats: { world: world.length, scanned: targets.length, facades: targets.filter((z) => z.flags?.facade).length } };
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTO-FIXERS — only for rules whose repair is fully determined by the data.
// Each returns the set of entity objects it mutated; the caller writes them.
// ─────────────────────────────────────────────────────────────────────────────
const FIXERS = {
  // BLD-1: seal every way in except the entrance side — both directions.
  sealFacade(f, ctx) {
    const z = ctx.zones.get(f.zone);
    const touched = new Set();
    for (const t of f.trespass) {
      const nb = ctx.zones.get(t.from);
      if (nb?.exits?.[t.dir] === z.id) { delete nb.exits[t.dir]; touched.add(nb); }
      const back = Object.entries(z.exits || {}).find(([, tgt]) => tgt === t.from);
      if (back) { delete z.exits[back[0]]; touched.add(z); }
    }
    return touched;
  },
  // WEZ-1/2/3: point world_exit_zone at the entrance-direction neighbour.
  setWez(f, ctx) {
    if (!f.want) return new Set();
    const z = ctx.zones.get(f.zone);
    z.flags.world_exit_zone = f.want;
    return new Set([z]);
  },
  // BLD-4: a typed building is a building.
  setIsBuilding(f, ctx) {
    const z = ctx.zones.get(f.zone);
    z.flags.is_building = true;
    return new Set([z]);
  },
  // DIR-1: rewrite the interior link from `in` to the cardinal opposite of the entrance.
  cardinaliseInterior(f, ctx) {
    if (!f.to) return new Set();
    const z = ctx.zones.get(f.zone);
    const touched = new Set();
    for (const d of f.from) {
      if (!z.exits?.[d]) continue;
      const target = z.exits[d];
      if (z.exits[f.to] && z.exits[f.to] !== target) continue; // occupied — leave for a human
      delete z.exits[d];
      z.exits[f.to] = target;
      touched.add(z);
      // Mirror the interior side: its way back should be the entrance direction.
      const inner = ctx.zones.get(target);
      const back = inner && Object.entries(inner.exits || {}).find(([, t]) => t === z.id);
      if (inner && back && !CARD.includes(back[0]) && !inner.exits[OPP[f.to]]) {
        delete inner.exits[back[0]];
        inner.exits[OPP[f.to]] = z.id;
        touched.add(inner);
      }
    }
    return touched;
  },
  // MARK-1: an interior draws on no map, so its glyph is dead data. `null` (not a
  // deleted key) is how content/ represents "no marker" — see any zone_util_* file.
  clearMarker(f, ctx) {
    const z = ctx.zones.get(f.zone);
    if (!z) return new Set();
    z.marker = null;
    return new Set([z]);
  },
  // MARK-3: stamp the floor designation derived from the unit's own name.
  setMarker(f, ctx) {
    if (!f.want) return new Set();
    const z = ctx.zones.get(f.zone);
    if (!z) return new Set();
    z.marker = f.want;
    return new Set([z]);
  },
  // SPAWN-1: relocate the spawn to the entrance-side street tile.
  moveSpawn(f, ctx) {
    if (!f.want) return new Set();
    const touched = new Set();
    for (const id of f.spawns) {
      const s = ctx.spawns.get(id);
      if (!s) continue;
      s.zone_id = f.want;
      touched.add(s);
    }
    return touched;
  },
};

function applyFix(code, opts) {
  const rule = RULE.get(code);
  if (!rule?.fix) { console.error(`Rule ${code} has no auto-fixer — it must be repaired by hand.`); process.exit(1); }
  const { findings } = audit(opts);
  let mine = findings.filter((f) => f.rule === code);
  if (!mine.length) { console.log(`No ${code} findings to fix.`); return; }

  // INTERLOCK: a GEO-1 tile's grid coordinates are a lie, so every fixer that
  // reasons about neighbours (all of them) would compute the repair from the
  // wrong geometry. Those tiles are quarantined until the swap is resolved by
  // hand. This is why three of the BLD-1/BLD-2 findings look unfixable — they
  // are symptoms of GEO-1, not defects of their own.
  const scrambled = new Set(findings.filter((f) => f.rule === 'GEO-1').map((f) => f.zone));
  const blocked = mine.filter((f) => scrambled.has(f.zone) || (f.trespass || []).some((t) => scrambled.has(t.from)));
  if (blocked.length && !opts.force) {
    mine = mine.filter((f) => !blocked.includes(f));
    console.log(`⚠ ${blocked.length} finding(s) skipped — the tile (or its neighbour) also has GEO-1 scrambled coordinates:`);
    for (const f of blocked) console.log(`   ${f.zone}`);
    console.log('   Resolve GEO-1 by hand first. Override with --force only if you know the geometry is right.\n');
    if (!mine.length) return;
  }

  const zones = new Map(loadDir('zones').map((z) => [z.id, z]));
  const spawns = new Map(loadDir('zone_spawns').map((s) => [s.id, s]));
  const ctx = { zones, spawns };
  const touched = new Set();
  for (const f of mine) for (const e of FIXERS[rule.fix](f, ctx)) touched.add(e);

  console.log(`${code} — ${mine.length} finding(s), ${touched.size} file(s) ${opts.write ? 'written' : 'would change'}:`);
  for (const e of touched) console.log(`   ${path.relative(REPO, e.__file).replace(/\\/g, '/')}`);
  if (opts.write) { for (const e of touched) writeEntity(e); console.log('\nWritten. Run `npm run content:lint` then `npm run test:regress`.'); }
  else console.log('\nDry run. Re-run with --write to apply.');
}

// ─────────────────────────────────────────────────────────────────────────────
function main() {
  const argv = process.argv.slice(2);
  const arg = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
  const has = (n) => argv.includes(n);

  if (has('--list-rules')) {
    for (const r of [...RULES].sort((a, b) => SEV_ORDER[a.sev] - SEV_ORDER[b.sev]))
      console.log(`${r.code.padEnd(9)} ${r.sev.padEnd(9)} ${r.kind.padEnd(11)} ${r.fix ? '[auto]' : '      '} ${r.title}`);
    return;
  }

  const opts = {
    region: arg('--region'),
    bbox: arg('--bbox') ? arg('--bbox').split(',').map(Number) : null,
    write: has('--write'),
    force: has('--force'),
  };

  if (has('--fix')) return applyFix(arg('--fix'), opts);

  const { findings, skipped, stats } = audit(opts);
  const one = arg('--rule');

  if (arg('--json')) {
    fs.writeFileSync(arg('--json'), JSON.stringify({ stats, findings }, null, 1));
    console.log(`${findings.length} findings → ${arg('--json')}`);
    return;
  }

  if (one) {
    const mine = findings.filter((f) => f.rule === one);
    const r = RULE.get(one);
    console.log(`${one} — ${r.title}\n  severity: ${r.sev}   kind: ${r.kind}   auto-fix: ${r.fix ? 'yes' : 'no'}`);
    console.log(`  why:  ${r.why}\n  rec:  ${r.rec}\n`);
    if (has('--groups') || has('--coarse')) {
      const coarse = has('--coarse');
      const key = (f) => (coarse ? f.coarse ?? f.group : f.group) ?? '(ungrouped)';
      const g = new Map();
      for (const f of mine) (g.get(key(f)) ?? g.set(key(f), []).get(key(f))).push(f);
      console.log(`${mine.length} findings in ${g.size} ${coarse ? 'coarse ' : ''}groups:\n`);
      for (const [k, v] of [...g].sort((a, b) => b[1].length - a[1].length)) {
        console.log(`${String(v.length).padStart(5)}  ${k}`);
        if (coarse) {
          const names = [...new Set(v.map((f) => f.group))];
          console.log(`         ${names.length} name(s): ${names.map((n) => n.split(' · ')[1] ?? n).slice(0, 8).join(', ')}${names.length > 8 ? ` … +${names.length - 8}` : ''}`);
        }
        console.log(`         e.g. ${v[0].zone}`);
      }
    } else {
      console.log(`${mine.length} findings:\n`);
      for (const f of mine) console.log(`  ${f.zone.padEnd(26)} ${f.detail}`);
    }
    return;
  }

  console.log(`MAP AUDIT — ${stats.scanned} of ${stats.world} world tiles scanned (${stats.facades} facades)`);
  if (opts.region) console.log(`  region: ${opts.region}`);
  if (opts.bbox) console.log(`  bbox:   ${opts.bbox.join(',')}`);
  const counts = new Map();
  for (const f of findings) counts.set(f.rule, (counts.get(f.rule) || 0) + 1);
  let sev = null;
  for (const r of [...RULES].sort((a, b) => SEV_ORDER[a.sev] - SEV_ORDER[b.sev] || a.code.localeCompare(b.code))) {
    const n = counts.get(r.code) || 0;
    if (!n) continue;
    if (r.sev !== sev) { sev = r.sev; console.log(`\n── ${sev.toUpperCase()} ──`); }
    console.log(`${String(n).padStart(6)}  ${r.code.padEnd(9)} ${r.fix ? '[auto]' : '      '} ${r.title}`);
  }
  const clean = RULES.filter((r) => !counts.get(r.code)).map((r) => r.code);
  if (clean.length) console.log(`\nclean: ${clean.join(' ')}`);
  if (skipped.size) console.log(`\nsuppressed by docs/audits/map-audit-decisions.json: ${[...skipped].map(([k, v]) => `${k}×${v}`).join('  ')}`);
  console.log(`\nTOTAL ${findings.length} findings. Drill in with --rule <CODE> (add --groups for judgement rules).`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
export { RULES, RULE };
