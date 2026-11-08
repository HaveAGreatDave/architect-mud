// GLASS 2 · A FLAT. The Room Stage's standalone room (docs/proposals/room-stage.md): the shell of a
// room round a roomLayout (client/shared/room-layout.js) and every piece in it drawn as its
// archetype's form, built from the same kit as the Platinum Box (room-kit.js). Pure: batches, no GL.
//
// The frame is the layout's, in metres: u across (right as you face the window), v back from the
// window wall, y up. The window is in the front wall, the door in the back wall.
//
// ⚠ THE LOOK COMES FROM DATA, NEVER FROM A NAME (home-stage.md rule 3). A piece arrives as
// { arche, form, dims, wear, seed }; its colours come from the seed and its wear from what it cost,
// so a second game on THOMAS draws its own catalogue with no edit here.
//
// ⚠ THE LIGHT IS SPLIT. Unlike the suite, whose light is all baked, a flat's vertex colour is the
// surface's colour times its baked ambient occlusion only; the lamp and the window light it in the
// shader (gl/room.js), so switching the lamp or the hour turning moves the light without a rebuild.
// A colour of 1.25 or over is a light itself (a bulb, a heater's element) and is drawn raw.

import { roomKit } from './room-kit.js';
import { createBatch, MAT, STRIDE } from './ballpark-mesh.js';
import { facing, COUNTER_H } from '../../../../shared/room-layout.js';
import { drawFitting, baseRun, STONE, FITTED_FORMS } from './room-fittings.js';
export { FITTED_FORMS };

// How many metres one repeat of each painted material covers (paintRoomTexture). A rug is mapped
// once across itself, so it has no repeat.
export const ROOM_TEXTURES = Object.freeze({ roomBoards: 1.8, roomPlaster: 3.6, roomCeiling: 2.4, roomWeave: 0.45, roomSteel: 0.9,
  roomWood: 1.1, roomConcrete: 1.6, roomTile: 0.9, roomCanvas: 0.8, roomTicking: 0.6, roomOak: 1.15, roomPlasterFine: 3.0, roomStone: 2.0, roomWool: 0.7, roomFacade: 3.4 });
export const ROOM_RUG = 'roomRug';

const { GLOSS, METAL, LEATHER, SATIN, CLOTH, MATTE, EMISSIVE } = MAT;
// A face that is a light (a bulb, a heater's element, a lamp on a panel): the kit's `glow` code, which
// gl/room.js draws unlit. No MAT code is 40.
export const GLOW = 40;
// A pane of frosted glass: gl/room.js gives it the day's light and nothing of the view.
export const FROST = 41;
// A lamp's own face, which the dimmer turns down (gl/room.js). A fire's is GLOW and isn't on the dimmer.
export const LAMP = 42;
const E0 = MAT.EMISSIVE;

// The palettes a piece's seed picks from. Muted and secondhand, as a flat in Coldwater is furnished.
const FABRIC = ['#7a3b2e', '#3f5a4a', '#a8823a', '#3b4a6b', '#6a6a66', '#5a3f5e', '#86603e', '#2f4f5a', '#8a4a3a', '#55603a'];
const ENAMEL = ['#e6e2d6', '#d6cfbc', '#c4d4cb', '#2a2c30', '#b9bdc1', '#d9c6a2'];
const WOOD = ['#8a6038', '#5b3a22', '#a8805a', '#3e2a1c', '#7a6a52'];
const PLASTIC = ['#2b2d31', '#3a3c40', '#5a5d62', '#1c1d20'];
const WALLS = ['#d8d2c2', '#c9cfc6', '#d6c6b0', '#bfc6cc', '#d4c9b8', '#c2b8a4'];
// What a fine flat is furnished from: quieter, and nothing in it has been handed down.
const FABRIC_FINE = ['#6a6e70', '#8a8478', '#3c4248', '#a39a88', '#54606a', '#7a6a5a'];
const ENAMEL_FINE = ['#c8ccd0', '#2a2c30'];
// the dark gap between two doors: the ink can't draw a line on a flat front, so the mesh does
const SEAM = '#141414';
const WOOD_FINE = ['#a8805a', '#8a6a4a', '#b08a60'];
// A stone floor's tint: the worktops' stone, a good deal paler
const PALE_STONE = '#fffaf0';

export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = (r, list) => list[Math.floor(r() * list.length) % list.length];
const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ── the occlusion ───────────────────────────────────────────────────────────────────────────────
// Dark where a wall meets the floor or the ceiling, in the corners, on the floor round and under
// every piece, and low down on a piece where it stands on the floor. Times the surface's colour.
function bakeAO(L) {
  const hu = L.w / 2, D = L.d, H = L.h, A = L.annex, ad = L.spec?.annex?.d || 0;
  const boxes = [...L.solid, ...L.climb.map((c) => c.slice(0, 4)), ...L.placed.filter((p) => !(p.arche === 'screen' && p.form !== 'crt')).map((p) => {
    const q = Math.round(((p.turn % 360) + 360) % 360 / 90) % 2, hw = (q ? p.d : p.w) / 2, hd = (q ? p.w : p.d) / 2;
    return [p.u - hw, p.u + hw, p.v - hd, p.v + hd];
  })];
  return ([u, v, y], [nu, ny, nv], col) => {
    // out on the balcony there's no corner of a room to darken
    if (v < -0.145 || (L.spec?.balcony?.wrap && (Math.abs(u) > hu + 0.145 || v > L.spec.balcony.wrap + 0.005))) return col;
    let ao = 1;
    // which room this face is in: the en-suite is its own box
    const [uL, uR, vF, vB] = A && v > D + 0.02 ? [A.u0, A.u1, A.v0, A.v0 + ad] : [-hu, hu, 0, D];
    const dw = Math.min(u - uL, uR - u, v - vF, vB - v);
    if (ny > 0.9 && y < 0.03) {
      ao *= 0.66 + 0.34 * sstep(0, 0.55, dw);
      // down in a pit, dark along the foot of the riser you're below
      const q = L.spec?.pit;
      if (q && y < -0.01) { const e = y < -q.depth * 0.75 ? q.step : 0; ao *= 0.6 + 0.4 * sstep(0, 0.5, Math.min(u - q.u0 - e, q.u1 - e - u, v - q.v0 - e, q.v1 - e - v)); }
      for (const [a, b, c, e] of boxes) {
        const ou = Math.max(a - u, 0, u - b), ov = Math.max(c - v, 0, v - e);
        ao *= 0.42 + 0.58 * sstep(0, 0.4, Math.hypot(ou, ov));
      }
    } else if (ny < -0.9 && y > H - 0.05) ao *= 0.72 + 0.28 * sstep(0, 0.7, dw);
    else if (Math.abs(ny) < 0.5) {
      // a wall low down and high up, and a vertical face near the floor
      ao *= (0.62 + 0.38 * sstep(0, 0.45, y)) * (0.86 + 0.14 * sstep(0, 0.35, H - y));
      const corner = Math.min(Math.min(u - uL, uR - u), Math.min(v - vF, vB - v) + 9 * Math.abs(nv));
      if (Math.abs(nu) > 0.5 || Math.abs(nv) > 0.5) ao *= 0.8 + 0.2 * sstep(0, 0.5, corner);
    } else if (ny > 0.9) ao *= 0.92 + 0.08 * sstep(0, 0.5, y);
    return col.map((c) => Math.min(0.98, c * ao));
  };
}

// ── the room ────────────────────────────────────────────────────────────────────────────────────
// opts: { seed (the room's), lampOn, doorShut (the en-suite's) }. Returns the kit's batches plus `view` (a box round the whole
// flat, drawn by the direction you're looking, gl/room.js: the world, seen through any gap the walls
// leave and all round you on the balcony), `lamps` (each { p: host point, annex }), `windows` (each
// { p, n, a, b, k }: where the light comes in) and `screens` (each { id, quad, n, first, count }: where a set's
// picture goes, for the page room-tv.js bends onto it).
export function buildRoom(L, { seed = 1, lampOn = true, doorShut = false, turning = null } = {}) {
  const K = roomKit(L, bakeAO(L), { textures: ROOM_TEXTURES, cell: 0.4, glow: GLOW });
  const { solid, quad, box, lathe, ball, onU, onV, C, nrmOf, TB, E } = K;
  K.fine = L.spec.finish === 'fine'; K.L = L; K.screens = [];
  const view = createBatch(64);
  const hu = L.w / 2, D = L.d, H = L.h, T = 0.14, spec = L.spec, fine = K.fine;
  const R = rng(seed), wallC = fine ? '#e4e0d8' : pick(R, WALLS), trim = fine ? '#efece6' : pick(R, ['#ece8de', '#e2dccd', '#d2cab8']);
  const win = spec.window || [-0.8, 0.8, 0.9, 2.2], door = spec.door || [hu - 1.3, hu - 0.4], DH = fine ? Math.min(2.4, H - 0.3) : 2.05;
  const plaster = { t: fine ? 'roomPlasterFine' : 'roomPlaster', c: wallC };
  const panes = spec.windows?.length ? spec.windows : [{ wall: 'front', a: win[0], b: win[1], y0: win[2], y1: win[3], kind: 'sash' }];
  const annex = spec.annex || null;

  // the floor: boards, run from the window to the door, or stone; cut round a pit when there's one
  {
    const pit = spec.pit, key = spec.ground === 'stone' ? 'roomStone' : fine ? 'roomOak' : 'roomBoards', t = ROOM_TEXTURES[key];
    const tint = spec.ground === 'stone' ? PALE_STONE : '#ffffff';
    const lay = K.lay = (u0, u1, v0, v1, y = 0) => { const ps = [[u0, v0, y], [u1, v0, y], [u1, v1, y], [u0, v1, y]]; quad(TB(key), ps, [0, 1, 0], C(tint, spec.ground === 'stone' ? 1.15 : 0.95), fine ? SATIN : E, ps.map((q) => [q[1] / t, q[0] / t])); };
    // the slab under the boards stops short of them, or the two fight over the same pixels
    if (!pit) { lay(-hu, hu, 0, D); box(-hu - T, hu + T, -T, D + T, -0.2, -0.01, '#2a2622'); } else {
      const g = 0.06;
      lay(-hu, hu, 0, pit.v0); lay(-hu, hu, pit.v1, D); lay(-hu, pit.u0, pit.v0, pit.v1); lay(pit.u1, hu, pit.v0, pit.v1);
      box(-hu - T, hu + T, -T, pit.v0 - g, -0.2, -0.01, '#2a2622'); box(-hu - T, hu + T, pit.v1 + g, D + T, -0.2, -0.01, '#2a2622');
      box(-hu - T, pit.u0 - g, pit.v0 - g, pit.v1 + g, -0.2, -0.01, '#2a2622'); box(pit.u1 + g, hu + T, pit.v0 - g, pit.v1 + g, -0.2, -0.01, '#2a2622');
      drawPit(K, pit, { key, tint, surf: fine ? SATIN : E });
    }
  }
  // the ceiling, and a slab over it
  {
    const key = fine ? 'roomPlasterFine' : 'roomCeiling', ps = [[-hu, D, H], [hu, D, H], [hu, 0, H], [-hu, 0, H]], t = ROOM_TEXTURES[key];
    quad(TB(key), ps, [0, -1, 0], C('#f2efe8', 1), E, ps.map((q) => [q[0] / t, q[1] / t]));
    box(-hu - T, hu + T, -T, D + T, H + 0.01, H + 0.2, '#8a8680');
  }

  // THE WALLS, each cut round what's in it: a wall is its length less its openings, with the wall
  // going on under and over any opening that doesn't reach the floor or the ceiling
  const wallBox = (wall, a, b, y0, y1) => {
    if (wall === 'front') box(a, b, -T, 0, y0, y1, wallC, 1, plaster);
    else if (wall === 'back') box(a, b, D, D + T, y0, y1, wallC, 1, plaster);
    else if (wall === 'left') box(-hu - T, -hu, a, b, y0, y1, wallC, 1, plaster);
    else box(hu, hu + T, a, b, y0, y1, wallC, 1, plaster);
  };
  const holes = { front: [], back: [{ a: door[0], b: door[1], y0: 0, y1: DH }], left: [], right: [] };
  if (annex) holes.back.push({ a: annex.door[0], b: annex.door[1], y0: 0, y1: DH });
  const glassTop = panes.find((q) => q.kind === 'curtain' && q.wall === 'front')?.y1;
  if (spec.balcony) holes.front.push({ a: spec.balcony.door[0], b: spec.balcony.door[1], y0: 0, y1: glassTop || DH });
  for (const q of panes) holes[q.wall].push(q);
  const solidRuns = {};
  for (const [wall, lo, hi] of [['front', -hu, hu], ['back', -hu, hu], ['left', -T, D + T], ['right', -T, D + T]]) {
    let s = lo;
    const runs = solidRuns[wall] = [];
    for (const q of holes[wall].sort((m, n) => m.a - n.a)) {
      if (q.a > s) { wallBox(wall, s, q.a, 0, H); runs.push([s, q.a]); }
      if (q.y0 > 0) wallBox(wall, q.a, q.b, 0, q.y0);
      if (q.y1 < H) wallBox(wall, q.a, q.b, q.y1, H);
      s = q.b;
    }
    if (s < hi) { wallBox(wall, s, hi, 0, H); runs.push([s, hi]); }
  }

  // the skirting round what's solid, and (in a plain room) the coving; a fine room's walls stop in a
  // shadow gap at the floor and go straight up to the ceiling
  for (const [wall, runs] of Object.entries(solidRuns)) for (const [a, b] of runs) {
    const [u0, u1, v0, v1] = wall === 'front' ? [a, b, 0, 0.016] : wall === 'back' ? [a, b, D - 0.016, D] : wall === 'left' ? [-hu, -hu + 0.016, Math.max(a, 0), Math.min(b, D)] : [hu - 0.016, hu, Math.max(a, 0), Math.min(b, D)];
    if (fine) { box(u0, u1, v0, v1, 0, 0.012, '#141416', 0.9); box(u0, u1, v0, v1, 0.012, 0.09, trim, 0.97, null, SATIN); continue; }
    box(u0, u1, v0, v1, 0, 0.11, trim, 0.95, null, SATIN);
    box(u0, u1, v0, v1, 0.11, 0.125, trim, 0.9, null, SATIN);
  }
  if (!fine) for (const [u0, u1, v0, v1] of [[-hu, -hu + 0.05, 0, D], [hu - 0.05, hu, 0, D], [-hu, hu, 0, 0.05], [-hu, hu, D - 0.05, D]]) box(u0, u1, v0, v1, H - 0.07, H, trim, 1);

  const windows = panes.map((q) => drawPane(K, q, { hu, D, H, trim, fine }));
  // the world: a box well clear of the flat, seen wherever the walls don't stop you seeing it
  {
    const R0 = 55, c = D / 2, a = [-R0, c - R0, -R0], b = [R0, c + R0, R0];
    const corner = (i) => [i & 1 ? b[0] : a[0], i & 2 ? b[1] : a[1], i & 4 ? b[2] : a[2]];
    for (const f of [[0, 1, 3, 2], [4, 5, 7, 6], [0, 1, 5, 4], [2, 3, 7, 6], [0, 2, 6, 4], [1, 3, 7, 5]]) K.quad(view, f.map(corner), [0, 1, 0], [1, 1, 1], EMISSIVE, null, true);
  }
  if (spec.balcony) drawBalcony(K, { hu, H, T, DH, fine, trim, top: glassTop || DH });

  // THE DOOR in the back wall: a four-panel door shut in its frame, an architrave, a brass knob and a
  // finger plate; a light switch and a socket by it. A fine flat's is one flush oak leaf, floor to head
  {
    const [d0, d1] = door, dv = D - 0.04, leaf = { t: fine ? 'roomOak' : 'roomWood', c: fine ? '#8a6a4a' : '#9a7a5a' };
    box(d0, d1, dv, D, 0, DH - 0.01, '#6a4a30', 0.92, leaf, SATIN);
    if (!fine) {
      for (const [a, b] of [[d0 + 0.09, (d0 + d1) / 2 - 0.04], [(d0 + d1) / 2 + 0.04, d1 - 0.09]]) for (const [c, e] of [[0.18, 0.92], [1.08, 1.9]]) {
        box(a, b, dv - 0.012, dv, c, e, '#6a4a30', 0.85, leaf, SATIN);
        box(a + 0.04, b - 0.04, dv - 0.02, dv - 0.012, c + 0.04, e - 0.04, '#6a4a30', 0.97, leaf, SATIN);
      }
    }
    for (const [a, b, c, e] of [[d0 - 0.07, d0, 0, DH + 0.07], [d1, d1 + 0.07, 0, DH + 0.07], [d0 - 0.07, d1 + 0.07, DH, DH + 0.07]]) box(a, b, D - 0.02, D, c, e, fine ? '#2a2c30' : trim, 0.97, null, SATIN);
    const ku = d0 + 0.07;
    if (fine) {
      K.rounded(...onV, dv - 0.05, dv - 0.03, ku - 0.012, ku + 0.012, 0.9, 1.3, 0.008, '#1c1d20', 1, METAL);
      for (const y of [0.92, 1.28]) box(ku - 0.008, ku + 0.008, dv - 0.04, dv, y - 0.008, y + 0.008, '#1c1d20', 1, null, METAL);
    } else {
      K.rounded(...onU, ku - 0.02, ku + 0.02, dv - 0.06, dv, 0.98, 1.0, 0.008, '#b8923e', 1.05, METAL);
      ball(ku, dv - 0.065, 0.99, 0.028, '#c9a24a', 1.05, 12, METAL);
      box(ku - 0.03, ku + 0.03, dv - 0.004, dv, 1.06, 1.3, '#c9a24a', 1, null, METAL);
    }
    const su = d0 - 0.22;
    box(su - 0.042, su + 0.042, D - 0.012, D, 1.16, 1.244, '#efece4', 1, null, SATIN);
    box(su - 0.012, su + 0.012, D - 0.022, D - 0.012, 1.19, 1.214, '#d8d4ca', 1, null, SATIN);
    box(su - 0.042, su + 0.042, D - 0.012, D, 0.28, 0.364, '#efece4', 1, null, SATIN);
  }

  // THE LIGHT. A plain room has a flex from a ceiling rose to a pleated paper shade over a bulb; a
  // fine one has downlights let into the ceiling, spread to reach a room that size
  const lamps = [];
  if (fine) {
    const nu = Math.max(2, Math.round(L.w / 4)), nv = Math.max(2, Math.round(D / 4));
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
      const u = -hu + (i + 0.5) * L.w / nu, v = (j + 0.5) * D / nv;
      lathe(u, v, [[0.05, H - 0.002], [0.07, H - 0.002], [0.07, H - 0.0005], [0.05, H - 0.0005]], '#2a2c30', 1, 18, METAL);
      lathe(u, v, [[0, H - 0.0015], [0.05, H - 0.0015]], lampOn ? '#fff0d0' : '#c8c4b8', lampOn ? 2.2 : 0.8, 16, lampOn ? LAMP : undefined);
    }
    // the lights the renderer has for them: one over each part of the room
    for (const [u, v] of zoneLights(L)) lamps.push({ p: L.world(u, v, H - 0.3), annex: false, k: 1.5 });
  } else for (const [u, v] of (spec.plan ? zoneLights(L).filter((_, i) => i !== 1) : [[0, D * 0.5]])) {
    const lamp = { u, v, y: H - 0.62 };
    lathe(lamp.u, lamp.v, [[0, H - 0.03], [0.05, H - 0.03], [0.055, H - 0.01], [0.05, H]], '#efece4', 1, 16);
    lathe(lamp.u, lamp.v, [[0.004, lamp.y + 0.2], [0.004, H - 0.03]], '#202020', 0.9, 6);
    lathe(lamp.u, lamp.v, [[0.018, lamp.y + 0.12], [0.022, lamp.y + 0.2], [0, lamp.y + 0.2]], '#2a2a2a', 0.9, 10);
    // the shade, pleated: sixteen facets alternately a little in and out
    const shade = [], n = 32;
    for (let i = 0; i < n; i++) {
      const a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2, r0 = i % 2 ? 0.2 : 0.21, r1 = i % 2 ? 0.21 : 0.2;
      const P = (a, r, y) => [lamp.u + Math.cos(a) * r, lamp.v + Math.sin(a) * r, y];
      shade.push([P(a0, r0 * 0.6, lamp.y + 0.16), P(a1, r1 * 0.6, lamp.y + 0.16), P(a1, r1, lamp.y - 0.06), P(a0, r0, lamp.y - 0.06)]);
    }
    for (const q of shade) quad(solid, q, nrmOf(0, -1, 0), C('#f1dcb4', lampOn ? 1.3 : 0.85), lampOn ? LAMP : E, null, lampOn);
    ball(lamp.u, lamp.v, lamp.y + 0.03, 0.045, lampOn ? '#fff4d8' : '#d8d4c8', lampOn ? 2.4 : 0.9, 12, lampOn ? LAMP : undefined);
    lamps.push({ p: L.world(lamp.u, lamp.v, lamp.y), annex: false, k: 1 });
  }

  // A RUG on the boards, in front of the sofa if there is one, else in the middle. A fine room's is a
  // plain wool one, sized to the room
  {
    const sofa = L.placed.find((p) => p.arche === 'sofa' || p.arche === 'bench'), scr = L.placed.find((p) => p.arche === 'screen');
    const lz = spec.plan?.living;
    let cu = lz ? (lz[0] + lz[1]) / 2 : 0, cv = lz ? (lz[2] + lz[3]) / 2 : D * 0.5;
    if (sofa && scr) { cu = (sofa.u + scr.u) / 2; cv = (sofa.v + scr.v) / 2; } else if (sofa) { const [fu, fv] = facing(sofa.turn); cu = sofa.u + fu * 0.9; cv = sofa.v + fv * 0.9; }
    const rw = (fine ? Math.min(3.4, L.w * 0.42) : Math.min(1.6, L.w - 1.0)) / 2, rd = (fine ? Math.min(2.6, D * 0.3) : Math.min(1.1, D * 0.3)) / 2;
    cu = Math.max(-hu + rw + 0.2, Math.min(hu - rw - 0.2, cu)); cv = Math.max(rd + 0.3, Math.min(D - rd - 0.3, cv));
    // a sunken lounge has it on its own floor, under the table
    const table = spec.pit && L.placed.find((p) => p.y0 && p.arche === 'table');
    if (table) { cu = table.u; cv = table.v; }
    if (spec.pit) K.lift(-spec.pit.depth);
    const y = 0.008, ps = [[cu - rw, cv - rd, y], [cu + rw, cv - rd, y], [cu + rw, cv + rd, y], [cu - rw, cv + rd, y]];
    if (fine) quad(TB('roomWool'), ps, [0, 1, 0], C('#cfc9bd', 0.95), CLOTH, ps.map((q) => [q[0] / ROOM_TEXTURES.roomWool, q[1] / ROOM_TEXTURES.roomWool]));
    else quad(TB(ROOM_RUG), ps, [0, 1, 0], C('#ffffff', 0.95), CLOTH, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    const side = (a, b, n) => quad(solid, [[a[0], a[1], 0.001], [b[0], b[1], 0.001], [b[0], b[1], y], [a[0], a[1], y]], n, C('#3a2a22', 0.8), CLOTH);
    side([cu - rw, cv - rd], [cu + rw, cv - rd], nrmOf(0, 0, -1)); side([cu + rw, cv + rd], [cu - rw, cv + rd], nrmOf(0, 0, 1));
    side([cu + rw, cv - rd], [cu + rw, cv + rd], nrmOf(1, 0, 0)); side([cu - rw, cv + rd], [cu - rw, cv - rd], nrmOf(-1, 0, 0));
    K.lift(0);
  }

  if (spec.plan) drawKitchen(K, { H, lampOn, lamps, seed });
  if (annex) buildAnnex(K, { H, D, T, DH, lampOn, lamps, doorShut });
  for (const p of L.placed) { if (p.id === turning?.id) continue; K.lift(p.y0 || 0); drawPiece(K, p); }
  // a piece on a turntable is drawn apart, by the stage, for as long as it's going round
  const spin = turning && L.placed.find((p) => p.id === turning.id) ? turntable(K, L, L.placed.find((p) => p.id === turning.id), turning) : null;
  K.lift(0);
  // a fire lights the room in front of it, as far as the renderer has a light to spare
  for (const p of L.placed) if (p.arche === 'fireplace') { const [fu, fv] = facing(p.turn), o = p.d / 2 + 0.5; lamps.push({ p: L.world(p.u + fu * o, p.v + fv * o, 0.9 + (p.y0 || 0)), annex: false, k: 0.6, fire: true }); }
  // ⚠ THE RENDERER TAKES SIX, AND AN EN-SUITE'S HAS TO BE THE LAST OF THEM (gl/room-light.js), so what
  // goes is a ceiling light and never the fire or the bathroom
  const kept = lamps.filter((l) => l.fire), spa = lamps.filter((l) => l.annex);
  const rest = lamps.filter((l) => !l.fire && !l.annex).slice(0, 6 - kept.length - spa.length);
  // each set's stretch of the screen batch, so the one that's on can be drawn with the broadcast
  K.screens.forEach((s, i) => { s.count = (K.screens[i + 1]?.first ?? K.screen.n) - s.first; });
  return { ...K, view, lamps: [...rest, ...kept, ...spa], windows, spin };
}

// A TURNTABLE: both faces of a piece as one set of vertices, `from` showing and `to` on its far side, for
// spinBatch to turn. Each face is pressed into the front half of the piece's depth, or the two would
// stand in each other going round. The textured parts come out in their tints: it's three seconds.
function turntable(K, L, p, { from, to }) {
  const [fu, fv] = facing(p.turn), o = L.world(p.u, p.v, 0), e = L.world(p.u + fu, p.v + fv, 0), fx = e[0] - o[0], fz = e[2] - o[2], hd = p.d / 2;
  const take = (form, far) => {
    const batches = [K.solid, ...K.textured.values()], was = new Map(batches.map((b) => [b, b.n]));
    K.lift(p.y0 || 0); drawPiece(K, { ...p, form });
    const out = [];
    for (const b of [K.solid, ...K.textured.values()]) {
      const n0 = was.get(b) ?? 0;
      out.push(b.data.slice(n0 * STRIDE, b.n * STRIDE));
      b.n = n0;
    }
    const d = new Float32Array(out.reduce((n, a) => n + a.length, 0));
    let at = 0;
    for (const a of out) { d.set(a, at); at += a.length; }
    for (let i = 0; i < d.length; i += STRIDE) {
      const x = d[i] - o[0], z = d[i + 2] - o[2], along = x * fx + z * fz, by = (along + hd) / 2 - along;
      d[i] += fx * by; d[i + 2] += fz * by;
      if (far) { d[i] = 2 * o[0] - d[i]; d[i + 2] = 2 * o[2] - d[i + 2]; d[i + 3] = -d[i + 3]; d[i + 5] = -d[i + 5]; }
    }
    return d;
  };
  const a = take(from, false), b = take(to, true), rest = new Float32Array(a.length + b.length);
  rest.set(a); rest.set(b, a.length);
  return { rest, at: [o[0], o[2]], out: new Float32Array(rest.length) };
}
// The turntable `angle` radians round, as a batch for the renderer's moving layer.
export function spinBatch(spin, angle) {
  const { rest, at: [cx, cz], out } = spin, c = Math.cos(angle), s = Math.sin(angle);
  out.set(rest);
  for (let i = 0; i < out.length; i += STRIDE) {
    const x = rest[i] - cx, z = rest[i + 2] - cz, nx = rest[i + 3], nz = rest[i + 5];
    out[i] = cx + x * c + z * s; out[i + 2] = cz - x * s + z * c;
    out[i + 3] = nx * c + nz * s; out[i + 5] = -nx * s + nz * c;
  }
  return { data: out, n: out.length / STRIDE };
}

// A SUNKEN FLOOR (client/shared/room-layout.js pitFloorAt): the ledge round it and its floor, laid as the
// room's floor is, a riser under each edge with a thread of light along its foot, so the steps read
// from across the room. A riser is a thin box behind the edge, its top just under the floor it holds up.
function drawPit(K, q, { key, tint, surf }) {
  const dh = q.depth / 2, s = q.step, t = 0.04, mat = { t: key, c: tint };
  K.lay(q.u0, q.u1, q.v0, q.v0 + s, -dh); K.lay(q.u0, q.u1, q.v1 - s, q.v1, -dh);
  K.lay(q.u0, q.u0 + s, q.v0 + s, q.v1 - s, -dh); K.lay(q.u1 - s, q.u1, q.v0 + s, q.v1 - s, -dh);
  K.lay(q.u0 + s, q.u1 - s, q.v0 + s, q.v1 - s, -q.depth);
  for (const i of [0, 1]) {
    const a = q.u0 + i * s, b = q.u1 - i * s, c = q.v0 + i * s, e = q.v1 - i * s, y1 = -i * dh - 0.002, y0 = -(i + 1) * dh - 0.002;
    for (const r of [[a - t, a, c - t, e + t], [b, b + t, c - t, e + t], [a, b, c - t, c], [a, b, e, e + t]]) K.box(...r, y0, y1, '#ffffff', 0.9, mat, surf);
    const y = y0 + 0.002, w = 0.012, g = 0.016;
    for (const r of [[a, a + w, c, e], [b - w, b, c, e], [a, b, c, c + w], [a, b, e - w, e]]) K.box(...r, y, y + g, '#d8a878', 1.3);
  }
}

// Where each part of a studio is lit from: the lounge, the kitchen, the bed.
function zoneLights(L) {
  const { living: a, kitchen: b, sleep: c } = L.spec.plan;
  return [[(a[0] + a[1]) / 2, (a[2] + a[3]) / 2], [(b[0] + b[1]) / 2, (b[2] + b[3]) / 2], [(c[0] + c[1]) / 2, (c[2] + c[3]) / 2]];
}

// THE KITCHEN of a studio (client/shared/room-layout.js studioPlan), built in whatever's been put in
// it: the L of counter with a breakfast overhang on the lounge's side, units along the wall in every
// gap the appliances leave, a splashback, its own floor, and lights hung over the counter.
function drawKitchen(K, { H, lampOn, lamps, seed }) {
  const L = K.L, fine = K.fine, P = L.spec.plan, hu = L.w / 2, [c0, c1, v0, v1] = P.counter, [rv0, rv1] = [P.run[2], P.run[3]], { box, quad, TB, C, lathe } = K;
  const r = rng(seed ^ 0x5bd1), rod = rodOf(K), T = COUNTER_H, front = fine ? '#3b3d41' : pick(r, ['#d8d0c0', '#4a5a5a', '#8a6a4a', '#e8e4dc']);
  const top = fine ? STONE : { t: 'roomConcrete', c: '#b8b4ac' }, side = fine ? { t: 'roomOak', c: '#8a6a4a' } : null;
  const unit = (u, v, fu, fv, w, d) => baseRun({ F: K.frame(u, v, fu, fv), p: { w, d, h: T }, r, fine, rod, front }, T);
  const depth = 0.66, runD = P.run[1] - P.run[0], over = c1 - c0 - depth;
  // its own floor, stopping at the counter
  {
    const key = fine ? 'roomStone' : 'roomTile', t = ROOM_TEXTURES[key], y = 0.004, ps = [[c0 + over, v0, y], [hu, v0, y], [hu, v1, y], [c0 + over, v1, y]];
    quad(TB(key), ps, [0, 1, 0], C(fine ? '#b0b2b2' : '#c8ccc4', 0.95), SATIN, ps.map((q) => [q[0] / t, q[1] / t]));
  }
  // the long side: units on the kitchen's side, a panel and the overhang on the lounge's, and the slab
  // running down the end to the floor
  unit(c1 - depth / 2, (v0 + v1) / 2, 1, 0, v1 - v0, depth);
  box(c0, c1, v0, v1, T - 0.04, T, '#a8a49c', 1, top, fine ? SATIN : MATTE);
  box(c0 + over - 0.03, c0 + over, v0, v1, 0.02, T - 0.04, front, 0.9, side, SATIN);
  box(c0, c1, v1, v1 + 0.04, 0, T, '#a8a49c', 0.97, top, fine ? SATIN : MATTE);
  // the return to the wall, closing the front of the kitchen
  unit((c1 + hu) / 2, v0 + runD / 2 + 0.02, 0, 1, hu - c1, runD - 0.04);
  box(c0, hu, v0 - 0.04, v0, 0, T, '#a8a49c', 0.97, top, fine ? SATIN : MATTE);
  // the units along the wall, in the gaps the appliances leave
  const taken = L.placed.filter((p) => p.wall === 'right' && !p.annex && p.v > rv0 - 0.5 && p.v < rv1 + 0.5 && !(p.arche === 'cabinet' || p.arche === 'screen')).map((p) => [p.v - p.w / 2, p.v + p.w / 2]).sort((a, b) => a[0] - b[0]);
  let s = rv0;
  for (const [a, b] of [...taken, [rv1, rv1]]) {
    if (a - s > 0.03) unit(hu - runD / 2, (s + a) / 2, -1, 0, a - s, runD);
    s = Math.max(s, b);
  }
  // the splashback up the wall behind them
  const tall = L.placed.filter((p) => p.wall === 'right' && !p.annex && p.h > 1.2 && p.v > rv0).map((p) => p.v - p.w / 2);
  box(hu - 0.012, hu, rv0, Math.min(rv1, ...tall), T, T + 0.55, '#ffffff', 0.95, fine ? STONE : { t: 'roomTile', c: '#d8dcd8' }, fine ? SATIN : GLOSS);
  // the lights over the counter, on long flexes
  const n = Math.max(2, Math.min(4, Math.round((v1 - v0) / 1.6))), um = (c0 + c1) / 2, y = T + 1.0;
  for (let i = 0; i < n; i++) {
    const v = v0 + (i + 0.5) * (v1 - v0) / n, hang = fine ? '#17181b' : '#3a3a3a';
    lathe(um, v, [[0, H - 0.015], [0.04, H - 0.015], [0.045, H], [0, H]], hang, 1, 12);
    lathe(um, v, [[0.004, y + 0.16], [0.004, H - 0.015]], hang, 0.9, 6);
    lathe(um, v, [[0.13, y], [0.11, y + 0.05], [0.04, y + 0.14], [0.02, y + 0.17], [0, y + 0.17]], fine ? '#1c1d20' : '#5a6a5a', 0.95, 16, fine ? METAL : GLOSS);
    lathe(um, v, [[0, y + 0.005], [0.12, y + 0.005]], lampOn ? '#fff0d0' : '#c8c4b8', lampOn ? 2 : 0.8, 14, lampOn ? LAMP : undefined);
  }
  if (!fine) lamps.push({ p: L.world(um, (v0 + v1) / 2, y), annex: false, k: 0.9 });
}

// THE BALCONY past the front wall: the door out, a deck, a rail, and the face of the building round it,
// so you step out onto something and can look back at where you came from. A tower flat's deck is the
// width of the room behind a glass balustrade; a plain one's is a concrete slab on a steel rail. One
// with `wrap` runs right round the building, which is then a closed block: a face down each side and
// across the back at `wrap`, so an en-suite and the corner beside it are inside it.
function drawBalcony(K, { hu, H, T, DH, fine, trim, top }) {
  const L = K.L, B = L.spec.balcony, [d0, d1] = B.door, [u0, u1] = B.u, vO = -T - B.d, { box, quad, TB, C, nrmOf } = K, rod = rodOf(K);
  const key = fine ? 'roomWood' : 'roomConcrete', t = ROOM_TEXTURES[key], deck = [[u0, vO, 0], [u1, vO, 0], [u1, -T, 0], [u0, -T, 0]];
  quad(TB(key), deck, [0, 1, 0], C(fine ? '#8a6a4a' : '#b8b4ac', 0.95), fine ? SATIN : MATTE, deck.map((q) => [q[1] / t, q[0] / t]));
  box(u0, u1, vO, -T, -0.26, -0.01, '#6a6864', 0.9);
  const wrap = B.wrap, xe = hu + T, vB = wrap ? wrap + B.d : -T;
  // the rest of the ring: each strip meets the next edge to edge, with the slab under it to catch a crack
  if (wrap) for (const [a, b, c, e] of [[xe, u1, -T, wrap], [u0, -xe, -T, wrap], [u0, u1, wrap, vB]]) {
    const ps = [[a, c, 0], [b, c, 0], [b, e, 0], [a, e, 0]];
    quad(TB(key), ps, [0, 1, 0], C(fine ? '#8a6a4a' : '#b8b4ac', 0.95), fine ? SATIN : MATTE, ps.map((q) => [q[1] / t, q[0] / t]));
    box(a, b, c, e, -0.26, -0.01, '#6a6864', 0.9);
  }
  // the wall stops at the floor and the slabs a centimetre short of it, so a strip just proud of
  // them seals the two cracks along the join
  box(-hu - T, hu + T, -T - 0.006, -T + 0.02, -0.2, 0.004, '#6a6864', 0.9);
  box(-hu - T, hu + T, -T - 0.006, -T + 0.02, H - 0.01, H + 0.2, '#6a6864', 0.9);
  // the door: a threshold through the wall, and its frame
  box(d0, d1, -T, 0, -0.02, 0.012, '#2a2c30', 1, null, METAL);
  const fr = fine ? '#17181b' : trim;
  for (const [a, b] of [[d0 - 0.04, d0 + 0.02], [d1 - 0.02, d1 + 0.04]]) box(a, b, -T - 0.012, 0.012, 0, top + 0.04, fr, 0.97, null, SATIN);
  box(d0 - 0.04, d1 + 0.04, -T - 0.012, 0.012, top - 0.02, top + 0.04, fr, 0.97, null, SATIN);
  // the door itself, stood open: slid behind the glass in a tower, swung back against the wall otherwise
  if (fine) quad(K.glass, [[d1 + 0.03, -0.1, 0.03], [d1 + 1.45, -0.1, 0.03], [d1 + 1.45, -0.1, top], [d1 + 0.03, -0.1, top]], nrmOf(0, 0, 1), [0.8, 0.86, 0.9], GLOSS, null, true);
  else box(d0 - 0.96, d0 - 0.04, 0.012, 0.05, 0, DH - 0.01, '#6a4a30', 0.92, { t: 'roomWood', c: '#9a7a5a' }, SATIN);
  // the rail round the open sides
  const RH = 1.12, run = wrap ? [[[u0, vO], [u1, vO]], [[u1, vO], [u1, vB]], [[u1, vB], [u0, vB]], [[u0, vB], [u0, vO]]] : [[[u0, vO], [u1, vO]], [[u0, vO], [u0, -T]], [[u1, vO], [u1, -T]]], metal = fine ? '#17181b' : '#5a5e62';
  for (const [a, b] of run) {
    rod([a[0], a[1], RH], [b[0], b[1], RH], fine ? 0.02 : 0.024, metal, 1, METAL);
    if (fine) {
      quad(K.glass, [[a[0], a[1], 0.02], [b[0], b[1], 0.02], [b[0], b[1], RH], [a[0], a[1], RH]], nrmOf(0, 0, 1), [0.8, 0.86, 0.9], GLOSS, null, true);
      continue;
    }
    rod([a[0], a[1], 0.12], [b[0], b[1], 0.12], 0.014, metal, 1, METAL);
    const n = Math.max(2, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.14));
    for (let i = 0; i <= n; i++) { const x = a[0] + (b[0] - a[0]) * i / n, y = a[1] + (b[1] - a[1]) * i / n; rod([x, y, 0], [x, y, RH], 0.008, metal, 1, METAL, 4); }
  }
  // the building round you: its face, over, under and to the sides of the flat, stopping at a corner
  // where the flat has glass round the side
  const glazed = (w) => (L.spec.windows || []).some((q) => q.wall === w);
  const f = ROOM_TEXTURES.roomFacade, v = -T, xl = glazed('left') || wrap ? -hu - T : -hu - T - 9, xr = glazed('right') || wrap ? hu + T : hu + T + 9, up = L.spec.crown ? H + 0.2 : H + 13;
  const face = (a, b, y0, y1) => { const ps = [[b, v, y0], [a, v, y0], [a, v, y1], [b, v, y1]]; quad(TB('roomFacade'), ps, nrmOf(0, 0, -1), C('#ffffff', 1), GLOSS, ps.map((q) => [q[0] / f, q[2] / f]), false); };
  face(xl, xr, -36, -0.2);
  if (up > H + 0.2) face(xl, xr, H + 0.2, up);
  if (xl < -hu - T) face(xl, -hu - T, -0.2, H + 0.2);
  if (xr > hu + T) face(hu + T, xr, -0.2, H + 0.2);
  // the block's other faces, a centimetre off the walls behind them, each side cut round its glass
  if (wrap) {
    const x = xe + 0.01, y0 = -0.2, y1 = H + 0.2, skin = (ps, n, i) => quad(TB('roomFacade'), ps, n, C('#ffffff', 1), GLOSS, ps.map((q) => [q[i] / f, q[2] / f]), false);
    for (const [wall, sx] of [['left', -1], ['right', 1]]) {
      let s = -T - 0.006;
      const panes = (L.spec.windows || []).filter((q) => q.wall === wall).sort((m, n) => m.a - n.a);
      for (const [a, b] of [...panes.map((q) => [s, q.a - 0.03, s = q.b + 0.03]), [s, wrap + 0.01]]) if (b > a) skin([[sx * x, a, y0], [sx * x, b, y0], [sx * x, b, y1], [sx * x, a, y1]], nrmOf(sx, 0, 0), 1);
      // under and over the glass, the strips that seal the front
      for (const q of panes) for (const [c, e] of [[-0.2, 0.004], [H - 0.01, H + 0.2]]) box(sx > 0 ? xe - 0.02 : -xe - 0.006, sx > 0 ? xe + 0.006 : -xe + 0.02, q.a, q.b, c, e, '#6a6864', 0.9);
    }
    skin([[x, wrap + 0.01, y0], [-x, wrap + 0.01, y0], [-x, wrap + 0.01, y1], [x, wrap + 0.01, y1]], nrmOf(0, 0, 1), 0);
  }
}

// A PANE in a wall, looking out. In the wall's own frame: x along it, z out into the room, y up. A
// sash is a painted timber window with a blind and a radiator under it; a curtain is floor-to-ceiling
// glass between thin black mullions. Past it is whatever the `view` box shows, so the picture holds
// as you walk. Returns where its light comes in.
function drawPane(K, q, { hu, D, trim, fine }) {
  const mid = (q.a + q.b) / 2, half = (q.b - q.a) / 2, y0 = q.y0, y1 = q.y1, L = K.L;
  const F = q.wall === 'front' ? K.frame(mid, 0, 0, 1) : q.wall === 'left' ? K.frame(-hu, mid, 1, 0) : q.wall === 'right' ? K.frame(hu, mid, -1, 0) : K.frame(mid, D, 0, -1);
  const { P, N, pbox, alongX, alongY } = F;
  // its uv is metres on the glass from 100: that's what tells gl/room.js a pane is out in the weather
  const glass = (z) => K.quad(K.glass, [P(-half, y0, z), P(half, y0, z), P(half, y1, z), P(-half, y1, z)], N(0, 0, 1), [0.8, 0.86, 0.9], GLOSS, [[100 - half, y0], [100 + half, y0], [100 + half, y1], [100 - half, y1]], true);
  if (q.kind === 'curtain') {
    // ⚠ PROUD OF THE WALL. The strips of wall over and under the glass end at -0.14, and a frame ending
    // there too fights them for the same pixels, which flickers along the deck
    const frame = '#17181b', n = Math.max(1, Math.round(half * 2 / 1.5)), out = -0.148;
    pbox(-half, half, y1 - 0.05, y1 + 0.1, out, -0.02, frame, 1, null, SATIN);
    pbox(-half, half, y0 - 0.05, y0 + 0.03, out, -0.02, frame, 1, null, SATIN);
    for (let i = 0; i <= n; i++) { const x = -half + i * half * 2 / n; pbox(x - 0.03, x + 0.03, y0, y1, out, -0.02, frame, 1, null, SATIN); }
    glass(-0.06);
  } else {
    // the frame, the sill board and the bars
    const fw = 0.05, fv = [-0.09, -0.03], my = y0 + (y1 - y0) * 0.62;
    for (const [a, b, c, e] of [[-half, -half + fw, y0, y1], [half - fw, half, y0, y1], [-half, half, y0, y0 + fw], [-half, half, y1 - fw, y1]]) pbox(a, b, c, e, fv[0], fv[1], trim, 0.95, null, SATIN);
    pbox(-0.02, 0.02, y0, y1, fv[0] + 0.01, fv[1] - 0.005, trim, 0.95, null, SATIN);
    pbox(-half, half, my - 0.02, my + 0.02, fv[0] + 0.01, fv[1] - 0.005, trim, 0.95, null, SATIN);
    pbox(-half - 0.05, half + 0.05, y0 - 0.035, y0, -0.04, 0.14, trim, 1, null, SATIN);
    pbox(-half - 0.07, half + 0.07, y0 - 0.12, y0 - 0.035, -0.005, 0.02, trim, 0.9);
    // the architrave round the opening on the room side
    for (const [a, b, c, e] of [[-half - 0.07, -half, y0 - 0.035, y1 + 0.07], [half, half + 0.07, y0 - 0.035, y1 + 0.07], [-half - 0.07, half + 0.07, y1, y1 + 0.07]]) pbox(a, b, c, e, 0, 0.018, trim, 0.97, null, SATIN);
    glass(-0.06);
    if (!fine) {
      // the blind: a cassette at the head, the cloth down a quarter of the glass, a bar and a pull
      const bl = y1 - (y1 - y0) * 0.24;
      pbox(-half - 0.02, half + 0.02, y1 + 0.07, y1 + 0.15, -0.01, 0.07, trim, 0.95, null, SATIN);
      pbox(-half + 0.01, half - 0.01, bl, y1 + 0.07, 0.03, 0.036, '#e9e1cf', 0.95, { t: 'roomCanvas', c: '#efe6d2' }, CLOTH);
      pbox(-half, half, bl - 0.03, bl, 0.025, 0.045, trim, 0.9, null, SATIN);
      const [pu, pv] = P(0, 0, 0.04);
      K.lathe(pu, pv, [[0, bl - 0.25], [0.012, bl - 0.25], [0.012, bl - 0.21], [0.003, bl - 0.2], [0.003, bl - 0.03], [0, bl - 0.03]], trim, 0.9, 8);
      // the radiator under the window: a row of columns on two pipes, gloss white
      const r0 = -half + 0.05, r1 = half - 0.05, cols = Math.round((r1 - r0) / 0.065);
      for (let i = 0; i < cols; i++) {
        const x = r0 + (i + 0.5) * (r1 - r0) / cols;
        K.rounded(...alongY(), 0.16, 0.74, x - 0.024, x + 0.024, 0.05, 0.14, 0.02, '#e4e0d6', 0.95, GLOSS);
      }
      for (const y of [0.18, 0.72]) K.rounded(...alongX(), r0 - 0.04, r1 + 0.04, 0.08, 0.11, y - 0.015, y + 0.015, 0.012, '#d8d4ca', 0.95, GLOSS);
      for (const x of [r0 - 0.06, r1 + 0.06]) { const [u, v] = P(x, 0, 0.09); K.lathe(u, v, [[0.012, 0], [0.012, 0.18]], '#c9c4b8', 0.9, 8, METAL); }
    }
  }
  // the light through it: its middle just inside the glass, the two ways it spans, and how much of a
  // window it is. A wall of glass lets in more than a sash, but not in proportion: the sky is one sky
  const p = P(0, (y0 + y1) / 2, 0.02), a = P(half, 0, 0), b = P(-half, 0, 0), wa = L.world(a[0], a[1], 0), wb = L.world(b[0], b[1], 0), nf = P(0, 0, 1), n0 = P(0, 0, 0), wn = L.world(nf[0], nf[1], 0), w0 = L.world(n0[0], n0[1], 0);
  return { p: L.world(p[0], p[1], p[2]), n: [wn[0] - w0[0], 0, wn[2] - w0[2]], a: [wa[0] - wb[0], 0, wa[2] - wb[2]], b: [0, y1 - y0, 0], k: Math.min(3, Math.max(1, half * 2 * (y1 - y0) / 2.4)) };
}

// THE EN-SUITE behind the back wall, a second room in the same frame. Its front wall is the far side
// of the flat's back wall, with the door in it standing open against the wall; fine ones are grey
// stone with a light in a slot, plain ones tiled to shoulder height with a bulkhead lamp. A high slot
// of frosted glass in the far wall lets the day in.
function buildAnnex(K, { H, D, T, DH, lampOn, lamps, doorShut }) {
  const { box, quad, TB, C, lathe } = K, L = K.L, A = L.annex, a = L.spec.annex, fine = a.finish === 'fine';
  const u0 = A.u0, u1 = A.u1, v0 = A.v0, v1 = A.v0 + a.d;
  const stone = { t: 'roomStone', c: '#d6d6d4' }, wall = fine ? stone : { t: 'roomPlaster', c: '#d8d8d0' }, wallHex = '#ffffff';
  // the floor: stone or square tiles
  {
    const key = fine ? 'roomStone' : 'roomTile', t = ROOM_TEXTURES[key], ps = [[u0, v0, 0], [u1, v0, 0], [u1, v1, 0], [u0, v1, 0]];
    quad(TB(key), ps, [0, 1, 0], C(fine ? '#b0b2b2' : '#c8ccc4', 0.95), SATIN, ps.map((q) => [q[0] / t, q[1] / t]));
    box(u0 - T, u1 + T, v0 - T, v1 + T, -0.2, -0.01, '#2a2622');
    const cp = [[u0, v1, H], [u1, v1, H], [u1, v0, H], [u0, v0, H]], ct = ROOM_TEXTURES.roomCeiling;
    quad(TB('roomCeiling'), cp, [0, -1, 0], C('#f2efe8', 0.96), E0, cp.map((q) => [q[0] / ct, q[1] / ct]));
    box(u0 - T, u1 + T, v0 - T, v1 + T, H + 0.01, H + 0.2, '#8a8680');
  }
  // the walls: two sides and the far one with its slot; and a lining on the flat's side of the door
  const slot = [Math.max(u0 + 0.3, (u0 + u1) / 2 - 0.6), Math.min(u1 - 0.3, (u0 + u1) / 2 + 0.6), H - 0.75, H - 0.3];
  box(u0 - T, u0, v0, v1 + T, 0, H, wallHex, 1, wall);
  box(u1, u1 + T, v0, v1 + T, 0, H, wallHex, 1, wall);
  box(u0, slot[0], v1, v1 + T, 0, H, wallHex, 1, wall);
  box(slot[1], u1, v1, v1 + T, 0, H, wallHex, 1, wall);
  box(slot[0], slot[1], v1, v1 + T, 0, slot[2], wallHex, 1, wall);
  box(slot[0], slot[1], v1, v1 + T, slot[3], H, wallHex, 1, wall);
  const [d0, d1] = a.door;
  box(u0, d0, v0, v0 + 0.012, 0, H, wallHex, 1, wall);
  box(d1, u1, v0, v0 + 0.012, 0, H, wallHex, 1, wall);
  box(d0, d1, v0, v0 + 0.012, DH, H, wallHex, 1, wall);
  // the frosted slot, lit by the day (gl/room.js: FROST), with a black frame
  quad(K.solid, [[slot[0], v1 + 0.04, slot[2]], [slot[1], v1 + 0.04, slot[2]], [slot[1], v1 + 0.04, slot[3]], [slot[0], v1 + 0.04, slot[3]]], K.nrmOf(0, 0, -1), [0.82, 0.86, 0.9], FROST, null, true);
  for (const [p, q, r, s] of [[slot[0], slot[1], slot[2] - 0.02, slot[2]], [slot[0], slot[1], slot[3], slot[3] + 0.02]]) box(p, q, v1 + 0.02, v1 + 0.05, r, s, '#17181b', 1, null, SATIN);
  // a plain en-suite's tiles to shoulder height, on the three walls that are its own
  if (!fine) {
    const tile = { t: 'roomTile', c: '#d8dcd8' }, y = 1.4;
    box(u0, u0 + 0.012, v0, v1, 0, y, '#ffffff', 0.96, tile, GLOSS);
    box(u1 - 0.012, u1, v0, v1, 0, y, '#ffffff', 0.96, tile, GLOSS);
    box(u0, u1, v1 - 0.012, v1, 0, y, '#ffffff', 0.96, tile, GLOSS);
    box(u0, d0, v0 + 0.012, v0 + 0.024, 0, y, '#ffffff', 0.96, tile, GLOSS);
    box(d1, u1, v0 + 0.012, v0 + 0.024, 0, y, '#ffffff', 0.96, tile, GLOSS);
  }
  // the door's frame through the wall, and the leaf swung right round against the wall
  const fr = fine ? '#2a2c30' : '#e2dccd';
  for (const [p, q] of [[d0 - 0.04, d0 + 0.01], [d1 - 0.01, d1 + 0.04]]) box(p, q, D - 0.014, v0 + 0.014, 0, DH + 0.04, fr, 0.97, null, SATIN);
  box(d0 - 0.04, d1 + 0.04, D - 0.014, v0 + 0.014, DH - 0.01, DH + 0.04, fr, 0.97, null, SATIN);
  const lw = Math.min(d1 - d0, u1 - d1 - 0.03);
  const annexLeaf = { t: fine ? 'roomOak' : 'roomWood', c: fine ? '#8a6a4a' : '#9a7a5a' };
  // shut, it fills the frame: somebody's in there
  if (doorShut) box(d0 + 0.01, d1 - 0.01, v0 - 0.03, v0 + 0.012, 0, DH - 0.01, '#6a4a30', 0.92, annexLeaf, SATIN);
  else box(d1, d1 + lw, v0 + 0.03, v0 + 0.07, 0, DH - 0.01, '#6a4a30', 0.92, annexLeaf, SATIN);
  // the light
  const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
  if (fine) box(u0 + 0.2, u1 - 0.2, cv - 0.02, cv + 0.02, H - 0.004, H - 0.001, lampOn ? '#fff0d0' : '#c8c4b8', lampOn ? 2 : 0.8);
  else lathe(cu, cv, [[0.13, H - 0.09], [0.15, H - 0.06], [0.15, H - 0.01], [0, H - 0.01]], lampOn ? '#fff2d8' : '#c8c4b8', lampOn ? 1.6 : 0.8, 16, lampOn ? LAMP : undefined);
  lamps.push({ p: L.world(cu, cv, H - 0.35), annex: true, k: 1.1 });
}

// ── the pieces ──────────────────────────────────────────────────────────────────────────────────
// A thin bar between two room points, six-sided, for legs, rails, pipes and aerials.
function rodOf(K) {
  return (a, b, r, hex, k = 1, surf = METAL, n = 6) => {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l = Math.hypot(...d) || 1, t = d.map((x) => x / l);
    const up = Math.abs(t[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const cx = (p, q) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
    let s = cx(t, up); const sl = Math.hypot(...s); s = s.map((x) => x / sl);
    const w = cx(t, s), col = K.C(hex, k);
    for (let i = 0; i < n; i++) {
      const a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2, am = (a0 + a1) / 2;
      const o = (ang) => s.map((x, j) => (x * Math.cos(ang) + w[j] * Math.sin(ang)) * r);
      const o0 = o(a0), o1 = o(a1), nm = s.map((x, j) => x * Math.cos(am) + w[j] * Math.sin(am));
      K.quad(K.solid, [[a[0] + o0[0], a[1] + o0[1], a[2] + o0[2]], [a[0] + o1[0], a[1] + o1[1], a[2] + o1[2]], [b[0] + o1[0], b[1] + o1[1], b[2] + o1[2]], [b[0] + o0[0], b[1] + o0[1], b[2] + o0[2]]],
        K.nrmOf(nm[0], nm[2], nm[1]), col, surf, null, k >= 1.25);
    }
  };
}

function drawPiece(K, p) {
  const [fu, fv] = facing(p.turn), F = K.frame(p.u, p.v, fu, fv), { P, pbox, alongX, alongY, alongZ } = F;
  const r = rng(p.seed || 7), wear = Math.max(0, Math.min(1, p.wear || 0));
  const w = p.w, d = p.d, h = p.h, hw = w / 2, hd = d / 2, rod = rodOf(K);
  // worn things are darker and duller; a colour picked off the seed, tired by the wear
  const tired = (k) => k * (1 - wear * 0.22);
  const fine = !!K.fine;
  const fab = { t: 'roomWeave', c: pick(r, fine ? FABRIC_FINE : FABRIC) }, wood = { t: fine ? 'roomOak' : 'roomWood', c: pick(r, fine ? WOOD_FINE : WOOD) }, enamel = pick(r, fine ? ENAMEL_FINE : ENAMEL), plastic = pick(r, PLASTIC);
  const steel = { t: 'roomSteel', c: '#c8ccd0' };
  const lat = (x, z, prof, mat, k = 1, n = 14, surf = E()) => { const [u, v] = P(x, 0, z); K.lathe(u, v, prof, mat, k, n, surf); };
  const R = (...a) => K.rounded(...a);
  // a stain or a patch on a worn piece: a darker square on a face, a little proud of it
  const stain = (x, y, z, s) => { if (wear > 0.45 && r() < wear) pbox(x - s, x + s, y - s * 0.7, y + s * 0.7, z, z + 0.003, '#2a2018', 0.55 + r() * 0.2, null, MATTE); };
  // the forms room-fittings.js owns, on the same helpers
  if (drawFitting({ K, F, p, r, L: K.L, wear, fine, fab, wood, enamel, plastic, steel, tired, stain, lat, rod, R, pick: (list) => pick(r, list) })) return;
  switch (p.form) {
    case 'stool': {
      lat(0, 0, [[0, 0], [0.19, 0], [0.19, 0.012], [0.14, 0.03], [0.03, 0.05], [0.022, 0.1], [0.022, 0.64], [0.05, 0.67], [0.05, 0.69], [0, 0.69]], '#9aa0a8', 1, 18, METAL);
      lat(0, 0, [[0.14, 0.27], [0.15, 0.275], [0.15, 0.29], [0.14, 0.295], [0.13, 0.29], [0.13, 0.275], [0.14, 0.27]], '#9aa0a8', 1, 18, METAL);
      lat(0, 0, [[0, 0.69], [0.19, 0.69], [0.215, 0.705], [0.225, 0.73], [0.21, 0.75], [0.17, 0.762], [0, 0.765]], pick(r, ['#7a2a24', '#2a2a2e', '#5a3a2a']), tired(0.95), 22, LEATHER);
      if (wear > 0.4) lat(0.06, 0.03, [[0, 0.763], [0.05, 0.763], [0, 0.767]], '#d8c8a8', 0.9, 8, CLOTH);
      break;
    }
    case 'chair': {
      // four tapered legs, a padded seat, a back that leans a little; steel or wood off the seed
      const metal = r() < 0.5, frame = metal ? '#8a9098' : null, legM = metal ? frame : wood, sy = 0.44, sd = hd - 0.03;
      for (const [x, z] of [[-hw + 0.05, -hd + 0.05], [hw - 0.05, -hd + 0.05], [-hw + 0.05, hd - 0.05], [hw - 0.05, hd - 0.05]]) lat(x, z, [[0.014, 0], [0.02, sy - 0.03]], legM, 0.9, 8, metal ? METAL : SATIN);
      pbox(-hw + 0.02, hw - 0.02, sy - 0.05, sy - 0.02, -sd, sd, frame || '#5a3a22', 0.85, metal ? null : wood, metal ? METAL : SATIN);
      R(...alongX(), -hw + 0.03, hw - 0.03, -sd, sd, sy - 0.02, sy + 0.06, 0.03, fab, tired(1), CLOTH);
      for (const x of [-hw + 0.05, hw - 0.05]) rod(P(x, sy - 0.02, -hd + 0.04), P(x, h - 0.02, -hd + 0.01 - 0.04 * 1), 0.016, metal ? frame : pick(r, WOOD), 0.9, metal ? METAL : SATIN);
      R(...alongX(0.12, sy + 0.12), -hw + 0.04, hw - 0.04, -hd + 0.02, -hd + 0.07, sy + 0.14, h, 0.03, fab, tired(0.97), CLOTH);
      stain(0, sy + 0.08, sd - 0.1, 0.05);
      break;
    }
    case 'bench': {
      // a slatted seat on two steel ends
      for (const x of [-hw + 0.08, hw - 0.08]) { pbox(x - 0.025, x + 0.025, 0, 0.42, -hd + 0.05, hd - 0.05, '#4a4e54', 0.9, null, METAL); pbox(x - 0.025, x + 0.025, 0.02, 0.06, -hd + 0.02, hd - 0.02, '#4a4e54', 0.9, null, METAL); }
      for (let i = 0; i < 5; i++) { const z = -hd + 0.06 + i * (d - 0.12) / 4.6; pbox(-hw, hw, 0.42, 0.455, z, z + (d - 0.12) / 5.4, '#7a6a52', 0.95, wood, SATIN); }
      if (h > 0.6) for (let i = 0; i < 2; i++) pbox(-hw, hw, 0.62 + i * 0.13, 0.72 + i * 0.13, -hd + 0.01, -hd + 0.04, '#7a6a52', 0.95, wood, SATIN);
      for (const x of [-hw + 0.08, hw - 0.08]) if (h > 0.6) rod(P(x, 0.42, -hd + 0.05), P(x, h - 0.05, -hd + 0.02), 0.02, '#4a4e54', 0.9);
      break;
    }
    case 'booth': {
      // a diner booth: a wooden plinth, a vinyl seat and a tall back in rolled channels
      const vinyl = pick(r, ['#8a2a2a', '#2a4a5a', '#6a2a3a', '#3a3a3a', '#a8742a']);
      pbox(-hw, hw, 0, 0.36, -hd + 0.02, hd - 0.05, '#5a3a22', 0.85, wood, SATIN);
      R(...alongX(), -hw + 0.02, hw - 0.02, -hd + 0.2, hd - 0.02, 0.36, 0.47, 0.05, vinyl, tired(1), LEATHER);
      pbox(-hw, hw, 0, h, -hd, -hd + 0.06, '#5a3a22', 0.85, wood, SATIN);
      const n = Math.max(4, Math.round(w / 0.16));
      for (let i = 0; i < n; i++) { const x0 = -hw + 0.03 + i * (w - 0.06) / n, x1 = x0 + (w - 0.06) / n; R(...alongY(), 0.47, h - 0.04, x0 + 0.003, x1 - 0.003, -hd + 0.06, -hd + 0.17, 0.035, vinyl, tired(0.97), LEATHER); }
      R(...alongX(), -hw, hw, -hd, -hd + 0.18, h - 0.06, h, 0.03, '#5a3a22', 0.9, SATIN);
      if (wear > 0.3) pbox(-0.08, 0.1, 0.47, 0.475, 0.0, 0.08, '#c8b890', 0.9, null, CLOTH);
      break;
    }
    case 'sofa': {
      // a deep base on turned feet, cushions in front of cushions, rolled arms; worn ones sag
      const n = Math.max(2, Math.min(3, Math.round(w / 0.62))), arm = 0.2, sy = 0.42 - wear * 0.04;
      for (const [x, z] of [[-hw + 0.08, -hd + 0.08], [hw - 0.08, -hd + 0.08], [-hw + 0.08, hd - 0.1], [hw - 0.08, hd - 0.1]]) lat(x, z, [[0, 0], [0.025, 0], [0.03, 0.02], [0.026, 0.09], [0.035, 0.11], [0, 0.11]], '#3a2818', 0.9, 10, SATIN);
      R(...alongX(), -hw + 0.02, hw - 0.02, -hd + 0.04, hd - 0.02, 0.11, 0.32, 0.05, fab, tired(0.85), CLOTH);
      R(...alongX(0.14, 0.32), -hw + 0.04, hw - 0.04, -hd + 0.01, -hd + 0.2, 0.3, h, 0.08, fab, tired(0.9), CLOTH);
      const inner = [-hw + arm, hw - arm], third = (inner[1] - inner[0]) / n;
      for (let i = 0; i < n; i++) {
        const a0 = inner[0] + i * third + 0.008, a1 = a0 + third - 0.016, sag = wear * (i === Math.floor(n / 2) ? 0.03 : 0.012);
        R(...alongX(0.14, 0.32), a0, a1, -hd + 0.18, -hd + 0.33, sy + 0.06, h - 0.06 - sag, 0.06, fab, tired(0.97), CLOTH);
        R(...alongX(), a0, a1, -hd + 0.26, hd + 0.01, 0.3, sy + 0.08 - sag, 0.06, fab, tired(1), CLOTH);
        stain(a0 + third / 2, sy + 0.08 - sag + 0.002, 0, 0.06);
      }
      for (const s of [-1, 1]) {
        const x0 = s < 0 ? -hw : hw - arm, x1 = s < 0 ? -hw + arm : hw;
        R(...alongZ(), -hd + 0.03, hd - 0.01, x0 + 0.01, x1 - 0.01, 0.11, 0.56, 0.05, fab, tired(0.9), CLOTH);
        R(...alongZ(), -hd + 0.02, hd + 0.02, s < 0 ? -hw - 0.02 : hw - arm + 0.02, s < 0 ? -hw + arm - 0.02 : hw + 0.02, 0.5, 0.64, 0.07, fab, tired(0.95), CLOTH);
      }
      // a blanket thrown over one arm on a lived-in sofa
      if (wear > 0.25 || r() < 0.4) {
        const s = r() < 0.5 ? -1 : 1, x0 = s < 0 ? -hw - 0.025 : hw - arm - 0.01, x1 = s < 0 ? -hw + arm + 0.01 : hw + 0.025, bc = pick(r, ['#c8b48a', '#7a8a6a', '#a85a4a', '#5a6a8a']);
        R(...alongZ(), -hd + 0.15, hd - 0.15, x0, x1, 0.6, 0.67, 0.03, { t: 'roomWeave', c: bc }, 0.95, CLOTH);
        pbox(s < 0 ? -hw - 0.035 : hw + 0.005, s < 0 ? -hw - 0.005 : hw + 0.035, 0.28, 0.66, -hd + 0.2, hd - 0.2, bc, 0.9, { t: 'roomWeave', c: bc }, CLOTH);
      }
      break;
    }
    case 'cot': {
      // a folding camp cot: a tube frame on crossed legs, an olive canvas sling, a folded blanket
      for (const z of [-hd + 0.04, hd - 0.04]) rod(P(-hw, 0.4, z), P(hw, 0.4, z), 0.014, '#5a5e4a', 0.9);
      for (const x of [-hw + 0.1, hw - 0.1]) { rod(P(x, 0.0, -hd + 0.04), P(x, 0.4, hd - 0.04), 0.012, '#5a5e4a', 0.9); rod(P(x, 0.0, hd - 0.04), P(x, 0.4, -hd + 0.04), 0.012, '#5a5e4a', 0.9); }
      R(...alongX(), -hw + 0.02, hw - 0.02, -hd + 0.04, hd - 0.04, 0.37, 0.41, 0.015, { t: 'roomCanvas', c: '#6a6e4a' }, tired(1), CLOTH);
      R(...alongX(), hw - 0.5, hw - 0.12, -hd + 0.1, hd - 0.1, 0.41, 0.48, 0.02, { t: 'roomWeave', c: '#7a6a5a' }, 0.95, CLOTH);
      break;
    }
    case 'bed': case 'pod': {
      // a frame, a mattress, a sheet, a duvet turned down, a pillow at the wall; a pod has a shell
      // hooped over it with a strip of light along the inside
      const top = p.form === 'pod' ? 0.42 : 0.38;
      pbox(-hw, hw, 0.05, 0.22, -hd, hd, '#5a3a22', 0.85, p.form === 'pod' ? null : wood, SATIN);
      for (const [x, z] of [[-hw + 0.05, -hd + 0.05], [hw - 0.05, -hd + 0.05], [-hw + 0.05, hd - 0.05], [hw - 0.05, hd - 0.05]]) pbox(x - 0.03, x + 0.03, 0, 0.05, z - 0.03, z + 0.03, '#2a2622', 0.9);
      R(...alongZ(), -hd + 0.02, hd - 0.02, -hw + 0.03, hw - 0.03, 0.22, top - 0.02, 0.06, { t: 'roomTicking', c: '#e8e4da' }, tired(1), CLOTH);
      const duv = { t: 'roomWeave', c: pick(r, FABRIC) };
      R(...alongZ(), -hd + 0.55, hd + 0.03, -hw + 0.01, hw - 0.01, top - 0.06, top + 0.05, 0.05, duv, tired(1), CLOTH);
      R(...alongZ(), -hd + 0.5, -hd + 0.62, -hw + 0.015, hw - 0.015, top - 0.04, top + 0.06, 0.04, { t: 'roomWeave', c: '#ece6da' }, 1, CLOTH);
      R(...alongX(), -hw + 0.12, hw - 0.12, -hd + 0.06, -hd + 0.4, top - 0.02, top + 0.1, 0.05, { t: 'roomTicking', c: '#f2efe8' }, 1, CLOTH);
      if (p.form === 'pod') {
        const shell = enamel, Rr = hw + 0.03, z0 = -hd - 0.01, z1 = hd - 0.5, cy = top - 0.02, n = 14;
        for (let i = 0; i < n; i++) {
          const a0 = i / n * Math.PI, a1 = (i + 1) / n * Math.PI;
          const at = (a, z, rr) => P(Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.8, z);
          const nm = (a) => F.N(Math.cos(a), Math.sin(a), 0);
          K.quad(K.solid, [at(a0, z0, Rr), at(a1, z0, Rr), at(a1, z1, Rr), at(a0, z1, Rr)], nm((a0 + a1) / 2), K.C(shell, 0.95), GLOSS);
          K.quad(K.solid, [at(a0, z1, Rr), at(a1, z1, Rr), at(a1, z1, Rr - 0.05), at(a0, z1, Rr - 0.05)], F.N(0, 0, 1), K.C(shell, 0.85), GLOSS);
        }
        // the light strip along the inside of the hood, at its crown
        const sy = cy + (Rr - 0.04) * 0.8;
        K.quad(K.solid, [P(-0.03, sy, z0 + 0.05), P(0.03, sy, z0 + 0.05), P(0.03, sy, z1 - 0.05), P(-0.03, sy, z1 - 0.05)], F.N(0, -1, 0), K.C('#9fe8ff', 1.6), E(), null, true);
      }
      break;
    }
    case 'flat': case 'slab': {
      // a panel on a bracket, its picture on the screen batch; a slab is thinner, with a lit edge
      const cy = 1.25, ph = h, thick = p.form === 'slab' ? 0.018 : 0.045, z0 = -hd + 0.03;
      pbox(-0.12, 0.12, cy - 0.1, cy + 0.1, -hd, z0, '#1a1b1e', 0.9, null, METAL);
      pbox(-hw, hw, cy - ph / 2, cy + ph / 2, z0, z0 + thick, plastic, 0.9, null, SATIN);
      pbox(-hw + 0.012, hw - 0.012, cy - ph / 2 + 0.012, cy + ph / 2 - 0.012, z0 + thick, z0 + thick + 0.002, '#0a0b0d', 0.9, null, GLOSS);
      noteScreen(K, p, F, hw - 0.016, cy - ph / 2 + 0.016, cy + ph / 2 - 0.016, z0 + thick + 0.004);
      F.front(K.screen, -hw + 0.016, hw - 0.016, cy - ph / 2 + 0.016, cy + ph / 2 - 0.016, z0 + thick + 0.003, [1, 1, 1], E(), [[1, 1], [0, 1], [0, 0], [1, 0]]);
      if (p.form === 'slab') pbox(-hw, hw, cy - ph / 2 - 0.006, cy - ph / 2, z0, z0 + thick, '#ff4fb0', 1.7);
      else pbox(hw - 0.06, hw - 0.04, cy - ph / 2 + 0.004, cy - ph / 2 + 0.008, z0 + thick, z0 + thick + 0.002, '#ff3020', 1.5);
      // the cable down the wall to the socket
      rod(P(hw * 0.3, cy - ph / 2, -hd + 0.01), P(hw * 0.3, 0.3, -hd + 0.01), 0.005, '#1a1a1a', 0.9, SATIN, 4);
      break;
    }
    case 'crt': {
      // a cathode set on a low cabinet: a deep tapered body, a bezel, a bulging face, two knobs and
      // a pair of rabbit ears
      const ch = 0.5, bw = Math.min(w, 0.62), bh = Math.min(h, 0.5), bd = Math.max(0.42, Math.min(0.5, bw * 0.75));
      pbox(-hw, hw, 0, ch, -hd, hd, '#3a2a1e', 0.85, wood, SATIN);
      pbox(-hw + 0.02, hw - 0.02, 0.06, ch - 0.06, hd, hd + 0.004, '#2a1e16', 0.9, wood, SATIN);
      const zf = hd - 0.02, zb = zf - bd;
      pbox(-bw / 2, bw / 2, ch, ch + bh, zf - 0.22, zf, '#5a4a38', 0.95, wood, SATIN);
      pbox(-bw / 2 + 0.07, bw / 2 - 0.07, ch + 0.05, ch + bh - 0.06, zb, zf - 0.22, '#2a2622', 0.9, null, SATIN);
      pbox(-bw / 2 + 0.02, bw / 2 - 0.16, ch + 0.03, ch + bh - 0.03, zf, zf + 0.01, '#141414', 0.9, null, SATIN);
      // the face: a grid bulging out at its middle, on the screen batch
      const gx = 6, gy = 5, sx0 = -bw / 2 + 0.05, sx1 = bw / 2 - 0.19, sy0 = ch + 0.06, sy1 = ch + bh - 0.06;
      noteScreen(K, p, F, (sx1 - sx0) / 2, sy0, sy1, zf + 0.034, (sx0 + sx1) / 2);
      for (let i = 0; i < gx; i++) for (let j = 0; j < gy; j++) {
        const xa = sx0 + (sx1 - sx0) * i / gx, xb = sx0 + (sx1 - sx0) * (i + 1) / gx, ya = sy0 + (sy1 - sy0) * j / gy, yb = sy0 + (sy1 - sy0) * (j + 1) / gy;
        const bz = (x, y) => zf + 0.012 + 0.02 * (1 - ((x - (sx0 + sx1) / 2) / ((sx1 - sx0) / 2)) ** 2) * (1 - ((y - (sy0 + sy1) / 2) / ((sy1 - sy0) / 2)) ** 2);
        const uv = (x, y) => [1 - (x - sx0) / (sx1 - sx0), 1 - (y - sy0) / (sy1 - sy0)];
        K.quad(K.screen, [P(xa, ya, bz(xa, ya)), P(xb, ya, bz(xb, ya)), P(xb, yb, bz(xb, yb)), P(xa, yb, bz(xa, yb))], F.N(0, 0, 1), [1, 1, 1], E(), [uv(xa, ya), uv(xb, ya), uv(xb, yb), uv(xa, yb)], true);
      }
      for (const y of [ch + bh * 0.7, ch + bh * 0.4]) { pbox(bw / 2 - 0.11, bw / 2 - 0.05, y - 0.03, y + 0.03, zf, zf + 0.03, '#c8c0a8', 0.95, null, SATIN); }
      pbox(bw / 2 - 0.12, bw / 2 - 0.04, ch + 0.06, ch + 0.16, zf, zf + 0.012, '#8a8070', 0.9, null, METAL);
      for (const s of [-1, 1]) rod(P(0, ch + bh, zb + 0.12), P(s * 0.28, ch + bh + 0.42, zb + 0.06), 0.004, '#c8ccd0', 1.05);
      lat(0, zb + 0.12, [[0, ch + bh], [0.04, ch + bh], [0.035, ch + bh + 0.03], [0, ch + bh + 0.035]], '#2a2a2a', 0.9, 10);
      break;
    }
    case 'fridge': case 'double': {
      // a tall cabinet with rounded corners, a freezer door over the fridge door (or two doors side by
      // side), steel handles, a black kick plate, and things stuck to the door
      const metal = p.form === 'double', body = metal ? '#c8ccd0' : enamel, tex = metal ? steel : null, surf = metal ? METAL : GLOSS;
      R(...alongY(), 0.06, h, -hw + 0.01, hw - 0.01, -hd, hd - 0.035, 0.05, tex || body, metal ? 1 : 0.96, surf);
      pbox(-hw + 0.03, hw - 0.03, 0, 0.06, -hd + 0.04, hd - 0.08, '#141414', 0.9);
      const zf = hd - 0.035;
      if (metal) {
        R(...alongY(), 0.07, h - 0.02, -hw + 0.01, -0.006, zf, zf + 0.035, 0.012, steel, 1.02, METAL);
        R(...alongY(), 0.07, h - 0.02, 0.006, hw - 0.01, zf, zf + 0.035, 0.012, steel, 1.02, METAL);
        pbox(-0.006, 0.006, 0.07, h - 0.02, zf, zf + 0.03, SEAM, 0.9);
        for (const x of [-0.04, 0.04]) { rod(P(x, h * 0.35, zf + 0.06), P(x, h * 0.8, zf + 0.06), 0.012, '#e0e4e8', 1.1); for (const y of [h * 0.35, h * 0.8]) rod(P(x, y, zf + 0.035), P(x, y, zf + 0.06), 0.008, '#e0e4e8', 1.1); }
      } else {
        const split = h * 0.7;
        pbox(-hw + 0.01, hw - 0.01, split - 0.008, split + 0.008, zf, zf + 0.03, SEAM, 0.9); // the gasket showing between the doors
        R(...alongY(), 0.07, split - 0.008, -hw + 0.01, hw - 0.01, zf, zf + 0.035, 0.014, body, 0.98, GLOSS);
        R(...alongY(), split + 0.008, h - 0.015, -hw + 0.01, hw - 0.01, zf, zf + 0.035, 0.014, body, 0.98, GLOSS);
        const hx = -hw + 0.07;
        for (const [y0, y1] of [[split - 0.42, split - 0.1], [split + 0.06, split + 0.24]]) { rod(P(hx, y0, zf + 0.06), P(hx, y1, zf + 0.06), 0.011, '#d8dce0', 1.1); for (const y of [y0, y1]) rod(P(hx, y, zf + 0.035), P(hx, y, zf + 0.06), 0.008, '#d8dce0', 1.1); }
        // a takeaway menu, a photo, a shopping list, each held by a magnet
        const notes = [['#f2ead2', 0.14, 0.2], ['#d8c8a0', 0.1, 0.14], ['#f4f2ec', 0.09, 0.16], ['#c86a4a', 0.07, 0.07]];
        for (let i = 0; i < 2 + Math.floor(r() * 3); i++) {
          const [c, nw, nh] = notes[i % notes.length], x = -hw * 0.2 + r() * hw * 0.8, y = split * (0.45 + r() * 0.4);
          pbox(x - nw / 2, x + nw / 2, y - nh / 2, y + nh / 2, zf + 0.035, zf + 0.037, c, 0.95, null, MATTE);
          pbox(x - 0.012, x + 0.012, y + nh / 2 - 0.03, y + nh / 2 - 0.006, zf + 0.037, zf + 0.047, pick(r, ['#d83a2a', '#2a6ad8', '#e8c02a', '#3aa84a']), 1, null, GLOSS);
        }
      }
      // whatever's kept on top
      if (r() < 0.7) pbox(-hw * 0.6, -hw * 0.6 + 0.2, h, h + 0.28, -hd * 0.4, -hd * 0.4 + 0.07, pick(r, ['#d8a83a', '#c83a2a', '#3a7ad8']), 0.95, null, SATIN);
      break;
    }
    case 'chest': {
      // a chest freezer: a white box with a rounded lid, a handle, a dial and a green lamp
      R(...alongX(), -hw, hw, -hd, hd, 0.06, h - 0.07, 0.04, enamel, 0.96, GLOSS);
      R(...alongX(), -hw - 0.01, hw + 0.01, -hd - 0.01, hd + 0.01, h - 0.07, h, 0.03, enamel, 0.99, GLOSS);
      pbox(-hw + 0.04, hw - 0.04, 0, 0.06, -hd + 0.04, hd - 0.04, '#141414', 0.9);
      R(...alongX(), -0.2, 0.2, hd + 0.01, hd + 0.04, h - 0.1, h - 0.07, 0.01, '#9aa0a8', 1, METAL);
      pbox(hw - 0.16, hw - 0.1, h - 0.2, h - 0.14, hd, hd + 0.015, '#d8d4c8', 1, null, SATIN);
      pbox(hw - 0.07, hw - 0.05, h - 0.18, h - 0.16, hd, hd + 0.012, '#5aff7a', 1.6);
      break;
    }
    case 'range': case 'cooktop': {
      // a range: an oven with a window in its door, four rings on top, knobs on a back panel, and a
      // run of tiles on the wall behind. A cooktop is two rings on a small cabinet
      const range = p.form === 'range', body = range ? enamel : '#ffffff', top = h;
      if (range) {
        R(...alongY(), 0.08, top - 0.03, -hw, hw, -hd, hd - 0.03, 0.02, body, 0.97, GLOSS);
        pbox(-hw + 0.02, hw - 0.02, 0, 0.08, -hd + 0.04, hd - 0.08, '#141414', 0.9);
        const zf = hd - 0.03;
        pbox(-hw + 0.04, hw - 0.04, 0.14, top - 0.2, zf, zf + 0.02, body, 0.94, null, GLOSS);
        pbox(-hw + 0.12, hw - 0.12, 0.3, top - 0.32, zf + 0.02, zf + 0.022, '#141618', 0.9, null, GLOSS);
        rod(P(-hw + 0.1, top - 0.24, zf + 0.06), P(hw - 0.1, top - 0.24, zf + 0.06), 0.012, '#c8ccd0', 1.1);
        for (const x of [-hw + 0.1, hw - 0.1]) rod(P(x, top - 0.24, zf + 0.02), P(x, top - 0.24, zf + 0.06), 0.008, '#c8ccd0', 1.1);
        pbox(-hw, hw, top, top + 0.16, -hd, -hd + 0.06, body, 0.92, null, GLOSS);
        for (let i = 0; i < 4; i++) { const x = -hw + 0.1 + i * (w - 0.2) / 3; const [u, v] = P(x, 0, -hd + 0.065); K.lathe(u, v, [[0, top + 0.06], [0.022, top + 0.06], [0.022, top + 0.09], [0, top + 0.095]], '#2a2a2a', 0.9, 10, SATIN); }
        // tiles up the wall behind it
        if (!K.L.spec.plan) pbox(-hw - 0.15, hw + 0.15, top, top + 0.6, -hd - 0.004, -hd + 0.002, '#ffffff', 0.95, { t: 'roomTile', c: pick(r, ['#e8e4d8', '#c8d8d0', '#d8c8a8']) }, GLOSS);
      } else {
        pbox(-hw, hw, 0, top - 0.05, -hd, hd, '#6a5a48', 0.9, wood, SATIN);
        pbox(-hw + 0.02, hw - 0.02, 0.08, top - 0.12, hd, hd + 0.01, '#6a5a48', 0.95, wood, SATIN);
        rod(P(-0.08, top - 0.18, hd + 0.03), P(0.08, top - 0.18, hd + 0.03), 0.008, '#c8ccd0', 1.05);
      }
      // the hob plate and its rings
      pbox(-hw + 0.01, hw - 0.01, top - 0.05, top, -hd + 0.02, hd - 0.02, '#16171a', 0.9, null, GLOSS);
      const rings = range ? [[-0.15, -0.12, 0.09], [0.15, -0.12, 0.075], [-0.15, 0.14, 0.075], [0.15, 0.14, 0.09]] : [[-0.13, 0, 0.08], [0.13, 0, 0.07]];
      for (const [x, z, rr] of rings) {
        const [u, v] = P(x * w / 0.76, 0, z * d / 0.66);
        K.lathe(u, v, [[rr * 0.3, top + 0.003], [rr, top + 0.003], [rr, top + 0.012], [rr * 0.3, top + 0.012]], '#3a3a3e', 0.95, 20, METAL);
        K.lathe(u, v, [[0, top + 0.006], [rr * 0.32, top + 0.006]], '#2a2a2e', 0.9, 16, METAL);
      }
      break;
    }
    case 'microwave': {
      // a microwave on a little steel trolley: a box, a dark window in its door, a keypad, a handle
      const ty = p.rise || 0.55;
      if (!p.rise) {
        for (const [x, z] of [[-hw + 0.03, -hd + 0.03], [hw - 0.03, -hd + 0.03], [-hw + 0.03, hd - 0.03], [hw - 0.03, hd - 0.03]]) rod(P(x, 0.02, z), P(x, ty, z), 0.012, '#9aa0a8', 1);
        pbox(-hw, hw, ty - 0.02, ty, -hd, hd, '#b8bcc0', 1, steel, METAL);
        pbox(-hw, hw, 0.12, 0.14, -hd, hd, '#b8bcc0', 1, steel, METAL);
      }
      R(...alongX(), -hw + 0.01, hw - 0.01, -hd + 0.02, hd - 0.02, ty, ty + 0.3, 0.02, enamel, 0.96, GLOSS);
      pbox(-hw + 0.04, hw * 0.35, ty + 0.04, ty + 0.26, hd - 0.02, hd - 0.012, '#121416', 0.9, null, GLOSS);
      pbox(hw * 0.45, hw - 0.04, ty + 0.16, ty + 0.25, hd - 0.02, hd - 0.014, '#0a1a10', 1, null, GLOSS);
      pbox(hw * 0.5, hw - 0.08, ty + 0.2, ty + 0.235, hd - 0.014, hd - 0.012, '#48ff8a', 1.5);
      for (let i = 0; i < 9; i++) pbox(hw * 0.5 + (i % 3) * 0.035, hw * 0.5 + (i % 3) * 0.035 + 0.025, ty + 0.05 + Math.floor(i / 3) * 0.03, ty + 0.07 + Math.floor(i / 3) * 0.03, hd - 0.02, hd - 0.012, '#d8d4c8', 1, null, SATIN);
      break;
    }
    case 'counter': case 'desk': {
      if (p.form === 'counter') {
        // base cupboards with doors and handles under a concrete slab with a little overhang; a kettle
        // and a couple of mugs on top
        const n = Math.max(1, Math.round(w / 0.6)), lam = pick(r, ['#d8d0c0', '#4a5a5a', '#8a6a4a', '#e8e4dc']);
        pbox(-hw, hw, 0, 0.1, -hd, hd - 0.06, '#1a1a1a', 0.9);
        pbox(-hw, hw, 0.1, h - 0.04, -hd, hd - 0.02, lam, 0.92, null, SATIN);
        for (let i = 0; i < n; i++) {
          const x0 = -hw + 0.004 + i * w / n, x1 = x0 + w / n - 0.008;
          pbox(x0, x1, 0.11, h - 0.06, hd - 0.02, hd, lam, 0.97, null, SATIN);
          if (i < n - 1) pbox(x1, x1 + 0.008, 0.11, h - 0.06, hd - 0.02, hd - 0.004, SEAM, 0.9);
          rod(P(i % 2 ? x0 + 0.05 : x1 - 0.05, h - 0.22, hd + 0.02), P(i % 2 ? x0 + 0.05 : x1 - 0.05, h - 0.12, hd + 0.02), 0.007, '#c8ccd0', 1.05);
        }
        pbox(-hw - 0.01, hw + 0.01, h - 0.04, h, -hd, hd + 0.03, '#a8a49c', 1, { t: 'roomConcrete', c: '#b8b4ac' }, MATTE);
        lat(-hw * 0.5, 0, [[0, h], [0.08, h], [0.085, h + 0.02], [0.08, h + 0.16], [0.06, h + 0.2], [0, h + 0.21]], pick(r, ['#d8d4c8', '#2a2a2a', '#c83a2a']), 0.95, 16, GLOSS);
        for (const x of [hw * 0.25, hw * 0.45]) lat(x, -0.05 + r() * 0.1, [[0, h], [0.04, h], [0.042, h + 0.1], [0.038, h + 0.1], [0.036, h + 0.006], [0, h + 0.006]], pick(r, ['#f2efe8', '#3a6a8a', '#d8a83a']), 1, 14, GLOSS);
      } else {
        // a desk: a top on four legs with a drawer, a lamp, papers
        const top = { t: 'roomWood', c: pick(r, WOOD) };
        pbox(-hw, hw, h - 0.03, h, -hd, hd, '#7a5a3a', 1, top, SATIN);
        for (const [x, z] of [[-hw + 0.04, -hd + 0.04], [hw - 0.04, -hd + 0.04], [-hw + 0.04, hd - 0.04], [hw - 0.04, hd - 0.04]]) pbox(x - 0.022, x + 0.022, 0, h - 0.03, z - 0.022, z + 0.022, '#7a5a3a', 0.9, top, SATIN);
        pbox(-hw + 0.06, hw * 0.1, h - 0.14, h - 0.03, -hd + 0.06, hd - 0.02, '#7a5a3a', 0.95, top, SATIN);
        rod(P(-hw * 0.4 - 0.04, h - 0.085, hd + 0.005), P(-hw * 0.4 + 0.04, h - 0.085, hd + 0.005), 0.006, '#c8ccd0', 1.05);
        for (let i = 0; i < 3; i++) { const x = hw * 0.2 + r() * 0.1, z = -0.05 + r() * 0.1; pbox(x - 0.105, x + 0.105, h + i * 0.002, h + 0.002 + i * 0.002, z - 0.148, z + 0.148, '#f2efe6', 1, null, MATTE); }
        // the lamp: a weighted base, a jointed arm, a cone
        const [bu, bv] = P(hw - 0.15, 0, -hd + 0.12);
        K.lathe(bu, bv, [[0, h], [0.07, h], [0.07, h + 0.02], [0.02, h + 0.03], [0, h + 0.03]], '#2a2a2e', 0.9, 14, METAL);
        const j1 = P(hw - 0.15, h + 0.32, -hd + 0.18), j2 = P(hw - 0.3, h + 0.42, -hd + 0.3);
        rod(P(hw - 0.15, h + 0.03, -hd + 0.12), j1, 0.008, '#2a2a2e', 0.9); rod(j1, j2, 0.008, '#2a2a2e', 0.9);
        K.lathe(j2[0], j2[1], [[0.07, j2[2] - 0.12], [0.03, j2[2] - 0.02], [0, j2[2]]], '#2a5a4a', 0.95, 14, GLOSS);
        K.lathe(j2[0], j2[1], [[0, j2[2] - 0.08], [0.022, j2[2] - 0.08], [0, j2[2] - 0.05]], '#fff4d8', 1.8, 10);
      }
      break;
    }
    case 'rail': {
      for (const x of [-hw + 0.03, 0, hw - 0.03]) rod(P(x, 0, 0), P(x, h, 0), 0.022, '#7a7e84', 0.95);
      for (const y of [h, h * 0.5]) rod(P(-hw, y, 0), P(hw, y, 0), 0.022, '#7a7e84', 0.95);
      for (const x of [-hw + 0.03, hw - 0.03]) lat(x, 0, [[0, 0], [0.05, 0], [0.05, 0.01], [0, 0.012]], '#5a5e64', 0.9, 10, METAL);
      break;
    }
    case 'heater': case 'box': {
      // a heater: a box on feet, a grille across its front, the element glowing behind it, a handle
      // on top and a battery lamp
      const heater = p.form === 'heater', body = heater ? pick(r, ['#d8d4c8', '#3a3c40', '#c8a050']) : '#8a7a5a';
      R(...alongY(), 0.03, h, -hw, hw, -hd, hd, 0.03, body, 0.95, heater ? GLOSS : SATIN);
      for (const x of [-hw + 0.04, hw - 0.04]) pbox(x - 0.03, x + 0.03, 0, 0.03, -hd - 0.02, hd + 0.02, '#1a1a1a', 0.9);
      if (heater) {
        pbox(-hw + 0.04, hw - 0.04, 0.08, h - 0.12, hd - 0.006, hd + 0.001, '#ff7a2a', 1.7);
        for (let i = 0; i < 7; i++) { const y = 0.08 + (i + 0.5) * (h - 0.2) / 7; pbox(-hw + 0.035, hw - 0.035, y - 0.006, y + 0.006, hd, hd + 0.012, '#2a2a2a', 0.9, null, METAL); }
        R(...alongX(), -0.07, 0.07, -0.02, 0.02, h, h + 0.04, 0.012, '#2a2a2a', 0.9, SATIN);
        pbox(hw - 0.05, hw - 0.03, h - 0.08, h - 0.06, hd, hd + 0.006, '#5aff7a', 1.6);
      }
      break;
    }
    default: {
      // a cabinet: a tall steel box with a recessed face, a slot, a keypad and a handset hung off it
      pbox(-hw, hw, 0, h, -hd, hd, '#5a6068', 0.95, steel, METAL);
      pbox(-hw + 0.05, hw - 0.05, h * 0.3, h - 0.08, hd, hd + 0.006, '#3a3e44', 0.9, null, METAL);
      pbox(-0.06, 0.06, h - 0.25, h - 0.15, hd + 0.006, hd + 0.012, '#9ab0a0', 0.6, null, GLOSS);
      for (let i = 0; i < 12; i++) pbox(-0.05 + (i % 3) * 0.035, -0.025 + (i % 3) * 0.035, h * 0.45 + Math.floor(i / 3) * 0.04, h * 0.45 + 0.025 + Math.floor(i / 3) * 0.04, hd + 0.006, hd + 0.014, '#c8c4b8', 0.95, null, SATIN);
      rod(P(hw - 0.08, h * 0.75, hd + 0.03), P(hw - 0.06, h * 0.45, hd + 0.05), 0.02, '#1a1a1a', 0.9, SATIN);
      rod(P(hw - 0.06, h * 0.45, hd + 0.05), P(-0.02, h * 0.25, hd + 0.03), 0.004, '#1a1a1a', 0.9, SATIN, 4);
      if (wear > 0.3) stain(0, h * 0.6, hd + 0.013, 0.08);
    }
  }
}
// Where a set's picture goes: its corners in the host's frame, top left first as you face it, which is
// the piece's +x side, since x runs across it as it faces out.
function noteScreen(K, p, F, half, y0, y1, z, mid = 0) {
  const L = K.L, w = (x, y) => { const q = F.P(mid + x, y, z); return L.world(q[0], q[1], q[2] + (p.y0 || 0)); };
  const o = F.P(mid, y0, z), n = F.P(mid, y0, z + 1), a = L.world(o[0], o[1], o[2]), b = L.world(n[0], n[1], n[2]);
  K.screens.push({ id: p.id, first: K.screen.n, quad: [w(half, y1), w(-half, y1), w(-half, y0), w(half, y0)], n: [b[0] - a[0], b[1] - a[1], b[2] - a[2]] });
}

// the emissive code, as a call so a case can't shadow it
function E() { return EMISSIVE; }

// ── the materials ───────────────────────────────────────────────────────────────────────────────
// Each a tile that repeats, painted once per room renderer, seeded so it's the same flat every time.
export function paintRoomTexture(doc, key, seed = 1) {
  const N = key === ROOM_RUG ? 1024 : 512, c = doc.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d'), r = rng([...key].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619), 2166136261 ^ seed));
  const specks = (n, size, cols, a) => {
    for (let i = 0; i < n; i++) {
      g.globalAlpha = a * (0.4 + r() * 0.6); g.fillStyle = cols[(r() * cols.length) | 0];
      const x = r() * N, y = r() * N, w = size * (0.5 + r()), h = size * (0.5 + r());
      for (const [ox, oy] of [[0, 0], [-N, 0], [0, -N], [-N, -N]]) g.fillRect(x + ox, y + oy, w, h);
    }
    g.globalAlpha = 1;
  };
  const blot = (cx, cy, rad, col) => {
    for (const [ox, oy] of [[0, 0], [-N, 0], [0, -N], [-N, -N], [N, 0], [0, N], [N, N], [N, -N], [-N, N]]) {
      const grd = g.createRadialGradient(cx + ox, cy + oy, 0, cx + ox, cy + oy, rad);
      grd.addColorStop(0, col); grd.addColorStop(1, col.replace(/[\d.]+\)$/, '0)'));
      g.fillStyle = grd; g.fillRect(cx + ox - rad, cy + oy - rad, rad * 2, rad * 2);
    }
  };
  if (key === 'roomBoards') {
    // oak boards, four across the tile, each its own shade, with grain, knots, the joints between
    // them and the polish worn off down the middle of the room
    const n = 4, bw = N / n;
    for (let i = 0; i < n; i++) {
      const base = 0.85 + r() * 0.3, x0 = i * bw;
      g.fillStyle = `rgb(${Math.round(150 * base)},${Math.round(108 * base)},${Math.round(70 * base)})`; g.fillRect(x0, 0, bw, N);
      for (let k = 0; k < 40; k++) {
        const x = x0 + r() * bw, amp = 1 + r() * 4, ph = r() * 6.28;
        g.strokeStyle = r() < 0.6 ? `rgba(70,42,20,${0.15 + r() * 0.25})` : `rgba(200,160,110,${0.1 + r() * 0.2})`;
        g.lineWidth = 0.5 + r() * 1.8; g.beginPath();
        for (let y = 0; y <= N; y += 8) { const xx = x + Math.sin(y / N * Math.PI * 2 * (1 + (k % 3)) + ph) * amp; if (y) g.lineTo(xx, y); else g.moveTo(xx, y); }
        g.stroke();
      }
      if (r() < 0.6) { const kx = x0 + bw * (0.2 + r() * 0.6), ky = r() * N; g.fillStyle = 'rgba(60,34,16,0.6)'; g.beginPath(); g.ellipse(kx, ky, 5 + r() * 4, 9 + r() * 6, 0, 0, Math.PI * 2); g.fill(); }
      // the board's end joint somewhere along it
      const jy = r() * N; g.fillStyle = 'rgba(40,24,12,0.7)'; g.fillRect(x0, jy, bw, 2);
      g.fillStyle = 'rgba(30,18,8,0.8)'; g.fillRect(x0, 0, 2, N);
    }
    specks(5000, 2, ['rgba(40,24,10,1)', 'rgba(220,190,150,1)'], 0.12);
    for (let i = 0; i < 6; i++) blot(r() * N, r() * N, 60 + r() * 120, `rgba(${r() < 0.5 ? '40,26,14' : '190,160,120'},0.12)`);
  } else if (key === 'roomOak') {
    // engineered oak: wide pale boards, long and quiet, joints you can barely see
    const n = 3, bw = N / n;
    for (let i = 0; i < n; i++) {
      const base = 0.94 + r() * 0.12, x0 = i * bw;
      g.fillStyle = `rgb(${Math.round(186 * base)},${Math.round(150 * base)},${Math.round(108 * base)})`; g.fillRect(x0, 0, bw, N);
      for (let k = 0; k < 60; k++) {
        const x = x0 + r() * bw, amp = 1 + r() * 7, ph = r() * 6.28;
        g.strokeStyle = r() < 0.55 ? `rgba(120,86,50,${0.05 + r() * 0.14})` : `rgba(226,198,158,${0.05 + r() * 0.12})`;
        g.lineWidth = 0.5 + r() * 2.2; g.beginPath();
        for (let y = 0; y <= N; y += 8) { const xx = x + Math.sin(y / N * Math.PI * 2 * (1 + (k % 2)) + ph) * amp; if (y) g.lineTo(xx, y); else g.moveTo(xx, y); }
        g.stroke();
      }
      g.fillStyle = 'rgba(70,46,26,0.4)'; g.fillRect(x0, 0, 1.5, N);
      g.fillRect(x0, r() * N, bw, 1.5);
    }
    specks(3000, 2, ['rgba(90,62,36,1)', 'rgba(230,206,170,1)'], 0.06);
  } else if (key === 'roomFacade') {
    // the building's face from outside: a storey of dark glass, a slab edge, two bays
    g.fillStyle = '#39414a'; g.fillRect(0, 0, N, N);
    const grd = g.createLinearGradient(0, 0, N, N); grd.addColorStop(0, 'rgba(150,180,205,0.28)'); grd.addColorStop(1, 'rgba(20,28,38,0.3)');
    g.fillStyle = grd; g.fillRect(0, 0, N, N);
    g.fillStyle = '#b4b2ac'; g.fillRect(0, N * 0.9, N, N * 0.1);
    g.fillStyle = '#17181b'; g.fillRect(0, 0, 8, N); g.fillRect(N / 2 - 4, 0, 8, N);
  } else if (key === 'roomWool') {
    // a deep plain wool: nothing but the pile
    g.fillStyle = '#d0d0d0'; g.fillRect(0, 0, N, N);
    specks(40000, 2, ['#bcbcbc', '#e4e4e4', '#c8c8c8'], 0.4);
  } else if (key === 'roomPlasterFine') {
    // fine plaster: nearly flat, the faintest trowel, and nothing has ever been hung on it
    g.fillStyle = '#f2efe9'; g.fillRect(0, 0, N, N);
    specks(12000, 2, ['#ebe7df', '#f8f6f1'], 0.3);
    for (let i = 0; i < 10; i++) blot(r() * N, r() * N, 80 + r() * 120, 'rgba(226,220,208,0.16)');
  } else if (key === 'roomStone') {
    // honed grey stone: a fine even grain, slow clouds, the odd pale vein
    g.fillStyle = '#b4b6b8'; g.fillRect(0, 0, N, N);
    specks(46000, 2, ['#a4a6a8', '#c2c4c6', '#9a9c9e'], 0.4);
    for (let i = 0; i < 14; i++) blot(r() * N, r() * N, 60 + r() * 130, `rgba(${r() < 0.5 ? '130,132,136' : '212,214,216'},0.18)`);
    for (let i = 0; i < 3; i++) {
      let x = r() * N, y = r() * N; g.strokeStyle = 'rgba(226,228,230,0.34)'; g.lineWidth = 0.8 + r() * 1.2; g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 40; k++) { x += (r() - 0.3) * 24; y += (r() - 0.5) * 24; g.lineTo(x, y); }
      g.stroke();
    }
  } else if (key === 'roomPlaster' || key === 'roomCeiling') {
    // painted plaster: near white, a faint roller texture, and on the walls the marks of a flat that
    // has been lived in: a water stain and a scuff
    g.fillStyle = '#f0ece4'; g.fillRect(0, 0, N, N);
    specks(30000, 2, ['#e4dfd4', '#f8f5ee', '#dcd6ca'], 0.5);
    for (let i = 0; i < 18; i++) blot(r() * N, r() * N, 40 + r() * 90, `rgba(${r() < 0.5 ? '200,192,176' : '255,252,246'},0.25)`);
    if (key === 'roomPlaster') {
      blot(r() * N, r() * N * 0.4, 70, 'rgba(160,130,80,0.22)');
      blot(r() * N, r() * N, 30, 'rgba(120,110,100,0.18)');
    }
  } else if (key === 'roomWeave' || key === 'roomCanvas' || key === 'roomTicking') {
    // a woven cloth in grey, to be tinted: warp and weft, slubs, and pilling; ticking has its stripe
    const tick = key === 'roomTicking', coarse = key === 'roomCanvas';
    g.fillStyle = '#c8c8c8'; g.fillRect(0, 0, N, N);
    const step = coarse ? 6 : 4;
    for (let i = 0; i < N; i += step) {
      g.fillStyle = `rgba(255,255,255,${0.08 + r() * 0.1})`; g.fillRect(i, 0, step / 2, N);
      g.fillStyle = `rgba(0,0,0,${0.06 + r() * 0.08})`; g.fillRect(0, i, N, step / 2);
    }
    specks(coarse ? 3000 : 8000, coarse ? 4 : 2, ['#a8a8a8', '#e8e8e8'], 0.35);
    if (tick) { g.fillStyle = 'rgba(60,80,120,0.55)'; for (let x = 0; x < N; x += 64) { g.fillRect(x + 6, 0, 10, N); g.fillRect(x + 22, 0, 3, N); } }
    for (let i = 0; i < 6; i++) blot(r() * N, r() * N, 50 + r() * 80, 'rgba(90,90,90,0.12)');
  } else if (key === 'roomSteel') {
    // brushed steel: long horizontal strokes and a soft sheen
    g.fillStyle = '#c6cacf'; g.fillRect(0, 0, N, N);
    for (let i = 0; i < 1600; i++) { g.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '90,96,104'},${0.04 + r() * 0.08})`; g.fillRect(0, r() * N, N, 1); }
    for (let i = 0; i < 5; i++) blot(r() * N, r() * N, 60 + r() * 80, 'rgba(120,110,90,0.08)');
  } else if (key === 'roomWood') {
    g.fillStyle = '#a8845e'; g.fillRect(0, 0, N, N);
    for (let i = 0; i < 120; i++) {
      const y0 = r() * N, amp = 2 + r() * 6, ph = r() * 6.28;
      g.strokeStyle = r() < 0.6 ? `rgba(70,44,22,${0.2 + r() * 0.3})` : `rgba(210,170,120,${0.12 + r() * 0.2})`;
      g.lineWidth = 0.6 + r() * 2;
      for (const oy of [-N, 0, N]) { g.beginPath(); for (let x = 0; x <= N; x += 8) { const y = oy + y0 + Math.sin(x / N * Math.PI * 4 + ph) * amp; if (x) g.lineTo(x, y); else g.moveTo(x, y); } g.stroke(); }
    }
  } else if (key === 'roomConcrete') {
    g.fillStyle = '#b4b0a8'; g.fillRect(0, 0, N, N);
    specks(40000, 2, ['#9a968e', '#c8c4bc', '#8a867e'], 0.45);
    specks(600, 6, ['#7a766e', '#d8d4cc'], 0.3);
    for (let i = 0; i < 10; i++) blot(r() * N, r() * N, 50 + r() * 100, `rgba(${r() < 0.5 ? '120,116,108' : '210,206,198'},0.2)`);
  } else if (key === 'roomTile') {
    // square glazed tiles, four a tile, white grout, each tile a little off its neighbour
    g.fillStyle = '#d8d4cc'; g.fillRect(0, 0, N, N);
    const n = 4, s = N / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const k = 0.94 + r() * 0.08; g.fillStyle = `rgb(${Math.round(240 * k)},${Math.round(238 * k)},${Math.round(232 * k)})`;
      g.fillRect(i * s + 3, j * s + 3, s - 6, s - 6);
      const grd = g.createLinearGradient(i * s, j * s, i * s + s, j * s + s); grd.addColorStop(0, 'rgba(255,255,255,0.25)'); grd.addColorStop(1, 'rgba(0,0,0,0.05)');
      g.fillStyle = grd; g.fillRect(i * s + 3, j * s + 3, s - 6, s - 6);
    }
  } else {
    // a rug: a worn kilim of bands and stepped diamonds, its ends fringed
    const pal = [['#6a2a24', '#c8a050', '#2a3a4a', '#e8dcc0'], ['#2a4a4a', '#c86a3a', '#e8d8b0', '#3a2a24'], ['#4a3a5a', '#d8b060', '#8a2a2a', '#e0d4bc']][seed % 3];
    g.fillStyle = pal[3]; g.fillRect(0, 0, N, N);
    const fr = 30;
    for (let y = fr; y < N - fr; y += 64) {
      const band = Math.floor(y / 64) % 3;
      g.fillStyle = pal[band]; g.fillRect(fr, y, N - 2 * fr, 64);
      g.fillStyle = pal[(band + 1) % 3];
      for (let x = fr + 32; x < N - fr; x += 64) { g.beginPath(); g.moveTo(x, y + 6); g.lineTo(x + 26, y + 32); g.lineTo(x, y + 58); g.lineTo(x - 26, y + 32); g.fill(); }
      g.fillStyle = pal[3]; for (let x = fr + 32; x < N - fr; x += 64) g.fillRect(x - 5, y + 27, 10, 10);
    }
    g.strokeStyle = '#efe6d2'; g.lineWidth = 2;
    for (let x = 4; x < N; x += 7) for (const [y0, y1] of [[0, fr], [N - fr, N]]) { g.beginPath(); g.moveTo(x, y0); g.lineTo(x + (r() - 0.5) * 4, y1); g.stroke(); }
    g.globalAlpha = 0.16;
    for (let i = 0; i < 60000; i++) { g.fillStyle = r() < 0.5 ? '#000' : '#fff'; g.fillRect(fr + r() * (N - 2 * fr), fr + r() * (N - 2 * fr), 1, 1); }
    g.globalAlpha = 1;
    blot(N / 2, N / 2, N * 0.3, 'rgba(255,240,210,0.15)');
  }
  return c;
}

// ── the view and the screen ─────────────────────────────────────────────────────────────────────
// A street out of the window at a fractional hour, for a room with no place in the world and for the
// moments before GLASS has drawn the real one (panels/room-outlook.js): the sky, the sun or the moon,
// towers in three rows fading into the haze, their windows lit as the evening comes on.
export function paintView(doc, hour, seed = 1) {
  const W = 1024, Hh = 512, c = doc.createElement('canvas');
  c.width = W; c.height = Hh;
  const g = c.getContext('2d'), r = rng(seed * 7919 + 13);
  const day = Math.max(0, Math.min(1, (Math.sin((hour - 6) / 12 * Math.PI) + 0.15) / 0.75)), dusk = Math.exp(-(((hour - 19) / 1.2) ** 2)) + Math.exp(-(((hour - 6.3) / 1.0) ** 2));
  const mixc = (a, b, t) => a.map((x, i) => Math.round(x + (b[i] - x) * t));
  const top = mixc([10, 14, 32], [86, 140, 204], day), low = mixc(mixc([24, 30, 56], [196, 214, 226], day), [236, 140, 90], Math.min(1, dusk * 0.8));
  const sky = g.createLinearGradient(0, 0, 0, Hh * 0.75);
  sky.addColorStop(0, `rgb(${top})`); sky.addColorStop(1, `rgb(${low})`);
  g.fillStyle = sky; g.fillRect(0, 0, W, Hh);
  if (day > 0.15) { const sx = W * (0.15 + ((hour - 6) / 12) * 0.7), sy = Hh * (0.6 - Math.sin((hour - 6) / 12 * Math.PI) * 0.45); const s = g.createRadialGradient(sx, sy, 0, sx, sy, 90); s.addColorStop(0, 'rgba(255,248,220,0.95)'); s.addColorStop(0.15, 'rgba(255,236,190,0.5)'); s.addColorStop(1, 'rgba(255,230,180,0)'); g.fillStyle = s; g.fillRect(0, 0, W, Hh); }
  else { g.fillStyle = 'rgba(230,232,240,0.9)'; g.beginPath(); g.arc(W * 0.7, Hh * 0.18, 14, 0, Math.PI * 2); g.fill(); for (let i = 0; i < 140; i++) { g.fillStyle = `rgba(255,255,255,${0.3 + r() * 0.6})`; g.fillRect(r() * W, r() * Hh * 0.45, 1.5, 1.5); } }
  // the towers, far row to near: darker and sharper as they come nearer
  for (const [row, base, hmin, hmax, shade] of [[0, Hh * 0.62, 60, 200, 0.55], [1, Hh * 0.7, 90, 260, 0.75], [2, Hh * 0.82, 120, 330, 1]]) {
    let x = -20;
    while (x < W + 20) {
      const bw = 40 + r() * 90, bh = hmin + r() * (hmax - hmin), y0 = base - bh;
      const lit = mixc(mixc([16, 18, 26], [96, 104, 118], day), low, (1 - shade) * 0.6);
      g.fillStyle = `rgb(${lit.map((v) => Math.round(v * (0.7 + 0.3 * (1 - shade))))})`;
      g.fillRect(x, y0, bw, Hh - y0);
      if (r() < 0.3) g.fillRect(x + bw * 0.4, y0 - 20 - r() * 30, 3, 20 + r() * 30);
      // its windows: lit at night, glinting by day
      for (let wy = y0 + 8; wy < Hh; wy += 11) for (let wx = x + 5; wx < x + bw - 6; wx += 9) {
        const on = r() < (1 - day) * 0.45 * shade + 0.04;
        if (on) { g.fillStyle = r() < 0.8 ? `rgba(255,214,140,${0.6 + r() * 0.4})` : `rgba(160,220,255,${0.6 + r() * 0.4})`; g.fillRect(wx, wy, 5, 6); }
        else if (day > 0.4 && r() < 0.15) { g.fillStyle = `rgba(220,236,255,${0.15 + r() * 0.2})`; g.fillRect(wx, wy, 5, 6); }
      }
      x += bw + 4 + r() * 16;
    }
    // the haze between the rows
    const hz = g.createLinearGradient(0, base - 120, 0, base); hz.addColorStop(0, 'rgba(0,0,0,0)'); hz.addColorStop(1, `rgba(${low},${0.25 * (1 - row * 0.3)})`);
    g.fillStyle = hz; g.fillRect(0, base - 120, W, 120);
  }
  // the street's own glow coming up from below, at night
  const glow = g.createLinearGradient(0, Hh * 0.75, 0, Hh); glow.addColorStop(0, 'rgba(255,170,90,0)'); glow.addColorStop(1, `rgba(255,170,90,${0.35 * (1 - day)})`);
  g.fillStyle = glow; g.fillRect(0, Hh * 0.75, W, Hh * 0.25);
  return c;
}

// A set's picture: snow and a rolling bar when it's on, a dark curved glass with the room in it when
// it's off. `t` moves the snow.
export function paintScreen(canvas, on, t = 0, seed = 1) {
  const g = canvas.getContext('2d'), W = canvas.width, Hh = canvas.height;
  if (!on) {
    const grd = g.createLinearGradient(0, 0, W, Hh);
    grd.addColorStop(0, '#16181c'); grd.addColorStop(0.45, '#0b0c0e'); grd.addColorStop(0.55, '#121418'); grd.addColorStop(1, '#08090a');
    g.fillStyle = grd; g.fillRect(0, 0, W, Hh);
    return canvas;
  }
  const img = g.createImageData(W, Hh), d = img.data, r = rng(((t * 30) | 0) * 2654435761 + seed);
  const bar = ((t * 0.35) % 1) * Hh;
  for (let y = 0; y < Hh; y++) {
    const roll = Math.exp(-(((y - bar) / 18) ** 2)) * 60;
    for (let x = 0; x < W; x++) {
      const v = Math.min(255, r() * 200 + 20 + roll), i = (y * W + x) * 4;
      d[i] = v * 0.92; d[i + 1] = v * 0.96; d[i + 2] = v; d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return canvas;
}
