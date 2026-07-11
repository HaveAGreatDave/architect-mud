// Zone planner — materialize an ASCII blueprint into zones (zone redesign
// Phase 7). Authoring a district stops being one-zone-at-a-time busywork:
// draw a character grid, map each glyph to a template, and this writes the
// zones, the adjacency exits (exits stay the traversability law — the planner
// WRITES them, adjacency alone never connects), and full facade+interior
// wiring for every building glyph.
//
//   node tools/zone-planner/apply.mjs tools/zone-planner/blueprints/<bp>.bp.json           (dry-run)
//   node tools/zone-planner/apply.mjs tools/zone-planner/blueprints/<bp>.bp.json --apply
//   add --force to reassert template fields on existing planner-owned zones
//
// Runs against the LOCAL dev DB (db.js env resolution); output reaches prod
// exclusively through the content pipeline: apply → npm run content:export →
// commit → push. Restart (or reloadZone) a running local server to see it live.
//
// Blueprint format (JSON):
//   {
//     "id": "bp_meridian_east",           // provenance tag on every zone it creates
//     "map": "map_world",
//     "origin": { "x": 40, "y": 12, "z": 0 },
//     "id_prefix": "meridian_e",          // zones become zone_<prefix>_<absX>_<absY>
//     "grid": [ "####B#",                 // top row = origin.y; col 0 = origin.x
//               "#..B##" ],
//     "legend": {
//       "#": { "template": "street", "name": "Meridian Ave — {block} block",
//               "tags": { "artery": ["Meridian Ave"], "street_life": true },
//               "ambient_theme": "city", "marker": "░", "color": "#ccc", "bg_color": "#4a4a52" },
//       ".": { "template": "alley", "name": "Back Alley" },
//       "~": { "template": "water", "name": "Cold Channel", "tags": { "water": true } },
//       "B": { "template": "building", "building_type": "store",
//               "name_pool": ["The Stacked Deck", "Nine Lives Salvage"],
//               "interior": { "lobby_name": "{name} — Ground Floor" } }
//     }
//   }
// Space = no zone. Name patterns accept {x} {y} {block} ({block} = y·100+x) and,
// inside interior.lobby_name, {name} = the building's name.
//
// Idempotency / hand-edit safety (re-running a blueprint on a grown map):
//   • upsert by deterministic id — same grid cell, same zone id, always
//   • always reasserted: map_id + grid coords, planner-drawn exits where BOTH
//     ends are planner-owned (hand-wired exits and exits to foreign zones are
//     merged in, never removed; zone_exit_overrides live elsewhere untouched)
//   • description rewritten only while it still starts with the [PLANNER STUB]
//     sentinel — hand-written prose is never clobbered
//   • name/colors/theme/tags reasserted only with --force
//   • a colliding zone NOT owned by this blueprint is skipped with a warning
//   • deleting a glyph never deletes a zone (dry-run lists the orphans;
//     deletion stays a human act via the dev panel / content files)
import { readFileSync } from 'node:fs';
import { query } from '../../server/models/db.js';
import { validateTags } from '../../server/engine/tags.js';

const args = process.argv.slice(2);
const bpPath = args.find(a => !a.startsWith('--'));
const APPLY = args.includes('--apply');
const FORCE = args.includes('--force');
// The District Editor passes this on every export: connect only neighbouring
// NON-building tiles, and never re-materialise a building tile that's linked to
// an existing real building (its street↔building links are wired by hand). CLI
// runs without the flag keep the original facade-adjacency behaviour.
const MANUAL_BLD = args.includes('--manual-building-exits');
if (!bpPath) { console.error('Usage: node tools/zone-planner/apply.mjs <blueprint.bp.json> [--apply] [--force]'); process.exit(1); }

const bp = JSON.parse(readFileSync(bpPath, 'utf8'));
// Two authoring formats reach the same internal `cells` model:
//   • v1 (ASCII): { grid: ["#.B"], legend: { "#": {...} } } — one char per cell.
//   • v2 (painter): { palette: { "ST": {...} }, cells: [[{t,bg,fg}|null]] } —
//     multi-char keys + per-cell bg/fg colour overrides (the paint editor writes this).
const IS_V2 = !!(bp.palette && bp.cells);
for (const k of ['id', 'map', 'origin', 'id_prefix', ...(IS_V2 ? ['palette', 'cells'] : ['grid', 'legend'])]) {
  if (!bp[k]) { console.error(`Blueprint missing "${k}"`); process.exit(1); }
}
const SENTINEL = '[PLANNER STUB]';
const zid = (x, y) => `zone_${bp.id_prefix}_${x}_${y}`;
const fillName = (pattern, x, y, name) => String(pattern || '')
  .replaceAll('{x}', x).replaceAll('{y}', y)
  .replaceAll('{block}', y * 100 + x)
  .replaceAll('{name}', name || '');

// ── Parse into cells ─────────────────────────────────────────────────────────
// Both formats normalize to a "x,y" -> { x, y, glyph, leg } map, where `leg`
// carries the same fields the planner reads (template/name/tags/interior/marker/
// color/bg_color/...). v2 folds per-cell colour overrides into that leg.
const cells = new Map();
if (IS_V2) {
  bp.cells.forEach((row, ry) => {
    (row || []).forEach((cell, rx) => {
      if (!cell || !cell.t) return; // null / empty = no zone (the v1 space)
      const pal = bp.palette[cell.t];
      if (!pal) { console.error(`Cell (${rx},${ry}) references palette key "${cell.t}" with no palette entry`); process.exit(1); }
      // Palette entry defines the type; the cell may override just its colours.
      const leg = {
        ...pal,
        color: cell.fg ?? pal.color ?? null,
        bg_color: cell.bg ?? pal.bg_color ?? pal.bg ?? null,
      };
      const x = bp.origin.x + rx, y = bp.origin.y + ry;
      cells.set(`${x},${y}`, { x, y, glyph: cell.t, leg, link: cell.link || null });
    });
  });
} else {
  bp.grid.forEach((row, ry) => {
    [...row].forEach((glyph, rx) => {
      if (glyph === ' ') return;
      const leg = bp.legend[glyph];
      if (!leg) { console.error(`Grid glyph "${glyph}" at (${rx},${ry}) has no legend entry`); process.exit(1); }
      const x = bp.origin.x + rx, y = bp.origin.y + ry;
      cells.set(`${x},${y}`, { x, y, glyph, leg });
    });
  });
}
const at = (x, y) => cells.get(`${x},${y}`);
const ORTHO = [['north', 0, -1], ['south', 0, 1], ['east', 1, 0], ['west', -1, 0]];
// Building classification, kept in sync with editor.html: a tile is a building
// iff its palette entry has an interior AND its type isn't a declared terrain
// type (SH = future-residential terrain). A linked building tile is a
// placeholder for an existing real building — it is never materialised.
const NON_BUILDING_TYPES = new Set(['SH']);
const isBuildingCell = (cell) => !!cell && !!cell.leg.interior && !NON_BUILDING_TYPES.has(cell.glyph);
// Hangar tiles connect to the runway on their east side, not to a road (see the
// second-pass connect). Keyed by palette type, like NON_BUILDING_TYPES.
const HANGAR_TYPES = new Set(['Hangar']);

// Default terrain prose, keyed by tile "kind" (template, or residential_street
// for SH). Each tile of a type deterministically picks one name+description by
// its coords, so a run of streets doesn't read identically. A palette entry's
// own name_pool / desc_pool overrides this. Names accept {x}{y}{block} tokens.
const TERRAIN_PROSE = {
  street: {
    names: ['{block} Block', 'Gravel Track — {block} Block', 'The {block} Road'],
    descs: [
      'A wide run of packed gravel and grit, graded flat by traffic and rain into something almost like a road. Puddles stand in the ruts, skinned with a chemical sheen. Nothing grows in the margins.',
      'Loose stone crunches underfoot, greyed with dust and old oil. A dead streetlight leans at the verge, and the wind carries grit that finds your teeth. Tyre tracks braid off into the haze.',
      'The road here is more suggestion than surface — compacted gravel, broken kerbstones, a storm drain choked with silt. Somebody dragged a mattress halfway across it and gave up.',
    ],
  },
  alley: {
    names: ['Back Alley', 'Service Cut', 'The Gap'],
    descs: [
      'A knife-thin gap between two buildings, floored with grease and old rain. Dumpsters hunch in the dark like they are waiting for something. Probably you.',
      'Fire escapes claw down both walls, none of them bolted to anything you would trust. The far end is a wall of trash bags and worse decisions.',
      'Narrow enough to touch both walls, dark enough that you would rather not. A single bulb buzzes overhead, throwing shadows that do not quite match what is casting them.',
    ],
  },
  water: {
    // Water is impassable — the player only ever wades the shoreline edge, so a
    // single description is enough.
    names: ['Shoreline Shallows'],
    descs: [
      'Cold water closes around your legs at the shoreline, the bottom shelving away fast into lightless murk. This is as far as you go on foot — the channel beyond is deep, and impassable without a boat.',
    ],
  },
  runway: {
    names: ['Runway Asphalt', 'The Apron', 'Taxiway'],
    descs: [
      'A broad grey ribbon of cracked asphalt, its painted centreline dwindling to a pale seam in the heat-shimmer. Weeds push up through the expansion joints. A windsock hangs limp at the far edge.',
      'Open apron stretching flat in every direction, tie-down rings rusted into the concrete. The wind has nothing to break it here and comes at you sideways, carrying grit and the ghost of jet fuel.',
      'Faded taxiway markings run off toward the hangars, the paint scoured to suggestion. Rubber scuffs and oil stains map decades of landings; somewhere a loose panel ticks against its frame in the wind.',
    ],
  },
  plaza: {
    names: ['{block} Plaza', 'The Concourse', 'Dead Fountain Square'],
    descs: [
      'An open square meant to feel civic that now just feels exposed. The fountain has been dry so long it is furniture. Pigeons hold the high ground.',
      'Cracked paving stones fan out around a monument to someone nobody remembers. The benches are all bolted flat so you cannot sleep on them. People do anyway.',
      'A wide flat nothing of a space, ringed by shuttered kiosks. Wind funnels through and lifts the trash into brief, hopeful little cyclones before dropping it again.',
    ],
  },
  residential_street: {
    descs: [
      'Stacked living units marketed as "affordable modular habitation" — landlord for a concrete drawer you rent by the month, utilities extra, dignity not included. Someone\'s AC unit drips onto someone else\'s only window. The whole block breathes through one wheezing vent.',
      'A residential stack optimised for maximum tenants per cubic metre and the bare legal minimum of reasons to keep living. Corridors of identical doors, behind each a life the city quietly stopped counting. A cat holds the stairwell; nobody contests the claim.',
      'Home sweet subsidised home: prefab housing the colour of wet cardboard, balconies caged against jumpers and pigeons with equal indifference. A billboard over the roofline promises a better unit uptown. Nobody here has ever seen uptown.',
    ],
  },
  runway_ns: {
    descs: [
      'A strip of runway asphalt split down the middle by a hard yellow centreline running dead straight north to south. The paint is fresh enough to catch the light; tyre rubber smears black on either side of it.',
      'The north–south centreline halves the tarmac, yellow and unmistakable. Follow it with your eye and the runway runs away at both ends toward thresholds lost in the heat-shimmer.',
      'Yellow runway markings stripe the asphalt north to south, guiding nothing anymore but obeyed out of habit. The line is chipped to dashes where wheels have hammered it for decades.',
    ],
  },
  pier: {
    descs: [
      'A length of the great pier, its planking grey and split, bolted over a forest of barnacled pilings that vanish into the cold slop below. Mooring cleats the size of anvils stud the edge, most wrenched half out. The whole structure groans when the water shoves it.',
      'Weathered decking stretches out over the water, wide enough to land a truck, scarred with the drag-marks of cargo that hasn\'t come through in years. A bollard leans drunkenly at the lip; gulls the size of dogs watch you from the rail and do not move.',
      'Part of the long pier reaching out into the channel — corrugated loading sheds, a rusted crane frozen mid-swing, rope thick as your arm coiled and rotting in the salt air. Below the boards, the water works at the pilings with the patience of something that has all the time in the world.',
    ],
  },
  grass: {
    descs: [
      'A stretch of hardy, knee-high grass gone silver-green and gnawed short by whatever still grazes out here. The wind moves through it in long slow waves. Something rustles, then goes very still.',
      'Open grassland quietly reclaiming old ground — seedheads nodding over the buried kerb of a road that used to matter. Insects drone. The horizon wobbles in the heat.',
      'Rough pasture, tussocked and uneven, dotted with the grey bones of dead machinery the green has decided to keep. It smells, improbably, alive.',
    ],
  },
};
// Resolve a tile to its prose kind. Specific palette KEYS win (SH = residential
// street, "Hangar 2" = the airport's runway asphalt); road/gravel templates fold
// into the street (road) prose; otherwise the template names the kind.
const KIND_BY_TYPE = { 'SH': 'residential_street', 'Hangar 2': 'runway', 'Runway NS': 'runway_ns', 'Grass': 'grass', 'DK': 'pier' };
const terrainKind = (c) => KIND_BY_TYPE[c.glyph]
  || (['road', 'gravel'].includes(c.leg.template) ? 'street' : (c.leg.template || 'zone'));

// Canonical terrain names — non-street terrain is named for WHAT IT IS (every
// grass tile is Grasslands), same name on every tile of the kind, unique ids,
// varied descriptions. Kinds not listed fall back to the palette label (so plaza
// landmarks keep their given name, e.g. "Embassy Hotel").
const TERRAIN_NAME = {
  water: 'Cold Channel', runway: 'Runway', runway_ns: 'Runway',
  grass: 'Grasslands', alley: 'Back Alley', residential_street: 'Residential Area', pier: 'Pier',
};

// Realistic street names, assigned to each road as it's laid out. A "road" is a
// path traced through the road network: it keeps one name along its length,
// bending as needed and running STRAIGHT THROUGH junctions, and only ends where
// it branches — each branch is a separate road (min 5 tiles; shorter stubs take
// an adjacent road's name). A tile where two roads meet shows both names
// ("Ironside Street + James Boulevard"). A road that runs into an existing named
// artery inherits that artery's name and membership instead of a fresh one, so
// the new district joins the real street grid. Roads = terrainKind 'street' only.
const STREET_NAMES = [
  'Ironside Street', 'Halcyon Boulevard', 'Cinder Lane', 'Meltwater Row', 'Kessler Street',
  'Voss Avenue', 'Marrow Street', 'Foundry Way', 'Cathode Street', 'Battery Row',
  'Ashfall Boulevard', 'Rime Lane', 'Sluice Way', 'Gantry Street', 'Prefect Avenue',
  'Ferrin Lane', 'Wren Boulevard', 'Culvert Row', 'Reach Street', 'Drum Lane',
  'Slag Road', 'Coldwater Boulevard', 'Meridian Avenue', 'James Boulevard',
];
const STREET_MIN_LEN = 5;
function computeStreetNames(extArtery) {
  const K = (c) => `${c.x},${c.y}`;
  const isStreet = (c) => c && !isBuildingCell(c) && terrainKind(c) === 'street';
  const roads = [...cells.values()].filter(isStreet);
  const roadSet = new Set(roads.map(K));
  const nbrs = (c) => ORTHO.map(([, dx, dy]) => at(c.x + dx, c.y + dy)).filter(n => n && roadSet.has(K(n)));
  // Continue a road through `cur` (arrived from `prev`): go straight if we can,
  // else follow the single turn at a degree-2 bend; a junction with no straight
  // continuation ends the road (its other arms become separate roads).
  const cont = (prev, cur) => {
    const dx = Math.sign(cur.x - prev.x), dy = Math.sign(cur.y - prev.y);
    const cands = nbrs(cur).filter(n => !(n.x === prev.x && n.y === prev.y));
    return cands.find(n => Math.sign(n.x - cur.x) === dx && Math.sign(n.y - cur.y) === dy)
      || (cands.length === 1 ? cands[0] : null);
  };
  const used = new Set();
  const mark = (a, b) => { used.add(`${K(a)}>${K(b)}`); used.add(`${K(b)}>${K(a)}`); };
  const chain = (prev, cur) => {
    const out = [];
    for (;;) {
      const nx = cont(prev, cur);
      if (!nx || used.has(`${K(cur)}>${K(nx)}`)) break;
      mark(cur, nx); out.push(nx); prev = cur; cur = nx;
    }
    return out;
  };
  // Trace each road as a maximal straight-through polyline (bends followed,
  // junctions crossed straight, branches split off as their own polyline).
  const segments = [];
  for (const a of roads) for (const b of nbrs(a)) {
    if (used.has(`${K(a)}>${K(b)}`)) continue;
    mark(a, b);
    const fwd = chain(a, b), bwd = chain(b, a);
    segments.push([...bwd.reverse(), a, b, ...fwd]);
  }
  const inSeg = new Set(segments.flat().map(K));
  for (const c of roads) if (!inSeg.has(K(c))) segments.push([c]); // lone tiles

  // Name roads ≥ STREET_MIN_LEN, in a stable order so re-exports don't rename.
  const anchor = (s) => Math.min(...s.map(t => t.y * 100000 + t.x));
  const long = segments.filter(s => s.length >= STREET_MIN_LEN).sort((a, b) => anchor(a) - anchor(b));
  const short = segments.filter(s => s.length < STREET_MIN_LEN);
  // Existing arteries this segment runs into, from OUTSIDE the district.
  const arteriesNear = (s) => {
    const set = new Set();
    for (const t of s) for (const [, dx, dy] of ORTHO) {
      const a = extArtery.get(`${t.x + dx},${t.y + dy}`);
      if (a) for (const nm of a) set.add(nm);
    }
    return [...set];
  };
  let idx = 0;
  const arteryNames = new Set(); // names inherited from a real artery
  const tileNames = new Map();
  const add = (k, nm) => (tileNames.get(k) || tileNames.set(k, new Set()).get(k)).add(nm);
  for (const s of long) {
    const near = arteriesNear(s);
    // Runs into exactly one existing artery → inherit its name (continuity).
    // Touches none, or several (a cross-street) → a fresh name from the list.
    let nm;
    if (near.length === 1) { nm = near[0]; arteryNames.add(nm); }
    else nm = STREET_NAMES[idx++ % STREET_NAMES.length];
    for (const t of s) add(K(t), nm);
  }
  // Short stubs take an adjacent named road's name; if none, they get their own.
  for (const s of short) {
    let nm = null;
    for (const t of s) { const set = tileNames.get(K(t)); if (set) { nm = [...set].sort()[0]; break; } }
    nm = nm || STREET_NAMES[idx++ % STREET_NAMES.length];
    for (const t of s) if (!tileNames.has(K(t))) add(K(t), nm);
  }
  // Each tile: the joined name(s), plus an `artery` list for any name inherited
  // from a real artery (a crossing/branch shows both names).
  const names = new Map();
  for (const c of roads) {
    const set = tileNames.get(K(c));
    if (!set) { names.set(K(c), { name: 'Unnamed Road', artery: null }); continue; }
    const arr = [...set].sort();
    const art = arr.filter(n => arteryNames.has(n));
    names.set(K(c), { name: arr.join(' + '), artery: art.length ? art : null });
  }
  return names;
}

// ── Build the desired zone set ───────────────────────────────────────────────
const plan = []; // { id, row: {...zone columns}, kind, ownExits: {dir: id} }
let poolCursor = new Map(); // glyph -> next name_pool index
// Existing named arteries on this map — a district road that runs into one
// inherits its name (and artery membership) so the street grid stays continuous.
const { rows: arteryRows } = await query(
  `SELECT grid_x, grid_y, flags->'artery' AS artery FROM zones
   WHERE map_id = $1 AND grid_z = $2 AND flags->'artery' IS NOT NULL`,
  [bp.map, bp.origin.z ?? 0]);
const extArtery = new Map(); // "x,y" -> [artery names]
for (const r of arteryRows) {
  let a = r.artery;
  if (typeof a === 'string') { try { a = JSON.parse(a); } catch { a = null; } }
  if (Array.isArray(a) && a.length) extArtery.set(`${r.grid_x},${r.grid_y}`, a);
}
const streetNames = computeStreetNames(extArtery); // "x,y" -> { name, artery }
// Linked building zones (the existing buildings that tiles point to) — for the
// on-map facade marker's name and to spot hangars in the second pass.
const buildLinkIds = [...new Set([...cells.values()].filter(c => c.link).map(c => c.link))];
const linkInfo = new Map(); // id -> { name, hangar }
if (buildLinkIds.length) {
  const { rows: linkRows } = await query('SELECT id, name, flags, exits, map_id FROM zones WHERE id = ANY($1::text[])', [buildLinkIds]);
  for (const r of linkRows) {
    const fl = r.flags || {};
    linkInfo.set(r.id, { name: fl.building_name || r.name || r.id, hangar: !!(fl.hangar_interior || fl.building_type === 'hangar'),
                         exits: r.exits || {}, flags: fl, mapId: r.map_id });
  }
}
const hangarLinks = new Set([...linkInfo].filter(([, v]) => v.hangar).map(([id]) => id));
// Two-letter map label from a building name (Embassy Hotel & Bar → EH).
const initials = (s) => {
  const base = String(s || '').split('—')[0].trim();
  const words = base.split(/\s+/).filter(w => /[a-z0-9]/i.test(w));
  return (words.length <= 1 ? base.replace(/[^a-z0-9]/gi, '').slice(0, 2)
    : words.map(w => w.match(/[a-z0-9]/i)[0]).join('').slice(0, 2)).toUpperCase();
};
// Road connectivity SVG: which orthogonal neighbours are also road tiles picks
// the matching connect-icon (road_ns straight, road_nes T, road_nesw cross, …),
// so adjacent road tiles render as one continuous network on the minimap.
const isStreetTile = (t) => !!t && !isBuildingCell(t) && terrainKind(t) === 'street';
// Water is impassable for now — no exits are wired to or from it.
const isWaterTile = (t) => !!t && terrainKind(t) === 'water';
const roadIcon = (c) => {
  let m = 0;
  if (isStreetTile(at(c.x, c.y - 1))) m |= 1;
  if (isStreetTile(at(c.x + 1, c.y))) m |= 2;
  if (isStreetTile(at(c.x, c.y + 1))) m |= 4;
  if (isStreetTile(at(c.x - 1, c.y))) m |= 8;
  const d = []; if (m & 1) d.push('n'); if (m & 2) d.push('e'); if (m & 4) d.push('s'); if (m & 8) d.push('w');
  return d.length ? 'road_' + d.join('') : 'road_x';
};
for (const c of cells.values()) {
  const isBuilding = isBuildingCell(c);
  const id = zid(c.x, c.y);
  // Adjacency exits — a two-way exit to each orthogonal neighbour; with
  // --manual-building-exits, buildings are left out of the auto-mesh entirely
  // (their street links are wired by the second pass / by hand).
  const ownExits = {};
  for (const [dir, dx, dy] of ORTHO) {
    const n = at(c.x + dx, c.y + dy);
    if (!n) continue;
    if (MANUAL_BLD && isBuildingCell(n)) continue;
    if (isWaterTile(c) || isWaterTile(n)) continue; // water impassable — no exits to/from it
    ownExits[dir] = zid(n.x, n.y);
  }
  if (!isBuilding) {
    // Terrain prose: a per-tile pick (by coords) from the type's own name_pool /
    // desc_pool, else the built-in library for its kind (SH → residential
    // street), so tiles of one type vary. Falls back to the single name + stub.
    const kind = terrainKind(c);
    const lib = TERRAIN_PROSE[kind];
    const descOpts = c.leg.desc_pool?.length ? c.leg.desc_pool : lib?.descs;
    const pick = (arr) => arr[((c.x * 31 + c.y * 17) % arr.length + arr.length) % arr.length];
    // Roads take their street name (shared per street; both names at a crossing);
    // other terrain is named for what it is (Grasslands, Cold Channel, Runway…),
    // else the palette label so plaza landmarks keep their given name.
    const sinfo = kind === 'street' ? streetNames.get(`${c.x},${c.y}`) : null;
    const name = kind === 'street'
      ? (sinfo?.name || 'Unnamed Road')
      : (TERRAIN_NAME[kind] || c.leg.label || c.leg.template || `Zone ${c.x},${c.y}`);
    const description = descOpts?.length
      ? pick(descOpts) // varied authored prose (no SENTINEL) — re-runs won't clobber it
      : `${SENTINEL} ${name} — a ${c.leg.template || 'place'} awaiting its prose.`;
    // Runway tiles get a real, queryable identity: an orientation flag so the flight
    // sim can find the strip and align its drawn runway to the actual yellow tiles,
    // plus the dashed-centreline icon (NS legend = vertical). Plain runway asphalt
    // (Hangar 2 → 'runway') is the surrounding pad — flagged, but no centreline icon.
    const rwFlags = kind === 'runway_ns' ? { runway: 'ns' } : kind === 'runway' ? { runway: 'pad' } : null;
    const ico = kind === 'street' ? roadIcon(c) // roads → connect-SVG
      : kind === 'runway_ns' ? 'runway_ns'      // centreline SVG
      : (c.leg.icon || null);
    plan.push({
      id, kind: c.leg.template || 'zone', ownExits,
      row: {
        id, name, description,
        map_id: bp.map, grid_x: c.x, grid_y: c.y, grid_z: bp.origin.z ?? 0,
        marker: c.leg.marker ?? null, color: c.leg.color ?? null, bg_color: c.leg.bg_color ?? null,
        ambient_theme: c.leg.ambient_theme || 'city',
        flags: { ...(c.leg.tags || {}), ...(rwFlags || {}), ...(ico ? { icon: ico } : {}), planner: bp.id,
                 ...(sinfo?.artery ? { artery: sinfo.artery } : {}) },
        parent_zone: null,
      },
    });
    continue;
  }
  // Building tile ⇒ an on-map facade marker (non-standable). Front door = the
  // first non-building neighbour the facade spills OUT onto (preferring south).
  const streetNeighbor = [['south', 0, 1], ['north', 0, -1], ['west', -1, 0], ['east', 1, 0]]
    .map(([, dx, dy]) => at(c.x + dx, c.y + dy)).find(n => n && !isBuildingCell(n));
  const streetId = streetNeighbor ? zid(streetNeighbor.x, streetNeighbor.y) : null;
  const linked = c.link ? (linkInfo.get(c.link) || { name: c.link }) : null;
  if (linked) {
    // LINKED: a labelled marker forwarding `in` to the EXISTING interior — no new
    // interior/lobby (never a duplicate). Marker = the tile's code, else initials.
    const bName = linked.name;
    const abbr = (c.code ? String(c.code).trim().toUpperCase() : initials(bName)).slice(0, 2);
    plan.push({
      id, kind: 'facade', ownExits: MANUAL_BLD ? { in: c.link } : { ...ownExits, in: c.link },
      row: {
        id, name: bName,
        description: `${SENTINEL} The face of ${bName}.`,
        map_id: bp.map, grid_x: c.x, grid_y: c.y, grid_z: bp.origin.z ?? 0,
        marker: abbr, color: c.leg.color ?? null, bg_color: c.leg.bg_color ?? null,
        ambient_theme: 'indoors',
        flags: { is_building: true, facade: true, building_name: bName,
                 ...(streetId ? { world_exit_zone: streetId } : {}), planner: bp.id },
        parent_zone: null,
      },
    });
    continue;
  }
  // UNLINKED: a brand-new building ⇒ facade + interior map + lobby.
  if (!streetId) { console.error(`Building at (${c.x},${c.y}) has no adjacent street cell — a facade needs a front door.`); process.exit(1); }
  const cursor = poolCursor.get(c.glyph) || 0;
  poolCursor.set(c.glyph, cursor + 1);
  const bName = (c.leg.name_pool || [])[cursor] || fillName(c.leg.name, c.x, c.y) || `Building ${c.x},${c.y}`;
  const abbr = (c.code ? String(c.code).trim().toUpperCase() : initials(bName)).slice(0, 2);
  const lobbyId = `${id}_lobby`;
  const mapId = `map_int_${id}`;
  plan.push({
    id, kind: 'facade', ownExits: MANUAL_BLD ? { in: lobbyId } : { ...ownExits, in: lobbyId },
    interiorMap: { id: mapId, name: `${bName} — Interior`, parent_zone_id: id, entry_zone_id: lobbyId },
    row: {
      id, name: bName,
      description: `${SENTINEL} The face of ${bName}.`,
      map_id: bp.map, grid_x: c.x, grid_y: c.y, grid_z: bp.origin.z ?? 0,
      marker: c.leg.marker ?? abbr, color: c.leg.color ?? null, bg_color: c.leg.bg_color ?? null,
      ambient_theme: c.leg.ambient_theme || 'indoors',
      flags: { ...(c.leg.tags || {}), ...(c.leg.icon ? { icon: c.leg.icon } : {}),
               is_building: true, facade: true, building_name: bName,
               ...(c.leg.building_type ? { building_type: c.leg.building_type } : {}),
               world_exit_zone: streetId, planner: bp.id },
      parent_zone: null,
    },
  });
  const lobbyName = fillName(c.leg.interior.lobby_name || '{name} — Ground Floor', c.x, c.y, bName);
  plan.push({
    id: lobbyId, kind: 'lobby', ownExits: { out: id },
    row: {
      id: lobbyId, name: lobbyName,
      description: `${SENTINEL} Inside ${bName} — a ground floor awaiting its prose.`,
      map_id: mapId, grid_x: 0, grid_y: 0, grid_z: 0,
      marker: null, color: null, bg_color: null,
      ambient_theme: 'indoors',
      flags: { is_interior: true, world_exit_zone: streetId, planner: bp.id },
      parent_zone: id,
    },
  });
}

// Second pass: hook each building to its nearest street tile — once. The first
// pass wires terrain↔terrain only; this adds a single one-way street→building
// exit per building (the building's own egress already exists — a linked one on
// the real map, an unlinked one via its facade). Editor exports only.
if (MANUAL_BLD) {
  const isRunway = (c) => c && !isBuildingCell(c) && (terrainKind(c) === 'runway' || terrainKind(c) === 'runway_ns');
  const streetCells = [...cells.values()].filter(c => !isBuildingCell(c) && terrainKind(c) === 'street');
  const streetPool = streetCells.length ? streetCells : [...cells.values()].filter(c => !isBuildingCell(c));
  const planById = new Map(plan.map(p => [p.id, p]));
  // A hangar connects to the runway, not a street (hangarLinks computed up top —
  // catches hangars placed from the bucket as generic BLD tiles too).
  const isHangarCell = (c) => HANGAR_TYPES.has(c.glyph) || (!!c.link && hangarLinks.has(c.link));
  // Cardinals from `from` toward `to`, dominant axis first.
  const dirsToward = (from, to) => {
    const dx = to.x - from.x, dy = to.y - from.y;
    const h = dx > 0 ? 'east' : dx < 0 ? 'west' : null;
    const v = dy > 0 ? 'south' : dy < 0 ? 'north' : null;
    return Math.abs(dx) >= Math.abs(dy) ? [h, v] : [v, h];
  };
  // Add one exit on `fromCell`'s zone toward `target`, in the first free cardinal.
  const wire = (fromCell, target, toCell) => {
    const fp = planById.get(zid(fromCell.x, fromCell.y));
    if (!fp) return false;
    const dir = dirsToward(fromCell, toCell).find(d => d && !fp.ownExits[d]);
    if (!dir) return false;
    fp.ownExits[dir] = target;
    return true;
  };
  let connected = 0;
  for (const c of cells.values()) {
    if (!isBuildingCell(c)) continue;
    const target = zid(c.x, c.y); // the on-map facade
    const facadePlan = planById.get(target);
    let street = null; // the district tile the facade fronts (for enter + egress)
    if (isHangarCell(c)) {
      // Hangars open onto the runway on their EAST end.
      let rw = null;
      for (let x = c.x + 1; ; x++) { const t = at(x, c.y); if (!t || isBuildingCell(t)) break; if (isRunway(t)) { rw = t; break; } }
      if (rw && wire(rw, target, c)) { connected++; street = zid(rw.x, rw.y); }
    } else {
      // Everything else: nearest street tile (Manhattan).
      let best = null, bestD = Infinity;
      for (const s of streetPool) { const d = Math.abs(s.x - c.x) + Math.abs(s.y - c.y); if (d < bestD) { bestD = d; best = s; } }
      if (best && wire(best, target, c)) { connected++; street = zid(best.x, best.y); }
    }
    // Ensure the facade has an egress street (prefer the adjacent one set in the
    // main loop; else the street the second pass just connected).
    if (facadePlan && street && !facadePlan.row.flags.world_exit_zone) facadePlan.row.flags.world_exit_zone = street;
  }
  if (connected) console.log(`  second pass: auto-connected ${connected} building(s) (hangars → runway east, others → nearest street)`);
}

// Validate every flags bag before touching anything. UNKNOWN tags (not in the
// catalog, e.g. a stray `dock`) are stripped with a warning rather than failing
// the whole export — a decorative tag shouldn't block a map. A bad SHAPE on a
// known tag stays fatal: that's a real structural error.
const strippedTags = new Set();
for (const p of plan) {
  const v = validateTags(p.row.flags);
  if (v.ok) continue;
  if (v.badShape.length) { console.error(`${p.id}: flags fail catalog validation — bad shapes: ${v.badShape.join('; ')}`); process.exit(1); }
  for (const k of v.unknown) { delete p.row.flags[k]; strippedTags.add(k); }
}
if (strippedTags.size) console.log(`  ⚠ stripped ${strippedTags.size} unknown tag(s) not in the catalog: ${[...strippedTags].join(', ')}`);

// ── Relocate linked buildings into the district (redirect + sever) ───────────
// Each building's interior map is repointed to sit behind its district facade,
// the interior's `out` is redirected into that facade, and the OLD exterior's
// door to the interior is severed — so the building lives in the district, not
// its old spot. Editor exports only; foreign-zone edits, so every one is logged.
const relocations = [];
let exteriorSevers = [];
if (MANUAL_BLD) {
  const facadeWxz = new Map(plan.filter(p => p.kind === 'facade').map(p => [p.id, p.row.flags.world_exit_zone || null]));
  const oldExtIds = new Set();
  for (const c of cells.values()) {
    if (!isBuildingCell(c) || !c.link) continue;
    const facadeId = zid(c.x, c.y), info = linkInfo.get(c.link);
    if (!info) continue;
    const ex = info.exits || {};
    const oldExt = ex.out || info.flags?.world_exit_zone || null;
    if (!oldExt || oldExt === facadeId) continue; // no exterior, or already relocated
    relocations.push({
      interiorId: c.link, mapId: info.mapId, facadeId, oldExt,
      frontStreet: facadeWxz.get(facadeId) || null,
      newExits: { ...ex, out: facadeId },
      newFlags: info.flags?.world_exit_zone ? { ...info.flags, world_exit_zone: facadeId } : (info.flags || {}),
    });
    oldExtIds.add(oldExt);
  }
  const relocated = new Set(relocations.map(r => r.interiorId));
  if (oldExtIds.size) {
    const { rows: extRows } = await query('SELECT id, exits FROM zones WHERE id = ANY($1::text[])', [[...oldExtIds]]);
    for (const r of extRows) {
      const kept = {}, removed = [];
      for (const [dir, tgt] of Object.entries(r.exits || {})) {
        const arr = Array.isArray(tgt) ? tgt : [tgt];
        const keep = arr.filter(t => !relocated.has(t));
        if (keep.length) kept[dir] = keep.length === 1 ? keep[0] : keep;
        if (keep.length !== arr.length) removed.push(dir);
      }
      if (removed.length) exteriorSevers.push({ id: r.id, newExits: kept, removed });
    }
  }
}

// ── Diff against the DB ──────────────────────────────────────────────────────
const planIds = plan.map(p => p.id);
const { rows: existingRows } = await query('SELECT * FROM zones WHERE id = ANY($1::text[])', [planIds]);
const existing = new Map(existingRows.map(r => [r.id, r]));
const { rows: orphanRows } = await query(
  `SELECT id FROM zones WHERE flags->>'planner' = $1 AND NOT (id = ANY($2::text[]))`, [bp.id, planIds]);

const creates = [], updates = [], skips = [];
for (const p of plan) {
  const cur = existing.get(p.id);
  if (!cur) { creates.push(p); continue; }
  if (cur.flags?.planner !== bp.id && !FORCE) { skips.push(p.id); continue; }
  updates.push(p);
}

console.log(`Blueprint ${bp.id} → ${bp.map} @ (${bp.origin.x},${bp.origin.y},${bp.origin.z ?? 0})`);
console.log(`  cells: ${cells.size}  zones planned: ${plan.length} (${plan.filter(p => p.kind === 'facade').length} building markers)`);
console.log(`  create: ${creates.length}   update (planner-owned): ${updates.length}   skip (foreign id collision): ${skips.length}`);
skips.forEach(id => console.log(`    ⚠ SKIP ${id} — exists and is not owned by this blueprint (use --force to take it over)`));
orphanRows.forEach(r => console.log(`    ⚠ ORPHAN ${r.id} — owned by this blueprint but no longer in the grid (delete by hand if unwanted)`));
if (relocations.length) {
  console.log(`  RELOCATE: ${relocations.length} building(s) moved into the district; ${exteriorSevers.length} old exterior(s) severed:`);
  relocations.forEach(r => console.log(`    ⇢ ${r.interiorId}  interior out→${r.facadeId}, map parent→facade, exit→${r.frontStreet || '⚠ NONE (would strand on exit)'}   (was at ${r.oldExt})`));
  exteriorSevers.forEach(s => console.log(`    ✂ ${s.id}  severed exit(s): ${s.removed.join(', ')}`));
}
if (!APPLY) { console.log('\n[dry-run] nothing written. Re-run with --apply.'); process.exit(0); }

// ── Write ────────────────────────────────────────────────────────────────────
for (const p of creates) {
  const r = p.row;
  await query(
    `INSERT INTO zones (id,name,description,exits,ambient_events,ambient_theme,flags,created_by,map_id,grid_x,grid_y,grid_z,marker,color,bg_color,parent_zone)
     VALUES ($1,$2,$3,$4,'[]',$5,$6,'zone-planner',$7,$8,$9,$10,$11,$12,$13,$14)`,
    [r.id, r.name, r.description, JSON.stringify(p.ownExits), r.ambient_theme, JSON.stringify(r.flags),
     r.map_id, r.grid_x, r.grid_y, r.grid_z, r.marker, r.color, r.bg_color, r.parent_zone]);
}
const planOwned = new Set(planIds);
for (const p of updates) {
  const cur = existing.get(p.id);
  // Merge exits: reassert planner edges (both ends planner-owned), keep every
  // exit whose target isn't part of this blueprint (hand-wired connections).
  const mergedExits = {};
  for (const [dir, tgt] of Object.entries(cur.exits || {})) {
    const targets = (Array.isArray(tgt) ? tgt : [tgt]).filter(t => !planOwned.has(t));
    if (targets.length) mergedExits[dir] = targets.length === 1 ? targets[0] : targets;
  }
  for (const [dir, tgt] of Object.entries(p.ownExits)) {
    if (!mergedExits[dir]) mergedExits[dir] = tgt;
    else {
      const cur2 = Array.isArray(mergedExits[dir]) ? mergedExits[dir] : [mergedExits[dir]];
      if (!cur2.includes(tgt)) mergedExits[dir] = [...cur2, tgt];
    }
  }
  const keepDescription = !String(cur.description || '').startsWith(SENTINEL);
  if (FORCE) {
    const r = p.row;
    await query(
      `UPDATE zones SET name=$2, description=$3, exits=$4, ambient_theme=$5, flags=$6, map_id=$7,
              grid_x=$8, grid_y=$9, grid_z=$10, marker=$11, color=$12, bg_color=$13, parent_zone=$14 WHERE id=$1`,
      [r.id, r.name, keepDescription ? cur.description : r.description, JSON.stringify(mergedExits), r.ambient_theme,
       JSON.stringify({ ...cur.flags, ...r.flags }), r.map_id, r.grid_x, r.grid_y, r.grid_z, r.marker, r.color, r.bg_color, r.parent_zone]);
  } else {
    const r = p.row;
    await query(
      `UPDATE zones SET description=$2, exits=$3, map_id=$4, grid_x=$5, grid_y=$6, grid_z=$7 WHERE id=$1`,
      [r.id, keepDescription ? cur.description : r.description, JSON.stringify(mergedExits), r.map_id, r.grid_x, r.grid_y, r.grid_z]);
  }
}
// Interior map rows (idempotent upsert).
for (const p of plan) {
  if (!p.interiorMap) continue;
  const m = p.interiorMap;
  await query(
    `INSERT INTO maps (id, name, parent_zone_id, entry_zone_id, created_by) VALUES ($1,$2,$3,$4,'zone-planner')
     ON CONFLICT (id) DO UPDATE SET parent_zone_id=$3, entry_zone_id=$4`,
    [m.id, m.name, m.parent_zone_id, m.entry_zone_id]);
}
// Relocation: repoint each interior map behind its district facade, redirect the
// interior's exit into the facade, and sever the old exterior's door to it.
for (const r of relocations) {
  if (r.mapId) await query('UPDATE maps SET parent_zone_id = $2 WHERE id = $1', [r.mapId, r.facadeId]);
  await query('UPDATE zones SET exits = $2, flags = $3, parent_zone = $4 WHERE id = $1',
    [r.interiorId, JSON.stringify(r.newExits), JSON.stringify(r.newFlags), r.facadeId]);
}
for (const s of exteriorSevers) {
  await query('UPDATE zones SET exits = $2 WHERE id = $1', [s.id, JSON.stringify(s.newExits)]);
}
console.log(`\n✓ applied: ${creates.length} created, ${updates.length} updated, ${plan.filter(p => p.interiorMap).length} interior maps upserted.`);
if (relocations.length) console.log(`  relocated ${relocations.length} building(s) into the district, severed ${exteriorSevers.length} old exterior(s).`);
console.log('  Next: npm run content:export  → review the diff → commit. Restart a running local server to walk it.');
process.exit(0);
