// One-shot: the Embassy's twelve units (zone_apt_1 .. zone_apt_12, Units 2A to 4D) become hotel rooms that fit inside
// the hotel's GLASS model. The model stays as it is; the rooms change to fit it.
//
//   node scripts/content/embassy-hotel-rooms.mjs           lay out, check and write
//   node scripts/content/embassy-hotel-rooms.mjs --dry     lay out and check, write nothing
//
// Run scripts/content/embassy-rooms.mjs first: it sets the lobby and the landings, and this lays each room out
// against its landing's doorways.
//
// The plate. At 921,904 the model's rose shaft is 15.7 m square from 5.37 m up (embassyhotelbar.json, `fh` 0.439 and
// `h` 20.04 m at this tile's seed), and each landing is 4.4 x 8 m in its middle. So on every guest floor:
//   - A (north, 2A/3A/4A) and B (south, 2B/3B/4B) are long rooms, 3.3 x 12.3 m, along the north and south party
//     walls. A has its window at the street end (west), B at the back (east, Dray Lane).
//   - C (east, 2C/3C/4C) and D (west, 2D/3D/4D) are wide shallow rooms, 8 x 3.2 m, across the back and the street.
// Every room has its en-suite behind its back wall, toward the landing, and its door beside it.
// scripts/content/building-stage.mjs and the fit check in this script hold the rooms inside the plate.
//
// What it does:
//   1. writes each room's `flags.room`: the size and face above, the ceiling height of its floor, and no kitchen;
//      its colours, finish, sash and blinds stay, and its decor is moved or shrunk to stay inside the walls.
//   2. deletes the kitchen and the dining set: hobs, ranges, microwaves, fridges, the kitchen sink, counter stools,
//      dining and kitchen tables and their chairs. The en-suite keeps its own basin. Everything else stays,
//      every gameplay piece included (control panels, the safe, the terminal, the hardcase, the TV, the piano).
//   3. gives every kept piece a spot that placeSpot takes in the new room, nearest the old one scaled to the new
//      size, and checks the room as the server lays it out: every piece placed, and every seat reachable from the door.
//   4. rewrites each room's text, and the street front's.
// A room that fails a check fails the run, and nothing is written.
import fs from 'node:fs';
import path from 'node:path';
import { canonicalJson } from './lib.mjs';
import {
  roomSpecOf, withAnnex, annexFrame, layRows, roomLayout, placeSpot, resolveSpot, seatApproach, roomPath,
  roomNearFree, doorwaysOf, hallOf,
} from '../../client/shared/room-layout.js';
import { walkPlans, buildingView } from '../../client/shared/building-graph.js';

const C = path.resolve(process.cwd(), 'content');
const DRY = process.argv.includes('--dry');
const readDir = (dir) => fs.readdirSync(path.join(C, dir)).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(C, dir, f), 'utf8')));
const zones = readDir('zones'), maps = readDir('maps'), furniture = readDir('furniture');
const items = new Map(readDir('items').map((i) => [i.id, i]));
const Z = new Map(zones.map((z) => [z.id, z]));
const r2 = (x) => +x.toFixed(2);

// ── the rooms ────────────────────────────────────────────────────────────────────────────────────────
const LONG = { w: 3.3, d: 12.3, ensuite: { d: 2.8 } }, WIDE = { w: 8, d: 3.2, ensuite: { d: 1.8 } };
const KIND = [{ ...LONG, face: 270 }, { ...LONG, face: 90 }, { ...WIDE, face: 90 }, { ...WIDE, face: 270 }];   // A, B, C, D
const HEIGHT = { 2: 4.13, 3: 3.93, 4: 3.96 };
const TEXT = {
  1: "Unit 2A, a long room with its window over the street. Sage walls under a white plaster cornice and a waxed parquet floor. Two armchairs face the window across a low oak table, and a brass bed stands at the dim end by the bathroom. The big canvas on the wall beside them was somebody's rent: Lowry takes part of it in paintings, and they hang in every room in the building.",
  2: "Unit 2B, a long room at the back with its window on Dray Lane. Dusty pink walls, a chesterfield along one side and a writing desk under the window. The faded beach poster a tenant left behind has been framed, and now looks like it was meant to be there.",
  3: "Unit 2C, at the back, wide and shallow. Teal walls and white trim, two bookcases full of other people's books, and a reading chair under a paper lantern. A rust sofa faces a chrome flatscreen. Everything is where the last guest left it, which is also how the hotel keeps it.",
  4: "Unit 2D, on the street. Ochre walls, a carved bed, and a long sofa and a velvet armchair round a low table under a small chandelier. Someone painted over COUNT YOUR DAYS on the inside of the door with a garden of tall flowers, and you can still read the words through the stems if you look.",
  5: "Unit 3A, a long room riding the front of the building. Oxblood walls and opal globes. The street window has been reglazed, and the neon outside now comes through it pink instead of purple. The water stain on the ceiling has been painted round and given a gilt frame.",
  6: "Unit 3B, a long room at the back with its window on Dray Lane. Slate-blue walls and a cast-iron radiator painted the same colour. Two low sofas face each other across a chess table. The lane's smell stops at the window, which shuts properly now.",
  7: "Unit 3C, at the back. The yellow has been repainted and holds this time, warm against white trim. The clawfoot tub stands in the room itself, on purpose, by the window with plants round it. The window looks down on Dray Lane.",
  8: "Unit 3D, on the street. Bottle-green walls and brass sconces either side of a long mirror. A ring of old candle stubs has been sealed into the floorboards under varnish, and nobody's sure whether that's art. The walls are thick enough that the neighbours' business stays theirs.",
  9: "Unit 4A, top floor, a long room with the street window and the best light in the building. Chalk-white walls, a plan chest full of paper and paint, and two easels by the window that opens. The canvases leaning on the bookcase are rent, waiting for a wall downstairs. The hook in the ceiling holds a paper lantern now.",
  10: "Unit 4B, the long room at the back under the roof. Plum walls and an old stain across the ceiling. The hole in the plaster was patched with a STOP sign, and the sign is still there, framed, over the sofa. A bucket stands under the old leak, planted with a fern.",
  11: "Unit 4C, which the corkboard downstairs calls cozy. It's small and shallow, but it's terracotta and white, and the window that was painted shut has been scraped free again. Bowls from somebody's wheel sit on every flat surface, most of them for sale.",
  12: "Unit 4D, top floor on the street, as far from the bar as the building gets. Navy walls, gold trim, and an upright piano against the long wall by the window. The ceiling fixtures are gone, so a lamp on the floor lights the room. It's quiet enough up here to hear the piano's strings settle at night.",
};
const FRONT = { id: 'zone_district_920_904', from: "The bar's windows are lit. The lobby's aren't.", to: 'The windows either side of the door are lit, and through the left one you can see the bar.' };

// placed before the rest of its room: Unit 4D's piano, which its text names
const FIRST = new Set(['furn_apt12_piano']);
// spots set by hand, tried first: in Unit 4D the search put the bed across the piano's keyboard, and a piano isn't a
// seat, so the reach check couldn't see it. The piano stands on the long street wall beside the window, the bed
// against the back wall clear of both doors, and the wardrobe on the end wall.
const FIXED = {
  furn_apt12_piano: { wall: 'front', along: -2.6 },
  furn_apt12_bed: { wall: 'back', along: 1.4 },
  furn_apt12_wardrobe: { wall: 'left', along: 2.3 },
};

// the kitchen and the dining set
const KITCHEN = /counter stool|dining (table|chair)|kitchen table|plate rack|hob and kettle|drop-leaf table|round table/i;
const isKitchen = (f) => {
  const fl = f.flags || {};
  return !!(fl.stove_tier || fl.microwave || fl.preserves || fl.appliance_grade || f.object_type === 'sink' || KITCHEN.test(f.name || ''));
};

// ── decor that has to stay inside the new walls ────────────────────────────────────────────────────
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
// The sash is in the middle of the front wall, `sash` metres wide. A picture or a sconce keeps clear of it and of
// every other picture and sconce on its wall; one that can't stay where it was goes to the nearest free place on a
// side wall or beside the window (never the back wall, which has the en-suite and the door in it).
function fitDecor(decor, w, d, sash) {
  if (!decor) return decor;
  const out = { ...decor }, hu = w / 2;
  const along = (wall) => (wall === 'front' || wall === 'back' ? [-hu + 0.3, hu - 0.3] : [0.3, d - 0.3]);
  const taken = [];   // [wall, lo, hi]
  if (sash) taken.push(['front', -sash / 2 - 0.15, sash / 2 + 0.15]);
  const free = (wall, lo, hi) => !taken.some(([tw, a, b]) => tw === wall && lo < b + 0.2 && hi > a - 0.2);
  const place = (wall, at, half) => {
    const fits = (wl, x) => { const [lo, hi] = along(wl); return x - half >= lo - 1e-6 && x + half <= hi + 1e-6 && free(wl, x - half, x + half); };
    const tries = [];
    for (const wl of [wall, 'right', 'left', 'front']) {
      if (wl === 'back' && wl !== wall) continue;
      const [lo, hi] = along(wl);
      for (let x = lo + half; x <= hi - half + 1e-6; x += 0.1) tries.push([wl, r2(x), Math.abs(x - at) + (wl === wall ? 0 : 20)]);
    }
    tries.sort((a, b) => a[2] - b[2]);
    const hit = tries.find(([wl, x]) => fits(wl, x));
    if (hit) taken.push([hit[0], hit[1] - half, hit[1] + half]);
    return hit;
  };
  if (Array.isArray(out.art)) out.art = out.art.map((a) => { const hit = place(a.wall, a.at, (a.w || 1) / 2); return hit ? { ...a, wall: hit[0], at: hit[1] } : null; }).filter(Boolean);
  if (out.sconces?.points) out.sconces = { ...out.sconces, points: out.sconces.points.map(([wall, at]) => place(wall, at, 0.4)).filter(Boolean).map(([wl, x]) => [wl, x]) };
  if (Array.isArray(out.plants)) out.plants = out.plants.map(([u, v, s]) => [r2(clamp(u, -hu + 0.4, hu - 0.4)), r2(clamp(v, 0.4, d - 0.4)), s]);
  if (out.rug && typeof out.rug === 'object') {
    const rw = Math.min(out.rug.w || 2, w - 1.2), rd = Math.min(out.rug.d || 2, d - 1.2);
    out.rug = rw < 1 || rd < 1 ? false : { ...out.rug, w: r2(rw), d: r2(rd), at: [r2(clamp(out.rug.at?.[0] ?? 0, -hu + rw / 2 + 0.3, hu - rw / 2 - 0.3)), r2(clamp(out.rug.at?.[1] ?? d / 2, rd / 2 + 0.3, d - rd / 2 - 0.3))] };
  }
  return out;
}

// ── the room as the Stage lays it out (plugins/roomstage stageSpec and roomPieces; embassy-dining.mjs) ──
const annexZoneOf = (z) => {
  const inner = z?.exits?.in ? Z.get(Array.isArray(z.exits.in) ? z.exits.in[0] : z.exits.in) : null;
  const out = inner?.exits?.out, back = Array.isArray(out) ? out[0] : out;
  return inner && back === z.id && inner.parent_zone === z.id ? inner : null;
};
const specById = (id) => {
  const z = Z.get(id);
  if (!z) return null;
  const mark = parseInt(z.marker, 10);
  const spec = roomSpecOf(z.flags, !!z.flags?.is_apartment, { storey: Number.isFinite(mark) ? mark : null });
  if (!spec) return null;
  const a = annexZoneOf(z);
  return a ? withAnnex(spec, a.id, a.name) : spec;
};
const itemOf = (f) => (f.flags?.item_id ? items.get(f.flags.item_id) || null : null);
const fp = (p) => { const q = Math.round((((p.turn % 360) + 360) % 360) / 90) % 2, hw = (q ? p.d : p.w) / 2, hd = (q ? p.w : p.d) / 2; return [p.u - hw, p.u + hw, p.v - hd, p.v + hd]; };
function doorPoint(L) {
  const S = L.spec, o = doorwaysOf(S).find((x) => x.wall === 'back' && !x.annex) || null;
  const [a, b] = o ? [o.a, o.b] : S.door, hall = o && hallOf(S, o);
  const v = hall ? hall.v1 - 0.4 : S.d - 0.4;
  return roomNearFree(L, (a + b) / 2, v, 1.2) || roomNearFree(L, (a + b) / 2, S.d - 0.6, 1.5);
}

// ── 1. the new room specs, in memory ─────────────────────────────────────────────────────────────────
// It refuses to run twice: once Unit 2A is the long room there is nothing to do, and a second pass would move
// pieces again from spots scaled off the new sizes.
if (Z.get('zone_apt_1').flags?.room?.w === LONG.w) { console.log('embassy-hotel-rooms: already done'); process.exit(0); }
const writes = new Map(), deletes = [], fails = [], report = [];
for (let n = 1; n <= 12; n++) {
  const id = `zone_apt_${n}`, z = Z.get(id), floor = parseInt(z.marker, 10), k = KIND[(n - 1) % 4];
  const old = z.flags.room || {};
  const { kitchen, plan, studio, ...keep } = old;
  const room = { ...keep, w: k.w, d: k.d, h: HEIGHT[floor], face: k.face, studio: false, ensuite: { ...(old.ensuite || {}), ...k.ensuite }, decor: fitDecor(old.decor, k.w, k.d, Math.min(old.sash?.w ?? 1.8, k.w - 0.8)) };
  if (room.sash?.w) room.sash = { ...room.sash, w: Math.min(room.sash.w, k.w - 0.8) };
  const next = { ...z, description: TEXT[n], flags: { ...z.flags, room } };
  Z.set(id, next);
  writes.set(`zones/${id}.json`, next);
}
const front = Z.get(FRONT.id);
if (front.description.includes(FRONT.from)) writes.set(`zones/${FRONT.id}.json`, { ...front, description: front.description.replace(FRONT.from, FRONT.to) });

// ── 2 and 3. the pieces ──────────────────────────────────────────────────────────────────────────────
const plans = walkPlans({ zones: Z, maps, specOf: (z) => specById(z.id) });
const stageSpec = (id) => { const s = specById(id), b = s && plans.get(id); return b ? buildingView(b, id, s, { specOf: specById }).spec : s; };
for (let n = 1; n <= 12; n++) {
  const id = `zone_apt_${n}`, z = Z.get(id), spec = stageSpec(id);
  if (!plans.get(id)) { fails.push(`${id}: not on the Embassy's walk, so its doorways can't be checked`); continue; }
  const rows = furniture.filter((f) => f.zone_id === id);
  const gone = rows.filter(isKitchen), kept = rows.filter((f) => !isKitchen(f));
  deletes.push(...gone.map((f) => f.id));
  const oldRoom = Object.fromEntries(['w', 'd'].map((key) => [key, Number(furniture && JSON.parse(fs.readFileSync(path.join(C, 'zones', `${id}.json`), 'utf8')).flags?.room?.[key]) || 8]));
  // each kept row's look, laid in placeRank order with no spots, so the big things go down first
  const looks = layRows(kept.map((f) => ({ ...f, flags: { ...(f.flags || {}), spot: undefined } })), spec, { finish: spec.finish, itemOf }).pieces;
  const placed = [], newSpot = new Map();
  // a piece the room's text is about goes down before the rest, so the bed and the sofa don't take its wall
  looks.sort((a, b) => (FIRST.has(b.id) ? 1 : 0) - (FIRST.has(a.id) ? 1 : 0));
  for (const p of looks) {
    const row = kept.find((f) => f.id === p.id), was = row.flags?.spot;
    const tries = [];
    if (was?.wall) {
      // the same wall first, the same distance along it scaled to its new length, then the other walls
      const len = (w) => (w === 'front' || w === 'back' ? spec.w : spec.d), oldLen = (w) => (w === 'front' || w === 'back' ? oldRoom.w : oldRoom.d);
      const target = (w) => (w === 'front' || w === 'back' ? was.along * len(w) / oldLen(w) : was.along * len(w) / oldLen(w));
      for (const wall of [was.wall, ...['left', 'right', 'front', 'back'].filter((x) => x !== was.wall)]) {
        const lo = wall === 'front' || wall === 'back' ? -spec.w / 2 : 0, hi = wall === 'front' || wall === 'back' ? spec.w / 2 : spec.d;
        for (let a = lo; a <= hi + 1e-6; a += 0.1) tries.push({ spot: { wall, along: r2(a) }, cost: Math.abs(a - target(wall)) + (wall === was.wall ? 0 : 20) });
      }
    } else {
      const tu = was?.at ? was.at[0] * spec.w / oldRoom.w : 0, tv = was?.at ? was.at[1] * spec.d / oldRoom.d : spec.d / 2;
      for (let v = 0.3; v <= spec.d - 0.3 + 1e-6; v += 0.1) for (let u = -spec.w / 2 + 0.3; u <= spec.w / 2 - 0.3 + 1e-6; u += 0.1) for (const dt of [0, 90, -90, 180]) {
        tries.push({ spot: { at: [r2(u), r2(v)], turn: ((was?.turn ?? 0) + dt + 540) % 360 - 180 }, cost: Math.hypot(u - tu, v - tv) + (dt ? 0.5 : 0) });
      }
      // a piece the old room never placed by hand can also go where the Stage would put it
      if (!was) { const auto = placeSpot(spec, placed, p.arche, p.dims, { crt: p.crt, form: p.form, bases: true }); if (auto) tries.unshift({ spot: auto, cost: -1 }); }
    }
    if (FIXED[p.id]) tries.push({ spot: FIXED[p.id], cost: -2 });
    tries.sort((a, b) => a.cost - b.cost);
    const hit = tries.find((t) => placeSpot(spec, placed, p.arche, p.dims, { crt: p.crt, form: p.form, test: t.spot }));
    if (!hit) { fails.push(`${id}: no room for ${p.id} (${p.name})`); continue; }
    newSpot.set(p.id, hit.spot);
    placed.push({ ...p, spot: hit.spot });
  }
  // the room as the server lays it out with the new spots
  const withSpots = kept.map((f) => (newSpot.has(f.id) ? { ...f, flags: { ...(f.flags || {}), spot: newSpot.get(f.id) } } : f));
  const annexId = spec.annex?.zone, annexRows = annexId ? furniture.filter((f) => f.zone_id === annexId) : [];
  const main = layRows(withSpots, spec, { finish: spec.finish, itemOf }).pieces;
  const all = spec.annex ? [...main, ...layRows(annexRows, annexFrame(spec).spec, { annex: true, finish: spec.annex.finish, itemOf }).pieces] : main;
  const L = roomLayout(spec, all);
  const lost = main.filter((p) => !L.placed.some((q) => q.id === p.id));
  if (lost.length) fails.push(`${id}: not laid out: ${lost.map((p) => p.name).join(', ')}`);
  for (const p of L.placed.filter((q) => !q.annex)) {
    const f = fp(p);
    if (f[0] < -L.w / 2 - 1e-6 || f[1] > L.w / 2 + 1e-6 || f[2] < -1e-6 || f[3] > L.d + 1e-6) fails.push(`${id}: ${p.name} stands through a wall`);
  }
  const from = doorPoint(L);
  if (!from) fails.push(`${id}: no floor inside the door`);
  const stuck = L.seats.filter((s) => { const at = seatApproach(L, s, 1.8); return !(from && at && roomPath(L, from, at)); });
  if (stuck.length) fails.push(`${id}: seats not reachable from the door: ${[...new Set(stuck.map((s) => s.piece))].join(', ')}`);
  for (const f of withSpots) if (newSpot.has(f.id)) writes.set(`furniture/${f.id}.json`, f);
  report.push(`${id} ${z.name}: ${spec.w} x ${spec.d} m facing ${z.flags.room.face}, ${kept.length} pieces kept, ${gone.length} gone, ${L.seats.length} seats reachable`);
}

for (const line of report) console.log(line);
if (fails.length) {
  for (const f of fails) console.error(`✗ ${f}`);
  console.error(`\n✗ embassy-hotel-rooms: ${fails.length} problem(s); nothing written`);
  process.exit(1);
}
let wrote = 0, removed = 0;
for (const [rel, data] of writes) {
  const file = path.join(C, rel), json = canonicalJson(data);
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === json) continue;
  if (!DRY) fs.writeFileSync(file, json);
  wrote++;
}
for (const id of deletes) {
  const file = path.join(C, 'furniture', `${id}.json`);
  if (!fs.existsSync(file)) continue;
  if (!DRY) fs.unlinkSync(file);
  removed++;
}
console.log(`✓ embassy-hotel-rooms: 12 rooms, ${wrote} files ${DRY ? 'to write' : 'written'}, ${removed} kitchen and dining rows ${DRY ? 'to delete' : 'deleted'}`);
