// The Meltwater and its pond, south-west of Coldwater: one-shot terrain and prose pass.
//
// Widens the river from the bay (880,900) to the pond into a channel about three tiles across, so a
// boat can run it (the hull beaches on any non-water tile, and depth is distance from shore, so the
// width is also the depth: about 2 m mid-channel, 7 m in the pond). Then lays the banks out round it:
// shingle bars on the inside of the bends, reed, willow carr, wet meadow, and round the pond a reed
// marsh with dead snags in it, a willow copse, a beach and a meadow.
//
// WRITES content/zones/*.json. Deterministic, so a second run writes the same files. Only plain
// wilds tiles are touched: never a building, a road, a park, the River Road strip or a tile with any
// flag beyond district/radiation/region_id/terrain. Run content:import afterwards.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(process.cwd(), 'content', 'zones');
const X0 = 874, X1 = 912, Y0 = 899, Y1 = 948;

// ── the tiles ──
const T = new Map();   // "x,y" -> { file, z }
for (const f of readdirSync(DIR)) {
  if (!f.startsWith('zone_district_')) continue;
  const z = JSON.parse(readFileSync(join(DIR, f), 'utf8'));
  if (z.grid_z || z.grid_x < X0 || z.grid_x > X1 || z.grid_y < Y0 || z.grid_y > Y1) continue;
  if ((z.flags || {}).region_id !== 'region_coldwater') continue;
  T.set(z.grid_x + ',' + z.grid_y, { file: join(DIR, f), z });
}
const at = (x, y) => T.get(x + ',' + y);
const terr = (x, y) => at(x, y)?.z.flags.terrain;
const PLAIN = new Set(['district', 'radiation', 'region_id', 'terrain']);
const SOFT = new Set(['redrock', 'water', 'marsh', 'scrub', 'forest', 'sand', 'gravel', 'deadwood', 'grass', 'dirt']);
function editable(x, y) {
  const t = at(x, y); if (!t) return false;
  const fl = t.z.flags;
  if (Object.keys(fl).some((k) => !PLAIN.has(k))) return false;
  if (!SOFT.has(fl.terrain)) return false;
  if (x >= 885 && y <= 923) return false;        // the River Road and its verge
  if (y <= 901) return false;                     // the bay and its beach
  return true;
}

// ── a stable 0..1 per tile ──
function hash(x, y, k = 0) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(k + 1, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// ── the river: a centreline in tile-centre coordinates ──
const LINE = [[880.5, 900], [880.5, 906], [881, 910.5], [882.2, 914], [883, 917], [882, 920.5],
  [880.8, 923.5], [881.8, 926.2], [884.5, 927.6], [887.5, 929], [889.8, 931], [892.5, 933]];
const HW = 1.85;
function toLine(px, py) {
  let best = { d: 1e9 };
  for (let i = 0; i < LINE.length - 1; i++) {
    const [ax, ay] = LINE[i], [bx, by] = LINE[i + 1];
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    const u = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2));
    const cx = ax + u * dx, cy = ay + u * dy, d = Math.hypot(px - cx, py - cy);
    if (d < best.d) best = { d, i, u, side: Math.sign(dx * (py - ay) - dy * (px - ax)) };
  }
  return best;
}
// Which way the river turns near a segment: + left, - right.
function turnAt(i, u) {
  const v = u < 0.5 ? i : i + 1;
  if (v <= 0 || v >= LINE.length - 1) return 0;
  const [ax, ay] = LINE[v - 1], [bx, by] = LINE[v], [cx, cy] = LINE[v + 1];
  return Math.sign((bx - ax) * (cy - by) - (by - ay) * (cx - bx));
}

// ── the pond: a lobed blob ──
const PC = [898.5, 936.5];
function inPond(x, y) {
  const dx = x + 0.5 - PC[0], dy = y + 0.5 - PC[1];
  const a = Math.atan2(dy, dx);
  const r = 5.6 + 0.9 * Math.sin(a * 3 + 0.7) + 0.5 * Math.cos(a * 2 - 1.1);
  return Math.hypot(dx * 0.95, dy * 1.05) < r;
}
const ISLET = new Set();   // no islet: land mid-pond would make the whole pond shallow (depth is distance from shore)

// ── 1. decide what's water ──
const want = new Map();   // "x,y" -> terrain
const wet = new Set();
for (const [k] of T) {
  const [x, y] = k.split(',').map(Number);
  const r = toLine(x + 0.5, y + 0.5);
  // The channel may cut a cliff tile (the rest of the cliff stays as the cut bank).
  const cut = terr(x, y) === 'cliff' && r.d <= HW && Object.keys(at(x, y).z.flags).every((q) => PLAIN.has(q));
  if (cut) { wet.add(k); want.set(k, 'water'); continue; }
  if (!editable(x, y)) { if (terr(x, y) === 'water') wet.add(k); continue; }
  if ((r.d <= HW || inPond(x, y)) && !ISLET.has(k)) wet.add(k), want.set(k, 'water');
}
// Old river water the new channel left behind becomes backwater reed.
for (const [k, t] of T) {
  const [x, y] = k.split(',').map(Number);
  if (t.z.flags.terrain === 'water' && editable(x, y) && !wet.has(k)) want.set(k, 'marsh');
}
for (const k of ISLET) want.set(k, 'marsh');

// ── 2. distance to water, in tiles (8-neighbour rings) ──
const dist = new Map();
let ring = [...wet];
for (const k of ring) dist.set(k, 0);
for (let d = 1; d <= 5; d++) {
  const next = [];
  for (const k of ring) {
    const [x, y] = k.split(',').map(Number);
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const n = (x + i) + ',' + (y + j);
      if (!T.has(n) || dist.has(n)) continue;
      dist.set(n, d); next.push(n);
    }
  }
  ring = next;
}
const nearPond = (x, y) => Math.hypot(x + 0.5 - PC[0], y + 0.5 - PC[1]) < 11.5;

// ── 3. the banks ──
for (const [k, d] of dist) {
  if (d === 0 || want.get(k) === 'water') continue;
  const [x, y] = k.split(',').map(Number);
  if (!editable(x, y)) continue;
  const cur = terr(x, y);
  if (cur === 'cliff') continue;   // a cliff over the water is a cut bank already
  const h = hash(x, y), h2 = hash(x, y, 7);
  let t = null;
  if (nearPond(x, y)) {
    const dx = x + 0.5 - PC[0], dy = y + 0.5 - PC[1];
    const south = dy > 1.5, east = dx > 3, northWest = dy < -2 && dx < 1;
    if (d === 1 && dx > 2 && dy > 3 && h < 0.75) t = 'sand';                 // the beach, south-east
    else if (d <= (south || east ? 3 : 2)) t = h2 < 0.1 ? 'deadwood' : 'marsh'; // reed, with dead snags
    else if (northWest && d <= 4) t = h < 0.8 ? 'forest' : 'grass';         // the willow copse
    else if (east && d <= 4) t = h < 0.75 ? 'grass' : 'marsh';              // wet meadow
    else if (d <= 5) t = h < 0.55 ? 'scrub' : 'grass';
  } else {
    const r = toLine(x + 0.5, y + 0.5);
    const inside = turnAt(r.i, r.u) !== 0 && turnAt(r.i, r.u) === r.side;
    if (d === 1) {
      if (inside) t = h < 0.6 ? 'gravel' : 'sand';                          // shingle bar on the bend
      else if (h < 0.42) t = 'grass';
      else if (h < 0.68) t = 'marsh';
      else if (h < 0.9) t = 'forest';                                         // willows on the bank
      else t = 'gravel';
    } else if (d === 2) {
      t = h < 0.45 ? 'scrub' : h < 0.75 ? 'grass' : h < 0.85 ? 'forest' : null;
    } else if (d === 3 && h < 0.3) t = 'scrub';
  }
  if (t && !(want.get(k) === 'marsh' && t !== 'marsh')) want.set(k, t);
}

// ── 4. the prose ──
const POND = (x, y) => inPond(x, y) || nearPond(x, y);
const P = {
  water_river: { name: 'The Meltwater', color: '#5f93b8', bg: '#1b3040', d: [
    'The Meltwater runs wide and brown here, deep enough in the middle for a boat if you keep off the bars. Drift sticks out of the banks at the height the spring flood left it.',
    'A slow, deep reach of the Meltwater. The current pulls at anything that floats and the bottom is out of sight a few feet down.',
    'The river bends here and the water on the outside of the bend runs dark and fast. Somebody has tied a rag to a root as a marker for the channel.',
  ] },
  water_pond: { name: 'Meltwater Pond', color: '#4f83a8', bg: '#1f3646', d: [
    'Open water in the middle of the pond, still and deep. Fish rise at dusk and leave rings that take a long time to settle.',
    'The pond is deeper than it looks. The shallows go gravel to silt and then the bottom just goes.',
    'Flat green water with a skin of pollen on it. Something big turns over below the surface and is gone.',
  ] },
  marsh_river: { name: 'Meltwater Reeds', d: [
    'Reeds grow thick along the bank, taller than you, and the ground between them is more water than mud.',
    'A backwater the river left behind, choked with reed and sedge. Frogs go quiet as you come through.',
  ] },
  marsh_pond: { name: 'The Reedbed', d: [
    'Reed and cattail stand in black water up to your knees. Every step sinks and something always moves off just ahead of you.',
    'The marsh around the pond. Sedge, reed, and the smell of rot and iron. Dragonflies hang over the open pools.',
    'Cattails as thick as a wall, with narrow channels between them where the ducks go. The mud takes your boots and gives them back slowly.',
  ] },
  forest_river: { name: 'Willow Bank', d: [
    'Willows lean out over the water with their roots in the bank. The shade under them is cold and full of midges.',
    'A stand of alder and willow holds the bank together. Old flood rubbish hangs in the branches above your head.',
  ] },
  forest_pond: { name: 'The Willow Carr', d: [
    'Wet woodland of willow and alder, the ground between them pooled and green. Birds are louder in here than anywhere in the city.',
    'Willows grow in a tangle on the north shore. Somebody built a lean-to here once and the trees have mostly taken it back.',
  ] },
  gravel: { name: 'Shingle Bar', d: [
    'A bar of rounded stone where the river drops what it was carrying. It is dry footing for once, and the herons like it.',
    'Shingle on the inside of the bend, sorted by size, big stones at the top and grit at the water. Good for landing a boat.',
  ] },
  sand_river: { name: 'Meltwater Sand', d: [
    'A spit of soft sand on the inside of the bend, ribbed by the current and printed with birds\' feet.',
  ] },
  sand_pond: { name: 'Pond Beach', d: [
    'A short beach of coarse sand on the pond\'s south-east side, the only place you can get to the water without wading through reed.',
    'Sand and pebbles at the water\'s edge. Somebody has left a fire ring and a broken lawn chair facing the pond.',
  ] },
  grass_river: { name: 'Meltwater Bank', d: [
    'Rough grass on the riverbank, green against the red country behind it. The ground is soft and the river is loud.',
    'A grassy bank above the water, cut away underneath where the flood has been at it. Mind the edge.',
  ] },
  grass_pond: { name: 'The Wet Meadow', d: [
    'Tussock grass and rushes, wet underfoot. Geese graze it and don\'t think much of you.',
    'A meadow that floods in spring and dries in summer. Wildflowers come up in the low places.',
  ] },
  scrub: { name: 'Meltwater Scrub', d: [
    'Scrub and thorn where the river\'s damp gives out and the red rock takes over again.',
    'Brush grows here on what the river reaches when it floods. Past it the ground is bare rock.',
  ] },
  deadwood: { name: 'The Drowned Trees', d: [
    'Dead trees stand in the reeds, grey and barkless, killed when the pond rose. Cormorants dry their wings on the tops.',
  ] },
};
const COLORS = {};
for (const [, t] of T) if (!COLORS[t.z.flags.terrain]) COLORS[t.z.flags.terrain] = t.z.color;
COLORS.marsh ||= '#4d5a30'; COLORS.forest ||= '#1e3a22'; COLORS.gravel ||= '#7d7a73'; COLORS.sand ||= '#c2b280';
COLORS.grass ||= '#2f3a26'; COLORS.scrub ||= '#6f7248'; COLORS.deadwood ||= '#4a4034';
function proseFor(t, x, y) {
  const pond = POND(x, y);
  const key = t === 'water' ? (pond ? 'water_pond' : 'water_river')
    : ['marsh', 'forest', 'sand', 'grass'].includes(t) ? t + (pond ? '_pond' : '_river') : t;
  return P[key];
}

// ── 5. write ──
const count = {};
for (const [k, t] of want) {
  const [x, y] = k.split(',').map(Number);
  const z = at(x, y).z;
  const p = proseFor(t, x, y);
  const changed = z.flags.terrain !== t;
  z.flags.terrain = t;
  if (p) {
    z.name = p.name;
    z.description = p.d[Math.floor(hash(x, y, 3) * p.d.length)];
    z.color = p.color || COLORS[t];
    if (t === 'water') z.bg_color = p.bg; else delete z.bg_color;
  }
  z.ambient_theme = t === 'forest' || t === 'marsh' || t === 'grass' ? 'forest' : 'wasteland';
  const sorted = (o) => Object.fromEntries(Object.keys(o).sort().map((q) => [q, o[q]]));
  z.flags = sorted(z.flags);
  writeFileSync(at(x, y).file, JSON.stringify(sorted(z), null, 2) + '\n');
  if (changed) count[t] = (count[t] || 0) + 1;
}
console.log('changed tiles by new terrain:', count, 'touched', want.size);
