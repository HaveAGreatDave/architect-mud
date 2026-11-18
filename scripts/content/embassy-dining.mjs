// One-shot authoring pass: a dining table and chairs in every Embassy Hotel flat (zone_apt_1 .. zone_apt_12, Units
// 2A to 4D), so the people who live there can eat together. A chair for each resident, and never fewer than two.
// Unit 2D already had its table and two chairs and keeps them; Unit 3C already had its round table, and gets its
// three chairs round that.
//
//   node scripts/content/embassy-dining.mjs           place, check and write
//   node scripts/content/embassy-dining.mjs --dry     place and check, write nothing
//
// Each flat is laid out the way the roomstage plugin lays it out (stageSpec, roomPieces): its spec from `flags.room`
// with its en-suite and its building's doorways, its rows through layRows, then roomLayout. The table goes in the
// spot nearest the kitchen's hob and fridge where placeSpot's own rules take it (clear of the way in, the door's
// swing, the en-suite's door, the balcony door, the kitchen and every other piece), and its chairs round it, each
// facing the table. Then the flat is laid out again with the new rows, as the server would, and held to:
//   1. every new chair is a seat somebody can walk up to (seatApproach inside the room's bounds)
//   2. every new chair's front looks over the table's top (npc-life.js sessionJob's own test)
//   3. nothing new stands in an existing piece's box, and every seat reachable from the door before still is
// A flat that can't be given a table that passes fails the run, and nothing is written.
//
// Idempotent: the script's own rows are left out of the search, so a second run lands in the same spots and a file
// is written only when its bytes would change.
import fs from 'node:fs';
import path from 'node:path';
import { canonicalJson } from './lib.mjs';
import {
  roomSpecOf, withAnnex, annexFrame, layRows, roomLayout, placeSpot, resolveSpot, dimsOf, facing,
  seatApproach, roomPath, roomNearFree, doorwaysOf, hallOf,
} from '../../client/shared/room-layout.js';
import { walkPlans, buildingView } from '../../client/shared/building-graph.js';

// ⚠ SUPERSEDED (2026-11-16) by scripts/content/embassy-hotel-rooms.mjs: the units are hotel rooms that fit the
// hotel's GLASS model, with no kitchen and no dining set. Running this would put the tables back, so it stops.
console.log('embassy-dining: superseded by embassy-hotel-rooms.mjs; nothing to do');
process.exit(0);
const C = path.resolve(process.cwd(), 'content');
const DRY = process.argv.includes('--dry');
const readDir = (dir) => fs.readdirSync(path.join(C, dir)).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(C, dir, f), 'utf8')));
const zones = readDir('zones'), maps = readDir('maps'), furniture = readDir('furniture'), npcs = readDir('npcs');
const items = new Map(readDir('items').map((i) => [i.id, i]));
const Z = new Map(zones.map((z) => [z.id, z]));

// ── the set for each flat ────────────────────────────────────────────────────────────────────────────
// Walnut and brass on the second floor, painted over on the third, flush and cheap on the fourth. `wood` is what
// the table and chairs are made of (or painted), `fabric` each chair's seat. `small` is a table for two: a fourth-
// floor flat gets the small one first. `table: null` keeps the flat's own dining table (Unit 3C's).
const FLOOR = {
  2: { wear: 0.08, dims: null },
  3: { wear: 0.2, dims: null },
  4: { wear: 0.35, dims: [1.2, 0.8, 0.76] },
};
const SETS = {
  1: { wood: '#5a3a26', table: ['walnut dining table', 'A walnut table for two by the kitchen, with brass caps on its feet. Two places are laid, and the salt is always on the same side.'],
    chairs: [['#3f5a3a', 'A walnut dining chair with a green leather seat held on with brass tacks.'], ['#8a4a2a', 'A walnut dining chair with a rust leather seat, partner to the green one.']] },
  2: { wood: '#5a3a26', table: ['walnut dining table', 'A walnut dining table from the hotel\'s old restaurant, a brass rail round the edge of the top. The crest is stamped underneath.'],
    chairs: [['#5a1e1a', 'A walnut chair with an oxblood leather seat, from the same restaurant as the table.'], ['#5a1e1a', 'A walnut chair with an oxblood leather seat. Its brass number plate says 14.']] },
  3: { wood: '#5a3a26', table: ['walnut dining table', 'A square walnut table near the kitchen with brass corners on the top and a folded cloth in the drawer.'],
    chairs: [['#3e5e60', 'A walnut chair with a teal cushion tied to the seat.'], ['#3e5e60', 'A walnut chair with a teal cushion tied to the seat, its brass foot caps rubbed bright.']] },
  4: { keep: true },
  5: { wood: '#2a2a2c', table: ['black dining table', 'An old hotel table painted black over its varnish, chipped along the edge where the elbows go. A game schedule is pinned under the salt.'],
    chairs: [['#6e2a2a', 'A bentwood chair painted black, with an oxblood cushion.'], ['#6e2a2a', 'A bentwood chair painted black. The old varnish shows through on the rungs.']] },
  6: { wood: '#4a5a72', table: ['painted dining table', 'A pine table painted slate blue to match the walls. Case files are stacked at one end and the other end is kept clear for plates.'],
    chairs: [['#3b4a6b', 'A kitchen chair painted slate blue. ROOM 31 is stencilled on the back rail under the paint.'], ['#6a6a66', 'A kitchen chair painted slate blue, one leg shimmed with a folded beer mat.']] },
  7: { wood: '#e8e2d4', table: null,
    chairs: [['#d8b860', 'A ladder-back chair painted white over the old varnish, pulled up to the round table.'], ['#d8b860', 'A ladder-back chair painted white, with a yellow cushion tied to the seat.'], ['#a87a6a', 'A third white chair, brought up from the hotel\'s store when the third tenant moved in.']] },
  8: { wood: '#2f4a2a', table: ['drop-leaf table', 'A drop-leaf table painted bottle green over the varnish, both leaves up. A notebook usually gets there before the plates do.'],
    chairs: [['#3e5a44', 'A wooden chair painted green to match the table, the old brown showing on the rungs.'], ['#3e5a44', 'A wooden chair painted green, with a cushion in green wool.']] },
  9: { wood: '#d8d4ca', table: ['kitchen table', 'A small flush-topped table on steel legs, white laminate gone grey at the edges. There is paint on it, but less than on everything else.'],
    chairs: [['#d8cdb8', 'A white plastic stacking chair with a crack in the seat.'], ['#d8cdb8', 'A white plastic stacking chair, a dry brush left on the seat.']] },
  10: { wood: '#8a7a6a', table: ['kitchen table', 'A cheap flush table on screw-in legs under a plum cloth, which hides the edging coming away.'],
    chairs: [['#5a3a26', 'A folding chair with a padded seat in brown vinyl.'], ['#5a3a26', 'A folding chair with a padded seat in brown vinyl, one hinge tied with wire.']] },
  11: { wood: '#c8b090', table: ['kitchen table', 'A small laminate table on hairpin legs, with a glazed bowl in the middle priced like the rest.'],
    chairs: [['#a07c52', 'A plywood chair on steel legs, the seat speckled with dried slip.'], ['#a07c52', 'A plywood chair on steel legs, the seat speckled with dried slip.']] },
  12: { wood: '#6a4a32', table: ['kitchen table', 'A flush table in fake walnut laminate, the edging lifting at one corner. Manuscript paper ends up on it more often than food.'],
    chairs: [['#1f2a46', 'A vinyl kitchen chair on chrome legs, the seat split and taped in navy.'], ['#1f2a46', 'A vinyl kitchen chair on chrome legs.']] },
};

// ── the room as the Stage lays it out ───────────────────────────────────────────────────────────────
// specOf and stageSpec in plugins/roomstage/index.js: the zone's spec, its storey from its marker, its en-suite, and
// with its building's doorways when it's on a walk.
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
const plans = walkPlans({ zones: Z, maps, specOf: (z) => specById(z.id) });
const stageSpec = (id) => { const s = specById(id), b = s && plans.get(id); return b ? buildingView(b, id, s, { specOf: specById }).spec : s; };
const itemOf = (f) => (f.flags?.item_id ? items.get(f.flags.item_id) || null : null);
// roomPieces: the flat's pieces, then its en-suite's in the en-suite's own frame
const piecesOf = (spec, rows, annexRows) => {
  const main = layRows(rows, spec, { finish: spec.finish, itemOf }).pieces;
  if (!spec.annex) return { main, all: main };
  const A = annexFrame(spec);
  return { main, all: [...main, ...layRows(annexRows, A.spec, { annex: true, finish: spec.annex.finish, itemOf }).pieces] };
};

// sessionJob's test (plugins/roomstage/npc-life.js): the seat's reach lands on the table's top
const looksOver = (s, t) => {
  const reach = [s.u + s.dir[0] * 0.45, s.v + s.dir[1] * 0.45];
  const [fu, fv] = facing(t.turn), du = reach[0] - t.u, dv = reach[1] - t.v;
  const x = du * -fv + dv * fu, z = du * fu + dv * fv;
  return Math.abs(x) <= t.w / 2 + 0.05 && Math.abs(z) <= t.d / 2 + 0.05;
};
const fp = (p) => { const q = Math.round((((p.turn % 360) + 360) % 360) / 90) % 2, hw = (q ? p.d : p.w) / 2, hd = (q ? p.w : p.d) / 2; return [p.u - hw, p.u + hw, p.v - hd, p.v + hd]; };
const meets = (a, b) => a[0] < b[1] - 1e-6 && a[1] > b[0] + 1e-6 && a[2] < b[3] - 1e-6 && a[3] > b[2] + 1e-6;
const r2 = (x) => +x.toFixed(2);
const turnTo = (du, dv) => Math.round(Math.atan2(du, -dv) * 180 / Math.PI);

// Where you come in: the flat's own door in its back wall, through the hall to the landing when it has one.
function doorPoint(L) {
  const S = L.spec, o = doorwaysOf(S).find((x) => x.wall === 'back' && !x.annex) || null;
  const [a, b] = o ? [o.a, o.b] : S.door, hall = o && hallOf(S, o);
  const v = hall ? hall.v1 - 0.4 : S.d - 0.4;
  return roomNearFree(L, (a + b) / 2, v, 1.2) || roomNearFree(L, (a + b) / 2, S.d - 0.6, 1.5);
}
// Every seat's walk-up spot and whether the door reaches it.
function reachable(L) {
  const from = doorPoint(L), out = new Map();
  L.seats.forEach((s, i) => {
    const at = seatApproach(L, s, 1.8);
    out.set(`${s.piece}#${s.kind}#${i}`, { s, ok: !!(from && at && roomPath(L, from, at)) });
  });
  return { from, out };
}
const seatKey = (s, L) => `${s.piece}#${s.kind}#${L.seats.indexOf(s)}`;

// Where the chairs go round a table at `t` ({u, v, turn, w, d}): the slots on its two long sides (`a` and `b`, the
// middle or a pair either side of it) and its two ends, each a chair's middle 0.1 m off the edge, facing in.
const CHAIR = dimsOf('seat', 0, { look: { arche: 'seat', form: 'chair' } }), GAP = 0.1;
function slots(t) {
  const [fu, fv] = facing(t.turn), su = -fv, sv = fu, out = {};
  const at = (x, z) => [t.u + su * x + fu * z, t.v + sv * x + fv * z];
  const side = t.d / 2 + GAP + CHAIR[1] / 2, end = t.w / 2 + GAP + CHAIR[1] / 2, pair = Math.min(0.42, t.w / 2 - CHAIR[0] / 2 - 0.02);
  const put = (k, x, z) => { const [u, v] = at(x, z); out[k] = { at: [r2(u), r2(v)], turn: turnTo(t.u + su * x - u, t.v + sv * x - v) }; };
  put('a0', 0, side); put('b0', 0, -side); put('a-', -pair, side); put('a+', pair, side); put('b-', -pair, -side); put('b+', pair, -side);
  put('e1', -end, 0); put('e2', end, 0);
  return out;
}
// The arrangements to try for n chairs, the sociable ones first: across the table from each other, then round it.
const PATTERNS = {
  2: [['a0', 'b0'], ['e1', 'e2'], ['a0', 'e1'], ['a0', 'e2'], ['b0', 'e1'], ['b0', 'e2'], ['a-', 'a+'], ['b-', 'b+']],
  3: [['a0', 'b0', 'e1'], ['a0', 'b0', 'e2'], ['a-', 'a+', 'b0'], ['b-', 'b+', 'a0'], ['a0', 'e1', 'e2'], ['b0', 'e1', 'e2'], ['a-', 'a+', 'e1'], ['a-', 'a+', 'e2'], ['b-', 'b+', 'e1'], ['b-', 'b+', 'e2']],
  4: [['a-', 'a+', 'b-', 'b+'], ['a0', 'b0', 'e1', 'e2']],
};

const fails = [], report = [], writes = [];
for (let n = 1; n <= 12; n++) {
  const zid = `zone_apt_${n}`, zone = Z.get(zid), set = SETS[n];
  const floor = parseInt(zone.marker, 10), F = FLOOR[floor];
  const residents = npcs.filter((x) => x.home_zone === zid);
  const want = Math.max(2, residents.length);
  const spec = stageSpec(zid);
  const annexId = spec.annex?.zone;
  const tableId = `furn_apt${n}_dining`, chairId = (i) => `furn_apt${n}_dining_chair_${i + 1}`;
  const ours = new Set([tableId, ...Array.from({ length: 6 }, (_, i) => chairId(i))]);
  const rows = furniture.filter((f) => f.zone_id === zid && (set.keep || !ours.has(f.id)));
  const annexRows = annexId ? furniture.filter((f) => f.zone_id === annexId) : [];
  const before = piecesOf(spec, rows, annexRows), L0 = roomLayout(spec, before.all);

  // ── Unit 2D: check what's there and leave it ──
  if (set.keep) {
    const t = L0.placed.find((p) => p.arche === 'table' && p.form === 'dining');
    const chairs = L0.seats.filter((s) => L0.placed.find((p) => p.id === s.piece && p.arche === 'seat' && p.form === 'chair') && t && looksOver(s, t));
    const R = reachable(L0), ok = chairs.length >= want && chairs.every((s) => seatApproach(L0, s, 1.8, L0.bounds) && R.out.get(seatKey(s, L0)).ok);
    report.push(`${zid} ${zone.marker}: kept ${t?.id} at [${t?.spot?.at}] turn ${t?.turn}, ${chairs.length} chairs at it (${residents.length} residents) ${ok ? 'pass' : 'FAIL'}`);
    if (!ok) fails.push(`${zid}: its own dining set doesn't pass (${chairs.length} chairs at the table)`);
    continue;
  }

  // ── where the table can stand ──
  const anchors = L0.placed.filter((p) => p.arche === 'hob' || p.arche === 'cold' || (p.arche === 'sink' && p.form === 'kitchen'));
  const anchor = anchors.length ? [anchors.reduce((s, p) => s + p.u, 0) / anchors.length, anchors.reduce((s, p) => s + p.v, 0) / anchors.length] : [spec.w / 2, spec.d / 2];
  const own = set.table === null ? before.main.find((p) => p.arche === 'table' && p.form === 'dining') : null;
  if (set.table === null && !own) { fails.push(`${zid}: expected its own dining table and found none`); continue; }
  const dimsList = own ? [own.dims] : F.dims ? [F.dims, dimsOf('table', 0, { look: { arche: 'table', form: 'dining' } })] : [dimsOf('table', 0, { look: { arche: 'table', form: 'dining' } }), [1.2, 0.8, 0.76]];
  const tables = [];
  for (const [di, dims] of dimsList.entries()) {
    if (own) { tables.push({ spot: own.spot, dims, di }); continue; }
    for (let v = 0.6; v <= spec.d - 0.4; v += 0.1) for (let u = -spec.w / 2 + 0.4; u <= spec.w / 2 - 0.4; u += 0.1) for (const turn of [0, 90]) {
      const spot = { at: [r2(u), r2(v)], turn };
      if (!placeSpot(spec, before.main, 'table', dims, { form: 'dining', test: spot })) continue;
      // a table belongs to the lounge, never the bed's end of the studio (the room-stage gate, scripts/shapes/room-stage.mjs 7)
      if (spec.plan && resolveSpot(spec, spot, dims).v > spec.plan.living[3]) continue;
      tables.push({ spot, dims, di });
    }
  }
  // Every table spot with an arrangement of chairs that placeSpot takes, scored: the full-size table before the
  // small one, then the distance to the kitchen, with half a metre added for each step down the patterns, so two
  // people across a table from each other beat two side by side unless that's a lot further from the stove.
  const where = (t) => resolveSpot(spec, t.spot, t.dims);
  const cands = [];
  for (const t of tables) {
    const tp = where(t), tableRow = own ? null : { id: tableId, name: set.table[0], arche: 'table', form: 'dining', dims: t.dims, spot: t.spot, verbs: [] };
    const S = slots(tp), dist = Math.hypot(tp.u - anchor[0], tp.v - anchor[1]);
    for (const [pi, pat] of (PATTERNS[want] || PATTERNS[3]).entries()) {
      // each chair by placeSpot's rules among what's there, the table and the chairs before it
      const placed = tableRow ? [...before.main, tableRow] : [...before.main];
      let ok = true;
      for (const [i, k] of pat.entries()) {
        const spot = S[k];
        if (!placeSpot(spec, placed, 'seat', CHAIR, { form: 'chair', test: spot })) { ok = false; break; }
        placed.push({ id: chairId(i), name: 'dining chair', arche: 'seat', form: 'chair', dims: CHAIR, spot, verbs: ['sit'] });
      }
      if (ok) cands.push({ t, pat, pi, spots: pat.map((k) => S[k]), score: t.di * 100 + dist + 0.5 * pi });
    }
  }
  cands.sort((a, b) => a.score - b.score || a.t.spot.at[0] - b.t.spot.at[0] || a.t.spot.at[1] - b.t.spot.at[1] || a.t.spot.turn - b.t.spot.turn || a.pi - b.pi);

  const R0 = reachable(L0);
  let found = null, tried = 0;
  for (const c of cands) {
    // the room as the server will lay it out with the new rows
    if (++tried > 400) break;
    const newRows = makeRows(n, set, F, c.t, c.spots, own);
    const after = piecesOf(spec, [...rows, ...newRows], annexRows), L1 = roomLayout(spec, after.all);
    const verdict = check(L0, R0, L1, newRows, own ? own.id : tableId);
    if (verdict.ok) { found = { ...c, newRows, L1, verdict }; break; }
  }
  if (!found) { fails.push(`${zid} ${zone.marker}: no spot near the kitchen takes a table and ${want} chairs (${tables.length} table spots, ${tried} arrangements laid out)`); continue; }
  const T = found.L1.placed.find((p) => p.id === (own ? own.id : tableId));
  report.push(`${zid} ${zone.marker}: ${own ? `own ${own.id}` : `${tableId} (${found.t.dims.slice(0, 2).join(' x ')} m)`} at [${T.spot.at}] turn ${T.spot.turn}, ${found.pat.length} chairs ${found.pat.join(' ')} for ${residents.length} residents; ${found.verdict.note}`);
  writes.push(...found.newRows);
}

// The rows for a flat's set: the table (unless it keeps its own) and its chairs, each facing the table.
function makeRows(n, set, F, t, chairSpots, own) {
  const out = [], base = { hp: null, hp_max: null, light_type: null, lumen_output: null, object_type: 'furniture', power_draw_kw: null, price: 0, zone_id: `zone_apt_${n}` };
  if (!own) {
    const look = { arche: 'table', form: 'dining', wear: F.wear, wood: set.wood };
    if (t.dims[0] !== 1.6) look.dims = t.dims;
    out.push({ ...base, id: `furn_apt${n}_dining`, name: set.table[0], description: set.table[1], flags: { aliases: ['table', 'dining table'], look, spot: t.spot } });
  }
  chairSpots.forEach((spot, i) => {
    const [fabric, description] = set.chairs[i] || set.chairs[set.chairs.length - 1];
    out.push({ ...base, id: `furn_apt${n}_dining_chair_${i + 1}`, name: 'dining chair', description, flags: { aliases: ['chair', 'dining chair'], interactions: ['sit'], look: { arche: 'seat', form: 'chair', fabric, wear: F.wear, wood: set.wood }, spot } });
  });
  return out;
}

// The three requirements, on the room laid out again with the new rows.
function check(L0, R0, L1, newRows, tableId) {
  const T = L1.placed.find((p) => p.id === tableId);
  if (!T) return { ok: false, why: 'the table isn\'t laid out' };
  const chairIds = newRows.filter((r) => r.flags.look.arche === 'seat').map((r) => r.id);
  for (const id of chairIds) {
    const s = L1.seats.find((x) => x.piece === id);
    // 1. a seat you can walk up to
    if (!s || !seatApproach(L1, s, 1.8, L1.bounds)) return { ok: false, why: `${id} can't be walked to` };
    // 2. its front looks over the table's top
    if (!looksOver(s, T)) return { ok: false, why: `${id} doesn't look over the table` };
  }
  // 3a. nothing new stands in an existing piece's box (solid or climbed), nor out of the room
  const newIds = new Set(newRows.map((r) => r.id));
  for (const p of L1.placed.filter((q) => newIds.has(q.id))) {
    const f = fp(p);
    if (f[0] < -L1.w / 2 - 1e-6 || f[1] > L1.w / 2 + 1e-6 || f[2] < -1e-6 || f[3] > L1.d + 1e-6) return { ok: false, why: `${p.id} is through a wall` };
    if ([...L0.solid, ...L0.climb.map((c) => c.slice(0, 4))].some((b) => meets(f, b))) return { ok: false, why: `${p.id} stands in an existing piece` };
  }
  // 3b. the door still reaches every seat it reached before, and the new ones
  const R1 = reachable(L1);
  if (!R1.from) return { ok: false, why: 'no floor inside the door' };
  for (const [k, v] of R1.out) {
    const piece = v.s.piece;
    if (newIds.has(piece) && !v.ok) return { ok: false, why: `${piece} has no path from the door` };
  }
  for (const [, v] of R0.out) {
    if (!v.ok) continue;
    const same = [...R1.out.values()].find((w) => w.s.piece === v.s.piece && w.s.kind === v.s.kind && Math.abs(w.s.u - v.s.u) < 1e-6 && Math.abs(w.s.v - v.s.v) < 1e-6);
    if (!same?.ok) return { ok: false, why: `${v.s.piece} lost its path from the door` };
  }
  const was = [...R0.out.values()].filter((v) => !v.ok).map((v) => v.s.piece);
  return { ok: true, note: `${R1.out.size} seats reachable from the door${was.length ? ` (already unreachable before: ${[...new Set(was)].join(', ')})` : ''}` };
}

for (const line of report) console.log(line);
if (fails.length) {
  for (const f of fails) console.error(`✗ ${f}`);
  console.error(`\n✗ embassy-dining: ${fails.length} flat(s) without a dining set; nothing written`);
  process.exit(1);
}
let wrote = 0;
for (const row of writes) {
  const file = path.join(C, 'furniture', `${row.id}.json`), json = canonicalJson(row);
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === json) continue;
  if (!DRY) fs.writeFileSync(file, json);
  wrote++;
  console.log(`${DRY ? 'would write' : 'wrote'} content/furniture/${row.id}.json`);
}
console.log(`✓ embassy-dining: 12 flats checked, ${writes.length} rows, ${wrote} ${DRY ? 'to write' : 'written'}`);
