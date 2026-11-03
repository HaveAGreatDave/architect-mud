// ONE-SHOT: the ground for the Coliseum at true size (docs/proposals/coliseum-true-size.md, phase 1).
//
//   node scripts/content/coliseum-ground.mjs [--write]
//
// The Curtain's west run moves from x 891 to the river bank at x 885, and its south run from y 919
// down four rows to y 923. The ground between becomes Halcyon Fields: the river road on x 886,
// Sorrel Way on y 921 with plots on y 922, the start of the new Halcyon Boulevard on y 909, and
// meadow everywhere else, which is where the park and the re-sited buildings go in later phases.
//
// THE SOUTH GATE MOVES WITH THE WALL (Dave, 2026-11-02). The gate, the South Lock and the whole
// Glacis round the Outer Lock move four rows south as one rigid piece, and keep their ids, so the
// NPCs, furniture, interiors, power rows and lock flags that name them follow without an edit. The
// ground they land on moves four rows north into the space they leave, so no tile is created or
// deleted: each column is a rotation. A connection with one end on a moved tile and the other off
// it is re-pointed at whatever now stands in that direction, which is how the lock's walls and the
// gate's own walls arrive on the right neighbours.
//
// After the moves: curtain walls that no longer sit on the frontier are deleted, the new frontier is
// walled the way mint-curtain-walls.mjs walls it (same ids, same name), and `exits` is rewritten from
// the projected graph for every tile in the window, because content:lint holds the two edge for edge.
//
// It refuses to run twice: once the gate stands at 911,923 there's nothing to do.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CONTENT_DIR, canonicalJson } from './lib.mjs';
import { CARDINAL, OPPOSITE, projectEdges } from './derive.mjs';

const WRITE = process.argv.includes('--write');
const ZD = path.join(CONTENT_DIR, 'zones');
const CD = path.join(CONTENT_DIR, 'connections');
const CURTAIN = "the Architect's Curtain";
const REGION = 'region_coldwater';

const readDir = (d) => fs.readdirSync(d).filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')));
const zones = readDir(ZD);
let conns = readDir(CD);
const byId = new Map(zones.map((z) => [z.id, z]));
const onWorld = (z) => z && z.map_id === 'map_world' && (z.grid_z ?? 0) === 0 && z.grid_x != null;
const cell = new Map();
const reindex = () => {
  cell.clear();
  for (const z of zones) if (onWorld(z)) cell.set(`${z.grid_x},${z.grid_y}`, z);
};
reindex();
const at = (x, y) => cell.get(`${x},${y}`);
const isWilds = (z) => z?.flags?.district === 'wilds';

// ── Refuse a second run ─────────────────────────────────────────────────────
if (at(911, 923)?.id === 'zone_district_911_919') {
  console.log('The South Gate already stands at 911,923; nothing to do.');
  process.exit(0);
}
const expect = (x, y, name) => {
  const z = at(x, y);
  if (z?.name !== name) throw new Error(`${x},${y} should be "${name}", is "${z?.name}" (${z?.id})`);
};
expect(911, 919, 'The South Gate');
expect(911, 917, 'The South Lock');
expect(911, 922, 'The Outer Lock');
expect(909, 921, 'The Glacis Weigh — Booth');
expect(913, 921, 'The Gate Post');

// ── 1. The gate moves four rows south ───────────────────────────────────────
// M: the gate and its works. D: the ground where they land, which moves up into the space they
// leave. Same columns, so each column is a rotation by four.
const SHIFT = 4;
const moved = [];   // [{ z, ox, oy }]
const M = [];
for (let y = 917; y <= 922; y++) M.push(at(911, y));
for (const x of [909, 910, 912, 913]) for (let y = 920; y <= 922; y++) M.push(at(x, y));
const D = [];
for (let y = 923; y <= 926; y++) D.push(at(911, y));
for (const x of [909, 910, 912, 913]) for (let y = 924; y <= 926; y++) D.push(at(x, y));
if ([...M, ...D].some((z) => !z)) throw new Error('a tile of the gate block is missing');
const setOf = new Map();
for (const z of M) setOf.set(z.id, 'M');
for (const z of D) setOf.set(z.id, 'D');
// On x 911 six tiles move south past four, so those four move north by six.
for (const z of M) { moved.push({ z, ox: z.grid_x, oy: z.grid_y }); z.grid_y += SHIFT; z._dirty = true; }
for (const z of D) { moved.push({ z, ox: z.grid_x, oy: z.grid_y }); z.grid_y -= z.grid_x === 911 ? 6 : SHIFT; z._dirty = true; }
reindex();

// Re-point connections across the edge of a moved piece.
const delta = Object.fromEntries(Object.entries(CARDINAL));
let repointed = 0;
for (const c of conns) {
  const a = byId.get(c.a), b = byId.get(c.b);
  if (!onWorld(a) || !onWorld(b) || !delta[c.dir]) continue;
  const sa = setOf.get(a.id), sb = setOf.get(b.id);
  if (!sa && !sb) continue;
  if (sa && sa === sb) continue;                     // both ends moved together
  // Re-point the end that didn't move with the other. When both moved, but in different pieces,
  // the moved piece the file was written about is the gate's, so M keeps its end.
  const keepA = sa === 'M' || (sa && !sb);
  if (keepA) {
    const [dx, dy] = delta[c.dir];
    const n = at(a.grid_x + dx, a.grid_y + dy);
    if (n && n.id !== c.b) { c.b = n.id; c._dirty = true; repointed++; }
  } else {
    const [dx, dy] = delta[OPPOSITE[c.dir]];
    const n = at(b.grid_x + dx, b.grid_y + dy);
    if (n && n.id !== c.a) { c.a = n.id; c._dirty = true; repointed++; }
  }
}

// ── 2. The new ground ───────────────────────────────────────────────────────
const tpl = (id) => structuredClone(byId.get(id));
const T = {
  wall: tpl('zone_district_891_912'),
  kettle: tpl('zone_district_899_917'),
  meltwater: tpl('zone_district_911_915'),
};
// A few of each, picked by tile, so no sentence lands on a hundred tiles (docs:prose).
const MEADOW_DESC = [
  'Open meadow at the edge of the estate, the grass long and silver-green. Survey stakes stand in it in rows, each one tied with a strip of orange tape.',
  'Long grass, gone to seed. A Halcyon board on two posts says the plot is sold, and a sticker under it says it\'s sold again.',
  'Meadow, mown once this year in a straight strip and then left. A surveyor\'s mark is sprayed on the ground in pink.',
  'Grass to the knee and a smell of cut hay from somewhere. Somebody has walked a path through it to the road and back.',
  'Open ground waiting for a building. The grass is flattened in a square where a site hut stood, and the square is still yellow.',
  'Rough meadow with a line of pegs across it. The string between them has gone, and the pegs lean.',
];
const RIVER_DESC = [
  'A two-lane road along the top of the river bank, kerbed on the town side. The Curtain hums along the far verge, and through it the river runs brown and quick.',
  'The river road, new tarmac with the white lines still bright. Through the Curtain on the west side the bank drops to the water.',
  'A straight run of road beside the Curtain. The hard light on the river side makes a low sound, like a fridge in another room.',
  'Fresh kerbs, a gutter and no pavement yet. Beyond the Curtain the river is close enough to hear.',
];
const SORREL_DESC = [
  'New road along the estate\'s south edge, the kerbs still pale. Lamp posts stand along it with no lamps in them yet.',
  'Sorrel Way, new tarmac and a long view down to the gate. The Curtain runs behind the plots on the south side.',
  'A wide new street with nothing much on it yet. Somebody has already parked across two of the bays.',
  'Freshly laid road, black and still soft at the edges in the sun. Plot numbers are stencilled on the kerb.',
];
const BOULEVARD_DESC = 'The new end of Halcyon Boulevard, graded gravel waiting for its tarmac. A row of young limes is planted along it, each one tied to a stake.';
const pick = (pool, x, y) => pool[((x * 7 + y * 13) % pool.length + pool.length) % pool.length];
const roadFlags = (district = 'halcyon_fields') => ({ district, region_id: REGION, scavenging_table_id: 'scav_roadside_junk', street_life: true, terrain: 'road' });

function become(z, { name, description, flags, theme = 'city', color = null }) {
  z.name = name;
  z.description = description;
  z.flags = flags;
  z.ambient_theme = theme;
  z.ambient_events = [];
  if (color) z.color = color; else delete z.color;
  delete z.bg_color;
  delete z.marker;
  z._dirty = true;
}
const WALL_WEST = [
  'Grass runs up to the Curtain and stops in a clean line. The wall of hard light hums, and the river shows through it, tinted blue.',
  'The edge of the estate. The Curtain stands a few feet off, floor to sky, and the far bank of the river is a blur behind it.',
  'Rough grass along the foot of the Curtain. Up close the hard light buzzes in your teeth. There\'s no way through but the South Gate.',
];
const WALL_SOUTH = [
  'Grass along the foot of the Curtain, the hard light humming a few feet off. The waste beyond it is red and flat to the hills.',
  'The back of the plots, where the estate stops at the Curtain. Through the light the Glacis road runs south, small and straight.',
  'Rough grass at the wall. The Curtain seals the edge here, floor to sky, and the only way through is the South Gate.',
];
const wallTile = (z) => become(z, {
  name: T.wall.name, theme: T.wall.ambient_theme, color: T.wall.color,
  description: pick(z.grid_x === 885 ? WALL_WEST : WALL_SOUTH, z.grid_x, z.grid_y),
  flags: { curtain: true, district: 'halcyon_fields', region_id: REGION, terrain: 'grass' },
});
// An old wall tile that's inland now keeps its own prose, less the lines about the wall.
const CURTAIN_LINES = [
  " The Architect's Curtain seals the edge here: a floor-to-sky sheet of humming hard light.",
  " There's no way through but the South Gate.",
];
const unwall = (z) => {
  delete z.flags.curtain;
  for (const l of CURTAIN_LINES) z.description = String(z.description || '').replace(l, '');
  z._dirty = true;
};
const meadow = (z) => become(z, {
  name: 'Grasslands', description: pick(MEADOW_DESC, z.grid_x, z.grid_y), theme: T.wall.ambient_theme, color: T.wall.color,
  flags: { district: 'halcyon_fields', region_id: REGION, terrain: 'grass' },
});
const road = (z, name, description, extra = {}, district) => become(z, { name, description, flags: { ...roadFlags(district), ...extra } });

const converted = [];
const plan = new Map();   // "x,y" -> role, for the report
for (let y = 901; y <= 923; y++) {
  for (let x = 885; x <= 912; x++) {
    const z = at(x, y);
    if (!z) continue;
    const wild = isWilds(z);
    const oldWall = !!z.flags?.curtain;
    const gateRoad = x === 911 && y >= 917 && y <= 920;
    let role = null;
    if (x === 885 && y === 901) { z.flags = { ...z.flags, curtain: true }; z._dirty = true; role = 'wall-water'; }
    else if (x === 891 && y === 901) { delete z.flags.curtain; z._dirty = true; role = 'water'; }
    else if ((x === 885 && y >= 902) || (y === 923 && x <= 910) || (x === 912 && y >= 920)) { wallTile(z); role = 'wall'; }
    else if (gateRoad) {
      const nm = y === 918 ? 'Windrow Lane + Meltwater Row' : y === 920 ? 'Sorrel Way + Meltwater Row' : 'Meltwater Row';
      road(z, nm, T.meltwater.description, { artery: ['Meltwater Row'] }, 'ashway');
      role = 'meltwater';
    } else if (x >= 886 && x <= 910 && y >= 902 && y <= 922 && (wild || oldWall)) {
      if (x === 886) {
        const nm = y === 909 ? 'Halcyon Boulevard + The River Road' : y === 921 ? 'Sorrel Way + The River Road' : 'The River Road';
        road(z, nm, pick(RIVER_DESC, x, y)); role = 'river';
      } else if (y === 909 && x <= 891) { road(z, 'Halcyon Boulevard', BOULEVARD_DESC, {}, 'glasshouse'); role = 'boulevard'; }
      else if (y === 921) { road(z, x === 899 ? 'Kettle Lane + Sorrel Way' : 'Sorrel Way', pick(SORREL_DESC, x, y)); role = 'sorrel'; }
      else if (x === 910 && y === 920) { road(z, 'Sorrel Way', pick(SORREL_DESC, x, y)); role = 'sorrel'; }
      else if (x === 899 && (y === 919 || y === 920)) { road(z, 'Kettle Lane', T.kettle.description); role = 'kettle'; }
      else if (wild) { meadow(z); role = 'meadow'; }
      else { unwall(z); role = 'unwalled'; }
    }
    if (role) { plan.set(`${x},${y}`, role); if (wild) converted.push(z.id); }
  }
}

// ── 3. Curtain walls: drop the inland ones, wall the new frontier ───────────
const adjacentDir = (a, b) => {
  if (!onWorld(a) || !onWorld(b)) return null;
  for (const [d, [dx, dy]] of Object.entries(CARDINAL)) if (a.grid_x + dx === b.grid_x && a.grid_y + dy === b.grid_y) return d;
  return null;
};
const facadeBlocks = (z, dir) => !!z?.flags?.facade && z.flags.entrance !== dir;
// Only walls with an end on a tile this script moved or changed; anything else inland was there
// before and isn't this build's to judge.
const dropped = [];
conns = conns.filter((c) => {
  if (!c.blocked || c.name !== CURTAIN) return true;
  const a = byId.get(c.a), b = byId.get(c.b);
  if (!a || !b || !(a._dirty || b._dirty)) return true;
  const d = adjacentDir(a, b);
  if (d && isWilds(a) !== isWilds(b)) {
    if (d !== c.dir) { c.dir = d; c._dirty = true; }
    return true;
  }
  dropped.push(c.id);
  return false;
});
// Re-pointed lock walls can land on a pair another file already speaks for.
const seen = new Map();
conns = conns.filter((c) => {
  const k = [c.a, c.b].sort().join('~') + (c.blocked ? '|wall' : `|${c.dir}`);
  if (seen.has(k)) { dropped.push(c.id); return false; }
  seen.set(k, c.id);
  return true;
});
const spoken = new Set(conns.map((c) => [c.a, c.b].sort().join('~')));
const slug = (id) => String(id).replace(/^zone_/, '').replace(/[^a-z0-9]+/gi, '_').slice(0, 34);
const suffix = (a, dir, b) => createHash('sha1').update(`${a}|${dir}|${b}`).digest()
  .readUInt32BE(0).toString(36).padStart(4, '0').slice(-4);
const minted = [];
for (let y = 899; y <= 928; y++) {
  for (let x = 882; x <= 915; x++) {
    const z = at(x, y);
    if (!z) continue;
    for (const [dir, [dx, dy]] of Object.entries(CARDINAL)) {
      const n = at(x + dx, y + dy);
      if (!n || isWilds(z) === isWilds(n)) continue;
      if (facadeBlocks(z, dir) || facadeBlocks(n, OPPOSITE[dir])) continue;
      const key = [z.id, n.id].sort().join('~');
      if (spoken.has(key)) continue;
      spoken.add(key);
      const c = { id: `conn_${slug(z.id)}_${dir}_${suffix(z.id, dir, n.id)}`, a: z.id, b: n.id, blocked: true, dir, lockable: false, name: CURTAIN, one_way: false, _dirty: true };
      conns.push(c);
      minted.push(c.id);
    }
  }
}

// ── 4. Exits from the projected graph ───────────────────────────────────────
const strip = (o) => { const { _dirty, ...rest } = o; return rest; };
const { edges } = projectEdges(zones.map(strip), conns.map(strip));
const out = new Map();
for (const e of edges) {
  if (!out.has(e.from_zone)) out.set(e.from_zone, {});
  const ex = out.get(e.from_zone);
  if (ex[e.direction] == null) ex[e.direction] = e.to_zone;
  else ex[e.direction] = [].concat(ex[e.direction], e.to_zone);
}
const same = (a, b) => JSON.stringify(canonicalJson(a || {})) === JSON.stringify(canonicalJson(b || {}));
let exitsChanged = 0;
const outside = [];
for (const z of zones) {
  const nx = out.get(z.id) || {};
  // Keep an existing exit's order where it has several targets.
  if (same(z.exits, nx)) continue;
  const inWindow = onWorld(z) && z.grid_x >= 882 && z.grid_x <= 915 && z.grid_y >= 899 && z.grid_y <= 928;
  if (!inWindow && !setOf.has(z.id)) { outside.push(z.id); continue; }
  z.exits = nx;
  z._dirty = true;
  exitsChanged++;
}

// ── 5. What else names the ground that changed side ─────────────────────────
const convertedSet = new Set(converted);
const refs = [];
for (const dir of ['zone_spawns', 'npcs', 'npc_residences', 'quests', 'job_boards', 'furniture', 'scavenging_tables']) {
  const d = path.join(CONTENT_DIR, dir);
  if (!fs.existsSync(d)) continue;
  for (const f of fs.readdirSync(d)) {
    if (!f.endsWith('.json')) continue;
    const raw = fs.readFileSync(path.join(d, f), 'utf8');
    for (const m of raw.matchAll(/"(zone_district_\d+_\d+)"/g)) if (convertedSet.has(m[1])) refs.push(`${dir}/${f} -> ${m[1]}`);
  }
}

// ── Report ──────────────────────────────────────────────────────────────────
const roles = {};
for (const r of plan.values()) roles[r] = (roles[r] || 0) + 1;
console.log(`gate block: ${M.length} tiles south ${SHIFT}, ${D.length} tiles north ${SHIFT}; ${repointed} connection end(s) re-pointed`);
console.log('roles:', roles);
console.log(`wild tiles taken in: ${converted.length}`);
console.log(`curtain walls: ${dropped.length} dropped, ${minted.length} minted`);
console.log(`exits rewritten on ${exitsChanged} tile(s)`);
if (outside.length) console.log(`⚠ ${outside.length} tile(s) outside the window disagree with the projection (left alone):`, outside.slice(0, 10));
if (refs.length) { console.log(`references to taken-in ground (${refs.length}):`); for (const r of [...new Set(refs)]) console.log('  ' + r); }

if (!WRITE) { console.log('\n(dry run; pass --write)'); process.exit(0); }
for (const z of zones) if (z._dirty) fs.writeFileSync(path.join(ZD, `${z.id}.json`), canonicalJson(strip(z)), 'utf8');
for (const c of conns) if (c._dirty) fs.writeFileSync(path.join(CD, `${c.id}.json`), canonicalJson(strip(c)), 'utf8');
for (const id of dropped) fs.rmSync(path.join(CD, `${id}.json`), { force: true });
console.log('✓ written');
