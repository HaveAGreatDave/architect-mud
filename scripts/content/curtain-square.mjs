// ONE-SHOT: the Curtain's south-east corner moves out, so the wall is a rectangle again.
//
//   node scripts/content/curtain-square.mjs [--write]
//
// When the Coliseum went to true size the south wall west of the gate moved four rows south to y 923
// (coliseum-ground.mjs) and the wall east of it stayed on y 919, with a jog up x 913 between them
// (coliseum-jog.mjs). This runs y 923 on to the east wall at x 927:
//
//   - x 914-926, y 920-922, thirty-nine tiles of waste, become meadow inside the wall;
//   - y 923 from x 914 to 926 and x 927 from y 920 to 923 become the wall, on what was waste, walled
//     from it to the south and the east;
//   - y 919 from x 914 to 926 and x 913 from y 920 to 922 stop being Curtain: neither touches the
//     waste any more. 913,923 stays Curtain, now a tile of the straight run, and so does 927,919;
//   - The Corner, the camp at 927,918, stays with Old Coldwater's east edge and keeps its name, though
//     the wall's inside angle has gone from it, and 927,923 is the angle now.
//
// Every tile keeps its id, so nothing that names one needs an edit. Curtain walls that no longer sit on
// the frontier go, the new frontier is walled the way mint-curtain-walls.mjs walls it, and `exits` is
// rewritten from the projected graph. It refuses to run twice: once 920,923 is Curtain there's nothing
// to do. Afterwards: node scripts/snapshot-flight-world.mjs, npm run wildlands:bake.

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
const GRASS = '#8ba36a';

const readDir = (d) => fs.readdirSync(d).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')));
const zones = readDir(ZD);
let conns = readDir(CD);
const byId = new Map(zones.map((z) => [z.id, z]));
const onWorld = (z) => z && z.map_id === 'map_world' && (z.grid_z ?? 0) === 0 && z.grid_x != null;
const cell = new Map(zones.filter(onWorld).map((z) => [`${z.grid_x},${z.grid_y}`, z]));
const at = (x, y) => cell.get(`${x},${y}`);
const isWilds = (z) => z?.flags?.district === 'wilds';

if (at(920, 923)?.flags?.curtain) { console.log('The south wall already runs on to x 927; nothing to do.'); process.exit(0); }
for (let x = 914; x <= 927; x++) if (!at(x, 919)?.flags?.curtain) throw new Error(`${x},919 should be Curtain`);
for (let y = 920; y <= 923; y++) {
  if (!at(913, y)?.flags?.curtain) throw new Error(`913,${y} should be Curtain`);
  for (let x = 914; x <= 927; x++) if (!isWilds(at(x, y))) throw new Error(`${x},${y} should be waste`);
}

const MEADOW = [
  'Open meadow, the grass long and silver-green. Survey stakes stand in it in rows, each one tied with a strip of orange tape.',
  'Rough ground the Curtain took in when it moved south. Red dirt still shows through the new grass in patches.',
  'Grass to the knee over ground that was outside the wall not long ago. Old tyre ruts run through it and stop.',
  'A row of pegs crosses the meadow. The string between them has gone, and the pegs lean.',
  'Thin grass on red dirt, with a dry ditch along one side. Nobody has decided what goes here yet.',
];
const SOUTH_WALL = [
  'Grass along the foot of the Curtain, the hard light humming a few feet off. The waste beyond it is red and flat to the hills.',
  'Rough grass at the wall. The Curtain seals the edge here, floor to sky, and the only way through is the South Gate.',
  'The Curtain runs dead straight along the south edge. Something moves out on the flats and stops.',
];
const EAST_WALL = [
  'Grass at the foot of the east wall. The Curtain hums floor to sky, and the red flats carry on behind it.',
  'The Curtain runs north and south here, close enough to feel in your teeth.',
];
const pick = (pool, x, y) => pool[(x * 7 + y * 3) % pool.length];
const CURTAIN_LINES = [
  " The Architect's Curtain seals the edge here: a floor-to-sky sheet of humming hard light.",
  " There's no way through but the South Gate.",
];
const changed = new Set();
const touch = (z) => { changed.add(z.id); return z; };
const lay = (x, y, description, flags) => {
  const z = touch(at(x, y));
  z.name = 'Grasslands';
  z.description = description;
  z.flags = { district: 'residential', region_id: REGION, terrain: 'grass', ...flags };
  z.color = GRASS;
  z.ambient_theme = 'forest';
  z.ambient_events = [];
};

// The Corner keeps its place and its name, and says what happened.
const corner = at(927, 918);
if (corner?.name !== 'The Corner') throw new Error('927,918 should be The Corner');
touch(corner).description = "The Curtain used to turn here, from the east wall into the south one. It moved, and the name stayed. The light is good enough to read by. There is a bench.";
// the new ground inside the wall
for (let y = 920; y <= 922; y++) for (let x = 914; x <= 926; x++) lay(x, y, pick(MEADOW, x, y), {});
// the wall on its new line
for (let x = 914; x <= 926; x++) lay(x, 923, pick(SOUTH_WALL, x, 923), { curtain: true });
for (let y = 920; y <= 922; y++) lay(927, y, pick(EAST_WALL, 927, y), { curtain: true });
lay(927, 923, "The inside angle of the Curtain, where the south wall and the east wall meet and the hum of the two of them beats against each other slightly out of time. Nobody has brought a bench out here yet.", { curtain: true });
// the old line, off the wall
for (let x = 914; x <= 926; x++) {
  const z = touch(at(x, 919));
  delete z.flags.curtain;
  for (const l of CURTAIN_LINES) z.description = String(z.description || '').replace(l, '');
}
for (let y = 920; y <= 922; y++) {
  const z = touch(at(913, y));
  delete z.flags.curtain;
  z.description = pick(MEADOW, 913, y);
}

// Curtain walls: drop the ones with an end on a changed tile that no longer sit on the frontier.
const adjacentDir = (a, b) => {
  if (!onWorld(a) || !onWorld(b)) return null;
  for (const [d, [dx, dy]] of Object.entries(CARDINAL)) if (a.grid_x + dx === b.grid_x && a.grid_y + dy === b.grid_y) return d;
  return null;
};
const dropped = [];
conns = conns.filter((c) => {
  if (!c.blocked || c.name !== CURTAIN) return true;
  const a = byId.get(c.a), b = byId.get(c.b);
  if (!a || !b || !(changed.has(a.id) || changed.has(b.id))) return true;
  if (adjacentDir(a, b) && isWilds(a) !== isWilds(b)) return true;
  dropped.push(c.id);
  return false;
});
const spoken = new Set(conns.map((c) => [c.a, c.b].sort().join('~')));
const facadeBlocks = (z, dir) => !!z?.flags?.facade && z.flags.entrance !== dir;
const slug = (id) => String(id).replace(/^zone_/, '').replace(/[^a-z0-9]+/gi, '_').slice(0, 34);
const suffix = (a, dir, b) => createHash('sha1').update(`${a}|${dir}|${b}`).digest().readUInt32BE(0).toString(36).padStart(4, '0').slice(-4);
const minted = [];
for (const id of changed) {
  const z = byId.get(id);
  for (const [dir, [dx, dy]] of Object.entries(CARDINAL)) {
    const n = at(z.grid_x + dx, z.grid_y + dy);
    if (!n || isWilds(z) === isWilds(n) || facadeBlocks(z, dir) || facadeBlocks(n, OPPOSITE[dir])) continue;
    const key = [z.id, n.id].sort().join('~');
    if (spoken.has(key)) continue;
    spoken.add(key);
    const c = { id: `conn_${slug(z.id)}_${dir}_${suffix(z.id, dir, n.id)}`, a: z.id, b: n.id, blocked: true, dir, lockable: false, name: CURTAIN, one_way: false };
    conns.push(c);
    minted.push(c);
  }
}

// Exits from the projected graph, for the tiles round the move.
const { edges } = projectEdges(zones, conns);
const out = new Map();
for (const e of edges) {
  if (!out.has(e.from_zone)) out.set(e.from_zone, {});
  const ex = out.get(e.from_zone);
  ex[e.direction] = ex[e.direction] == null ? e.to_zone : [].concat(ex[e.direction], e.to_zone);
}
for (let y = 917; y <= 925; y++) for (let x = 911; x <= 929; x++) {
  const z = at(x, y);
  if (!z) continue;
  const nx = out.get(z.id) || {};
  if (canonicalJson(z.exits || {}) !== canonicalJson(nx)) { z.exits = nx; changed.add(z.id); }
}

console.log(`${changed.size} tile(s) changed; curtain walls: ${dropped.length} dropped, ${minted.length} minted`);
if (!WRITE) { console.log('(dry run; pass --write)'); process.exit(0); }
for (const id of changed) fs.writeFileSync(path.join(ZD, `${id}.json`), canonicalJson(byId.get(id)), 'utf8');
for (const c of minted) fs.writeFileSync(path.join(CD, `${c.id}.json`), canonicalJson(c), 'utf8');
for (const id of dropped) fs.rmSync(path.join(CD, `${id}.json`), { force: true });
console.log('✓ written');
