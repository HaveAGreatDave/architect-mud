// The Room Stage gate (docs/proposals/room-stage.md). Ten checks, no DOM, no GL:
//
//   1. The Platinum Box suite is the Room Stage's first room. Its layout (seats with their eyes and
//      facings, stations, the boxes a walker can't stand in or climbs over, the floor heights) comes
//      out of roomLayout identical to the frozen copy in booth-layout.fixture.json, which is what the
//      suite's own hard-coded layout produced before it was lifted. Move a chair on purpose and
//      re-freeze it with --update.
//   2. Every form of every archetype builds in a stub flat (gl/room-mesh.js), with no vertex that
//      isn't a number, its seats and stations where its archetype says.
//   3. placeSpot furnishes a flat to the twelve-piece cap without standing two pieces in each other.
//   3b. A sunken floor: its levels, its seats and climb lowered, the floor drawn down there.
//   4. A flat with an en-suite: you can walk from the room through the door into it and back, a piece
//      in it lands in it, and the wall between keeps you out everywhere but the door.
//   5. Every flat in content/ lays out: nothing drawn outside its room, nothing stood in anything else,
//      and nothing concealed or a shelf of something else in the payload.
//   6. A glazed room lights and draws: every pane gives a light to the renderer and a quad to look
//      through, and a screen doesn't hang across a window.
//   7. A studio keeps its parts: walked from the door, every flat reaches every seat and every thing
//      you can use, the lounge and the en-suite, with the way in clear; the kitchen's pieces are in
//      the kitchen, the bed in the back of the room, and the rest out of the kitchen.
//   8. A balcony you can stand on: through its door and no other way, stopped by the rail, none on
//      the ground floor; every set says where its picture goes and which of the screen batch is its own.
//   9. Somebody else can cross every flat: a way from the door to every seat and thing you can use,
//      on free floor the whole way.
//  10. A building's doorways: every open one cut, walked through from just inside it, the one in the
//      window wall taking the window, and a shut one left as wall.
//
// `node scripts/shapes/room-stage.mjs [--update]`
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { createHash } from 'crypto';
import { boothLayout } from '../../client/game/js/panels/gl/booth-mesh.js';
import { buildRoom, withShells } from '../../client/game/js/panels/gl/room-mesh.js';
import { STRIDE } from '../../client/game/js/panels/gl/ballpark-mesh.js';
import { buildingGraph, buildingLayout, roomOpenings, placeFrom, ROOM_GAP } from '../../client/shared/building-graph.js';
import { roomLayout, roomSpecOf, placeSpot, archetypeOf, dimsOf, formOf, ARCHETYPES, FORMS, withAnnex, annexFrame, roomFree, roomStep, inAnnex, onBalcony, layRows, rowDrawn, roomPath, roomNearFree, pathLength, withDoorways, doorwaysOf, openingCrossed, openingInside } from '../../client/shared/room-layout.js';

const FIXTURE = new URL('./booth-layout.fixture.json', import.meta.url);
const fails = [];
const fail = (m) => fails.push(m);

// ── 1. the suite ───────────────────────────────────────────────────────────────────────────────
{
  const spec = { at: [-138.59, 16.97], d: 32, face: 45, floor: 38.5, h: 8.5, w: 30 };
  const L = boothLayout(spec);
  const r6 = (x) => Math.round(x * 1e6) / 1e6;
  const ground = [];
  for (let u = -15; u <= 15; u += 0.5) for (let v = 0; v <= 32; v += 0.5) ground.push(L.groundAt(u, v));
  const now = {
    seats: L.seats.map((s) => ({ kind: s.kind, i: s.i, u: r6(s.u), v: r6(s.v), y: r6(s.y), yaw: r6(s.yaw), pitch: r6(s.pitch), eye: s.eye.map(r6) })),
    stations: L.stations.map((s) => ({ target: s.target, u: s.u, v: s.v, y: s.y, reach: s.reach, behind: s.behind })),
    solid: L.solid, climb: L.climb, bounds: L.bounds, radius: L.radius,
    ground: createHash('sha256').update(JSON.stringify(ground)).digest('hex'),
    world: L.world(3, 4, 5).map(r6), local: L.local([1, 2, 3]).map(r6),
  };
  if (process.argv.includes('--update')) writeFileSync(FIXTURE, JSON.stringify(now) + '\n');
  const was = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  for (const k of Object.keys(was)) if (JSON.stringify(was[k]) !== JSON.stringify(now[k])) fail(`the suite's ${k} moved from booth-layout.fixture.json (re-freeze with --update if that was meant)`);
}

// ── 2. every form in a stub flat ───────────────────────────────────────────────────────────────
{
  const REF = { seat: 6000, bench: 15000, sofa: 25000, bed: 60000, screen: 12000, cold: 50000, hob: 25000, surface: 40000, small: 5000, prop: 18000 };
  // each form in the room it would meet: a plain flat, and a fine one with glass and an en-suite
  for (const spec of [roomSpecOf({ room: [5, 6, 2.6] }, true), withAnnex(roomSpecOf({ room: { w: 8, d: 9, h: 3, glass: ['front', 'left'], finish: 'fine' } }, true), 'bath', 'bath')])
  for (const [arche, forms] of Object.entries(FORMS)) for (const form of forms) {
    const flags = { look: { arche, form }, ...(form === 'crt' ? { tv_skin: 'crt' } : {}) };
    if (formOf(arche, flags, REF[arche] || 0) !== form) { fail(`${arche}/${form}: flags.look.form isn't honoured`); continue; }
    const dims = dimsOf(arche, REF[arche] || 0, flags), spot = placeSpot(spec, [], arche, dims, { crt: form === 'crt', form });
    if (!spot) { fail(`${arche}/${form}: no spot in an empty flat`); continue; }
    const piece = { id: 'p', name: 'piece', arche, form, dims, crt: form === 'crt', spot, wear: 0.6, seed: 12345 };
    const L = roomLayout(spec, [piece]);
    let m;
    try { m = buildRoom(L, { seed: 3, lampOn: true }); } catch (e) { fail(`${arche}/${form}: buildRoom threw ${e.message}`); continue; }
    let n = 0, bad = 0;
    for (const b of [m.solid, m.screen, m.glass, m.view, ...m.textured.values()]) { n += b.n; for (let i = 0; i < b.n * 12; i++) if (!Number.isFinite(b.data[i])) bad++; }
    if (bad) fail(`${arche}/${form}: ${bad} vertex values aren't numbers`);
    const sits = L.seats.filter((s) => s.piece === 'p'), uses = L.stations.filter((s) => s.piece === 'p');
    const wantSit = ['seat', 'bench', 'sofa', 'bed'].includes(arche);
    if (wantSit && !sits.length) fail(`${arche}/${form}: no seat`);
    if (!wantSit && !uses.length) fail(`${arche}/${form}: no station`);
    if (uses.some((s) => s.verb !== ARCHETYPES[arche].verb)) fail(`${arche}/${form}: a station answers to the wrong verb`);
    if (!n) fail(`${arche}/${form}: drew nothing`);
  }
}

// ── 3. a flat furnished to the cap ─────────────────────────────────────────────────────────────
{
  const sold = [[{ tv: true, interactions: ['watch'] }, 14000], [{ interactions: ['sit', 'lie'] }, 20000], [{ container: 15000 }, 22000], [{ stove_tier: 'mid' }, 32000],
    [{ interactions: ['sit'] }, 3000], [{ interactions: ['lie'] }, 60000], [{ interactions: ['lift'] }, 5200], [{ interactions: ['lean'] }, 80000],
    [{ interactions: ['sit'] }, 12000], [{ microwave: true }, 15000], [{ interactions: ['sit'] }, 8000], [{ interactions: [] }, 18000]];
  const spec = roomSpecOf({}, true), pieces = [];
  for (const [i, [flags, g]] of sold.entries()) {
    const arche = archetypeOf(flags, g), dims = dimsOf(arche, g, flags), spot = placeSpot(spec, pieces, arche, dims);
    if (spot) pieces.push({ id: `p${i}`, arche, dims, spot });
  }
  const L = roomLayout(spec, pieces);
  const fp = (p) => { const q = Math.round(((p.turn % 360) + 360) % 360 / 90) % 2, hw = (q ? p.d : p.w) / 2, hd = (q ? p.w : p.d) / 2; return [p.u - hw, p.u + hw, p.v - hd, p.v + hd]; };
  const floor = L.placed.filter((p) => !(p.arche === 'screen' && !p.crt)).map(fp);
  for (let i = 0; i < floor.length; i++) for (let j = i + 1; j < floor.length; j++) {
    const a = floor[i], b = floor[j];
    if (a[0] < b[1] - 1e-6 && a[1] > b[0] + 1e-6 && a[2] < b[3] - 1e-6 && a[3] > b[2] + 1e-6) fail(`placeSpot stood ${L.placed[i].id} in ${L.placed[j].id}`);
  }
  if (pieces.length < 8) fail(`placeSpot found room for only ${pieces.length} of ${sold.length} pieces in a default flat`);
}

// ── 3b. a sunken floor ─────────────────────────────────────────────────────────────────────
{
  const spec = roomSpecOf({ room: { w: 12, d: 13, h: 3, finish: 'fine', ground: 'stone', pit: { at: [-3, 3, 2, 8], depth: 0.4, step: 0.4 } } }, true);
  if (!spec.pit || spec.ground !== 'stone') fail('a room lost its pit or its stone floor on the way into the spec');
  const sofa = { id: 's', name: 'sofa', arche: 'sofa', form: 'sofa', dims: [2.4, 0.9, 0.72], spot: { at: [0, 5], turn: 0 } }, up = { id: 'u', name: 'chair', arche: 'seat', form: 'chair', dims: [0.6, 0.6, 0.9], spot: { at: [-4.5, 5], turn: 0 } };
  const flat = roomLayout({ ...spec, pit: undefined }, [sofa, up]), L = roomLayout(spec, [sofa, up]);
  const at = (X, id) => X.seats.find((s) => s.piece === id);
  if (Math.abs(L.groundAt(-4.5, 1) - 0) > 1e-9 || Math.abs(L.groundAt(-2.8, 5) + 0.2) > 1e-9 || Math.abs(L.baseAt(1.5, 3.5) + 0.4) > 1e-9) fail(`the pit's levels are wrong: ${L.groundAt(-2.8, 5)} on the ledge, ${L.baseAt(1.5, 3.5)} on its floor`);
  if (Math.abs(at(L, 's').y - (at(flat, 's').y - 0.4)) > 1e-9) fail('a seat in a pit stayed at the height of the room');
  if (at(L, 'u').y !== at(flat, 'u').y) fail('a seat on the floor beside a pit moved');
  if (L.climb.find((c) => c[4] < 0.1 && c[4] > -0.1) === undefined) fail("a sofa in a pit kept the height of its seat in the room");
  const m = buildRoom(L, { seed: 3, lampOn: true });
  let low = Infinity, bad = 0;
  for (const b of [m.solid, ...m.textured.values()]) for (let i = 0; i < b.n; i++) { const y = b.data[i * 12 + 1]; if (!Number.isFinite(y)) bad++; else if (y < low && y > -0.15 - 0.42) low = y; }
  if (bad) fail(`a room with a pit has ${bad} vertices that aren't numbers`);
  if (!(low <= -0.39)) fail(`nothing was drawn at the pit's floor: the lowest is ${low}`);
  if (placeSpot(spec, [], 'table', [1, 1, 0.5], { form: 'dining' })?.at && roomLayout(spec, [{ id: 't', arche: 'table', dims: [1, 1, 0.5], spot: placeSpot(spec, [], 'table', [1, 1, 0.5]) }]).placed[0].y0) fail('placeSpot stood a piece in a pit');
}

// ── 4. an en-suite ─────────────────────────────────────────────────────────────────────────────
{
  const spec = withAnnex(roomSpecOf({ room: { w: 6, d: 7, h: 2.8 } }, true), 'bath', 'the bath');
  const A = annexFrame(spec), toilet = { id: 't', name: 'toilet', arche: 'toilet', form: 'pan', dims: dimsOf('toilet', 0, {}), annex: true };
  toilet.spot = placeSpot(A.spec, [], 'toilet', toilet.dims, { form: 'pan' });
  const L = roomLayout(spec, [toilet]), [a, b] = spec.annex.door, mid = (a + b) / 2;
  const t = L.placed[0];
  if (!(t.v > A.v0 && t.v < A.v0 + spec.annex.d && t.u > A.u0 && t.u < A.u1)) fail(`an en-suite's piece landed outside it: ${t.u.toFixed(2)},${t.v.toFixed(2)}`);
  if (L.solid.some(([u0, u1, v0, v1]) => mid > u0 - L.radius && mid < u1 + L.radius && v1 > A.v0 && v0 < A.v0 + 0.7)) fail('a piece blocks the way in from the en-suite door');
  // walk straight through the door and back
  let p = [mid, L.d - 1];
  for (let i = 0; i < 80; i++) p = roomStep(L, p, 0, 0.05);
  if (!inAnnex(L, p[1])) fail(`walking at the en-suite's door stopped at v ${p[1].toFixed(2)}, short of it (${A.v0})`);
  for (let i = 0; i < 90; i++) p = roomStep(L, p, 0, -0.05);
  if (inAnnex(L, p[1])) fail('walking back out of the en-suite stopped inside it');
  // and nowhere else through the wall
  for (const u of [a - 0.3, b + 0.3]) if (roomFree(L, u, L.d + 0.07)) fail(`the wall by the en-suite door can be walked through at u ${u.toFixed(2)}`);
  // nobody hangs a set on the doorway to it, or stands a wardrobe in it
  const big = placeSpot(spec, [], 'wardrobe', dimsOf('wardrobe', 0, {}), { form: 'wardrobe', wall: 'back' }), L2 = roomLayout(spec, [{ id: 'w', name: 'w', arche: 'wardrobe', form: 'wardrobe', dims: dimsOf('wardrobe', 0, {}), spot: big }]);
  const w = L2.placed[0];
  if (w.u + w.w / 2 > a && w.u - w.w / 2 < b) fail('a wardrobe stood in the en-suite door');
}

// ── 5. every flat in content/ ──────────────────────────────────────────────────────────────────
const flatLayouts = [];
{
  const dir = new URL('../../content/', import.meta.url);
  const read = (d) => readdirSync(new URL(d, dir)).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(new URL(d + f, dir), 'utf8')));
  const zones = new Map(read('zones/').map((z) => [z.id, z])), rows = new Map();
  for (const r of read('furniture/')) { if (!rows.has(r.zone_id)) rows.set(r.zone_id, []); rows.get(r.zone_id).push(r); }
  const fp = (p) => { const q = Math.round(((p.turn % 360) + 360) % 360 / 90) % 2, hw = (q ? p.d : p.w) / 2, hd = (q ? p.w : p.d) / 2; return [p.u - hw, p.u + hw, p.v - hd, p.v + hd]; };
  for (const z of zones.values()) {
    let spec = roomSpecOf(z.flags, !!z.flags?.is_apartment);
    if (!spec) continue;
    const inner = zones.get(z.exits?.in), annex = inner?.exits?.out === z.id && inner.parent_zone === z.id ? inner : null;
    if (annex) spec = withAnnex(spec, annex.id, annex.name);
    const here = rows.get(z.id) || [], there = annex ? rows.get(annex.id) || [] : [];
    const pieces = layRows(here, spec, { finish: spec.finish }).pieces;
    if (annex) pieces.push(...layRows(there, annexFrame(spec).spec, { annex: true, finish: spec.annex.finish }).pieces);
    for (const r of [...here, ...there]) {
      if ((r.flags?.concealed || r.flags?.compartment_of) && pieces.some((p) => p.id === r.id)) fail(`${z.id}: ${r.id} is concealed or a shelf, and it's in the payload`);
    }
    const L = roomLayout(spec, pieces), A = L.annex, floor = L.placed.filter((p) => !p.on && !(p.arche === 'screen' && !p.crt) && !(p.arche === 'cabinet' && p.form !== 'vitrine' && p.form !== 'humidor')), box = floor.map(fp);
    if (spec.plan) flatLayouts.push({ id: z.id, L });
    // 7: walk it from the door
    if (spec.plan) {
      const P = spec.plan, step = 0.1, [a, b, c, e] = L.outer, nu = Math.ceil((b - a) / step) + 1, seen = new Set(), key = (i, j) => i * 4096 + j;
      const start = [(spec.door[0] + spec.door[1]) / 2, L.d - 0.6], i0 = Math.round((start[0] - a) / step), j0 = Math.round((start[1] - c) / step), todo = [[i0, j0]];
      seen.add(key(i0, j0));
      if (!roomFree(L, start[0], start[1])) fail(`${z.id}: the way in is blocked where you start`);
      while (todo.length) {
        const [i, j] = todo.pop();
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ni = i + di, nj = j + dj, u = a + ni * step, v = c + nj * step;
          if (ni < 0 || ni >= nu || u > b || v > e || nj < 0 || seen.has(key(ni, nj)) || !roomFree(L, u, v)) continue;
          seen.add(key(ni, nj)); todo.push([ni, nj]);
        }
      }
      const cells = [...seen].map((n) => [a + Math.floor(n / 4096) * step, c + (n % 4096) * step]);
      const near = (u, v, r) => cells.some(([x, y]) => Math.hypot(x - u, y - v) < r);
      for (const s of L.stations) if (!near(s.u, s.v, s.reach)) fail(`${z.id}: nobody can reach ${s.piece}`);
      for (const s of L.seats) if (!near(s.u, s.v, 1.2)) fail(`${z.id}: nobody can reach the seat on ${s.piece}`);
      if (!near((P.living[0] + P.living[1]) / 2, P.living[3] * 0.5, 1.5)) fail(`${z.id}: the lounge can't be walked to from the door`);
      if (A && !near(A.cu, A.v0 + 0.5, 0.3)) fail(`${z.id}: the en-suite can't be walked to from the door`);
      if (spec.balcony && !near((spec.balcony.door[0] + spec.balcony.door[1]) / 2, -0.14 - spec.balcony.d / 2, 0.3)) fail(`${z.id}: the balcony can't be walked to from the door`);
      // and each kind of thing in its own part of the room
      const within = (p, q) => p.u >= q[0] - 0.01 && p.u <= q[1] + 0.01 && p.v >= q[2] - 0.01 && p.v <= q[3] + 0.01;
      for (const p of L.placed) {
        if (p.annex || p.on) continue;
        const cooks = p.arche === 'cold' || (p.arche === 'hob' && p.form !== 'microwave') || (p.arche === 'sink' && p.form !== 'basin');
        if (cooks && !within(p, P.kitchen)) fail(`${z.id}: ${p.id} (${p.form}) isn't in the kitchen`);
        if (!cooks && within(p, P.kitchen) && p.arche !== 'cabinet' && p.arche !== 'hob' && !(p.arche === 'surface' && p.form === 'counter')) fail(`${z.id}: ${p.id} (${p.form}) is in the kitchen`);
        // a row that fixes its own spot has been told where to stand (the crown's bed is under the north glass)
        if (p.arche === 'bed' && !(p.v > L.d * 0.5) && !here.find((r) => r.id === p.id)?.flags?.spot) fail(`${z.id}: ${p.id} isn't in the back of the room`);
        if ((p.arche === 'sofa' || p.arche === 'table') && p.v > P.living[3]) fail(`${z.id}: ${p.id} isn't in the lounge`);
      }
    }
    floor.forEach((p, i) => {
      const [u0, u1, v0, v1] = box[i], [a, b, c, e] = p.annex ? [A.u0, A.u1, A.v0, A.v0 + spec.annex.d] : [-L.w / 2, L.w / 2, 0, L.d];
      if (u0 < a - 0.01 || u1 > b + 0.01 || v0 < c - 0.01 || v1 > e + 0.01) fail(`${z.id}: ${p.id} stands outside its room`);
      // a pit's banquette is a ring round its wall, so a runway passes over its middle on purpose
      const ring = (x) => x.form === 'banquette';
      for (let j = i + 1; j < floor.length; j++) { const q = box[j]; if (ring(p) || ring(floor[j])) continue; if (u0 < q[1] - 0.01 && u1 > q[0] + 0.01 && v0 < q[3] - 0.01 && v1 > q[2] + 0.01) fail(`${z.id}: ${p.id} stands in ${floor[j].id}`); }
    });
  }
}

// ── 6. a glazed room ───────────────────────────────────────────────────────────────────────────
{
  const spec = withAnnex(roomSpecOf({ room: { w: 9, d: 10, h: 3, glass: ['front', 'left'], finish: 'fine' } }, true), 'bath', 'bath');
  const dims = dimsOf('screen', 12000, {}), spot = placeSpot(spec, [], 'screen', dims);
  if (spot?.wall === 'left' || spot?.wall === 'front') fail(`a screen hung on the glass (${spot.wall})`);
  const m = buildRoom(roomLayout(spec, []), { seed: 5, lampOn: true });
  if (m.windows.length !== spec.windows.length) fail(`${spec.windows.length} panes gave ${m.windows.length} lights`);
  if (m.view.n < spec.windows.length * 6) fail('a pane has nothing to look through');
  if (!m.lamps.some((l) => l.annex) || m.lamps[m.lamps.length - 1].annex !== true) fail("the en-suite's lamp isn't the last, which is how gl/room-light.js keeps it in there");
  if (m.lamps.length > 6) fail(`${m.lamps.length} lamps, and gl/room-light.js has room for six`);
  for (const r of [{ object_type: 'fixture', flags: {} }, { object_type: 'container', flags: { concealed: true } }, { object_type: 'container', flags: { compartment_of: 'x' } }]) if (rowDrawn(r)) fail(`${JSON.stringify(r)} shouldn't be drawn`);
}

// ── 8. a balcony, and a set ────────────────────────────────────────────────────────────────────
{
  const spec = roomSpecOf({ room: { w: 12, d: 13, h: 3, glass: ['front', 'left'], finish: 'fine' } }, true, { storey: 30 });
  if (!spec.balcony) fail('a tower flat has no balcony');
  else {
    const L = roomLayout(spec, []), [a, b] = spec.balcony.door, mid = (a + b) / 2;
    if (spec.windows.some((q) => q.wall === 'front' && q.a < b && q.b > a)) fail('a pane stands across the balcony door');
    let p = [mid, 2];
    for (let i = 0; i < 80; i++) p = roomStep(L, p, 0, -0.05);
    if (p[1] > -0.5) fail(`walking at the balcony door stopped at v ${p[1].toFixed(2)}`);
    if (p[1] < -0.14 - spec.balcony.d) fail(`walking off the balcony got to v ${p[1].toFixed(2)}, past the rail`);
    for (const u of [a - 0.4, b + 0.4]) if (roomFree(L, u, -0.07)) fail(`the front wall can be walked through at u ${u.toFixed(2)}`);
  }
  // a wrapped deck: all the way round, no way through a wall, and the back of it isn't the en-suite
  {
    const s = withAnnex(roomSpecOf({ room: { w: 16, d: 18, h: 5, glass: ['front', 'left'], finish: 'fine', ensuite: { w: 4.2, d: 4.4 }, balcony: { wrap: 'all' } } }, true, { storey: 30 }), 'bath', 'bath'), B = s.balcony, L = roomLayout(s, []);
    if (!B?.wrap) fail('balcony: { wrap } did not wrap');
    else {
      if (B.wrap <= annexFrame(s).v0 + s.annex.d) fail(`the block ends at v ${B.wrap}, inside the en-suite`);
      let p = [(B.door[0] + B.door[1]) / 2, -1.2];
      const walk = (du, dv, n, ok, what) => { for (let i = 0; i < n; i++) p = roomStep(L, p, du, dv); if (!ok(p)) fail(`${what}: stopped at ${p.map((x) => x.toFixed(2))}`); if (!onBalcony(s, p)) fail(`${what}: ${p.map((x) => x.toFixed(2))} isn't on the balcony`); if (inAnnex(L, p[1], p[0])) fail(`${what}: ${p.map((x) => x.toFixed(2))} counts as the en-suite`); };
      walk(0.05, 0, 400, (q) => q[0] > 8.5 && q[0] <= B.u[1], 'east along the front');
      walk(0, 0.05, 900, (q) => q[1] > B.wrap && q[1] <= B.wrap + B.d, 'down the east side');
      walk(-0.05, 0, 900, (q) => q[0] < -8.5 && q[0] >= B.u[0], 'along the back');
      walk(0, -0.05, 900, (q) => q[1] < 0 && q[1] >= -0.14 - B.d, 'up the west side');
      if (onBalcony(s, [0, 5]) || onBalcony(s, [annexFrame(s).cu, annexFrame(s).v0 + 1])) fail('onBalcony says the flat is outdoors');
      if (!inAnnex(L, annexFrame(s).v0 + 1, annexFrame(s).cu)) fail('the en-suite stopped being the en-suite');
      for (const q of [[8.07, 6], [-8.07, 15], [4, 18.07], [0, B.wrap - 0.05]]) if (roomFree(L, q[0], q[1])) fail(`the wall can be walked through at ${q}`);
      if (!buildRoom(L, { seed: 2, lampOn: true })) fail('a wrapped balcony did not build');
    }
    if (roomSpecOf({ room: { w: 12, d: 13, h: 3, finish: 'fine' } }, true, { storey: 30 }).balcony.wrap) fail('a balcony wrapped without being asked to');
  }
  if (roomSpecOf({ room: { w: 12, d: 13, h: 3 } }, true, { storey: 1 }).balcony) fail('a ground-floor flat has a balcony');
  if (roomSpecOf({ room: { w: 12, d: 13, h: 3, balcony: false } }, true).balcony) fail('balcony: false still has one');
  // a sash flat's door goes beside its window
  const plain = roomSpecOf({}, true, { storey: 3 });
  if (plain.balcony && plain.balcony.door[1] > plain.window[0]) fail("a plain flat's balcony door is in its window");
  const dims = dimsOf('screen', 12000, {}), L = roomLayout(plain, [{ id: 's', name: 's', arche: 'screen', form: 'flat', dims, spot: placeSpot(plain, [], 'screen', dims) }]);
  const m = buildRoom(L, { seed: 2, lampOn: true });
  if (m.screens.length !== 1 || m.screens[0].id !== 's') fail('a set has no screen to put the broadcast on');
  // each set owns its stretch of the screen batch, so the one that's on can be drawn alone
  if (!(m.screens[0].count > 0) || m.screens[0].first !== 0 || m.screens[0].count !== m.screen.n) fail('a set does not say which of the screen batch is its own');
}

// ── 9. somebody else crossing the room ─────────────────────────────────────────────────────────
{
  for (const f of flatLayouts) {
    const { id, L } = f, door = [((L.spec.door?.[0] ?? 0.7) + (L.spec.door?.[1] ?? 1.6)) / 2, L.spec.d - 0.6];
    const goals = [...L.seats, ...L.stations].filter((g) => !inAnnex(L, g.v) && g.v > 0);
    for (const g of goals) {
      const stand = roomNearFree(L, g.u, g.v, 1.8, L.bounds);
      if (!stand) { fail(`${id}: nowhere to stand by ${g.piece}`); continue; }
      const path = roomPath(L, door, stand);
      if (!path) { fail(`${id}: no way from the door to ${g.piece}`); continue; }
      if (pathLength(path) > 3 * (L.w + L.d)) fail(`${id}: the way to ${g.piece} is ${pathLength(path).toFixed(1)} m`);
      for (let i = 1; i < path.length; i++) {
        const [a, b] = [path[i - 1], path[i]], n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.1);
        for (let k = 1; k < n; k++) if (!roomFree(L, a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n)) { fail(`${id}: the way to ${g.piece} goes through something`); k = n; i = path.length; }
      }
    }
  }
}

// ── 10. a building's doorways (docs/proposals/building-stage.md) ──────────────────────────────────
// A doorway on every wall: each one cut, walked through and come back from, the one on the window wall
// taking the window, one over the flat's own door taking that, and a shut one left as wall.
{
  const base = roomSpecOf({ room: { w: 6, d: 5, h: 3, studio: false, balcony: false } }, false);
  const ops = [
    { wall: 'front', a: -0.45, b: 0.45, kind: 'door', dir: 'north', to: 'n' },
    { wall: 'back', a: base.door[0], b: base.door[1], kind: 'door', dir: 'south', to: 's' },
    { wall: 'left', a: 2, b: 2.9, kind: 'door', dir: 'west', to: 'w' },
    { wall: 'right', a: 2, b: 2.9, kind: 'shut', dir: 'east', to: 'e' },
  ];
  const spec = withDoorways(base, ops), L = roomLayout(spec, []);
  if (!spec.windowless) fail('a doorway in the window wall left the window standing');
  if (doorwaysOf(spec).length !== 3) fail(`${doorwaysOf(spec).length} doorways, not the three open ones`);
  for (const o of doorwaysOf(spec)) {
    const inside = openingInside(L, o);
    if (!roomFree(L, ...inside.at) || openingCrossed(L, inside.at)) fail(`${o.wall}: just inside the doorway isn't in the room`);
    const step = o.wall === 'front' ? [0, -0.05] : o.wall === 'back' ? [0, 0.05] : [-0.05, 0];
    let p = inside.at.slice();
    for (let i = 0; i < 60 && !openingCrossed(L, p); i++) p = roomStep(L, p, ...step);
    if (openingCrossed(L, p)?.dir !== o.dir) fail(`${o.wall}: walking at the doorway never went through it (stopped at ${p.map((x) => x.toFixed(2))})`);
  }
  if (roomFree(L, base.w / 2 + 0.2, 2.45)) fail('a shut door can be walked through');
  let m = null;
  try { m = buildRoom(L, { seed: 4, lampOn: true }); } catch (e) { fail(`a room with doorways threw ${e.message}`); }
  if (m && m.windows.length) fail(`a windowless room drew ${m.windows.length} panes`);
}

// ── 10b. furniture keeps out of a doorway ───────────────────────────────────────────────────────────
// The four-doorway room above, furnished as far as placeSpot will go: no piece on the floor reaches into
// the way through a doorway, half a metre in, so nobody walks into a sofa coming through.
{
  const base = roomSpecOf({ room: { w: 6, d: 5, h: 3, studio: false, balcony: false } }, false);
  const spec = withDoorways(base, [
    { wall: 'front', a: -0.45, b: 0.45, kind: 'door', dir: 'north', to: 'n' },
    { wall: 'back', a: -1.45, b: -0.55, kind: 'door', dir: 'south', to: 's' },
    { wall: 'left', a: 2, b: 2.9, kind: 'door', dir: 'west', to: 'w' },
    { wall: 'right', a: 2, b: 2.9, kind: 'door', dir: 'east', to: 'e' },
  ]);
  const sold = [[{ interactions: ['sit', 'lie'] }, 20000], [{ interactions: ['lie'] }, 60000], [{ container: 15000 }, 22000], [{ interactions: ['sit'] }, 3000],
    [{ interactions: ['lean'] }, 80000], [{ interactions: ['sit'] }, 12000], [{ interactions: [] }, 18000], [{ interactions: ['sit'] }, 8000]];
  const pieces = [];
  for (const [i, [flags, g]] of sold.entries()) {
    const arche = archetypeOf(flags, g), dims = dimsOf(arche, g, flags), spot = placeSpot(spec, pieces, arche, dims);
    if (spot) pieces.push({ id: `d${i}`, arche, dims, spot });
  }
  if (pieces.length < 4) fail(`only ${pieces.length} pieces fitted round four doorways`);
  const hu = spec.w / 2, D = spec.d, k = 0.5;
  const ways = doorwaysOf(spec).map((o) => o.wall === 'front' ? [o.a, o.b, 0, k] : o.wall === 'back' ? [o.a, o.b, D - k, D] : o.wall === 'left' ? [-hu, -hu + k, o.a, o.b] : [hu - k, hu, o.a, o.b]);
  for (const p of roomLayout(spec, pieces).placed) {
    if (p.arche === 'screen' && !p.crt) continue;
    const q = Math.round(((p.turn % 360) + 360) % 360 / 90) % 2, hw = (q ? p.d : p.w) / 2, hd = (q ? p.w : p.d) / 2;
    for (const w of ways) if (p.u - hw < w[1] && p.u + hw > w[0] && p.v - hd < w[3] && p.v + hd > w[2]) fail(`a ${p.arche} stands in a doorway (${[p.u, p.v].map((x) => x.toFixed(2))})`);
  }
}

// ── 11. the rooms one doorway away (docs/proposals/building-stage.md, step 4) ───────────────────────
// A landing with six doorways, two each on its north and south walls and one east and west, run through
// the real pipeline: graph, plan, openings, placeFrom. Every doorway meets its room's across the
// wall between, every room comes back through it, no wall of the rooms beyond stands inside the landing,
// the shells add to the landing's batches whole, and building all seven stays cheap.
{
  const room = (w, d, extra = {}) => ({ room: { w, d, h: 3, studio: false, balcony: false, face: 0, ...extra } });
  const zones = [
    { id: 'st', map_id: 'map_world', flags: {}, exits: { up: 'L' } },
    { id: 'L', map_id: 'm', flags: room(8, 6, { doors: { north: -1.5, out: 1.5, south: -1.5, in: 1.5 } }), exits: { north: 'n1', out: 'n2', south: 's1', in: 's2', east: 'e', west: 'w', down: 'st' } },
    { id: 'n1', map_id: 'm', flags: room(2.5, 4), exits: { south: 'L' } }, { id: 'n2', map_id: 'm', flags: room(2.5, 4), exits: { in: 'L' } },
    { id: 's1', map_id: 'm', flags: room(2.5, 4), exits: { north: 'L' } }, { id: 's2', map_id: 'm', flags: room(2.5, 4), exits: { out: 'L' } },
    { id: 'e', map_id: 'm', flags: room(4, 4), exits: { west: 'L' } }, { id: 'w', map_id: 'm', flags: room(4, 4), exits: { east: 'L' } },
  ];
  const Z = new Map(zones.map((q) => [q.id, q])), specOf = (q) => roomSpecOf(q.flags, false);
  const b = buildingGraph({ zones, maps: [{ id: 'm', parent_zone_id: 'st', entry_zone_id: 'L' }], specOf }).get('m');
  const plan = buildingLayout(b, { zones, specOf });
  if (plan.problems.length) fail(`the landing's plan: ${plan.problems.map((p) => p.kind).join(', ')}`);
  const here = withDoorways(specOf(Z.get('L')), roomOpenings(b, plan, 'L')), Lh = roomLayout(here, []), doors = doorwaysOf(here);
  if (doors.length !== 6) fail(`the landing has ${doors.length} doorways, not six`);
  const nextSpec = (id) => ({ ...withDoorways(specOf(Z.get(id)), roomOpenings(b, plan, id)), ...placeFrom(plan, 'L', id) });
  const mid = (L, q) => { const c = (q.a + q.b) / 2, S = L.spec; return q.wall === 'front' ? L.world(c, 0, 0) : q.wall === 'back' ? L.world(c, S.d, 0) : L.world((q.wall === 'right' ? 1 : -1) * S.w / 2, c, 0); };
  for (const o of doors) {
    const Ln = roomLayout(nextSpec(o.to), []), back = doorwaysOf(Ln.spec).find((q) => q.to === 'L');
    if (!back) { fail(`${o.to}: no doorway back to the landing`); continue; }
    const [p, q] = [mid(Lh, o), mid(Ln, back)], gap = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    if (Math.abs(gap - ROOM_GAP) > 0.01) fail(`${o.to}: its doorway is ${gap.toFixed(3)} m from the landing's, not across one wall (${ROOM_GAP})`);
  }
  const t0 = process.cpuUsage();
  const shells = doors.map((o) => buildRoom(roomLayout(nextSpec(o.to), []), { seed: 7, lampOn: true, joined: new Set(['L']) }));
  const own = buildRoom(Lh, { seed: 7, lampOn: true, joined: new Set(doors.map((o) => o.to)) }), ownN = own.solid.n;
  const all = withShells(own, shells), ms = (() => { const u = process.cpuUsage(t0); return (u.user + u.system) / 1000; })();
  if (all.solid.n !== ownN + shells.reduce((s, m) => s + m.solid.n, 0)) fail('the shells did not add to the landing whole');
  // the landing is at the origin facing 0, so its floor is x in [-4, 4] and z in [-6, 0]
  let inside = 0, bad = 0;
  for (const m of shells) for (let i = 0; i < m.solid.n; i++) {
    const o = i * STRIDE, x = m.solid.data[o], y = m.solid.data[o + 1], zz = m.solid.data[o + 2];
    if (![x, y, zz].every(Number.isFinite)) bad++;
    else if (x > -3.99 && x < 3.99 && zz > -5.99 && zz < -0.01 && y > 0.01 && y < 2.99) inside++;
  }
  if (bad) fail(`${bad} shell vertices aren't numbers`);
  if (inside) fail(`${inside} vertices of the rooms beyond stand inside the landing`);
  if (ms > 2000) fail(`building the landing and its six shells took ${ms.toFixed(0)} ms of CPU`);
}

// ── 12. a locked doorway's door and hololock (docs/proposals/room-hololock.md) ──────────────────────────
// A lock on every wall: two leaves a doorway that close it and slide clear of it, a reader on the wall,
// and a card and a board for the hologram that hang inside the room, in front of the wall they're on.
{
  const { buildLocks } = await import('../../client/game/js/panels/gl/room-lock.js');
  const { liftDoorBatch } = await import('../../client/game/js/panels/gl/room-mesh.js');
  const { quadMatrix, lockActs } = await import('../../client/game/js/panels/room-lock.js');
  const openings = [
    { wall: 'front', a: -0.45, b: 0.45, kind: 'door', dir: 'north', to: 'n' }, { wall: 'back', a: 0.6, b: 1.5, kind: 'door', dir: 'south', to: 's' },
    { wall: 'left', a: 1.2, b: 2.1, kind: 'door', dir: 'west', to: 'w' }, { wall: 'right', a: 1.2, b: 2.1, kind: 'door', dir: 'east', to: 'e' },
  ];
  const spec = withDoorways({ w: 6, d: 5, h: 3, windowless: true }, openings), L = roomLayout(spec, []);
  const ways = doorwaysOf(spec), locks = ways.map((o) => ({ to: o.to, dir: o.dir, door: 'd_' + o.to, locked: true, pass: false, yours: false, hack: true }));
  const G = buildLocks(L, ways, locks);
  if (ways.length !== 4) fail(`the lock room has ${ways.length} doorways, not 4`);
  if (G.leaves.length !== 8) fail(`${G.leaves.length} door leaves for 4 locked doorways`);
  if (G.panels.some((p) => !p)) fail('a locked doorway has no hologram');
  const nums = (a) => Array.from(a).every(Number.isFinite);
  if (!nums(G.fixed) || G.leaves.some((l) => !nums(l.rest))) fail('a lock\'s vertices aren\'t numbers');
  // shut, the two leaves fill the doorway; open, nothing of them is left in it
  const inWay = (batch, o) => {
    let n = 0;
    for (let i = 0; i < batch.n; i++) {
      const q = L.local([batch.data[i * STRIDE], batch.data[i * STRIDE + 1], batch.data[i * STRIDE + 2]]), along = o.wall === 'front' || o.wall === 'back' ? q[0] : q[1];
      if (along > o.a + 0.06 && along < o.b - 0.06) n++;
    }
    return n;
  };
  ways.forEach((o, i) => {
    const mine = G.leaves.filter((l) => l.way === i);
    const shut = liftDoorBatch(mine, 1), open = liftDoorBatch(mine, 0);
    if (!inWay(shut, o)) fail(`the ${o.dir} door shut leaves its doorway empty`);
    if (inWay(open, o)) fail(`the ${o.dir} door open still stands in its doorway`);
    const p = G.panels[i];
    for (const [name, quad] of [['card', p.card], ['board', p.board]]) for (const c of quad) {
      const q = L.local(c);
      if (!(q[0] > -3 && q[0] < 3 && q[1] > 0 && q[1] < 5)) fail(`the ${o.dir} lock's ${name} hangs outside the room at ${q.map((v) => v.toFixed(2))}`);
    }
    if (!roomFree(L, ...p.at)) fail(`nobody can stand at the ${o.dir} lock`);
  });
  {
    // a page laid over its own rectangle is the identity, moved
    const m = quadMatrix(300, 400, [[10, 20], [310, 20], [310, 420], [10, 420]]);
    if (m !== 'matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,10,20,0,1)') fail(`quadMatrix of a page's own rectangle is ${m}`);
    const verbs = (k) => lockActs({ dir: 'east', ...k }).map((a) => a.cmd).join('|');
    if (verbs({ locked: true, hack: true, yours: false }) !== 'unlock door east|hack door east') fail('a locked door you have no key to offers ' + verbs({ locked: true, hack: true, yours: false }));
    if (verbs({ locked: true, hack: true, yours: true }) !== 'unlock door east') fail('your own locked door offers ' + verbs({ locked: true, hack: true, yours: true }));
    if (verbs({ locked: true, pass: true, yours: true }) !== 'unlock door east' || lockActs({ dir: 'east', locked: true, pass: true })[0].then !== 'open door east') fail('a locked door that knows you doesn\'t unlock and then open');
    if (verbs({ locked: false }) !== 'open door east|lock door east') fail('a shut, unlocked door offers ' + verbs({ locked: false }));
    if (verbs({ locked: false, lock: false }) !== 'open door east') fail('a shut door with no lock offers ' + verbs({ locked: false, lock: false }));
    if (verbs({ locked: false, open: true }) !== 'close door east') fail('a door standing open offers ' + verbs({ locked: false, open: true }));
  }
}

// ── 13. a chem lab, at each grade (docs/proposals/chem-stage.md, phase 1) ───────────────────────────
// A lab row is drawn as a lab whatever its object_type, at its station's grade; a Cachet that's turned
// carries what it hid's grade; every grade builds, puts glass in the room and keeps inside the footprint
// the walker collides with. Measured against the same room built without it, so the walls don't count.
{
  const { labGrade, LAB_GRADES } = await import('../../client/shared/room-layout.js');
  const lab = { id: 'lab', name: 'chem lab', object_type: 'container', flags: { crafting_station: 'chem_lab', station_quality: 'pristine' } };
  const L0 = layRows([lab], roomSpecOf({ room: [6, 6, 2.6] }, true)).pieces[0];
  if (!L0 || L0.form !== 'chemwall' || L0.lab !== 'pristine') fail(`a pristine lab row lays out as ${L0 ? `${L0.arche}/${L0.form}/${L0.lab}` : 'nothing'}, not surface/chemwall/pristine`);
  else {
    const at = roomLayout(roomSpecOf({ room: [6, 6, 2.6] }, true), [L0]).stations.map((s) => `${s.verb}:${s.target}`).join();
    if (at !== 'workspace:chem lab') fail(`a lab standing on its own offers ${at || 'nothing'}, not its workspace`);
  }
  if (labGrade({}) !== 'standard' || labGrade({ station_quality: 'gold' }) !== 'standard') fail('a lab with no known grade isn\'t standard');
  const cab = { id: 'cab', name: 'cabinet', object_type: 'furniture', flags: { conceal_brand: 'X', conceal_hides: 'lab', interactions: ['lean'] } };
  const hid = { ...lab, flags: { ...lab.flags, station_quality: 'refined', conceal_hidden_by: 'cab' } };
  const sealed = layRows([cab, { ...hid, flags: { ...hid.flags, concealed: true } }], roomSpecOf({ room: [6, 6, 2.6] }, true)).pieces;
  const open = layRows([cab, hid], roomSpecOf({ room: [6, 6, 2.6] }, true)).pieces;
  if (sealed.length !== 1 || sealed[0].form !== 'barwall') fail(`a sealed Cachet lays out as ${sealed.map((p) => p.form).join(', ')}, not one barwall`);
  if (open.length !== 1 || open[0].form !== 'chemwall' || open[0].lab !== 'refined') fail(`a turned Cachet lays out as ${open.map((p) => `${p.form}/${p.lab}`).join(', ')}, not one refined chemwall`);
  const spec = roomSpecOf({ room: [6, 6, 2.6] }, true);
  const tally = (m, L, p) => {
    const q = Math.round(((p.turn % 360) + 360) % 360 / 90) % 2, hw = (q ? p.d : p.w) / 2 + 0.02, hd = (q ? p.w : p.d) / 2 + 0.02;
    let out = 0, glass = m.glass.n;
    for (const b of [m.solid, m.screen, m.glass, ...m.textured.values()]) for (let i = 0; i < b.n; i++) {
      const s = L.local([b.data[i * STRIDE], b.data[i * STRIDE + 1], b.data[i * STRIDE + 2]]);
      if (s[0] < p.u - hw || s[0] > p.u + hw || s[1] < p.v - hd || s[1] > p.v + hd || s[2] > p.h + 0.02) out++;
    }
    return { out, glass };
  };
  for (const [form, dims] of [['chemwall', dimsOf('surface', 40000, { crafting_station: 'chem_lab' })], ['chemwall', [2.2, 0.46, 2.3]]]) for (const grade of LAB_GRADES) {
    const spot = placeSpot(spec, [], 'surface', dims, { form });
    if (!spot) { fail(`a ${grade} lab ${dims.join('×')} finds no spot in a 6 m room`); continue; }
    const piece = { id: 'p', name: 'lab', arche: 'surface', form, dims, spot, lab: grade, wear: 0.5, seed: 777 };
    const L = roomLayout(spec, [piece]), E = roomLayout(spec, []);
    let m, e;
    try { m = buildRoom(L, { seed: 3, lampOn: true }); e = buildRoom(E, { seed: 3, lampOn: true }); } catch (x) { fail(`a ${grade} lab: buildRoom threw ${x.message}`); continue; }
    const p = L.placed.find((x) => x.id === 'p'), a = tally(m, L, p), b = tally(e, E, p);
    let bad = 0;
    for (const bt of [m.solid, m.glass, ...m.textured.values()]) for (let i = 0; i < bt.n * STRIDE; i++) if (!Number.isFinite(bt.data[i])) bad++;
    if (bad) fail(`a ${grade} lab: ${bad} vertex values aren't numbers`);
    if (a.glass - b.glass < 200) fail(`a ${grade} lab put ${a.glass - b.glass} vertices of glass in the room: its glassware isn't there`);
    if (a.out - b.out > 0) fail(`a ${grade} lab ${dims.map((x) => x.toFixed(2)).join('×')}: ${a.out - b.out} vertices outside its footprint`);
  }
}

if (fails.length) { console.error(`room-stage: ${fails.length} failed\n  ${fails.join('\n  ')}`); process.exit(1); }
