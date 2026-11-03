// The Room Stage gate (docs/proposals/room-stage.md). Three checks, no DOM, no GL:
//
//   1. The Platinum Box suite is the Room Stage's first room. Its layout (seats with their eyes and
//      facings, stations, the boxes a walker can't stand in or climbs over, the floor heights) comes
//      out of roomLayout identical to the frozen copy in booth-layout.fixture.json, which is what the
//      suite's own hard-coded layout produced before it was lifted. Move a chair on purpose and
//      re-freeze it with --update.
//   2. Every form of every archetype builds in a stub flat (gl/room-mesh.js), with no vertex that
//      isn't a number, its seats and stations where its archetype says.
//   3. placeSpot furnishes a flat to the twelve-piece cap without standing two pieces in each other.
//
// `node scripts/shapes/room-stage.mjs [--update]`
import { readFileSync, writeFileSync } from 'fs';
import { createHash } from 'crypto';
import { boothLayout } from '../../client/game/js/panels/gl/booth-mesh.js';
import { buildRoom } from '../../client/game/js/panels/gl/room-mesh.js';
import { roomLayout, roomSpecOf, placeSpot, archetypeOf, dimsOf, formOf, ARCHETYPES, FORMS } from '../../client/shared/room-layout.js';

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
  const spec = roomSpecOf({ room: [5, 6, 2.6] }, true);
  const REF = { seat: 6000, bench: 15000, sofa: 25000, bed: 60000, screen: 12000, cold: 50000, hob: 25000, surface: 40000, small: 5000, prop: 18000 };
  for (const [arche, forms] of Object.entries(FORMS)) for (const form of forms) {
    const flags = { look: { arche, form }, ...(form === 'crt' ? { tv_skin: 'crt' } : {}) };
    if (formOf(arche, flags, REF[arche]) !== form) { fail(`${arche}/${form}: flags.look.form isn't honoured`); continue; }
    const dims = dimsOf(arche, REF[arche], flags), spot = placeSpot(spec, [], arche, dims, { crt: form === 'crt' });
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

if (fails.length) { console.error(`room-stage: ${fails.length} failed\n  ${fails.join('\n  ')}`); process.exit(1); }
