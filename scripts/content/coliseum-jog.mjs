// ONE-SHOT: the Curtain's jog beside the South Gate moves one column east, from x 912 to x 913
// (docs/proposals/coliseum-true-size.md, a fix to phase 1).
//
//   node scripts/content/coliseum-jog.mjs [--write]
//
// Phase 1 (coliseum-ground.mjs) turned the wall north up x 912 from the gate's corner at 912,923 to its
// old line at y 919. That put two jog tiles hard against the South Lock's east wall, walled on both
// sides, so nothing could tell which side was in (the flight derive's `ci`), and it left 912,919 and
// the corner at the top of the jog flagged as Curtain with no wild ground next to them, so their faces
// pointed along their own run. The jog moves to x 913:
//
//   - 912,920-922 become meadow beside the lock, as the ground beside it was before it moved; the
//     lock's own walls (`the lock wall`) still shut its side;
//   - 913,920-923 become the wall, open to that meadow on the west and walled from the waste on the east;
//   - 912,919 and 913,919 stop being Curtain: neither touches the waste, and the wall meets itself at
//     their corner point the way an inside corner does.
//
// Then curtain walls that no longer sit on the frontier go, the new frontier is walled the way
// mint-curtain-walls.mjs walls it, and `exits` is rewritten from the projected graph. It refuses to
// run twice: once 913,920 is Curtain there's nothing to do.

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

const readDir = (d) => fs.readdirSync(d).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')));
const zones = readDir(ZD);
let conns = readDir(CD);
const byId = new Map(zones.map((z) => [z.id, z]));
const onWorld = (z) => z && z.map_id === 'map_world' && (z.grid_z ?? 0) === 0 && z.grid_x != null;
const cell = new Map(zones.filter(onWorld).map((z) => [`${z.grid_x},${z.grid_y}`, z]));
const at = (x, y) => cell.get(`${x},${y}`);
const isWilds = (z) => z?.flags?.district === 'wilds';

if (at(913, 920)?.flags?.curtain) { console.log('The jog already runs up x 913; nothing to do.'); process.exit(0); }
for (let y = 920; y <= 922; y++) if (!at(912, y)?.flags?.curtain) throw new Error(`912,${y} should be Curtain`);
for (let y = 920; y <= 923; y++) if (!isWilds(at(913, y))) throw new Error(`913,${y} should be waste`);

const CURTAIN_LINES = [
  " The Architect's Curtain seals the edge here: a floor-to-sky sheet of humming hard light.",
  " There's no way through but the South Gate.",
];
const MEADOW = [
  'Open meadow at the edge of the estate, the grass long and silver-green. Survey stakes stand in it in rows, each one tied with a strip of orange tape.',
  'Grass to the knee beside the grey plate of the South Lock. The lamps over its mouth tick as they change.',
  'Rough meadow with a line of pegs across it. The string between them has gone, and the pegs lean.',
];
const WALL = [
  'Grass along the foot of the Curtain, the hard light humming a few feet off. The Gate Post stands on the far side of it, lit all night.',
  'Rough grass at the wall. The Curtain seals the edge here, floor to sky, and the only way through is the South Gate.',
  'The corner of the estate, where the Curtain turns along the wall. Through the light the Glacis road runs south, small and straight.',
  'Grass beside the Curtain where it bends round the gate. The waste beyond it is red and flat to the hills.',
];
const changed = new Set();
const touch = (z) => { changed.add(z.id); return z; };
for (let y = 920; y <= 922; y++) {
  const z = touch(at(912, y));
  z.name = 'Grasslands';
  z.description = MEADOW[y - 920];
  z.flags = { district: 'halcyon_fields', region_id: REGION, terrain: 'grass' };
}
for (let y = 920; y <= 923; y++) {
  const z = touch(at(913, y));
  z.name = 'Grasslands';
  z.description = WALL[y - 920];
  z.flags = { curtain: true, district: 'halcyon_fields', region_id: REGION, terrain: 'grass' };
  z.ambient_theme = 'forest';
  z.ambient_events = [];
}
for (const x of [912, 913]) {
  const z = touch(at(x, 919));
  delete z.flags.curtain;
  for (const l of CURTAIN_LINES) z.description = String(z.description || '').replace(l, '');
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

// Exits from the projected graph, for the tiles round the jog.
const { edges } = projectEdges(zones, conns);
const out = new Map();
for (const e of edges) {
  if (!out.has(e.from_zone)) out.set(e.from_zone, {});
  const ex = out.get(e.from_zone);
  ex[e.direction] = ex[e.direction] == null ? e.to_zone : [].concat(ex[e.direction], e.to_zone);
}
for (let y = 917; y <= 926; y++) for (let x = 909; x <= 916; x++) {
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
