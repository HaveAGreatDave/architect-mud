// Lays out one room of a building from the content files, as the roomstage plugin would, and checks it: every piece
// placed, inside its walls, nothing in front of a set, and every seat reachable from the door. For hand-placed
// furniture (the fit scripts run the same checks as they write).
//
//   node scripts/content/room-check.mjs <zone id> [--list]
import fs from 'node:fs';
import path from 'node:path';
import { roomSpecOf, withAnnex, annexFrame, layRows, roomLayout, seatApproach, roomPath, roomNearFree, doorwaysOf, hallOf, screenView, mayFaceScreen, pieceBoxes } from '../../client/shared/room-layout.js';
import { walkPlans, buildingView } from '../../client/shared/building-graph.js';

const C = path.resolve(process.cwd(), 'content');
const readDir = (dir) => fs.readdirSync(path.join(C, dir)).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(C, dir, f), 'utf8')));
const id = process.argv[2];
if (!id) { console.error('usage: node scripts/content/room-check.mjs <zone id> [--list]'); process.exit(2); }
const Z = new Map(readDir('zones').map((z) => [z.id, z])), maps = readDir('maps'), furniture = readDir('furniture');
const items = new Map(readDir('items').map((i) => [i.id, i])), itemOf = (f) => (f.flags?.item_id ? items.get(f.flags.item_id) || null : null);
const annexOf = (z) => { const i = z?.exits?.in ? Z.get(Array.isArray(z.exits.in) ? z.exits.in[0] : z.exits.in) : null; const o = i?.exits?.out; return i && (Array.isArray(o) ? o[0] : o) === z.id && i.parent_zone === z.id ? i : null; };
const specById = (zid) => { const z = Z.get(zid); if (!z) return null; const m = parseInt(z.marker, 10); const s = roomSpecOf(z.flags, !!z.flags?.is_apartment, { storey: Number.isFinite(m) ? m : null }); if (!s) return null; const a = annexOf(z); return a ? withAnnex(s, a.id, a.name) : s; };
const plans = walkPlans({ zones: Z, maps, specOf: (z) => specById(z.id) });
const s0 = specById(id), b = plans.get(id), spec = b ? buildingView(b, id, s0, { specOf: specById }).spec : s0;
if (!spec) { console.error(`${id}: no Stage spec`); process.exit(1); }
const rows = furniture.filter((f) => f.zone_id === id && f.object_type !== 'light');
const annexRows = spec.annex ? furniture.filter((f) => f.zone_id === spec.annex.zone && f.object_type !== 'light') : [];
const main = layRows(rows, spec, { finish: spec.finish, itemOf }).pieces;
const L = roomLayout(spec, spec.annex ? [...main, ...layRows(annexRows, annexFrame(spec).spec, { annex: true, finish: spec.annex.finish, itemOf }).pieces] : main);
const fails = [];
const lost = main.filter((p) => !L.placed.some((q) => q.id === p.id));
if (lost.length) fails.push(`no room for ${lost.map((p) => p.name).join(', ')}`);
for (const sc of L.placed.filter((q) => q.arche === 'screen' && !q.annex)) {
  const r = screenView(sc), meets = (q) => q[0] < r[1] - 0.01 && q[1] > r[0] + 0.01 && q[2] < r[3] - 0.01 && q[3] > r[2] + 0.01;
  const by = L.placed.find((p) => p !== sc && !p.annex && !mayFaceScreen(p, sc) && pieceBoxes(p).some(meets));
  if (by) fails.push(`${by.name} stands in front of ${sc.name}`);
}
// (a room reached only by a stair has no door in a wall: its way in is the stair's head, so the walk starts mid-room)
const o = doorwaysOf(spec).find((x) => !x.annex && ['front', 'back', 'left', 'right'].includes(x.wall));
let from = null;
if (o) { const mid = (o.a + o.b) / 2, hall = o.wall === 'back' && hallOf(spec, o);
  from = o.wall === 'back' ? roomNearFree(L, mid, hall ? hall.v1 - 0.4 : spec.d - 0.4, 1.2) : o.wall === 'front' ? roomNearFree(L, mid, 0.5, 1.5) : roomNearFree(L, o.wall === 'left' ? -spec.w / 2 + 0.5 : spec.w / 2 - 0.5, mid, 1.5); }
if (!o) from = roomNearFree(L, 0, spec.d / 2, Math.max(spec.w, spec.d));
if (!from) fails.push('no floor inside the door');
const stuck = L.seats.filter((s) => { const at = seatApproach(L, s, 1.8); return !(from && at && roomPath(L, from, at)); });
if (stuck.length) fails.push(`seats not reachable from the door: ${[...new Set(stuck.map((s) => s.piece))].join(', ')}`);
if (process.argv.includes('--list')) for (const p of L.placed.filter((q) => !q.annex)) console.log(`  ${p.name.padEnd(28)} u ${p.u.toFixed(2).padStart(6)}  v ${p.v.toFixed(2).padStart(6)}  ${p.w?.toFixed?.(2)} x ${p.d?.toFixed?.(2)}  turn ${p.turn}`);
console.log(`${id}: ${spec.w} x ${spec.d} m, ${L.placed.length} pieces, ${L.seats.length} seats`);
for (const f of fails) console.error(`✗ ${f}`);
process.exit(fails.length ? 1 : 0);
