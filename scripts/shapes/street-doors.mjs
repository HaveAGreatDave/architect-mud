// street-doors: the door a building with a Stage has in its street doorway (docs/reference/street-doors.md). Three
// checks, no DB, no GL:
//
//   1. Every doorway a model records (windshield.js markDoorway, from windowBay doors, drawEntrance and the arms that
//      draw their own) is a real opening: finite, wider than nothing, a head over its sill, on its own tile.
//   2. Every Stage street door in content/ is a kind client/shared/street-door.js knows, and its doorway resolves on
//      its facade's model (glass/doorway-measure.js): leaves somewhere, a door's width and a person's height. A door
//      fitted to the model's own doorway is the clean case; one that falls back to the room's width is listed.
//   3. Every kind draws (glass/street-doors.js), shut, half open and open, by day and night, with the room drawn
//      through it and without, dark and not: no throw, something on screen, no corner that isn't a number.
//
// `node scripts/shapes/street-doors.mjs [--list]`  (--list prints every Stage door's fit)
import fs from 'node:fs';
import path from 'node:path';
import { loadWindshield, stubCanvas } from './dom-stub.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const LIST = process.argv.includes('--list');
const fails = [];
const fail = (m) => fails.push(m);
const W = await loadWindshield();
const { measureDoorway } = await import('../../client/game/js/panels/glass/doorway-measure.js');
const { drawStreetDoors } = await import('../../client/game/js/panels/glass/street-doors.js');
const { DOOR_KINDS, streetDoorKind, streetDoorLook } = await import('../../client/shared/street-door.js');
const fin = (...v) => v.every(Number.isFinite);

// ── 1. every model's recorded doorways ──────────────────────────────────────────────────────────────
let recorded = 0;
for (const { key, m } of W.shapeModelRegistry()) {
  let bays;
  try { bays = W.captureDoorways(m, { fh: 0.4, h: 1, seed: 3, E: [0, 1] }); }
  catch (e) { fail(`${key}: the door capture threw: ${e.message}`); continue; }
  for (const b of bays) {
    recorded++;
    if (!fin(b.lx, b.half, b.wall, b.front, b.sill, b.head)) fail(`${key}: a doorway with a corner that isn't a number ${JSON.stringify(b)}`);
    else if (!(b.half > 0.002) || !(b.head > b.sill)) fail(`${key}: a doorway with no opening (half ${b.half.toFixed(4)}, sill ${b.sill.toFixed(3)}, head ${b.head.toFixed(3)})`);
  }
}
if (!recorded) fail('no model recorded a doorway: markDoorway is not reached from windowBay or drawEntrance');

// ── 2. every Stage street door in content/ ──────────────────────────────────────────────────────────
const zdir = path.join(ROOT, 'content', 'zones'), zones = new Map();
const zone = (id) => {
  if (zones.has(id)) return zones.get(id);
  let z = null; try { z = JSON.parse(fs.readFileSync(path.join(zdir, id + '.json'), 'utf8')); } catch { /* not a file of that name */ }
  zones.set(id, z); return z;
};
const rooms = [];
for (const f of fs.readdirSync(zdir)) {
  if (!f.endsWith('.json')) continue;
  const txt = fs.readFileSync(path.join(zdir, f), 'utf8');
  if (!txt.includes('"street_door"')) continue;
  const z = JSON.parse(txt);
  if (z.flags?.room?.street_door) { rooms.push(z); zones.set(z.id, z); }
}
const facadeOf = new Map();
for (const f of fs.readdirSync(path.join(ROOT, 'content', 'maps'))) {
  if (!f.endsWith('.json')) continue;
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'maps', f), 'utf8'));
  if (m.entry_zone_id && m.parent_zone_id) facadeOf.set(m.entry_zone_id, m.parent_zone_id);
}
const world = JSON.parse(fs.readFileSync(path.join(ROOT, 'client', 'game', 'flightsim-world.json'), 'utf8'));
const EDGE = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
const METRE = 0.09 / 1.6;   // freelook-view.js METRE: FPS_EYE is 1.6 m
const fits = [];
// A door that falls back to the room's width (fit 'room') is drawn on a guessed opening and can float or clip, so it
// fails unless it's listed here with the reason the model can't record its doorway yet. Shrink this list; never grow it.
const ROOM_FIT_OK = {
  zone_solenne_lobby: 'the 2x2 Solenne model draws its doors 1.4 m high; record the middle bay once the model is finished',
  // `vtol_park` has no GLASS arm at all (no TYPE_MODEL row, so doorBayAt's modelFor is null): there is no model to
  // record a doorway in. Take these off when the parking deck gets its arm.
  zone_apark_lobby: 'Airport Parking Plaza is a vtol_park, which has no GLASS model yet',
  zone_sdeck_lobby: 'Marrow Street Parking is a vtol_park, which has no GLASS model yet',
  // Added 2026-11-25 when their Stage rooms landed: both facades draw through generic arms (shopArm, residential)
  // that record no doorway. Take these off once those arms call markDoorway.
  zone_otoole_interior: "Rusty O'Toole's is a shop facade, and shopArm doesn't record its doorway yet",
  zone_restassured_hall: 'Rest Assured is a residential facade, which records no doorway yet',
};
for (const r of rooms) {
  const sd = r.flags.room.street_door, kind = streetDoorKind(sd);
  if (!DOOR_KINDS[kind]) { fail(`${r.id}: street_door kind '${sd.kind}' isn't one of ${Object.keys(DOOR_KINDS).join(', ')}`); continue; }
  if (sd.kind && !DOOR_KINDS[sd.kind]) fail(`${r.id}: street_door kind '${sd.kind}' isn't one of ${Object.keys(DOOR_KINDS).join(', ')}`);
  // up to the world map: the facade is the building map's parent, or the room's own parent
  let f = zone(facadeOf.get(r.id) || r.parent_zone_id || '');
  for (let hop = 0; hop < 4 && f && f.map_id !== 'map_world'; hop++) f = zone(f.parent_zone_id || '');
  if (!f) { fits.push(`${r.id}: no facade on the world map (not a building's entry room)`); continue; }
  const E = EDGE[String(f.flags?.entrance || '').toLowerCase()], cell = world.cells[f.grid_x + ',' + f.grid_y];
  if (!E || !cell) { fits.push(`${r.id}: facade ${f.id} has no entrance or no snapshot cell (npm run snapshot:flight)`); continue; }
  const look = streetDoorLook(sd), cx = look?.cx || 0;
  const bay = W.doorBayAt(f.grid_x, f.grid_y, cell, cx);
  const g = measureDoorway(f.grid_x, f.grid_y, cell, E, Number(sd.w) || 1.2, W.groundObstructionAt, METRE, cx, bay, look?.h || 0);
  const wide = (2 * g.half) / METRE, high = (g.top - g.sill) / METRE;
  fits.push(`${r.id.padEnd(28)} ${kind.padEnd(9)} ${g.fit.padEnd(5)} ${wide.toFixed(2)} m wide, ${high.toFixed(2)} m high, ${g.cx.toFixed(3)} along`);
  if (g.fit === 'room' && !ROOM_FIT_OK[r.id]) fail(`${r.id}: its door falls back to the room's width; record the doorway in its model (markDoorway or a windowBay door)`);
  if (!g.leaves) fail(`${r.id}: its doorway at ${f.grid_x},${f.grid_y} found no wall, so its door is drawn nowhere`);
  else if (!(wide > 0.7 && wide < 8)) fail(`${r.id}: its doorway is ${wide.toFixed(2)} m wide`);
  else if (!(high > 1.6 && high < 9)) fail(`${r.id}: its doorway is ${high.toFixed(2)} m high`);
}
if (!rooms.length) fail('no room in content/ has flags.room.street_door');

// ── 3. every kind draws ─────────────────────────────────────────────────────────────────────────────
const ctx = stubCanvas('street-doors').getContext('2d');
let bad = 0, drawn = 0;
const cam = { fx: 0, fy: 0.9, back: 0, sinh: 0, cosh: 1, EH: 0.09, nearMax: 0.02,
  proj: (x, y, z) => { if (!fin(x, y, z)) bad++; drawn++; return { sx: x * 400, sy: -z * 400, f: 1 }; } };
const door = (kind, extra) => ({ x: 0, y: 0, E: [0, 1], plane: 0.46, wall: 0.44, back: 0.459, half: 0.06, sill: 0.002, top: 0.14, cx: 0.05, kind,
  glass: DOOR_KINDS[kind].glass, ...(DOOR_KINDS[kind].glass ? {} : { bars: true }), ...(kind === 'swing' || kind === 'single' ? { swing: true } : {}), ...extra });
for (const kind of Object.keys(DOOR_KINDS)) {
  for (const open of [0, 0.5, 1]) for (const night of [0, 1]) for (const portal of [false, true]) for (const dark of [false, true]) {
    const look = { glass: '#7f97a0', trim: '#5a4430', monogram: 'E', fanlight: true, runner: '#7a1e2a', ...(dark ? { dark: true } : {}), ...(kind === 'grille' ? { bars: true } : {}) };
    const v = { mapCenter: { x: 0, y: 0 }, streetDoors: [door(kind, { open, look, fit: portal ? 'model' : 'room' })] };
    const before = drawn;
    try { drawStreetDoors(ctx, cam, v, 1000 + open * 500, night, portal ? new Set(['0,0']) : null); }
    catch (e) { fail(`${kind} (open ${open}, night ${night}, portal ${portal}, dark ${dark}) threw: ${e.message}`); continue; }
    if (drawn === before) fail(`${kind} (open ${open}, night ${night}, portal ${portal}, dark ${dark}) drew nothing`);
  }
}
if (bad) fail(`the door kinds projected ${bad} corner(s) that aren't numbers`);

if (LIST) for (const s of fits) console.log('  ' + s);
if (fails.length) {
  console.log(`street-doors: ${fails.length} failure(s)`);
  for (const f of fails) console.log('  ✗ ' + f);
  process.exit(1);
}
