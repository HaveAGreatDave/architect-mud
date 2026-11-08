// The Room Stage gate (docs/proposals/room-stage.md). Nine checks, no DOM, no GL:
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
//
// `node scripts/shapes/room-stage.mjs [--update]`
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { createHash } from 'crypto';
import { boothLayout } from '../../client/game/js/panels/gl/booth-mesh.js';
import { buildRoom } from '../../client/game/js/panels/gl/room-mesh.js';
import { roomLayout, roomSpecOf, placeSpot, archetypeOf, dimsOf, formOf, ARCHETYPES, FORMS, withAnnex, annexFrame, roomFree, roomStep, inAnnex, onBalcony, layRows, rowDrawn, roomPath, roomNearFree, pathLength } from '../../client/shared/room-layout.js';

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
    const L = roomLayout(spec, pieces), A = L.annex, floor = L.placed.filter((p) => !p.on && !(p.arche === 'screen' && !p.crt) && !(p.arche === 'cabinet' && p.form !== 'vitrine')), box = floor.map(fp);
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
      for (let j = i + 1; j < floor.length; j++) { const q = box[j]; if (u0 < q[1] - 0.01 && u1 > q[0] + 0.01 && v0 < q[3] - 0.01 && v1 > q[2] + 0.01) fail(`${z.id}: ${p.id} stands in ${floor[j].id}`); }
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

if (fails.length) { console.error(`room-stage: ${fails.length} failed\n  ${fails.join('\n  ')}`); process.exit(1); }
