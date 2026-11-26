// npc-doors: the door a person on the street goes in and out of a building by (client/game/js/panels/glass/npc-doors.js,
// docs/reference/street-doors.md "People on the street"). No DB, no GL. For every facade in the flight snapshot:
//
//   1. Stood on the tile its front faces, the person picks this building (windshield.js doorwayDir via npcDoorFor's
//      caller's rule: only a front that faces them). Stood beside its flank or back, they don't: nobody walks into a
//      blank wall.
//   2. Its door resolves: at the model's own doorway when the model records one (fit 'model'), its doorstep out on the
//      street tile and its step inside behind the front, and a door's size.
//   3. Every building type's door draws, shut, opening and open, by day and night.
//
// `node scripts/shapes/npc-doors.mjs [--list]`  (--list counts the doors by kind and fit)
import fs from 'node:fs';
import path from 'node:path';
import { loadWindshield, stubCanvas } from './dom-stub.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const LIST = process.argv.includes('--list');
const fails = [], fail = (m) => fails.push(m);
await loadWindshield();
const N = await import('../../client/game/js/panels/glass/npc-doors.js');
const { doorForType, DOOR_KINDS } = await import('../../client/shared/street-door.js');
const world = JSON.parse(fs.readFileSync(path.join(ROOT, 'client', 'game', 'flightsim-world.json'), 'utf8'));
const EDGE = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
const METRE = 0.09 / 1.6;
const R = 2;
// a window of the snapshot round (x, y), as the street view holds one
const windowAt = (x, y) => {
  const map = [];
  for (let j = -R; j <= R; j++) { const row = []; for (let i = -R; i <= R; i++) row.push(world.cells[(x + i) + ',' + (y + j)] || null); map.push(row); }
  return map;
};
// doorwayDir's rule (windshield.js), restated: a neighbour whose front faces the tile
const faceVec = (ent) => EDGE[ent] || [0, 1];
const facing = (map, dx, dy) => { const c = map[R + dy]?.[R + dx]; if (!c || !c.bt) return false; const E = faceVec(c.ent); return E[0] === -dx && E[1] === -dy; };

const tally = new Map();
let n = 0;
for (const [k, c] of Object.entries(world.cells)) {
  if (!c || !c.bt || !EDGE[c.ent]) continue;
  const [gx, gy] = k.split(',').map(Number), E = EDGE[c.ent], sx = gx + E[0], sy = gy + E[1];
  const street = world.cells[sx + ',' + sy];
  if (!street || street.bt) continue;   // a front onto another building or off the map: nobody comes up to it
  n++;
  const map = windowAt(sx, sy);
  if (!facing(map, -E[0], -E[1])) { fail(`${k} (${c.bt}): its own front tile doesn't see it as facing`); continue; }
  // the flank: a tile beside it along the front's own line, which must not take this building
  const fx = gx + E[1], fy = gy - E[0], flank = world.cells[fx + ',' + fy];
  if (flank && !flank.bt && facing(windowAt(fx, fy), gx - fx, gy - fy)) fail(`${k} (${c.bt}): a person beside its flank at ${fx},${fy} would go in by the wall`);
  let d;
  try { d = N.npcDoorFor(map, R, sx, sy, sx, sy, -E[0], -E[1]); } catch (e) { fail(`${k} (${c.bt}): the door threw: ${e.message}`); continue; }
  if (!d) { tally.set('none', (tally.get('none') || 0) + 1); continue; }   // no wall to hang one in: they fade, as before
  const key = `${d.kind}/${d.fit}`; tally.set(key, (tally.get(key) || 0) + 1);
  if (!DOOR_KINDS[d.kind]) fail(`${k} (${c.bt}): door kind '${d.kind}' isn't one DOOR_KINDS knows`);
  const S = N.npcDoorStep(d), I = N.npcDoorInside(d);
  // out of the front (y), the doorstep is at the tile's edge, a step in front of the door; along it (x), on the tile
  const out = (S[0] - gx) * E[0] + (S[1] - gy) * E[1], along = (S[0] - gx) * E[1] - (S[1] - gy) * E[0];
  if (!(out > 0.1 && out < 0.7) || Math.abs(along) > 0.5) fail(`${k} (${c.bt}): the doorstep is ${out.toFixed(2)} out and ${along.toFixed(2)} along, not in front of its door`);
  if ((I[0] - gx) * E[0] + (I[1] - gy) * E[1] > (S[0] - gx) * E[0] + (S[1] - gy) * E[1]) fail(`${k} (${c.bt}): the step inside is in front of the doorstep`);
  const wide = (2 * d.half) / METRE;
  if (!(wide > 0.6 && wide < 15)) fail(`${k} (${c.bt}): the door is ${wide.toFixed(2)} m wide`);
  if (!(d.top > d.sill)) fail(`${k} (${c.bt}): the door has no height`);
}
if (!n) fail('no facade with a street in front of it in the snapshot');

// every type's door draws
const ctx = stubCanvas('npc-doors').getContext('2d');
let bad = 0, drawn = 0;
const cam = { fx: 0, fy: 0.9, back: 0, sinh: 0, cosh: 1, EH: 0.09, nearMax: 0.02,
  proj: (x, y, z) => { if (![x, y, z].every(Number.isFinite)) bad++; drawn++; return { sx: x * 400, sy: -z * 400, f: 1 }; } };
const types = new Set(Object.values(world.cells).map((c) => c && c.bt).filter(Boolean));
const { drawStreetDoors } = await import('../../client/game/js/panels/glass/street-doors.js');
for (const bt of types) {
  const { kind, look } = doorForType(bt, 99);
  for (const open of [0, 0.5, 1]) for (const night of [0, 1]) {
    const before = drawn;
    try { drawStreetDoors(ctx, cam, { mapCenter: { x: 0, y: 0 }, streetDoors: [{ x: 0, y: 0, E: [0, 1], plane: 0.46, back: 0.454, half: 0.05, sill: 0, top: 0.13, cx: 0, fit: 'model', kind, look, open }] }, 1000, night, null); }
    catch (e) { fail(`${bt}'s ${kind} door (open ${open}, night ${night}) threw: ${e.message}`); continue; }
    if (drawn === before) fail(`${bt}'s ${kind} door (open ${open}, night ${night}) drew nothing`);
  }
}
if (bad) fail(`the doors projected ${bad} corner(s) that aren't numbers`);

if (LIST) { console.log(`npc-doors: ${n} fronts`); for (const [k, v] of [...tally].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(18)} ${v}`); }
if (fails.length) {
  console.log(`npc-doors: ${fails.length} failure(s)`);
  for (const f of fails.slice(0, 60)) console.log('  ✗ ' + f);
  process.exit(1);
}
