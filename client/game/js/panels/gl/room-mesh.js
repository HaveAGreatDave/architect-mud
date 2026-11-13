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

import { lightAt } from '../../../../shared/sky-keys.js';
import { roomKit } from './room-kit.js';
import { createBatch, MAT, STRIDE } from './ballpark-mesh.js';
import { cachetWing, cachetInner } from '../../../../shared/room-layout.js';
import { facing, COUNTER_H, doorwaysOf, liftButtons, liftPanelAt, hallOf } from '../../../../shared/room-layout.js';
import { drawDecor, drawDecorForm, liftPortal, drawBalconyDress } from './room-decor.js';
import { legend, legendWidth } from '../../../../shared/legend-font.js';
import { drawFitting, baseRun, STONE, FITTED_FORMS } from './room-fittings.js';
import { paintDesktop } from './room-screens.js';
import { paintBoothTexture } from './booth-mesh.js';
import { drawEnvPanel } from './room-envctl.js';
import { CAT_GRAIN, paintCatGrain } from './cat-statue.js';
export { FITTED_FORMS };

// How many metres one repeat of each painted material covers (paintRoomTexture). A rug is mapped
// once across itself, so it has no repeat.
export const ROOM_TEXTURES = Object.freeze({ roomBoards: 1.8, roomPlaster: 3.6, roomCeiling: 2.4, roomWeave: 0.45, roomSteel: 0.9,
  roomWood: 1.1, roomConcrete: 1.6, roomTile: 0.9, roomCanvas: 0.8, roomTicking: 0.6, roomOak: 1.15, roomPlasterFine: 3.0, roomStone: 2.0, roomMarble: 2.4, roomWool: 0.7, roomFacade: 3.4,
  roomLaminate: 0.9, roomButcher: 0.7, roomEpoxy: 0.8, roomSubway: 0.6, roomBrushed: 0.5, roomPowder: 0.7 });
export const ROOM_RUG = 'roomRug';

const { GLOSS, METAL, LEATHER, SATIN, CLOTH, MATTE, EMISSIVE } = MAT;
// carbon fibre: gl/room.js weaves it in the shader off the face's own metres
const CARBON = 46;
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
  // a flat's hall out to its corridor, past the back wall beside the en-suite (room-layout.js hallOf)
  const halls = L.spec ? doorwaysOf(L.spec).map((o) => hallOf(L.spec, o)).filter(Boolean) : [];
  const boxes = [...L.solid, ...L.climb.map((c) => c.slice(0, 4)), ...L.placed.filter((p) => !(p.arche === 'screen' && p.form !== 'crt')).map((p) => {
    const q = Math.round(((p.turn % 360) + 360) % 360 / 90) % 2, hw = (q ? p.d : p.w) / 2, hd = (q ? p.w : p.d) / 2;
    return [p.u - hw, p.u + hw, p.v - hd, p.v + hd];
  })];
  return ([u, v, y], [nu, ny, nv], col) => {
    // out on the balcony there's no corner of a room to darken
    if (v < -0.145 || (L.spec?.balcony?.wrap && (Math.abs(u) > hu + 0.145 || v > L.spec.balcony.wrap + 0.005))) return col;
    let ao = 1;
    // which room this face is in: the en-suite is its own box, and so is a hall
    const hall = v > D + 0.02 ? halls.find((h) => u > h.a - 0.2 && u < h.b + 0.2) : null;
    const [uL, uR, vF, vB] = hall ? [hall.a, hall.b, D, hall.v1] : A && v > D + 0.02 ? [A.u0, A.u1, A.v0, A.v0 + ad] : [-hu, hu, 0, D];
    const dw = Math.min(u - uL, uR - u, v - vF, vB - v);
    if (ny > 0.9 && y < 0.03) {
      ao *= 0.66 + 0.34 * sstep(0, 0.55, dw);
      // down in a pit, dark along the foot of the riser you're below
      const q = L.spec?.pit;
      if (q?.round && y < -0.01) { const e = y < -q.depth * 0.75 ? q.step : 0; ao *= 0.6 + 0.4 * sstep(0, 0.5, q.r - e - Math.hypot(u - q.cu, v - q.cv)); }
      else if (q && y < -0.01) { const e = y < -q.depth * 0.75 ? q.step : 0; ao *= 0.6 + 0.4 * sstep(0, 0.5, Math.min(u - q.u0 - e, q.u1 - e - u, v - q.v0 - e, q.v1 - e - v)); }
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
// THE ROOM'S KITCHEN GEAR, for the Kitchen Stage when you cook in a room (kitchen-stage.js). It replays
// the same seeded picks buildRoom and drawPiece make, so the hob, fridge, units and wall it reports are
// the ones you were standing at. ⚠ Keep the pick order in step with buildRoom (wall), drawKitchen
// (front) and drawPiece (fabric, wood, enamel, plastic, then a counter's laminate).
export function roomKitchenKit(L, seed = 1) {
  const fine = L.spec.finish === 'fine';
  const look = (p) => { const r = rng(p.seed || 7); pick(r, fine ? FABRIC_FINE : FABRIC); const wood = pick(r, fine ? WOOD_FINE : WOOD), enamel = pick(r, fine ? ENAMEL_FINE : ENAMEL); pick(r, PLASTIC); return { wood, enamel, lam: pick(r, ['#d8d0c0', '#4a5a5a', '#8a6a4a', '#e8e4dc']) }; };
  const kit = { fine, wall: fine ? '#e4e0d8' : pick(rng(seed), WALLS), top: fine ? '#8a8c8e' : '#b8b4ac', front: null, hob: null, cold: null, sink: null, microwave: false };
  if (L.spec.plan) kit.front = fine ? '#3b3d41' : pick(rng(seed ^ 0x5bd1), ['#d8d0c0', '#4a5a5a', '#8a6a4a', '#e8e4dc']);
  for (const p of L.placed) {
    if (p.annex) continue;
    const lk = look(p);
    if (p.arche === 'hob' && p.form === 'microwave') kit.microwave = kit.microwave || { colour: lk.enamel };
    else if (p.arche === 'hob' && !kit.hob) kit.hob = { form: p.form, colour: p.form === 'range' ? lk.enamel : '#ffffff', wood: lk.wood };
    else if (p.arche === 'cold' && !kit.cold) kit.cold = { form: p.form, colour: p.form === 'double' ? '#c8ccd0' : lk.enamel };
    else if (p.arche === 'sink' && !kit.sink) kit.sink = { form: p.form };
    else if (p.arche === 'surface' && p.form === 'counter' && !kit.front) kit.front = lk.lam;
  }
  if (!kit.front) kit.front = kit.hob?.wood || '#8a6a4a';
  return kit;
}

// The rooms one doorway away (docs/proposals/building-stage.md, step 4), built as shells with their
// furniture and added to the room's own batches each time it's built: their walls, floors, glass,
// pieces and screens, never their view box (the room's own is round them all) or their lamps
// (gl/room-light.js has room for six).
export function withShells(m, shells) {
  const add = (dst, src) => {
    if (!src?.n) return;
    // a new list, never a push: meshCopy shares the kept mesh's
    if (src.kit?.length) dst.kit = [...(dst.kit || []), ...src.kit.map(([a, c]) => [a + dst.n, c])];
    const need = (dst.n + src.n) * STRIDE;
    if (need > dst.data.length) { const d = new Float32Array(need); d.set(dst.data.subarray(0, dst.n * STRIDE)); dst.data = d; }
    dst.data.set(src.data.subarray(0, src.n * STRIDE), dst.n * STRIDE);
    dst.n += src.n;
  };
  for (const s of shells || []) {
    // a set's screen next door goes after the room's own, so the room's sets keep their stretch of the batch
    add(m.solid, s.solid); add(m.glass, s.glass); add(m.screen, s.screen);
    for (const [key, b] of s.textured) { if (!m.textured.has(key)) m.textured.set(key, createBatch(b.n)); add(m.textured.get(key), b); }
  }
  return m;
}

// opts.joined: the zones past this room's doorways that are drawn too, so a doorway into one is a
// threshold rather than a dim passage.
export function buildRoom(L, { seed = 1, lampOn = true, doorShut = false, turning = null, swinging = null, joined = new Set(), shell = false } = {}) {
  const K = roomKit(L, bakeAO(L), { textures: ROOM_TEXTURES, cell: 0.4, glow: GLOW });
  const { solid, quad, box, lathe, ball, onU, onV, C, nrmOf, TB, E } = K;
  K.fine = L.spec.finish === 'fine'; K.L = L; K.screens = []; K.dials = [];
  const view = createBatch(64);
  const hu = L.w / 2, D = L.d, H = L.h, T = 0.14, spec = L.spec, fine = K.fine;
  // a club (spec.club) is painted black-red, ceiling and all, and lit by its rig (clubRig)
  const club = spec.club === 'vip' ? 'vip' : !!spec.club, R = rng(seed), wall0 = fine ? '#e4e0d8' : pick(R, WALLS), trim0 = fine ? '#efece6' : pick(R, ['#ece8de', '#e2dccd', '#d2cab8']);
  // `spec.tone` paints a room its own way (Solenne's lobby: dark walls, gold): its walls, trim and ceiling,
  // and `accent`, a metal that runs round it as a band and lines its doorways
  const tone = spec.tone || {}, accent = tone.accent || null;
  const wallC = tone.wall || (club ? '#3a2830' : wall0), trim = tone.trim || (club ? '#141216' : trim0);
  const win = spec.window || [-0.8, 0.8, 0.9, 2.2], door = spec.door || [hu - 1.3, hu - 0.4], DH = fine ? Math.min(2.4, H - 0.3) : 2.05;
  const plaster = { t: fine ? 'roomPlasterFine' : 'roomPlaster', c: wallC };
  // a copy: a door's glass transom is added to it below, and the spec is built from again and again
  const panes = spec.windowless ? [] : spec.windows?.length ? [...spec.windows] : [{ wall: 'front', a: win[0], b: win[1], y0: win[2], y1: win[3], kind: 'sash' }];
  const annex = spec.annex || null;

  // the floor: boards, run from the window to the door, or stone; cut round a pit when there's one
  {
    const pit = spec.pit, key = spec.ground === 'marble' ? 'roomMarble' : spec.ground === 'tile' ? 'roomTile' : spec.ground === 'concrete' ? 'roomConcrete' : spec.ground === 'stone' || spec.ground === 'rubber' ? 'roomStone' : fine ? 'roomOak' : 'roomBoards', t = ROOM_TEXTURES[key];
    const tint = spec.ground === 'stone' ? PALE_STONE : spec.ground === 'rubber' ? '#33363a' : spec.ground === 'concrete' ? '#8a8c8a' : spec.ground === 'tile' ? '#eef0ee' : '#ffffff', marble = spec.ground === 'marble';
    const lay = K.lay = (u0, u1, v0, v1, y = 0) => { const ps = [[u0, v0, y], [u1, v0, y], [u1, v1, y], [u0, v1, y]]; quad(TB(key), ps, [0, 1, 0], C(tint, spec.ground === 'stone' ? 1.15 : marble ? 1.05 : 0.95), marble ? GLOSS : fine ? SATIN : E, ps.map((q) => [q[1] / t, q[0] / t])); };
    // the slab under the boards stops short of them, or the two fight over the same pixels
    if (pit?.round) {
      // the boards outside the pit's square, then between the square and the circle in wedges, cut
      // so the square's corners fall on wedge edges
      lay(-hu, hu, 0, pit.v0); lay(-hu, hu, pit.v1, D); lay(-hu, pit.u0, pit.v0, pit.v1); lay(pit.u1, hu, pit.v0, pit.v1);
      const N = 64, sq = (a) => pit.r / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)));
      for (let i = 0; i < N; i++) {
        const a0 = i / N * Math.PI * 2, a1 = (i + 1) / N * Math.PI * 2, at = (a, r) => [pit.cu + Math.cos(a) * r, pit.cv + Math.sin(a) * r, 0];
        const ps = [at(a0, pit.r), at(a0, sq(a0)), at(a1, sq(a1)), at(a1, pit.r)];
        quad(TB(key), ps, [0, 1, 0], C(tint, 0.95), fine ? SATIN : E, ps.map((q) => [q[1] / t, q[0] / t]));
      }
      box(-hu - T, hu + T, -T, D + T, -pit.depth - 0.2, -pit.depth - 0.02, '#2a2622');
      // the rail round the rim stops either side of anything raised that runs out over it (a runway)
      const over = L.placed.filter((p) => p.form === 'runway' || p.form === 'stage').map((p) => {
        const q = Math.round(((p.turn % 360) + 360) % 360 / 90) % 2, hw = (q ? p.d : p.w) / 2, hd = (q ? p.w : p.d) / 2;
        return [p.u - hw - 0.15, p.u + hw + 0.15, p.v - hd - 0.15, p.v + hd + 0.15];
      });
      drawRoundPit(K, pit, { key, tint, surf: fine ? SATIN : E, over });
    } else if (!pit) { lay(-hu, hu, 0, D); box(-hu - T, hu + T, -T, D + T, -0.2, -0.01, '#2a2622'); } else {
      const g = 0.06;
      lay(-hu, hu, 0, pit.v0); lay(-hu, hu, pit.v1, D); lay(-hu, pit.u0, pit.v0, pit.v1); lay(pit.u1, hu, pit.v0, pit.v1);
      box(-hu - T, hu + T, -T, pit.v0 - g, -0.2, -0.01, '#2a2622'); box(-hu - T, hu + T, pit.v1 + g, D + T, -0.2, -0.01, '#2a2622');
      box(-hu - T, pit.u0 - g, pit.v0 - g, pit.v1 + g, -0.2, -0.01, '#2a2622'); box(pit.u1 + g, hu + T, pit.v0 - g, pit.v1 + g, -0.2, -0.01, '#2a2622');
      drawPit(K, pit, { key, tint, surf: fine ? SATIN : E });
    }
  }
  // the ceiling, and a slab over it. A roof deck (spec.open) has neither: over it is the sky the glass shows
  if (!spec.open) {
    const key = fine ? 'roomPlasterFine' : 'roomCeiling', ps = [[-hu, D, H], [hu, D, H], [hu, 0, H], [-hu, 0, H]], t = ROOM_TEXTURES[key];
    quad(TB(key), ps, [0, -1, 0], C(tone.ceiling || (club ? '#1c181e' : '#f2efe8'), 1), E, ps.map((q) => [q[0] / t, q[1] / t]));
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
  // a building's open doorways (docs/proposals/building-stage.md); one over the flat's own door takes its place
  const doorways = doorwaysOf(spec);
  // a lift car has no flat's door: its ways out are its doorways, open or with the doors drawn shut.
  // ⚠ NOR DOES A ROOM ON A BUILDING'S WALK: its ways in are its doorways. The plain door every room was given
  // stood beside the lift in the Solenne's lobby and on its landings, a door to nowhere.
  const overDoor = !!(spec.car || spec.lift) || Array.isArray(spec.openings) || doorways.some((o) => o.wall === 'back' && o.a < door[1] && o.b > door[0]);
  const holes = { front: [], back: overDoor ? [] : [{ a: door[0], b: door[1], y0: 0, y1: DH }], left: [], right: [] };
  if (annex) holes.back.push({ a: annex.door[0], b: annex.door[1], y0: 0, y1: DH });
  const glassTop = panes.find((q) => q.kind === 'curtain' && q.wall === 'front')?.y1;
  if (spec.balcony) holes.front.push({ a: spec.balcony.door[0], b: spec.balcony.door[1], y0: 0, y1: glassTop || DH });
  for (const q of panes) holes[q.wall].push(q);
  // a Cachet in a false wall going round opens the room's wall behind its opening onto the recess it works from
  const tpw = turning && L.placed.find((p) => p.id === turning.id && cachetWing(p) > 0);
  if (tpw) {
    const [fu, fv] = facing(tpw.turn), hd = tpw.d / 2, bu = tpw.u - fu * hd, bv = tpw.v - fv * hd, ow = cachetInner(tpw).w / 2;
    const top = Math.min(H - 0.12, tpw.h) + (tpw.y0 || 0), y0 = tpw.y0 || 0;
    const near = [['front', Math.abs(bv)], ['back', Math.abs(bv - D)], ['left', Math.abs(bu + hu)], ['right', Math.abs(bu - hu)]].sort((m, n) => m[1] - n[1])[0];
    if (near[1] < 0.4) { const c = near[0] === 'front' || near[0] === 'back' ? tpw.u : tpw.v; holes[near[0]].push({ a: c - ow, b: c + ow, y0, y1: top }); }
  }
  const cut = doorways;
  // a pair of automatic glass doors in a glass wall (building-graph.js street_door): the opening runs up to the
  // glass's head, an operator box over the doors and a glass transom over that, so the wall stays glass
  const glassHead = (wall) => panes.filter((q) => q.kind === 'curtain' && q.wall === wall).reduce((m, q) => Math.max(m, q.y1), 0);
  const SLIDE_BOX = 0.24;
  // a flat's front door on a corridor is at the end of a hall beside its en-suite: the back wall opens on the hall
  const HALL_H = Math.min(H, DH + 0.22);
  for (const o of cut) {
    const hall = hallOf(spec, o);
    if (hall) { holes.back.push({ a: hall.a, b: hall.b, y0: 0, y1: HALL_H }); continue; }
    holes[o.wall].push({ a: o.a, b: o.b, y0: 0, y1: o.slide && glassHead(o.wall) > DH + SLIDE_BOX + 0.3 ? glassHead(o.wall) : DH });
  }
  for (const o of cut) if (o.slide && glassHead(o.wall) > DH + SLIDE_BOX + 0.3) panes.push({ wall: o.wall, a: o.a, b: o.b, y0: DH + SLIDE_BOX, y1: glassHead(o.wall), kind: 'curtain' });
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
  // the accent: a gold skirting cap, a thin band at the door heads and a shadow line and band at the
  // ceiling, round every solid run. Each stands 1 cm or more proud of the wall, so none fights it
  // (a room clad in stone or walnut has its own trim, and these would be inside the cladding)
  if (accent && !spec.decor?.walls) for (const [wall, runs] of Object.entries(solidRuns)) for (const [a, b] of runs) {
    const band = (y0, y1, p) => { const [u0, u1, v0, v1] = wall === 'front' ? [a, b, 0, p] : wall === 'back' ? [a, b, D - p, D] : wall === 'left' ? [-hu, -hu + p, Math.max(a, 0), Math.min(b, D)] : [hu - p, hu, Math.max(a, 0), Math.min(b, D)]; box(u0, u1, v0, v1, y0, y1, accent, 1.05, null, METAL); };
    band(0.09, 0.105, 0.022);
    band(DH + 0.04, DH + 0.065, 0.012);
    band(H - 0.16, H - 0.12, 0.014);
  }
  if (club === true) drawPosters(K, L, solidRuns, { hu, D, H, seed });

  const windows = panes.map((q) => drawPane(K, q, { hu, D, H, trim, fine }));
  // the world: a box well clear of the flat, seen wherever the walls don't stop you seeing it
  {
    const R0 = 55, c = D / 2, a = [-R0, c - R0, -R0], b = [R0, c + R0, R0];
    const corner = (i) => [i & 1 ? b[0] : a[0], i & 2 ? b[1] : a[1], i & 4 ? b[2] : a[2]];
    for (const f of [[0, 1, 3, 2], [4, 5, 7, 6], [0, 1, 5, 4], [2, 3, 7, 6], [0, 2, 6, 4], [1, 3, 7, 5]]) K.quad(view, f.map(corner), [0, 1, 0], [1, 1, 1], EMISSIVE, null, true);
  }
  if (spec.balcony) drawBalcony(K, { hu, H, T, DH, fine, trim, top: glassTop || DH });

  // A DOORWAY TO THE NEXT ROOM. Where that room is drawn (`joined`), a threshold across this room's
  // wall, and the room beyond lays the other half across its own. Where it isn't, the doorway is lined
  // through the wall with a short dim passage past it, so the hole doesn't open on the street the
  // window shows.
  for (const o of cut) {
    const P = 0.8, dark = '#1b1b1e', hall = hallOf(spec, o);
    // the hall to a flat's front door: its floor, ceiling, walls and a light, and the doorway in its far wall
    if (hall) drawHall(K, { hall, o, D, T, DH, H: HALL_H, fine, trim, accent, wallC, plaster, lampOn, joined: joined.has(o.to) });
    // [u0, u1, v0, v1] of a slab from depth p0 to p1 past the wall's inner face, across [a, b]; a hall's doorway is
    // in its far wall
    const DB = hall ? hall.v1 : D;
    const span = (a, b, p0, p1) => o.wall === 'front' ? [a, b, -p1, -p0] : o.wall === 'back' ? [a, b, DB + p0, DB + p1] : o.wall === 'left' ? [-hu - p1, -hu - p0, a, b] : [hu + p0, hu + p1, a, b];
    if (joined.has(o.to)) { box(...span(o.a, o.b, 0, T), -0.02, 0, '#3a3634', 1); continue; }
    // automatic doors: a dark sill, aluminium jambs, and the operator box across the head, as wide as the leaves
    // slide; the leaves themselves are drawn apart (slideLeaves) so they can open as you come up to them
    // hinged hotel doors (street_door kind 'swing'): a bronze threshold, fluted bronze jambs, a lintel and over it a
    // fanlight of glass in bronze glazing bars; the leaves are drawn apart (slideLeaves) and swing in as you come up
    if (o.kind === 'front' && o.swing) {
      const BZ = '#8a6a44', w = o.b - o.a, FAN = 0.55;
      box(...span(o.a - 0.04, o.b + 0.04, -0.02, T), -0.02, 0.012, '#5a4630', 1.05, null, METAL);
      for (const [a, b] of [[o.a - 0.14, o.a], [o.b, o.b + 0.14]]) {
        box(...span(a, b, -0.04, T), 0, DH + FAN + 0.12, BZ, 1.02, null, METAL);
        for (let i = 1; i < 4; i++) { const x = a + (b - a) * i / 4; box(...span(x - 0.006, x + 0.006, -0.05, -0.04), 0.12, DH + FAN, '#c9a24a', 1.1, null, METAL); }
      }
      box(...span(o.a - 0.14, o.b + 0.14, -0.05, T), DH, DH + 0.1, BZ, 1.05, null, METAL);
      box(...span(o.a - 0.14, o.b + 0.14, -0.06, T), DH + FAN + 0.1, DH + FAN + 0.2, BZ, 1.05, null, METAL);
      // the fanlight's bars, fanned from the middle of the lintel
      const n = 7;
      for (let i = 0; i <= n; i++) { const x = o.a + w * i / n; box(...span(x - 0.012, x + 0.012, -0.03, 0), DH + 0.1, DH + FAN + 0.1, '#c9a24a', 1.1, null, METAL); }
      box(...span(o.a, o.b, -0.03, 0), DH + FAN * 0.55, DH + FAN * 0.55 + 0.02, '#c9a24a', 1.1, null, METAL);
      continue;
    }
    if (o.kind === 'front' && o.slide) {
      const w = o.b - o.a, AL = '#9aa0a6';
      box(...span(o.a, o.b, 0, T), -0.02, 0.004, '#202224', 1, null, METAL);
      for (const [a, b] of [[o.a - 0.06, o.a], [o.b, o.b + 0.06]]) box(...span(a, b, -0.02, T), 0, DH + SLIDE_BOX, AL, 1.05, null, METAL);
      box(...span(o.a - w / 2 - 0.08, o.b + w / 2 + 0.08, -0.16, -0.02), DH, DH + SLIDE_BOX, AL, 1.05, null, METAL);
      box(...span(o.a - w / 2 - 0.08, o.b + w / 2 + 0.08, -0.164, -0.158), DH + 0.03, DH + SLIDE_BOX - 0.03, '#2a2d31', 1, null, METAL);
      continue;
    }
    // the street door: a threshold, and past it the street the window shows
    if (o.kind === 'front') { box(...span(o.a, o.b, 0, T), -0.02, 0, '#3a3634', 1); for (const [a, b] of [[o.a - 0.05, o.a], [o.b, o.b + 0.05]]) box(...span(a, b, 0, T), 0, DH, '#2a2c30', 1, null, METAL); box(...span(o.a - 0.05, o.b + 0.05, 0, T), DH, DH + 0.06, '#2a2c30', 1, null, METAL); continue; }
    box(...span(o.a, o.b, 0, T + P), -0.02, 0, '#3a3634', 1);
    box(...span(o.a, o.b, 0, T + P), DH, DH + 0.02, dark, 1);
    box(...span(o.a, o.b, T + P, T + P + 0.02), 0, DH, dark, 1);
    for (const [a, b] of [[o.a - 0.02, o.a], [o.b, o.b + 0.02]]) box(...span(a, b, 0, T + P), 0, DH, accent || trim, accent ? 1.05 : 0.9, null, accent ? METAL : SATIN);
  }

  // THE DOOR in the back wall: a four-panel door shut in its frame, an architrave, a brass knob and a
  // finger plate; a light switch and a socket by it. A fine flat's is one flush oak leaf, floor to head
  if (!overDoor) {
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
    // THE LIGHT SWITCH: a plate with a rocker that shows how the lights stand and a dimmer's slot under
    // it. Its place goes on K.dials as `kind: 'switch'`, and a click on it opens the lights panel in
    // panels/room-stage.js, the way a fire's dial opens the fire's.
    const su = d0 - 0.22, sy = 1.2;
    box(su - 0.045, su + 0.045, D - 0.012, D, sy - 0.07, sy + 0.07, fine ? '#d8cfb8' : '#efece4', 1, null, SATIN);
    box(su - 0.02, su + 0.02, lampOn ? D - 0.026 : D - 0.018, D - 0.012, sy + 0.008, sy + 0.05, lampOn ? '#fbfaf5' : '#bdb9af', 1, null, GLOSS);
    box(su - 0.004, su + 0.004, D - 0.014, D - 0.012, sy - 0.055, sy - 0.012, '#2a2c30', 1, null, MATTE);
    if (!shell) K.dials.push({ id: 'lights', kind: 'switch', at: L.world(su, D - 0.02, sy), r: 0.07 });
    box(su - 0.042, su + 0.042, D - 0.012, D, 0.28, 0.364, '#efece4', 1, null, SATIN);
  }

  // THE LIGHT. A plain room has a flex from a ceiling rose to a pleated paper shade over a bulb; a
  // fine one has downlights let into the ceiling, spread to reach a room that size
  const lamps = [];
  if (club === 'vip') vipRig(K, L, { H, D, hu, lamps, lampOn });
  else if (club) clubRig(K, L, { H, D, hu, lamps, lampOn });
  // a working room lit by its own ceiling strips (gl/room-decor.js `strips`): a lamp under each, no shade drawn
  else if (Array.isArray(spec.decor?.strips) && spec.decor.strips.length) {
    for (const s of spec.decor.strips.slice(0, 8)) if (Array.isArray(s?.at)) lamps.push({ p: L.world(s.at[0], s.at[1], H - 0.25), annex: false, k: s.cage ? 0.9 : 1.15 });
  }
  else if (fine && spec.decor?.downlights === false) {
    // a finished room lit by its own fittings (gl/room-decor.js): its chandeliers are its lamps; with none, its cove
    // and sconces are, a lamp every four metres or so down its length
    if (!spec.decor.lights?.length) {
      const long = L.w >= D, len = long ? L.w : D, n = Math.max(1, Math.min(3, Math.round(len / 4)));
      for (let i = 0; i < n; i++) { const t = (i + 0.5) / n - 0.5; lamps.push({ p: long ? L.world(t * L.w, D * 0.5, H - 0.4) : L.world(0, (t + 0.5) * D, H - 0.4), annex: false, k: 1.25 }); }
    }
  } else if (fine) {
    const nu = Math.max(2, Math.round(L.w / 4)), nv = Math.max(2, Math.round(D / 4));
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
      const u = -hu + (i + 0.5) * L.w / nu, v = (j + 0.5) * D / nv;
      lathe(u, v, [[0.05, H - 0.002], [0.07, H - 0.002], [0.07, H - 0.0005], [0.05, H - 0.0005]], '#2a2c30', 1, 18, METAL);
      lathe(u, v, [[0, H - 0.0015], [0.05, H - 0.0015]], lampOn ? '#fff0d0' : '#c8c4b8', lampOn ? 2.2 : 0.8, 16, lampOn ? LAMP : undefined);
    }
    // the lights the renderer has for them: one over each part of the room
    // (a fine room with no studio plan, a lobby or a lift car, is lit from its middle)
    for (const [u, v] of spec.plan ? zoneLights(L) : [[0, D * 0.5]]) lamps.push({ p: L.world(u, v, H - 0.3), annex: false, k: 1.5 });
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
  // plain wool one, sized to the room. A club has none. `decor.rug` as { at, w, d, style } lays it where
  // the room says, at that size; style 'persian' is the Platinum Box's silk rug (booth-mesh.js)
  const rugAt = spec.decor?.rug && typeof spec.decor.rug === 'object' ? spec.decor.rug : null;
  if (!club && spec.decor?.rug !== false) {
    const sofa = L.placed.find((p) => p.arche === 'sofa' || p.arche === 'bench'), scr = L.placed.find((p) => p.arche === 'screen');
    const lz = spec.plan?.living;
    let cu = lz ? (lz[0] + lz[1]) / 2 : 0, cv = lz ? (lz[2] + lz[3]) / 2 : D * 0.5;
    if (sofa && scr) { cu = (sofa.u + scr.u) / 2; cv = (sofa.v + scr.v) / 2; } else if (sofa) { const [fu, fv] = facing(sofa.turn); cu = sofa.u + fu * 0.9; cv = sofa.v + fv * 0.9; }
    let rw = (fine ? Math.min(3.4, L.w * 0.42) : Math.min(1.6, L.w - 1.0)) / 2;
    let rd = (fine ? Math.min(2.6, D * 0.3) : Math.min(1.1, D * 0.3)) / 2;
    cu = Math.max(-hu + rw + 0.2, Math.min(hu - rw - 0.2, cu)); cv = Math.max(rd + 0.3, Math.min(D - rd - 0.3, cv));
    // a sunken lounge has it on its own floor, under the table
    const table = spec.pit && L.placed.find((p) => p.y0 && p.arche === 'table');
    if (table) { cu = table.u; cv = table.v; }
    if (rugAt) {
      if (Array.isArray(rugAt.at)) { cu = +rugAt.at[0] || 0; cv = +rugAt.at[1] || 0; }
      if (rugAt.w) rw = rugAt.w / 2;
      if (rugAt.d) rd = rugAt.d / 2;
    }
    if (spec.pit) K.lift(-spec.pit.depth);
    const y = 0.008, ps = [[cu - rw, cv - rd, y], [cu + rw, cv - rd, y], [cu + rw, cv + rd, y], [cu - rw, cv + rd, y]];
    if (rugAt?.style === 'persian') quad(TB('roomPersian'), ps, [0, 1, 0], C('#ffffff', 0.95), CLOTH, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    else if (fine) quad(TB('roomWool'), ps, [0, 1, 0], C('#cfc9bd', 0.95), CLOTH, ps.map((q) => [q[0] / ROOM_TEXTURES.roomWool, q[1] / ROOM_TEXTURES.roomWool]));
    else quad(TB(ROOM_RUG), ps, [0, 1, 0], C('#ffffff', 0.95), CLOTH, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    const side = (a, b, n) => quad(solid, [[a[0], a[1], 0.001], [b[0], b[1], 0.001], [b[0], b[1], y], [a[0], a[1], y]], n, C('#3a2a22', 0.8), CLOTH);
    side([cu - rw, cv - rd], [cu + rw, cv - rd], nrmOf(0, 0, -1)); side([cu + rw, cv + rd], [cu - rw, cv + rd], nrmOf(0, 0, 1));
    side([cu + rw, cv - rd], [cu + rw, cv + rd], nrmOf(1, 0, 0)); side([cu - rw, cv + rd], [cu - rw, cv - rd], nrmOf(-1, 0, 0));
    K.lift(0);
  }

  const isCar = !!(spec.car || spec.lift);
  if (isCar) drawCar(K, L, { DH, doorways });
  if (spec.lift) drawLiftPanel(K, spec);
  if (spec.sign) drawSign(K, L);
  // the room's finish (gl/room-decor.js), and the bronze round a lift at its landing
  if (spec.decor) drawDecor(K, L, { H, D, hu, T, DH, lampOn, lamps, runs: solidRuns, fine, accent, TEX: ROOM_TEXTURES });
  if (!isCar) for (const o of doorways) if (o.lift) liftPortal(K, L, o, { DH, H, lampOn });
  if (spec.walls) drawPartitions(K, spec.walls, H);
  if (spec.stairs) drawStairs(K, spec.stairs);
  // the furniture's stretch of each batch (`b.kit`, [first, count] in vertices): gl/room.js inks it in the
  // house line whether or not the room is, as it does the people. The kitchen's units are furniture too.
  const kitFrom = () => new Map([K.solid, ...K.textured.values()].map((b) => [b, b.n]));
  const kitTo = (was) => { for (const b of [K.solid, ...K.textured.values()]) { const n0 = was.get(b) ?? 0; if (b.n > n0) (b.kit ||= []).push([n0, b.n - n0]); } };
  let was = kitFrom();
  if (spec.plan) drawKitchen(K, { H, lampOn, lamps, seed });
  kitTo(was);
  if (annex) buildAnnex(K, { H, D, T, DH, lampOn, lamps, doorShut });
  was = kitFrom();
  for (const p of L.placed) {
    // a Cachet in a false wall: the wall stays put; only what's in its opening goes round
    if (cachetWing(p) > 0) { K.lift(p.y0 || 0); cachetFrame(K, p, { H, plaster, lit: p.form === 'chemwall' && p.id !== turning?.id, open: p.id === turning?.id }); }
    if (p.id === turning?.id) continue;
    if (swinging != null && String(p.id) === String(swinging)) continue;
    K.lift(p.y0 || 0); drawPiece(K, cachetInner(p));
  }
  // an open fridge: its body stays in the room, its doors come out to be swung on the props layer (swingBatch)
  const sp = swinging != null && L.placed.find((p) => String(p.id) === String(swinging));
  const swing = sp ? swingParts(K, L, sp) : null;
  kitTo(was);
  // a piece on a turntable is drawn apart, by the stage, for as long as it's going round
  // (a Cachet in a false wall doesn't turn: it takes itself apart and the other side puts itself together)
  const tp = turning && L.placed.find((p) => p.id === turning.id);
  const spin = tp ? (cachetWing(tp) > 0 ? assembly(K, L, tp, turning) : turntable(K, L, tp, turning)) : null;
  K.lift(0);
  // a fire lights the room in front of it, as far as the renderer has a light to spare
  for (const p of L.placed) if (p.arche === 'fireplace') { const [fu, fv] = facing(p.turn), o = p.d / 2 + 0.5; lamps.push({ p: L.world(p.u + fu * o, p.v + fv * o, 0.9 + (p.y0 || 0)), annex: false, k: 0.6, fire: true }); }
  // ⚠ THE RENDERER TAKES SIX, AND AN EN-SUITE'S HAS TO BE THE LAST OF THEM (gl/room-light.js), so what
  // goes is a ceiling light and never the fire or the bathroom
  const kept = lamps.filter((l) => l.fire), spa = lamps.filter((l) => l.annex);
  const rest = lamps.filter((l) => !l.fire && !l.annex).slice(0, 6 - kept.length - spa.length);
  // each set's stretch of the screen batch, so the one that's on can be drawn with the broadcast
  K.screens.forEach((s, i) => { s.count = (K.screens[i + 1]?.first ?? K.screen.n) - s.first; });
  // a lift car's doors are drawn apart, by the stage, so they can slide without a rebuild
  const liftDoors = isCar && doorways.length ? liftLeaves(K, L, { DH, doorways }) : null;
  // the street's glass doors, and a lift landing's bronze ones
  const slides = doorways.filter((o) => o.slide && (o.kind === 'front' || o.lift));
  // the balcony's door is an automatic glass one too: it parts as you come up to it, shutters down or not
  if (spec.balcony && !isCar) slides.push({ wall: 'front', a: spec.balcony.door[0], b: spec.balcony.door[1], h: glassTop || DH, to: 'balcony', balcony: true });
  // ⚠ A ROOM SEEN THROUGH A DOORWAY KEEPS THEM IN ITS BATCHES, DRAWN SHUT: only the room you're in moves them.
  // They used to be left out of a shell altogether, so a lift landing's bronze doors popped in as you stepped into
  // the hall.
  // Never the doorway it's seen through (`joined`): from inside the car that's the landing's own lift doors, and
  // drawn shut they stood behind the car's open ones, a second pair to walk through.
  const shown = shell ? slides.filter((o) => !joined.has(o.to)) : slides;
  const slideDoors = !isCar && shown.length ? slideLeaves(K, L, { DH, ways: shown, keep: shell }) : null;
  return { ...K, view, lamps: [...rest, ...kept, ...spa], windows, spin, swing, liftDoors, slideDoors: shell ? null : slideDoors };
}

// THE INSIDE OF A FRIDGE OR FREEZER, behind its door: a lit liner, glass shelves (wire in a freezer) and a
// few things on them. It sits inside the door's own thickness, so a shut door hides it and nothing is drawn
// twice; it only shows while the door is swung (swingBatch). Its own seed, so the fridge's picks don't move.
const COLD_STOCK = ['#d83a2a', '#f2ead2', '#3a7ad8', '#e8c02a', '#3aa84a', '#c86a4a', '#f4f2ec'];
function coldInside(K, F, p, x0, x1, y0, y1, zf, frozen) {
  const { pbox } = F, r = rng(((p.seed || 7) * 31 + (frozen ? 11 : 5)) >>> 0);
  pbox(x0, x1, y0, y1, zf, zf + 0.002, frozen ? '#c8d8e2' : '#d8dcd8', 1, null, MATTE);
  pbox(x0 + 0.025, x1 - 0.025, y0 + 0.02, y1 - 0.02, zf + 0.002, zf + 0.004, frozen ? '#e6f2fa' : '#f4f6f0', 1.35, null, MATTE);
  const n = Math.max(1, Math.round((y1 - y0) / 0.32)), gap = (y1 - y0) / (n + 1);
  for (let i = 1; i <= n; i++) {
    const y = y0 + gap * i;
    pbox(x0 + 0.02, x1 - 0.02, y, y + 0.01, zf + 0.004, zf + 0.03, frozen ? '#b8c4cc' : '#cfe4ea', frozen ? 1 : 1.15, null, frozen ? METAL : GLOSS);
    // what's kept on it: a carton, a jar, a tub; in a freezer, boxes white with frost
    let x = x0 + 0.04;
    while (x < x1 - 0.1) {
      const w = 0.05 + r() * 0.08, hh = Math.min(0.06 + r() * 0.14, gap - 0.03);
      if (r() < 0.7 && hh > 0.02) pbox(x, Math.min(x + w, x1 - 0.04), y + 0.01, y + 0.01 + hh, zf + 0.006, zf + 0.026, frozen ? '#e8eef2' : pick(r, COLD_STOCK), 1.05, null, SATIN);
      x += w + 0.02 + r() * 0.05;
    }
  }
}

// AN OPEN FRIDGE'S DOORS: the piece drawn once with K.mark, the parts after a `swing` mark cut out of the
// room's batches into their own, each with the hinge it turns on. A door hangs on a vertical hinge at its
// front corner on `side` (-1 left, +1 right, in the piece's frame); a chest's lid on its back top edge.
function swingParts(K, L, p) {
  const all = () => [K.solid, ...K.textured.values()], was = new Map(all().map((b) => [b, b.n]));
  const marks = [];
  K.mark = (name, o) => marks.push({ name, o: o || {}, at: new Map(all().map((b) => [b, b.n])), data: [] });
  K.lift(p.y0 || 0); drawPiece(K, cachetInner(p));
  K.mark = null;
  for (const b of all()) {
    const a0 = was.get(b) ?? 0, z = b.n, keep = [];
    let s = a0, m = null;
    const cut = (e) => { if (e > s) (m?.name === 'swing' ? m.data : keep).push(b.data.slice(s * STRIDE, e * STRIDE)); s = Math.max(s, e); };
    for (const q of marks) { cut(q.at.get(b) ?? a0); m = q; }
    cut(z);
    b.n = a0;
    for (const d of keep) { b.data.set(d, b.n * STRIDE); b.n += d.length / STRIDE; }
  }
  const [fu, fv] = facing(p.turn), o = L.world(p.u, p.v, 0);
  const dir = (du, dv) => { const e = L.world(p.u + du, p.v + dv, 0), x = e[0] - o[0], z = e[2] - o[2], l = Math.hypot(x, z) || 1; return [x / l, 0, z / l]; };
  const front = dir(fu, fv), side = dir(-fv, fu);
  const dot = (d, i, v) => d[i] * v[0] + d[i + 1] * v[1] + d[i + 2] * v[2];
  // which way round is "out": a turn about up by +a carries `side` toward `front` when this is positive
  const hand = side[2] * front[0] - side[0] * front[2] > 0 ? 1 : -1;
  const parts = [];
  for (const q of marks) {
    if (q.name !== 'swing' || !q.data.length) continue;
    const rest = new Float32Array(q.data.reduce((n, d) => n + d.length, 0));
    let at = 0; for (const d of q.data) { rest.set(d, at); at += d.length; }
    let sMin = Infinity, sMax = -Infinity, fMin = Infinity, fMax = -Infinity, yMin = Infinity;
    for (let i = 0; i < rest.length; i += STRIDE) {
      const sv = dot(rest, i, side), fw = dot(rest, i, front);
      sMin = Math.min(sMin, sv); sMax = Math.max(sMax, sv); fMin = Math.min(fMin, fw); fMax = Math.max(fMax, fw);
      yMin = Math.min(yMin, rest[i + 1]);
    }
    const lid = !!q.o.lid, hs = lid ? 0 : q.o.side > 0 ? sMax : sMin, hf = lid ? fMin : fMax - 0.05;
    const pt = [side[0] * hs + front[0] * hf, lid ? yMin : 0, side[2] * hs + front[2] * hf];
    // a door on the right turns its free (left) edge out: the far edge is at -side, so it's the turn that
    // carries -side toward front; a door on the left, the other way. A lid turns its front edge up.
    const sign = lid ? 0 : (q.o.side > 0 ? -hand : hand);
    parts.push({ rest, pt, axis: lid ? side : [0, 1, 0], sign, lid, max: lid ? 1.3 : 1.85 });
  }
  if (parts.some((q) => q.lid)) {
    // a lid's sign: whichever turn lifts its front edge
    for (const q of parts) if (q.lid) {
      const a = 0.3, [ax, , az] = q.axis, fx = front[0], fz = front[2];
      // the front edge, relative to the hinge, is +front; turned about `side` by +a its height is
      const up = (az * fx - ax * fz) * Math.sin(a);
      q.sign = up > 0 ? 1 : -1;
    }
  }
  return parts.length ? { id: p.id, parts } : null;
}

// The open fridge's doors `k` of the way open (0 shut, 1 open), added into the props batch `b`.
export function swingBatch(b, swing, k) {
  if (!swing) return b;
  const e = k * k * (3 - 2 * k);
  for (const q of swing.parts) {
    const a = e * q.max * q.sign, c = Math.cos(a), s = Math.sin(a), [ax, ay, az] = q.axis, [px, py, pz] = q.pt;
    const rot = (x, y, z, out, o) => {
      const d = ax * x + ay * y + az * z, cx = ay * z - az * y, cy = az * x - ax * z, cz = ax * y - ay * x;
      out[o] = x * c + cx * s + ax * d * (1 - c); out[o + 1] = y * c + cy * s + ay * d * (1 - c); out[o + 2] = z * c + cz * s + az * d * (1 - c);
    };
    const need = (b.n * STRIDE) + q.rest.length;
    if (need > b.data.length) { const d = new Float32Array(Math.max(need, b.data.length * 2)); d.set(b.data.subarray(0, b.n * STRIDE)); b.data = d; }
    const out = b.data, base = b.n * STRIDE;
    out.set(q.rest, base);
    for (let i = 0; i < q.rest.length; i += STRIDE) {
      const o = base + i;
      rot(q.rest[i] - px, q.rest[i + 1] - py, q.rest[i + 2] - pz, out, o);
      out[o] += px; out[o + 1] += py; out[o + 2] += pz;
      rot(q.rest[i + 3], q.rest[i + 4], q.rest[i + 5], out, o + 3);
    }
    b.n += q.rest.length / STRIDE;
  }
  return b;
}

// A TURNTABLE: both faces of a piece as one set of vertices, `from` showing and `to` on its far side, for
// spinBatch to turn. Each face is pressed into the front half of the piece's depth, or the two would
// stand in each other going round. The textured parts come out in their tints: it's three seconds.
function turntable(K, L, p0, { from, to }) {
  const p = cachetInner(p0);
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
// A CACHET IN A FALSE WALL, OPENING OR SHUTTING. The bar turns back on its back right corner and slides off into
// the pocket through the recess's right wall. Then the lab comes up the recess from the bay at its far end, where
// it waits in three units behind the reach of the bar's turn, and each one locks onto the last in front of you:
//   the base (casework, worktop, the gas and the tools on the bench) rolls up the floor rails into the opening;
//   the hood, its rig inside it, hangs off a trolley in the gantry overhead: it lifts clear of the worktop's
//   upstand, runs forward over the base and drops onto the worktop;
//   the wall (its back panel, the splashback, the shelves and their bottles) comes last on its own legs and
//   closes up behind the hood.
// Shutting plays the same move backwards. Nothing is put out of sight or brought in from nowhere: every part is in
// the recess, in view, the whole time, and the glass rides with it (the props glass layer).
// ⚠ THE ORDER IS THE CLEARANCE. The base is home before the hood comes down over it, the hood before the wall
// closes on it, and every unit waits behind cachetPlan's z1, past the bar's turn. Change OPEN and check the gate.
// A form drawn in parts (gl/lab-mesh.js drawLab's marks) is sorted into the units by UNIT; any other mark rides
// with the base.
const UNIT = { back: 'wall', shelf: 'wall', legs: 'wall', hood: 'hood', rig: 'hood', trolley: 'hood' };
// the timeline, as fractions of the opening move: the bar's turn, then each unit's legs of travel
const OPEN = { bar: [0, 0.28], base: [[0.3, 0.54]], hood: [[0.42, 0.48], [0.5, 0.72], [0.74, 0.8]], wall: [[0.76, 0.97]] };
// Where each unit waits, as offsets from home in the piece's frame (x across, y up, z out of its front); how far
// the hood lifts; how deep the recess runs behind the wall, how high its ceiling is, and the bar's slot.
export function cachetPlan(p0) {
  const p = cachetInner(p0), lift = 0.12;
  const z1 = -(p.d + Math.hypot(p.w, p.d) + 0.12);   // the base: clear of everywhere the bar's corner reaches
  const z2 = z1 - (p.d + 0.1);                         // the hood, behind the base
  const z3 = z2 - 0.06;                                // the wall: its shelves stand beside the hood, its panel behind it
  return { z1, z2, z3, lift, deep: -z3 + 0.45, ceil: p.h + lift + 0.14, slot: p.w + 0.35 };
}
// What carries the hood and the wall up the recess, drawn with them so they move as one. The hood's hanger comes
// up out of its duct to a trolley that runs under the gantry, so once it's home both are up in the false wall's
// header; the wall's two legs and their skids stand behind its panel, so once it's home they're behind the wall.
function labCarriers(K, p, PL) {
  const [fu, fv] = facing(p.turn), { pbox } = K.frame(p.u, p.v, fu, fv), hw = p.w / 2, hd = p.d / 2, h = p.h;
  const steel = '#9ea5ac', carbon = '#3c4047', dx = -hw + p.w * 0.3, dz = -hd * 0.2, ty = PL.ceil - PL.lift, T = 0.93;
  K.mark('trolley');
  pbox(dx - 0.018, dx + 0.018, h - 0.03, ty - 0.04, dz - 0.018, dz + 0.018, steel, 1, null, 45);
  pbox(dx - 0.16, dx + 0.16, ty - 0.04, ty - 0.006, dz - 0.1, dz + 0.1, carbon, 1, null, 46);
  pbox(dx - 0.12, dx + 0.12, ty - 0.006, ty, dz - 0.08, dz + 0.08, steel, 1, null, 45);
  for (const sx of [-1, 1]) pbox(dx + sx * 0.16 - 0.006, dx + sx * 0.16 + 0.006, ty - 0.034, ty - 0.012, dz - 0.07, dz + 0.07, '#d8b020', 1, null, MAT.MATTE);
  K.mark('legs');
  for (const x of [-hw + 0.12, hw - 0.12]) {
    pbox(x - 0.025, x + 0.025, 0.012, T + 0.3, -hd - 0.07, -hd - 0.02, '#7a8088', 1, null, 45);
    pbox(x - 0.03, x + 0.03, 0, 0.012, -hd - 0.3, -hd - 0.01, steel, 1, null, 45);
    pbox(x - 0.02, x + 0.02, T + 0.12, T + 0.26, -hd - 0.02, -hd - 0.002, steel, 1, null, 45);
  }
  pbox(-hw + 0.1, hw - 0.1, T + 0.24, T + 0.3, -hd - 0.07, -hd - 0.02, carbon, 1, null, 46);
  K.mark('end');
}
function assembly(K, L, p0, { from, to }) {
  if (from === to || ![from, to].includes('chemwall')) return turntable(K, L, p0, { from, to });
  const open = to === 'chemwall', cover = open ? from : to, PL = cachetPlan(p0);
  const p = cachetInner(p0), [fu, fv] = facing(p.turn), su = -fv, sv = fu;
  const o = L.world(p.u, p.v, 0);
  // a move in the piece's frame (x across, y up, z out) as a move in the world
  const vec = ([x, y, z]) => { const b = L.world(p.u + su * x + fu * z, p.v + sv * x + fv * z, y); return [b[0] - o[0], b[1] - o[1], b[2] - o[2]]; };
  const cat = (list) => { const d = new Float32Array(list.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of list) { d.set(x, i); i += x.length; } return d; };
  const take = (form) => {
    const all = () => [K.solid, K.glass, ...K.textured.values()], was = new Map(all().map((b) => [b, b.n]));
    const at = () => new Map(all().map((b) => [b, b.n])), marks = [];
    K.mark = (name) => marks.push({ name, at: at() });
    K.lift(p.y0 || 0); drawPiece(K, { ...p, form });
    if (form === 'chemwall') labCarriers(K, p, PL);
    K.mark = null;
    const end = at();
    // the triangles drawn between two marks; a batch first made after a mark has nothing before it
    const slice = (bs, lo, hi) => cat(bs.map((b) => { const a = lo.get(b) ?? 0, z = hi.get(b) ?? 0; return z > a ? b.data.slice(a * STRIDE, z * STRIDE) : null; }).filter(Boolean));
    const cut = (lo, hi) => ({ data: slice([K.solid, ...K.textured.values()], lo, hi), glass: slice([K.glass], lo, hi) });
    const parts = marks.length ? marks.map((m, i) => ({ name: m.name, ...cut(m.at, marks[i + 1]?.at || end) })) : [{ name: 'whole', ...cut(was, end) }];
    for (const b of all()) b.n = was.get(b) ?? 0;
    return parts;
  };
  const moves = [];
  // the bar: a quarter turn back on its back right corner, then off sideways into its pocket
  const unit = (v) => { const l = Math.hypot(v[0], v[2]) || 1; return [v[0] / l, 0, v[2] / l]; };
  const A = unit(vec([1, 0, 0])), B = unit(vec([0, 0, 1])), pv = vec([p.w / 2, 0, -p.d / 2]);
  const swing = { A, B, at: [o[0] + pv[0], o[2] + pv[2]], slide: p.d + 0.12 };
  for (const q of take(cover)) moves.push({ data: q.data, glass: q.glass, swing, k0: OPEN.bar[0], k1: OPEN.bar[1], arriving: !open, land: open ? null : 1 });
  const units = { base: [], hood: [], wall: [] };
  for (const q of take('chemwall')) units[UNIT[q.name] || 'base'].push(q);
  const route = { base: [[0, 0, PL.z1], [0, 0, 0]], hood: [[0, 0, PL.z2], [0, PL.lift, PL.z2], [0, PL.lift, 0], [0, 0, 0]], wall: [[0, 0, PL.z3], [0, 0, 0]] };
  for (const [u, list] of Object.entries(units)) {
    if (!list.length) continue;
    const segs = OPEN[u];
    moves.push({ unit: u, data: cat(list.map((q) => q.data)), glass: cat(list.map((q) => q.glass)), pts: route[u].map(vec), segs, arriving: open, land: open ? segs[segs.length - 1][1] : null });
  }
  const total = (key) => moves.reduce((s, m) => s + m[key].length, 0);
  return { asm: true, open, moves, out: new Float32Array(total('data')), gout: new Float32Array(total('glass')) };
}
// The move `k` (0..1) through, as a batch for the renderer's moving layer, with its glass for the props glass layer.
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const smooth = (x) => x * x * x * (x * (x * 6 - 15) + 10);
// where a unit is at `k` of the opening move, as an offset from home: along its route, one leg at a time, each
// leg starting and stopping soft
function routeAt(m, k) {
  const { pts, segs } = m;
  let i = 0;
  while (i < segs.length && k >= segs[i][1]) i++;
  if (i >= segs.length) return pts[pts.length - 1];
  const [a, b] = segs[i], s = smooth(clamp01((k - a) / (b - a))), P = pts[i], Q = pts[i + 1];
  return [P[0] + (Q[0] - P[0]) * s, P[1] + (Q[1] - P[1]) * s, P[2] + (Q[2] - P[2]) * s];
}
function shift(arr, at, len, d) {
  if (!d[0] && !d[1] && !d[2]) return;
  for (let i = 0; i < len; i += STRIDE) { arr[at + i] += d[0]; arr[at + i + 1] += d[1]; arr[at + i + 2] += d[2]; }
}
export function assembleBatch(asm, k) {
  const { moves, out, gout } = asm, kk = asm.open ? k : 1 - k;
  let at = 0, ga = 0;
  for (const m of moves) {
    out.set(m.data, at); gout.set(m.glass, ga);
    if (m.swing) {
      const u = clamp01((kk - m.k0) / (m.k1 - m.k0));
      swingPose(m, out, at, m.data.length, u); swingPose(m, gout, ga, m.glass.length, u);
    } else { const d = routeAt(m, kk); shift(out, at, m.data.length, d); shift(gout, ga, m.glass.length, d); }
    at += m.data.length; ga += m.glass.length;
  }
  return { data: out, n: out.length / STRIDE, glass: { data: gout, n: gout.length / STRIDE } };
}

// The bar wall `u` of the way gone (0 home, 1 away): a quarter turn back on its back right corner, eased in
// and out so it starts and lands soft, then a slide to the right into its pocket.
function swingPose(m, out, at, len, u) {
  const { A, B, at: [px, pz], slide } = m.swing, TURN = 0.74;
  const th = (Math.PI / 2) * smooth(Math.min(1, u / TURN)), sl = u > TURN ? slide * smooth((u - TURN) / (1 - TURN)) : 0;
  const c = Math.cos(th), s = Math.sin(th);
  for (let i = 0; i < len; i += STRIDE) {
    const j = at + i, dx = out[j] - px, dz = out[j + 2] - pz;
    const rx = dx * A[0] + dz * A[2], rz = dx * B[0] + dz * B[2];
    const nx = rx * c - rz * s + sl, nz = rx * s + rz * c;
    out[j] = px + A[0] * nx + B[0] * nz; out[j + 2] = pz + A[2] * nx + B[2] * nz;
    const qx = out[j + 3] * A[0] + out[j + 5] * A[2], qz = out[j + 3] * B[0] + out[j + 5] * B[2];
    const mx = qx * c - qz * s, mz = qx * s + qz * c;
    out[j + 3] = A[0] * mx + B[0] * mz; out[j + 5] = A[2] * mx + B[2] * mz;
  }
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
// A ROUND ONE: a riser down to a ring of ledge, a riser down to the floor, each with its thread of
// light, a chrome rail round the rim with a gap for the way in at `gapAt` (radians, round from +u),
// and the floor lit red from under, so from the door the whole pit reads as one glowing cherry.
function drawRoundPit(K, q, { key, tint, surf, over = [] }) {
  const dh = q.depth / 2, ri = q.r - q.step, n = 64, mat = { t: key, c: tint };
  K.lathe(q.cu, q.cv, [[q.r, 0], [q.r, -dh]], mat, 0.85, n, surf);
  K.lathe(q.cu, q.cv, [[q.r, -dh], [ri, -dh]], mat, 0.95, n, surf);
  K.lathe(q.cu, q.cv, [[ri, -dh], [ri, -q.depth]], mat, 0.85, n, surf);
  K.lathe(q.cu, q.cv, [[ri, -q.depth], [0, -q.depth]], '#5a0c18', 1.2, n);
  K.lathe(q.cu, q.cv, [[ri * 0.55, -q.depth + 0.004], [0, -q.depth + 0.004]], '#c01830', 1.4, n);
  for (const [r, y] of [[q.r, -dh], [ri, -q.depth]]) K.lathe(q.cu, q.cv, [[r - 0.012, y + 0.016], [r - 0.012, y + 0.002]], '#ff4a6a', 1.6, n);
  const gap = Number(q.gapAt ?? Math.PI / 2), half = 0.45, rod = rodOf(K);
  // the rail: short posts and a top tube, segment by segment, skipping the way in
  const seg = 40, rr = q.r + 0.12, H = 1.0, P = (a, y) => [q.cu + Math.cos(a) * rr, q.cv + Math.sin(a) * rr, y];
  const under = (a) => { const [u, v] = P(a, 0); return over.some(([u0, u1, v0, v1]) => u > u0 && u < u1 && v > v0 && v < v1); };
  const off = (a) => Math.abs(((a - gap + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < half || under(a);
  const keep = Array.from({ length: seg }, (_, i) => !off(i / seg * Math.PI * 2) && !off((i + 1) / seg * Math.PI * 2));
  for (let i = 0; i < seg; i++) {
    if (!keep[i]) continue;
    const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2;
    rod(P(a0, H), P(a1, H), 0.025, '#c8ccd0', 1.1);
    // a post every fourth, and one to finish the rail wherever it stops
    if (i % 4 === 0 || !keep[(i + seg - 1) % seg]) rod(P(a0, 0), P(a0, H), 0.02, '#9aa0a8', 1);
    if (!keep[(i + 1) % seg]) rod(P(a1, 0), P(a1, H), 0.02, '#9aa0a8', 1);
  }
}

// A CLUB'S RIG (spec.club): a square truss under the ceiling over the middle of the room (over the
// pit when there's one), a moving head at each corner, two strobes, a mirror ball, a spotlight on a
// pipe over a runway's tip and a strip of neon round the walls. Its lamps carry a `tint` and an `fx`
// that gl/room.js plays each frame: the strobe in bursts, the heads' colour wandering the floor, a
// red wash off the stage on the beat. Six lamps at most, the renderer's limit.
function clubRig(K, L, { H, D, hu, lamps, lampOn }) {
  const { box, ball, lathe } = K, rod = rodOf(K), spec = L.spec, W = (u, v, y) => L.world(u, v, y);
  const [cu, cv] = spec.pit ? [spec.pit.cu ?? (spec.pit.u0 + spec.pit.u1) / 2, spec.pit.cv ?? (spec.pit.v0 + spec.pit.v1) / 2] : [0, D / 2];
  const s = Math.min(2.2, hu - 1, D / 4), y = H - 0.45, steel = '#2a2a2e', glow = lampOn ? 1.8 : 0.5;
  const c4 = [[cu - s, cv - s], [cu + s, cv - s], [cu + s, cv + s], [cu - s, cv + s]];
  // the truss: two chords a side with a zigzag between, hung from the ceiling at its corners
  for (let i = 0; i < 4; i++) {
    const [a, b] = [c4[i], c4[(i + 1) % 4]], n = 8;
    for (const dy of [0, 0.3]) rod([a[0], a[1], y + dy], [b[0], b[1], y + dy], 0.025, steel, 1);
    for (let j = 0; j < n; j++) { const t0 = j / n, t1 = (j + 1) / n, at = (t, dy) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, y + dy]; rod(at(t0, j % 2 ? 0.3 : 0), at(t1, j % 2 ? 0 : 0.3), 0.01, steel, 1); }
    rod([a[0], a[1], y + 0.3], [a[0], a[1], H], 0.012, '#5a5a60', 1);
  }
  // a moving head under each corner: a yoke and a round head, its lens lit
  const lens = ['#ff40c0', '#40e0ff', '#ff40c0', '#40e0ff'];
  c4.forEach(([u, v], i) => {
    box(u - 0.13, u + 0.13, v - 0.05, v + 0.05, y - 0.08, y, '#141418', 1, null, METAL);
    for (const du of [-0.12, 0.1]) box(u + du, u + du + 0.02, v - 0.04, v + 0.04, y - 0.3, y - 0.08, '#141418', 1, null, METAL);
    ball(u, v, y - 0.24, 0.1, '#1c1c20', 1, 12, METAL);
    ball(u, v, y - 0.33, 0.045, lens[i], glow, 10, GLOW);
  });
  // two strobes on the truss's sides, a flat white face turned down
  for (const [u, v] of [[cu, cv - s], [cu, cv + s]]) {
    box(u - 0.26, u + 0.26, v - 0.07, v + 0.07, y - 0.16, y, '#18181c', 1, null, METAL);
    box(u - 0.23, u + 0.23, v - 0.05, v + 0.05, y - 0.17, y - 0.16, '#eef4ff', glow, null, GLOW);
  }
  // the mirror ball, off to one side of the middle on its chain
  const mb = [cu + s * 0.55, cv + s * 0.7];
  rod([mb[0], mb[1], H], [mb[0], mb[1], H - 0.75], 0.006, '#8a8c90', 1);
  ball(mb[0], mb[1], H - 0.97, 0.22, '#d8dce4', 1.3, 10, METAL);
  // a runway's spotlight on a pipe over its tip, or the middle's
  const rw = L.placed.find((p) => p.form === 'runway');
  const tip = rw ? (() => { const q = Math.round(((rw.turn % 360) + 360) % 360 / 90) % 2; return q ? [rw.u + rw.d / 2 - 0.35, rw.v] : [rw.u, rw.v + rw.d / 2 - 0.35]; })() : [cu, cv];
  rod([tip[0] - 0.6, tip[1], H - 0.3], [tip[0] + 0.6, tip[1], H - 0.3], 0.02, steel, 1);
  lathe(tip[0], tip[1], [[0.09, H - 0.32], [0.12, H - 0.62], [0, H - 0.62]], '#18181c', 1, 14, METAL);
  lathe(tip[0], tip[1], [[0.11, H - 0.625], [0, H - 0.625]], '#fff4e0', lampOn ? 2.4 : 0.6, 14, LAMP);
  // neon round the walls, high up
  const ny = H - 0.4, neon = '#ff3a8a';
  box(-hu + 0.005, -hu + 0.03, 1.6, D - 0.2, ny, ny + 0.025, neon, glow, null, GLOW);
  box(hu - 0.03, hu - 0.005, 1.6, D - 0.2, ny, ny + 0.025, neon, glow, null, GLOW);
  box(-hu + 0.2, hu - 0.2, D - 0.03, D - 0.005, ny, ny + 0.025, neon, glow, null, GLOW);
  // the lamps (each tint is over the warm lamp colour gl/room.js gives every lamp, 1 : 0.82 : 0.6)
  const front = L.placed.find((p) => p.form === 'stage'), bar = L.placed.find((p) => p.form === 'bar'), back = L.placed.find((p) => p.form === 'barwall');
  // glow strips: red LED under the stage's lip and down both sides of the runway, a ring round the pit's
  // rim, and a warm strip under the back bar's shelves, so the room reads by its edges and not only its lamps
  const red = '#ff2040', led = lampOn ? 2.2 : 0.6, even = (p) => Math.round(((p.turn % 360) + 360) % 360 / 90) % 2 === 0;
  if (front && even(front)) { const v = front.v + front.d / 2; box(front.u - front.w / 2, front.u + front.w / 2, v - 0.02, v + 0.005, 0.05, 0.09, red, led, null, GLOW); }
  if (rw && even(rw)) for (const su of [-1, 1]) { const u = rw.u + su * (rw.w / 2 + 0.005); box(u - 0.012, u + 0.012, rw.v - rw.d / 2, rw.v + rw.d / 2, rw.h - 0.12, rw.h - 0.08, red, led, null, GLOW); }
  if (spec.pit?.round) {
    const { cu: pu, cv: pv, r } = spec.pit, n = 48;
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2, u = pu + Math.cos(a) * (r - 0.04), v = pv + Math.sin(a) * (r - 0.04); box(u - 0.035, u + 0.035, v - 0.035, v + 0.035, 0.005, 0.03, '#ff3060', led, null, GLOW); }
  }
  if (back) {
    const [u0, u1, v0, v1] = even(back) ? [back.u - back.w / 2, back.u + back.w / 2, back.v - 0.03, back.v + 0.03] : [back.u - 0.03, back.u + 0.03, back.v - back.w / 2, back.v + back.w / 2];
    for (const yy of [1.25, 1.75]) box(u0, u1, v0, v1, yy, yy + 0.02, '#ffb060', lampOn ? 1.6 : 0.5, null, GLOW);
  }
  // the lamps (each tint is over the warm lamp colour gl/room.js gives every lamp, 1 : 0.82 : 0.6)
  lamps.push({ p: W(tip[0], tip[1], H - 0.7), annex: false, k: 3.2, tint: [1, 1.02, 1.15] });
  lamps.push({ p: W(cu, cv - s, y - 0.3), annex: false, k: 12, tint: [0.95, 1.2, 1.65], fx: { kind: 'strobe', every: 13, on: 3.2, rate: 9 } });
  lamps.push({ p: W(cu - s, cv, 2.0), annex: false, k: 4.4, tint: [1.15, 0.15, 1.5], fx: { kind: 'sweep', c: W(cu - s * 0.5, cv, 2.0), r: [3, 3], speed: 0.55 } });
  lamps.push({ p: W(cu + s, cv, 2.0), annex: false, k: 4.0, tint: [0.12, 1.0, 1.7], fx: { kind: 'sweep', c: W(cu + s * 0.5, cv, 2.0), r: [3, 3], speed: 0.41, off: Math.PI } });
  lamps.push({ p: W(front ? front.u : 0, front ? front.v + front.d / 2 + 0.6 : 1, 0.6), annex: false, k: 2.6, tint: [1.3, 0.08, 0.25], fx: { kind: 'beat', bpm: 124 } });
  if (bar) lamps.push({ p: W(bar.u, bar.v, 2.3), annex: false, k: 1.9, tint: [1, 0.72, 0.55] });
}

// A VIP ROOM (spec.club 'vip'): the club's back room, smaller and slower. Red neon low and high round
// the walls, a brass ring of bulbs over the table, a chrome pole off to one side under its own pink
// spot, and a red lamp low on a wall. No strobe and no truss. Paint it with `tone` on the room's flags.
function vipRig(K, L, { H, D, hu, lamps, lampOn }) {
  const { box, ball, lathe } = K, rod = rodOf(K), W = (u, v, y) => L.world(u, v, y), glow = lampOn ? 1.9 : 0.5;
  const table = L.placed.find((p) => p.arche === 'table'), [tu, tv] = table ? [table.u, table.v] : [0, D / 2];
  const neon = '#ff2050';
  for (const ny of [0.32, H - 0.3]) {
    box(-hu + 0.005, -hu + 0.03, 0.2, D - 0.2, ny, ny + 0.025, neon, glow, null, GLOW);
    box(hu - 0.03, hu - 0.005, 0.2, D - 0.2, ny, ny + 0.025, neon, glow, null, GLOW);
    box(-hu + 0.2, hu - 0.2, 0.005, 0.03, ny, ny + 0.025, neon, glow, null, GLOW);
  }
  // the ring of bulbs over the table, on three chains
  const rr = 0.45, ry = H - 0.55;
  for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2; rod([tu + Math.cos(a) * rr, tv + Math.sin(a) * rr, ry], [tu, tv, H], 0.006, '#b08a3a', 1); }
  for (let i = 0; i < 24; i++) { const a0 = (i / 24) * Math.PI * 2, a1 = ((i + 1) / 24) * Math.PI * 2; rod([tu + Math.cos(a0) * rr, tv + Math.sin(a0) * rr, ry], [tu + Math.cos(a1) * rr, tv + Math.sin(a1) * rr, ry], 0.014, '#c9a24a', 1); }
  for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; ball(tu + Math.cos(a) * rr, tv + Math.sin(a) * rr, ry - 0.05, 0.035, '#ffd8a0', lampOn ? 2.2 : 0.6, 8, GLOW); }
  // the pole, off the table's right-hand end, clear of the curtain
  const pu = Math.min(hu - 0.8, tu + 1.6), pv = Math.min(D - 1.3, tv + 0.9);
  lathe(pu, pv, [[0.32, 0], [0.32, 0.04], [0.26, 0.06], [0, 0.06]], '#c8ccd2', 1.1, 20, METAL);
  rod([pu, pv, 0.06], [pu, pv, H], 0.025, '#e0e4ea', 1.2);
  lathe(pu, pv, [[0.07, H - 0.04], [0.07, H], [0, H]], '#c8ccd2', 1, 12, METAL);
  lathe(pu, pv, [[0.1, H - 0.08], [0.13, H - 0.3], [0, H - 0.3]], '#18181c', 1, 14, METAL);
  lathe(pu, pv, [[0.12, H - 0.305], [0, H - 0.305]], '#ffc0e0', lampOn ? 2.2 : 0.5, 14, LAMP);
  // the lamps: the bulb ring warm over the table, the pole's pink spot, a red lamp low on the left wall,
  // and a slow magenta wash drifting round the couch
  lamps.push({ p: W(tu, tv, ry - 0.2), annex: false, k: 1.1, tint: [1.15, 0.7, 0.5] });
  lamps.push({ p: W(pu, pv, H - 0.5), annex: false, k: 1.5, tint: [1.35, 0.55, 1.0] });
  lamps.push({ p: W(-hu + 0.4, D * 0.6, 0.7), annex: false, k: 1.0, tint: [1.5, 0.15, 0.2] });
  lamps.push({ p: W(0, 1.2, 1.6), annex: false, k: 0.9, tint: [1.2, 0.2, 1.2], fx: { kind: 'sweep', c: W(0, 1.4, 1.6), r: [1.4, 0.6], speed: 0.18 } });
}

// Bills pasted up on a club's walls (spec.club), at head height in ragged runs, stopping short of
// doorways and of anything tall against the wall. The pictures are a sheet of eight (paintRoomTexture,
// 'roomPosters'): band nights, two-for-ones, the house's own rules.
function drawPosters(K, L, runs, { hu, D, H, seed }) {
  const r = rng(seed ^ 0x9e37), key = 'roomPosters', b = K.TB(key);
  const tall = L.placed.filter((p) => p.wall && (p.h || 0) + (p.rise || 0) > 1.3);
  let layer = 0;
  for (const wall of ['left', 'right', 'back']) for (const [a0, b0] of runs[wall] || []) {
    // side walls run in v, the back wall in u; keep clear of the corners and the backstage partition
    const lo = Math.max(a0, wall === 'back' ? -hu : 1.7) + 0.35, hi = Math.min(b0, wall === 'back' ? hu : D) - 0.35;
    let x = lo + r() * 0.3;
    while (x < hi - 0.5) {
      const w = 0.5 + r() * 0.22, h = w * 1.41, at = x + w / 2;
      if (at + w / 2 > hi) break;
      const blocked = tall.some((p) => p.wall === wall && Math.abs((wall === 'back' ? p.u : p.v) - at) < (p.w || 1) / 2 + w / 2 + 0.05);
      if (!blocked && r() > 0.12) {
        for (const yc of r() < 0.3 ? [1.72, 2.62] : [1.72 + (r() - 0.5) * 0.25]) {
          const cell = (r() * 8) | 0, th = (r() - 0.5) * 0.09, cs = Math.cos(th), sn = Math.sin(th), off = 0.006 + (layer++ % 5) * 0.0015;
          const m = 0.012, cu0 = (cell % 4) / 4 + m, cu1 = (cell % 4 + 1) / 4 - m, cv0 = Math.floor(cell / 4) / 2 + m, cv1 = (Math.floor(cell / 4) + 1) / 2 - m;
          // corners in the wall's plane: along it by `s`, up by `t`, from the poster's middle
          const pt = (s, t) => {
            const ss = s * cs - t * sn, tt = s * sn + t * cs;
            if (wall === 'left') return [-hu + off, at - ss, yc + tt];
            if (wall === 'right') return [hu - off, at + ss, yc + tt];
            return [at - ss, D - off, yc + tt];
          };
          const n = wall === 'left' ? K.nrmOf(1, 0, 0) : wall === 'right' ? K.nrmOf(-1, 0, 0) : K.nrmOf(0, 0, -1);
          const ps = [pt(-w / 2, -h / 2), pt(w / 2, -h / 2), pt(w / 2, h / 2), pt(-w / 2, h / 2)];
          K.quad(b, ps, n, K.C('#ffffff', 0.9 - r() * 0.15), MATTE, [[cu0, cv1], [cu1, cv1], [cu1, cv0], [cu0, cv0]]);
        }
      }
      x += w + (r() < 0.4 ? -0.08 : 0.05 + r() * 0.35);
    }
  }
}

// A partition: a plaster wall standing in the room, full height
function drawPartitions(K, walls, H) {
  for (const [u0, u1, v0, v1] of walls) K.box(u0, u1, v0, v1, 0, H, '#16141a', 0.9);
}

// A stair going down: a dark well with its treads falling away, a lip of light along each and a rail
// down its open side
function drawStairs(K, stairs) {
  for (const st of stairs) {
    const [u0, u1, v0, v1] = st.box, n = 8;
    K.box(u0, u1, v0, v1, -0.02, 0.003, '#060608', 0.6);
    for (let i = 0; i < n; i++) { const a = u0 + 0.1 + i * (u1 - u0 - 0.1) / n; K.box(a, a + 0.03, v0 + 0.05, v1 - 0.05, 0.003, 0.006, '#c8c0b0', 0.5 * (1 - i / n) + 0.15); }
    K.box(u0, u1, v1 - 0.04, v1, 0, 0.95, '#3a3a40', 1);
    K.box(u0, u0 + 0.04, v1 - 0.04, v1, 0, 0.95, '#3a3a40', 1);
  }
}

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
  const top = fine ? STONE : { t: 'roomButcher', c: '#ffffff' }, side = fine ? { t: 'roomOak', c: '#8a6a4a' } : null;
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
  // round three sides (`sides`) the deck stops at the building's back face: the lift and landing are behind it
  const wrap = B.wrap, xe = hu + T, vB = wrap ? (B.sides ? wrap : wrap + B.d) : -T;
  // the rest of the ring: each strip meets the next edge to edge, with the slab under it to catch a crack
  if (wrap) for (const [a, b, c, e] of [[xe, u1, -T, wrap], [u0, -xe, -T, wrap], ...(B.sides ? [] : [[u0, u1, wrap, vB]])]) {
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
  // the right jamb is the one the leaf shuts against; the left is the mouth of the pocket it slides into: two
  // black lips either side of the leaf's track (v -0.1..-0.06) with a dark slot between, so the leaf goes in
  // through a gap instead of through the frame
  const fb = '#141518';
  box(d1 - 0.02, d1 + 0.04, -T - 0.012, 0.012, 0, top + 0.04, fb, 0.97, null, SATIN);
  box(d0 - 0.04, d0 + 0.02, -T - 0.012, -0.106, 0, top + 0.04, fb, 0.97, null, SATIN);
  box(d0 - 0.04, d0 + 0.02, -0.054, 0.012, 0, top + 0.04, fb, 0.97, null, SATIN);
  box(d0 - 0.04, d0 - 0.03, -0.106, -0.054, 0, top + 0.04, '#050506', 1, null, MATTE);
  // the head: a black box over the opening and the pocket, with the track slot along its underside
  const pk = d0 - (d1 - d0) - 0.02;
  box(pk, d1 + 0.04, -T - 0.012, -0.106, top - 0.02, top + 0.06, fb, 0.97, null, SATIN);
  box(pk, d1 + 0.04, -0.054, 0.012, top - 0.02, top + 0.06, fb, 0.97, null, SATIN);
  box(pk, d1 + 0.04, -0.106, -0.054, top + 0.02, top + 0.06, '#050506', 1, null, MATTE);
  // a black threshold track the leaf rides in, the full run of the pocket
  box(pk, d1, -0.11, -0.05, 0, 0.008, fb, 1, null, METAL);
  // the door itself is an automatic glass slider (slideLeaves, way 'balcony'), moved by the Stage. The shutters
  // come down over its doorway too, on a pane of their own just inside the leaves: its uv runs from 300 at the
  // doorway's middle, and the shader opens it from the right as the one leaf slides left (uShutDoor), shutters down or not
  const dm = (d0 + d1) / 2, dps = [[d0, -0.04, 0.004], [d1, -0.04, 0.004], [d1, -0.04, top], [d0, -0.04, top]];
  quad(K.glass, dps, nrmOf(0, 0, 1), [0.8, 0.86, 0.9], GLOSS, dps.map((q) => [300 + q[0] - dm, q[2]]), true);
  // the rail round the open sides
  const RH = 1.12, metal = fine ? '#17181b' : '#5a5e62';
  const run = wrap && B.sides ? [[[u0, vO], [u1, vO]], [[u1, vO], [u1, vB]], [[u1, vB], [xe, vB]], [[-xe, vB], [u0, vB]], [[u0, vB], [u0, vO]]]
    : wrap ? [[[u0, vO], [u1, vO]], [[u1, vO], [u1, vB]], [[u1, vB], [u0, vB]], [[u0, vB], [u0, vO]]] : [[[u0, vO], [u1, vO]], [[u0, vO], [u0, -T]], [[u1, vO], [u1, -T]]];
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
    // (round three sides there's no deck behind to see it from, and the landing is there)
    if (!B.sides) skin([[x, wrap + 0.01, y0], [-x, wrap + 0.01, y0], [-x, wrap + 0.01, y1], [x, wrap + 0.01, y1]], nrmOf(0, 0, 1), 0);
  }
  // a tower flat's deck is dressed: planters at the rail, a bench against the building
  if (fine) drawBalconyDress(K, L);
}

// A FLAT'S HALL OUT TO ITS CORRIDOR (room-layout.js hallOf): past the back wall, beside the en-suite, the room's
// own floor carried through, a light in its ceiling, and the flat's front door at the far end stood open into it.
// The doorway in the far wall is lined by buildRoom like any other doorway.
function drawHall(K, { hall, o, D, T, DH, H, fine, trim, wallC, plaster, lampOn }) {
  const { box, quad, TB, C } = K, { a, b, v1 } = hall;
  K.lay(a, b, D, v1);
  box(a - T, b + T, D, v1 + T, -0.2, -0.01, '#2a2622');
  {
    // ⚠ FROM THE BACK WALL'S FAR FACE, NOT ITS NEAR ONE. The hall is lower than the room, so a slab begun at D
    // had its edge in the same plane as the wall over the opening and flickered through it as a grey band; the
    // ceiling begun there fought the underside of that wall the same way
    const ps = [[a, v1, H], [b, v1, H], [b, D + T, H], [a, D + T, H]], t = ROOM_TEXTURES.roomPlasterFine;
    quad(TB('roomPlasterFine'), ps, [0, -1, 0], C('#f2efe8', 1), E0, ps.map((q) => [q[0] / t, q[1] / t]));
    box(a - T, b + T, D + T, v1 + T, H + 0.01, H + 0.2, '#8a8680');
  }
  // its walls from the back wall's far face, and the far wall round the doorway
  box(a - T, a, D + T, v1, 0, H, wallC, 1, plaster);
  box(b, b + T, D + T, v1, 0, H, wallC, 1, plaster);
  box(a - T, o.a, v1, v1 + T, 0, H, wallC, 1, plaster);
  box(o.b, b + T, v1, v1 + T, 0, H, wallC, 1, plaster);
  if (H > DH) box(o.a, o.b, v1, v1 + T, DH, H, wallC, 1, plaster);
  for (const [u0, u1] of [[a, a + 0.016], [b - 0.016, b]]) box(u0, u1, D + T, v1, 0, 0.09, trim, 0.97, null, SATIN);
  // a square downlight halfway along
  const cv = (D + T + v1) / 2, cu = (a + b) / 2;
  box(cu - 0.08, cu + 0.08, cv - 0.08, cv + 0.08, H - 0.004, H - 0.001, lampOn ? '#fff0d0' : '#c8c4b8', lampOn ? 2 : 0.8);
  // the front door's frame; its door is the lock's steel leaves (gl/room-lock.js), not a swung timber one
  const fr = fine ? '#2a2c30' : trim;
  for (const [p, q] of [[o.a - 0.06, o.a], [o.b, o.b + 0.06]]) box(p, q, v1 - 0.02, v1, 0, DH + 0.06, fr, 0.97, null, SATIN);
  box(o.a - 0.06, o.b + 0.06, v1 - 0.02, v1, DH, DH + 0.06, fr, 0.97, null, SATIN);
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
  // y0 and y1, the glass's foot and head up the wall, are where the shutters run (gl/room-shutters.js)
  return { p: L.world(p[0], p[1], p[2]), n: [wn[0] - w0[0], 0, wn[2] - w0[2]], a: [wa[0] - wb[0], 0, wa[2] - wb[2]], b: [0, y1 - y0, 0], k: Math.min(3, Math.max(1, half * 2 * (y1 - y0) / 2.4)), y0, y1 };
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

// A Cachet's false wall (client/shared/room-layout.js cachetWing): plaster wings either side of the opening and
// a header to the ceiling, in the room's own wall, with a hairline shadow gap round the opening; behind the
// turntable, the alcove's dark back wall, and over it a strip light that's on while what it hides is out
// (`lit`). Drawn in the piece's frame, inside its footprint, and never turned.
function cachetFrame(K, p, { H, plaster, lit, open }) {
  const [fu, fv] = facing(p.turn), F = K.frame(p.u, p.v, fu, fv), { pbox } = F;
  const hw = p.w / 2, hd = p.d / 2, wing = cachetWing(p), ow = hw - wing, top = Math.min(H - 0.12, p.h), ceil = H - 0.004;
  // the wings and the header, the room's wall brought out to the turntable's face
  // the wings stop a shadow gap short of the opening, so no dark face lies in the plaster's plane (it flickered)
  const g = 0.008;
  pbox(-hw, -ow - g, 0, ceil, -hd, hd, '#ffffff', 1, plaster, E());
  pbox(ow + g, hw, 0, ceil, -hd, hd, '#ffffff', 1, plaster, E());
  pbox(-ow - g, ow + g, top + g, ceil, -hd, hd, '#ffffff', 1, plaster, E());
  // skirting along the wings' feet, as the room's walls have
  for (const [a, b] of [[-hw, -ow - g], [ow + g, hw]]) pbox(a, b, 0, 0.08, hd, hd + 0.012, '#e8e4dc', 0.96, null, SATIN);
  // the shadow gap round the opening, set back in the slot: the only sign the wall isn't a wall
  // Going round, the slot is the mouth of the recess the lab comes out of, so it's lined as the recess is: carbon
  // jambs and soffit, a steel deck and the base's rails run on through it to the front
  for (const [x0, x1, y0, y1] of [[-ow - g, -ow, 0, top + g], [ow, ow + g, 0, top + g], [-ow, ow, top, top + g]]) pbox(x0, x1, y0, y1, -hd, hd - 0.03, open ? '#3c4046' : '#0c0d0e', 1, null, open ? CARBON : MATTE);
  if (open) {
    pbox(-ow, ow, 0, 0.002, -hd, hd - 0.03, '#2a2e33', 1, null, METAL);
    for (const x of [-ow + 0.12, -ow * 0.35, ow * 0.35, ow - 0.12]) pbox(x - 0.012, x + 0.012, 0.002, 0.004, -hd, hd - 0.05, '#c4cad0', 1, null, METAL);
    for (const x of [-ow - g, ow]) pbox(x, x + g, 0, top, hd - 0.04, hd - 0.03, '#c4cad0', 1, null, METAL);
  }
  // with the lab out, the opening's side walls are a lab's too: a pegboard of hung tools on one, a hazard chart on the other
  if (lit) {
    const z0 = -hd + 0.08, z1 = hd - 0.1;
    pbox(-ow - 0.004, -ow + 0.012, 0.95, Math.min(top - 0.1, 1.95), z0, z1, '#2b3036', 1, null, MATTE);
    for (let i = 0; i < 4; i++) {
      const z = z0 + (z1 - z0) * (i + 0.5) / 4, y = 1.62 - (i % 2) * 0.22;
      pbox(-ow + 0.012, -ow + 0.03, y, y + 0.012, z - 0.006, z + 0.006, '#9aa0a8', 1, null, METAL);
      pbox(-ow + 0.03, -ow + 0.05, y - 0.26, y + 0.02, z - 0.02, z + 0.02, ['#c8ccd0', '#3a7a4a', '#b8862a', '#7a2a24'][i], 1, null, i ? MATTE : METAL);
    }
    // the hazard chart, up at the front of the opening where it's seen whole: a steel frame, a red header with its
    // lettering, a grid of hazard cells each with its symbol and a label, and the small print under them
    const c0 = Math.max(z0, z1 - 0.6), c1 = z1 - 0.04, y0 = 1.02, y1 = 1.86, xf = ow - 0.006, cw = c1 - c0;
    pbox(xf, ow + 0.004, y0, y1, c0, c1, '#9aa0a8', 1, null, METAL);
    pbox(xf - 0.003, xf, y0 + 0.015, y1 - 0.015, c0 + 0.015, c1 - 0.015, '#ece6cc', 1, null, MATTE);
    pbox(xf - 0.005, xf - 0.003, y1 - 0.11, y1 - 0.025, c0 + 0.03, c1 - 0.03, '#b02a22', 1, null, MATTE);
    for (let i = 0; i < 5; i++) { const z = c0 + 0.06 + i * (cw - 0.12) / 5; pbox(xf - 0.0065, xf - 0.005, y1 - 0.085, y1 - 0.05, z, z + (cw - 0.12) / 5 - 0.014, '#f4f0e0', 1, null, MATTE); }
    pbox(xf - 0.0065, xf - 0.005, y1 - 0.13, y1 - 0.122, c0 + 0.03, c1 - 0.03, '#2a2a2c', 1, null, MATTE);
    const cols = 4, rows = 4, gz = (cw - 0.08) / cols, gy = 0.13;
    for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
      const yc = y1 - 0.2 - row * gy, zc = c0 + 0.04 + gz * (col + 0.5), k = (row * 3 + col * 2) % 4, sq = 0.042;
      pbox(xf - 0.0055, xf - 0.003, yc - sq, yc + sq, zc - sq, zc + sq, ['#b83a2a', '#d8a82a', '#3a6aa8', '#2e8a4a'][k], 1, null, MATTE);
      pbox(xf - 0.006, xf - 0.0055, yc - sq + 0.008, yc + sq - 0.008, zc - sq + 0.008, zc + sq - 0.008, '#f4f0e0', 1, null, MATTE);
      // the symbol: a flame, a skull's dot pair, a drop or a cross, as two dark strokes
      pbox(xf - 0.0068, xf - 0.006, yc - 0.022, yc + 0.022, zc - 0.006, zc + 0.006, '#1a1a1c', 1, null, MATTE);
      pbox(xf - 0.0068, xf - 0.006, yc + (k % 2 ? -0.006 : 0.008), yc + (k % 2 ? 0.006 : 0.016), zc - (k > 1 ? 0.022 : 0.012), zc + (k > 1 ? 0.022 : 0.012), '#1a1a1c', 1, null, MATTE);
      pbox(xf - 0.0045, xf - 0.003, yc - sq - 0.022, yc - sq - 0.012, zc - sq, zc + sq * (0.4 + 0.15 * k), '#3a3a3c', 1, null, MATTE);
    }
    for (let i = 0; i < 3; i++) pbox(xf - 0.0045, xf - 0.003, y0 + 0.05 + i * 0.022, y0 + 0.06 + i * 0.022, c0 + 0.04, c1 - 0.04 - i * 0.07, '#5a5a5c', 1, null, MATTE);
    // two screws in the frame's top corners
    for (const z of [c0 + 0.03, c1 - 0.03]) pbox(xf - 0.006, xf, y1 - 0.012, y1 - 0.002, z - 0.005, z + 0.005, '#c8ccd0', 1, null, METAL);
  }
  // the alcove behind: a dark back wall, and the strip light in the header's soffit. Going round, the room's wall
  // is open behind it (buildRoom's holes) onto the recess the works come out of
  if (open) cachetRecess(K, F, p, { ow, hd, top });
  else pbox(-ow, ow, 0, top, -hd, -hd + 0.015, '#15171a', 1, null, MATTE);
  if (lit) pbox(-ow + 0.12, ow - 0.12, top - 0.012, top - 0.004, -hd + 0.08, -hd + 0.2, '#d8f0ea', 1.7, null, MATTE);
}

// THE RECESS BEHIND A CACHET'S FALSE WALL, seen only while it's going round: the bay the lab unfolds from. A
// carbon-fibre tunnel ribbed in steel, as deep as cachetPlan says, with the bar's pocket off its right side by
// the opening, rails let flush into its steel deck for the base and the wall's legs, the gantry the hood's
// trolley runs under, strip lights down both sides, and a steel bulkhead at the far end with its status lamps.
// It's all in the piece's frame, behind the wall's plane.
export const recessDepth = (p) => cachetPlan(p).deep;
function cachetRecess(K, F, p, { ow, hd, top }) {
  const { pbox } = F, PL = cachetPlan(p), inner = cachetInner(p), zb = -hd - PL.deep, Y = PL.ceil + 0.14;
  const dark = '#2a2e33', rib = '#7a8088', bright = '#c4cad0', carbon = '#2c2f34', ex = 0.08, X0 = -ow - ex, X1 = ow + ex;
  // the deck, and the four rails let flush into it in their dark channels: the outer two under the wall's legs
  pbox(X0, X1, -0.03, -0.002, zb, -hd, dark, 1, null, METAL);
  for (const x of [-ow + 0.12, -ow * 0.35, ow * 0.35, ow - 0.12]) {
    pbox(x - 0.03, x + 0.03, -0.0035, -0.0012, zb, -hd, '#0c0d0e', 1, null, MATTE);
    pbox(x - 0.012, x + 0.012, -0.012, 0, zb, -hd, bright, 1, null, METAL);
  }
  // a yellow line across the deck where each unit stands waiting
  for (const z of [PL.z1, PL.z2]) pbox(X0 + 0.05, X1 - 0.05, -0.0015, -0.001, z - hd - 0.05, z - hd - 0.03, '#d8b020', 1, null, MATTE);
  // the side walls, carbon: the left whole, the right open by the opening where the bar goes through
  const sz0 = -hd - PL.slot + 0.1, sz1 = -hd - 0.02;
  pbox(X0 - 0.03, X0, -0.03, Y, zb, -hd, carbon, 1, null, CARBON);
  pbox(X1, X1 + 0.03, -0.03, Y, zb, sz0, carbon, 1, null, CARBON);
  pbox(X1, X1 + 0.03, top - 0.06, Y, sz0, sz1, carbon, 1, null, CARBON);
  for (const z of [sz0, sz1]) pbox(X1 - 0.01, X1 + 0.035, 0, top - 0.06, z - 0.012, z + 0.012, bright, 1, null, METAL);
  // the bar's pocket beyond the slot: deep enough for the bar on its side, dark
  const pk = X1 + p.d + 0.25;
  pbox(X1, pk, -0.03, 0, sz0 - 0.03, -hd, '#060708', 1, null, MATTE);
  pbox(X1, pk, top, top + 0.03, sz0 - 0.03, -hd, '#060708', 1, null, MATTE);
  pbox(pk, pk + 0.03, 0, top, sz0 - 0.03, -hd, '#060708', 1, null, MATTE);
  pbox(X1, pk, 0, top, sz0 - 0.06, sz0 - 0.03, '#060708', 1, null, MATTE);
  // steel ribs up the walls and over the ceiling every 60 cm, none across the slot
  for (let z = -hd - 0.3; z > zb + 0.1; z -= 0.6) {
    pbox(X0, X0 + 0.03, 0, Y, z - 0.03, z + 0.03, rib, 1, null, METAL);
    if (z < sz0 - 0.05) pbox(X1 - 0.03, X1, 0, Y, z - 0.03, z + 0.03, rib, 1, null, METAL);
    pbox(X0, X1, Y - 0.04, Y, z - 0.03, z + 0.03, rib, 1, null, METAL);
  }
  // the ceiling, and a strip light down each side under it
  pbox(X0, X1, Y, Y + 0.03, zb, -hd, carbon, 1, null, CARBON);
  for (const x of [X0 + 0.04, X1 - 0.1]) pbox(x, x + 0.06, Y - 0.1, Y - 0.07, zb + 0.15, -hd - 0.15, '#d8f0ea', 1.8, null, MATTE);
  // the gantry: a steel beam down the middle of the hood's side, the trolley's flange at PL.ceil
  const gx = -inner.w / 2 + inner.w * 0.3;
  pbox(gx - 0.09, gx + 0.09, PL.ceil, PL.ceil + 0.014, zb + 0.05, -hd, bright, 1, null, METAL);
  pbox(gx - 0.012, gx + 0.012, PL.ceil + 0.014, Y, zb + 0.05, -hd, rib, 1, null, METAL);
  for (let z = -hd - 0.3; z > zb + 0.1; z -= 0.6) pbox(gx - 0.05, gx + 0.05, Y - 0.06, Y, z - 0.04, z + 0.04, dark, 1, null, METAL);
  // the bulkhead at the far end: dark steel, a hazard band at its foot, a row of status lamps, a lit seam
  pbox(X0, X1, -0.03, Y, zb - 0.04, zb, dark, 1, null, METAL);
  for (let i = 0; i < 12; i++) { const x = X0 + i * (X1 - X0) / 12; pbox(x, x + (X1 - X0) / 24, 0.06, 0.16, zb, zb + 0.004, i % 2 ? '#141414' : '#d8b020', 1, null, MATTE); }
  for (let i = 0; i < 5; i++) { const x = -0.3 + i * 0.15; pbox(x - 0.03, x + 0.03, 1.5, 1.53, zb, zb + 0.006, i < 3 ? '#48ff8a' : '#5ae0ff', 1.7, null, MATTE); }
  pbox(X0 + 0.1, X1 - 0.1, Y - 0.2, Y - 0.19, zb, zb + 0.006, '#5ae0ff', 1.7, null, MATTE);
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
  // a hotel's forms (gl/room-decor.js), then the ones room-fittings.js owns, on the same helpers
  // a flat's control panel (plugins/envcontrol) lays out as a hung cabinet and is drawn as itself
  if (p.dress === 'envctl' && drawEnvPanel(K, F, p)) return;
  if (drawDecorForm(K, F, p)) return;
  if (drawFitting({ K, F, p, r, L: K.L, coldInside: (...a) => coldInside(K, F, p, ...a), wear, fine, fab, wood, enamel, plastic, steel, tired, stain, lat, rod, R, pick: (list) => pick(r, list) })) return;
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
      const n = Math.max(2, Math.min(3, Math.round(w / 0.62))), arm = 0.2, sy = 0.37 - wear * 0.02; // cushion top sy + 0.08 = 0.45, a chair's seat, where the sit clip's hips are
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
      const cy = p.mount || 1.25, ph = h, thick = p.form === 'slab' ? 0.018 : 0.045, z0 = -hd + 0.03;
      pbox(-0.12, 0.12, cy - 0.1, cy + 0.1, -hd, z0, '#1a1b1e', 0.9, null, METAL);
      // in a room with an accent metal the bezel is that metal (Solenne's gold)
      const bezel = K.L.spec.tone?.accent;
      pbox(-hw, hw, cy - ph / 2, cy + ph / 2, z0, z0 + thick, bezel || plastic, bezel ? 1.05 : 0.9, null, bezel ? METAL : SATIN);
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
        // two cold rooms side by side behind the doors: the freezer on the left, the fridge on the right
        coldInside(K, F, p, -hw + 0.02, -0.006, 0.08, h - 0.03, zf, true);
        coldInside(K, F, p, 0.006, hw - 0.02, 0.08, h - 0.03, zf, false);
        K.mark?.('swing', { side: -1 });
        R(...alongY(), 0.07, h - 0.02, -hw + 0.01, -0.006, zf, zf + 0.035, 0.012, steel, 1.02, METAL);
        rod(P(-0.04, h * 0.35, zf + 0.06), P(-0.04, h * 0.8, zf + 0.06), 0.012, '#e0e4e8', 1.1); for (const y of [h * 0.35, h * 0.8]) rod(P(-0.04, y, zf + 0.035), P(-0.04, y, zf + 0.06), 0.008, '#e0e4e8', 1.1);
        K.mark?.('swing', { side: 1 });
        R(...alongY(), 0.07, h - 0.02, 0.006, hw - 0.01, zf, zf + 0.035, 0.012, steel, 1.02, METAL);
        rod(P(0.04, h * 0.35, zf + 0.06), P(0.04, h * 0.8, zf + 0.06), 0.012, '#e0e4e8', 1.1); for (const y of [h * 0.35, h * 0.8]) rod(P(0.04, y, zf + 0.035), P(0.04, y, zf + 0.06), 0.008, '#e0e4e8', 1.1);
        K.mark?.('body');
        pbox(-0.006, 0.006, 0.07, h - 0.02, zf, zf + 0.03, SEAM, 0.9);
      } else {
        const split = h * 0.7;
        coldInside(K, F, p, -hw + 0.02, hw - 0.02, 0.08, split - 0.01, zf, false);
        coldInside(K, F, p, -hw + 0.02, hw - 0.02, split + 0.01, h - 0.03, zf, true);
        pbox(-hw + 0.01, hw - 0.01, split - 0.008, split + 0.008, zf, zf + 0.03, SEAM, 0.9); // the gasket showing between the doors
        // both doors hang on the right, the handles on the left; the freezer's first, then the fridge's with its notes
        const hx = -hw + 0.07, handle = (y0, y1) => { rod(P(hx, y0, zf + 0.06), P(hx, y1, zf + 0.06), 0.011, '#d8dce0', 1.1); for (const y of [y0, y1]) rod(P(hx, y, zf + 0.035), P(hx, y, zf + 0.06), 0.008, '#d8dce0', 1.1); };
        K.mark?.('swing', { side: 1 });
        R(...alongY(), split + 0.008, h - 0.015, -hw + 0.01, hw - 0.01, zf, zf + 0.035, 0.014, body, 0.98, GLOSS);
        handle(split + 0.06, split + 0.24);
        K.mark?.('swing', { side: 1 });
        R(...alongY(), 0.07, split - 0.008, -hw + 0.01, hw - 0.01, zf, zf + 0.035, 0.014, body, 0.98, GLOSS);
        handle(split - 0.42, split - 0.1);
        // a takeaway menu, a photo, a shopping list, each held by a magnet
        const notes = [['#f2ead2', 0.14, 0.2], ['#d8c8a0', 0.1, 0.14], ['#f4f2ec', 0.09, 0.16], ['#c86a4a', 0.07, 0.07]];
        for (let i = 0; i < 2 + Math.floor(r() * 3); i++) {
          const [c, nw, nh] = notes[i % notes.length], x = -hw * 0.2 + r() * hw * 0.8, y = split * (0.45 + r() * 0.4);
          pbox(x - nw / 2, x + nw / 2, y - nh / 2, y + nh / 2, zf + 0.035, zf + 0.037, c, 0.95, null, MATTE);
          pbox(x - 0.012, x + 0.012, y + nh / 2 - 0.03, y + nh / 2 - 0.006, zf + 0.037, zf + 0.047, pick(r, ['#d83a2a', '#2a6ad8', '#e8c02a', '#3aa84a']), 1, null, GLOSS);
        }
        K.mark?.('body');
      }
      // whatever's kept on top
      if (r() < 0.7) pbox(-hw * 0.6, -hw * 0.6 + 0.2, h, h + 0.28, -hd * 0.4, -hd * 0.4 + 0.07, pick(r, ['#d8a83a', '#c83a2a', '#3a7ad8']), 0.95, null, SATIN);
      break;
    }
    case 'chest': {
      // a chest freezer: a white box with a rounded lid, a handle, a dial and a green lamp
      R(...alongX(), -hw, hw, -hd, hd, 0.06, h - 0.07, 0.04, enamel, 0.96, GLOSS);
      // the frosted well under the lid, and the baskets across it
      pbox(-hw + 0.05, hw - 0.05, h - 0.075, h - 0.07, -hd + 0.05, hd - 0.05, '#e6f0f6', 1.3, null, MATTE);
      for (const x of [-hw * 0.5, hw * 0.5]) pbox(x - 0.012, x + 0.012, h - 0.072, h - 0.071, -hd + 0.06, hd - 0.06, '#b8c4cc', 1, null, METAL);
      K.mark?.('swing', { lid: true });
      R(...alongX(), -hw - 0.01, hw + 0.01, -hd - 0.01, hd + 0.01, h - 0.07, h, 0.03, enamel, 0.99, GLOSS);
      R(...alongX(), -0.2, 0.2, hd + 0.01, hd + 0.04, h - 0.1, h - 0.07, 0.01, '#9aa0a8', 1, METAL);
      K.mark?.('body');
      pbox(-hw + 0.04, hw - 0.04, 0, 0.06, -hd + 0.04, hd - 0.04, '#141414', 0.9);
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
  if (key.startsWith('roomSign|')) return paintSign(doc, key);
  // Scrappy's statue: a fine grain of pits and hairline cracks (gl/cat-statue.js)
  if (key === CAT_GRAIN) return paintCatGrain(doc);
  // a computer's monitor: the page its row names (gl/room-screens.js)
  // a Persian rug: the Platinum Box's silk one
  if (key === 'roomPersian') return paintBoothTexture(doc, 'boothRug');
  if (key.startsWith('roomScreen|')) return paintDesktop(doc, key.slice('roomScreen|'.length));
  const N = key === ROOM_RUG || key === 'roomPosters' ? 1024 : 512, c = doc.createElement('canvas');
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
  } else if (key === 'roomMarble') {
    // polished white marble in book-matched slabs: a warm white ground, soft grey clouds, long grey
    // veins with a gold thread through some, and a hairline joint round each slab
    g.fillStyle = '#f2eee6'; g.fillRect(0, 0, N, N);
    specks(20000, 2, ['#ebe6dc', '#f8f6f0', '#e4ded2'], 0.35);
    for (let i = 0; i < 16; i++) blot(r() * N, r() * N, 80 + r() * 160, `rgba(${r() < 0.6 ? '196,192,186' : '236,226,206'},0.2)`);
    for (let i = 0; i < 7; i++) {
      let x = r() * N, y = r() * N; const gold = r() < 0.3;
      g.strokeStyle = gold ? 'rgba(190,150,80,0.45)' : 'rgba(120,118,116,0.4)'; g.lineWidth = 0.6 + r() * 2.2; g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 60; k++) { x += (r() - 0.25) * 18; y += (r() - 0.5) * 18; g.lineTo(x, y); }
      g.stroke();
    }
    g.strokeStyle = 'rgba(150,144,136,0.5)'; g.lineWidth = 1.5; g.strokeRect(0.75, 0.75, N - 1.5, N - 1.5);
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
  } else if (key === 'roomLaminate') {
    // a cheap worktop: pale speckled laminate gone yellow, with knife scores, cup rings, a cigarette burn
    // and a scorch where a pan went down hot. The tint (`c`) colours it; this is its wear
    g.fillStyle = '#e4ddcc'; g.fillRect(0, 0, N, N);
    specks(26000, 1.6, ['#b8ae98', '#f2ecdc', '#9a9080', '#c8bca4'], 0.5);
    for (let i = 0; i < 8; i++) blot(r() * N, r() * N, 40 + r() * 90, 'rgba(170,140,80,0.16)');
    g.strokeStyle = 'rgba(90,80,64,0.35)';
    for (let i = 0; i < 70; i++) { const x = r() * N, y = r() * N, a = (r() - 0.5) * 0.6, l = 10 + r() * 50; g.lineWidth = 0.4 + r() * 0.8; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); }
    for (let i = 0; i < 4; i++) { const x = r() * N, y = r() * N, rad = 18 + r() * 10; g.strokeStyle = `rgba(110,80,50,${0.18 + r() * 0.2})`; g.lineWidth = 2 + r() * 2; g.beginPath(); g.arc(x, y, rad, r() * 2, 5 + r()); g.stroke(); }
    for (let i = 0; i < 2; i++) { const x = r() * N, y = r() * N; blot(x, y, 9, 'rgba(50,30,14,0.85)'); blot(x, y, 22, 'rgba(120,80,30,0.3)'); }
    blot(r() * N, r() * N, 60, 'rgba(70,50,30,0.3)');
  } else if (key === 'roomButcher') {
    // a butcher-block worktop: narrow staves of beech glued side by side, each its own shade, oiled
    const n = 12, s = N / n;
    for (let i = 0; i < n; i++) {
      const k = 0.82 + r() * 0.3;
      g.fillStyle = `rgb(${Math.round(196 * k)},${Math.round(150 * k)},${Math.round(100 * k)})`; g.fillRect(i * s, 0, s, N);
      for (let j = 0; j < 7; j++) {
        const x = i * s + r() * s, ph = r() * 6.28; g.strokeStyle = `rgba(90,56,26,${0.12 + r() * 0.2})`; g.lineWidth = 0.5 + r();
        g.beginPath(); for (let y = 0; y <= N; y += 8) { const xx = Math.min(i * s + s - 1, Math.max(i * s + 1, x + Math.sin(y / 60 + ph) * 1.5)); if (y) g.lineTo(xx, y); else g.moveTo(xx, y); } g.stroke();
      }
      const j0 = r() * N; g.fillStyle = 'rgba(60,36,16,0.5)'; g.fillRect(i * s, j0, s, 1.5);
      g.fillStyle = 'rgba(60,36,16,0.45)'; g.fillRect(i * s, 0, 1.2, N);
    }
    for (let i = 0; i < 5; i++) blot(r() * N, r() * N, 50 + r() * 80, 'rgba(80,50,20,0.12)');
  } else if (key === 'roomConcrete') {
    g.fillStyle = '#b4b0a8'; g.fillRect(0, 0, N, N);
    specks(40000, 2, ['#9a968e', '#c8c4bc', '#8a867e'], 0.45);
    specks(600, 6, ['#7a766e', '#d8d4cc'], 0.3);
    for (let i = 0; i < 10; i++) blot(r() * N, r() * N, 50 + r() * 100, `rgba(${r() < 0.5 ? '120,116,108' : '210,206,198'},0.2)`);
  } else if (key === 'roomEpoxy') {
    // a lab's epoxy resin worktop, to be tinted: near black, a fine mineral fleck, a satin bloom where it's
    // been wiped in circles, the white rings of hot glass put down, and a few etched spills of something
    g.fillStyle = '#b8babc'; g.fillRect(0, 0, N, N);
    specks(30000, 1.4, ['#9a9c9e', '#cfd1d3', '#e4e6e8', '#a6a8aa'], 0.6);
    for (let i = 0; i < 18; i++) blot(r() * N, r() * N, 50 + r() * 120, 'rgba(120,124,128,0.07)');
    for (let i = 0; i < 9; i++) { const x = r() * N, y = r() * N, rad = 14 + r() * 26; g.strokeStyle = `rgba(200,204,206,${0.12 + r() * 0.16})`; g.lineWidth = 1 + r() * 2.5; g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.stroke(); }
    for (let i = 0; i < 5; i++) { const x = r() * N, y = r() * N; blot(x, y, 18 + r() * 30, `rgba(${r() < 0.5 ? '150,130,90' : '110,140,150'},0.22)`); blot(x + (r() - 0.5) * 30, y + (r() - 0.5) * 30, 8 + r() * 10, 'rgba(210,200,170,0.18)'); }
    g.strokeStyle = 'rgba(160,164,168,0.08)';
    for (let i = 0; i < 40; i++) { const x = r() * N, y = r() * N; g.lineWidth = 0.5; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 80, y + (r() - 0.5) * 20); g.stroke(); }
  } else if (key === 'roomSubway') {
    // glazed subway tile in running bond, eight courses a tile: each brick a little off its neighbour, a bright
    // glaze bevel along its top edge, grey grout, and the odd chip
    g.fillStyle = '#9c9a94'; g.fillRect(0, 0, N, N);
    const rows = 8, bh = N / rows, bw = bh * 2;
    for (let j = 0; j < rows; j++) for (let i = -1; i < N / bw + 1; i++) {
      const x = i * bw + (j % 2 ? bw / 2 : 0), y = j * bh, k = 0.93 + r() * 0.09;
      g.fillStyle = `rgb(${Math.round(236 * k)},${Math.round(238 * k)},${Math.round(234 * k)})`;
      g.fillRect(x + 2, y + 2, bw - 4, bh - 4);
      const grd = g.createLinearGradient(x, y, x, y + bh); grd.addColorStop(0, 'rgba(255,255,255,0.45)'); grd.addColorStop(0.18, 'rgba(255,255,255,0)'); grd.addColorStop(0.85, 'rgba(0,0,0,0)'); grd.addColorStop(1, 'rgba(0,0,0,0.14)');
      g.fillStyle = grd; g.fillRect(x + 2, y + 2, bw - 4, bh - 4);
      if (r() < 0.04) blot(x + r() * bw, y + bh - 3, 4, 'rgba(90,88,84,0.8)');
    }
    for (let i = 0; i < 6; i++) blot(r() * N, r() * N, 60 + r() * 90, 'rgba(150,140,110,0.06)');
  } else if (key === 'roomBrushed') {
    // brushed stainless for the chrome: a fine grain one way, nearly white so the reflection carries it
    g.fillStyle = '#e6e8ea'; g.fillRect(0, 0, N, N);
    for (let i = 0; i < 2400; i++) { g.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '150,156,162'},${0.05 + r() * 0.12})`; const y = r() * N, x = r() * N; g.fillRect(x, y, 60 + r() * N, 1); g.fillRect(x - N, y, 60 + r() * N, 1); }
    for (let i = 0; i < 4; i++) blot(r() * N, r() * N, 70 + r() * 90, 'rgba(170,176,182,0.1)');
    for (let i = 0; i < 6; i++) blot(r() * N, r() * N, 6 + r() * 10, 'rgba(200,204,208,0.18)');
  } else if (key === 'roomPowder') {
    // powder-coated steel casework, to be tinted: a faint orange peel, a few scuffs to the bare grey
    g.fillStyle = '#e4e4e4'; g.fillRect(0, 0, N, N);
    specks(36000, 3, ['#d8d8d8', '#eeeeee', '#dcdcdc'], 0.45);
    g.strokeStyle = 'rgba(120,122,126,0.25)';
    for (let i = 0; i < 14; i++) { const x = r() * N, y = r() * N; g.lineWidth = 0.6 + r(); g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 40, y + (r() - 0.5) * 8); g.stroke(); }
    for (let i = 0; i < 4; i++) blot(r() * N, N * (0.7 + r() * 0.3), 30 + r() * 50, 'rgba(110,100,86,0.08)');
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
  } else if (key === 'roomPosters') paintPosters(g, N, r);
  else {
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

// A sheet of eight bills, four across and two down, each a 256 x 512 cell (drawPosters maps one onto
// each poster): a loud ground, one big shape, a block of lettering, a strip of small print, then the
// wear of a damp wall over the lot.
const POSTER_WORDS = [['LIVE', 'TONIGHT'], ['2 FOR 1', 'TILL TEN'], ['NO', 'TOUCHING'], ['LADIES', 'NIGHT'], ['BASS', 'HEAVY'], ['CASH', 'ONLY'], ['THE', 'DROP'], ['AMATEUR', 'NIGHT']];
function paintPosters(g, N, r) {
  const cw = N / 4, ch = N / 2;
  const grounds = ['#e8d22a', '#1a1a1e', '#e8317a', '#f2ece0', '#2a40c8', '#d8261e', '#101012', '#ff7a1a'];
  const inks = ['#141414', '#ff3a6a', '#141414', '#c8102e', '#f2ece0', '#f2ece0', '#3af0ff', '#141414'];
  g.fillStyle = '#2a2026'; g.fillRect(0, 0, N, N);
  for (let i = 0; i < 8; i++) {
    const x0 = (i % 4) * cw, y0 = Math.floor(i / 4) * ch, bg = grounds[i], ink = inks[i], cx = x0 + cw / 2;
    g.save(); g.beginPath(); g.rect(x0 + 6, y0 + 6, cw - 12, ch - 12); g.clip();
    g.fillStyle = bg; g.fillRect(x0, y0, cw, ch);
    // the big shape: a sunburst, a disc, lips, a bolt, a star, rings, a heart, stripes
    g.fillStyle = ink; g.strokeStyle = ink;
    const sy = y0 + ch * 0.36, R = cw * 0.34;
    switch (i) {
      case 0: for (let k = 0; k < 16; k += 2) { g.beginPath(); g.moveTo(cx, sy); g.arc(cx, sy, R * 1.4, k * Math.PI / 8, (k + 1) * Math.PI / 8); g.fill(); } break;
      case 1: g.beginPath(); g.arc(cx, sy, R, 0, Math.PI * 2); g.fill(); g.fillStyle = bg; g.beginPath(); g.arc(cx, sy, R * 0.45, 0, Math.PI * 2); g.fill(); break;
      case 2: g.beginPath(); g.ellipse(cx, sy, R, R * 0.42, 0, 0, Math.PI * 2); g.fill(); g.fillStyle = bg; g.fillRect(cx - R, sy - 3, R * 2, 6); break;
      case 3: g.beginPath(); g.moveTo(cx + 10, sy - R); g.lineTo(cx - R * 0.5, sy + 8); g.lineTo(cx, sy + 8); g.lineTo(cx - 14, sy + R); g.lineTo(cx + R * 0.55, sy - 10); g.lineTo(cx + 4, sy - 10); g.closePath(); g.fill(); break;
      case 4: g.beginPath(); for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? R * 0.45 : R; g.lineTo(cx + Math.cos(a) * rr, sy + Math.sin(a) * rr); } g.closePath(); g.fill(); break;
      case 5: g.lineWidth = 9; for (let k = 1; k <= 4; k++) { g.beginPath(); g.arc(cx, sy, R * k / 4, 0, Math.PI * 2); g.stroke(); } break;
      case 6: g.beginPath(); g.moveTo(cx, sy + R * 0.8); g.bezierCurveTo(cx - R * 1.3, sy - R * 0.1, cx - R * 0.6, sy - R, cx, sy - R * 0.35); g.bezierCurveTo(cx + R * 0.6, sy - R, cx + R * 1.3, sy - R * 0.1, cx, sy + R * 0.8); g.fill(); break;
      default: for (let k = 0; k < 7; k++) g.fillRect(x0, sy - R + k * R * 0.32, cw, R * 0.16);
    }
    // the lettering, squeezed to fit the cell
    const [w1, w2] = POSTER_WORDS[i];
    g.fillStyle = i === 6 ? '#ff3a8a' : ink; g.textAlign = 'center'; g.textBaseline = 'middle';
    if (g.fillText) for (const [word, y, size] of [[w1, y0 + ch * 0.7, 54], [w2, y0 + ch * 0.81, 40]]) {
      g.font = `900 ${size}px Impact, 'Arial Black', sans-serif`;
      const wm = g.measureText ? g.measureText(word).width : size * word.length * 0.6, k = Math.min(1, (cw - 30) / Math.max(1, wm));
      g.save(); g.translate(cx, y); g.scale(k, 1); g.fillText(word, 0, 0); g.restore();
    }
    // small print: a few grey lines nobody reads
    g.globalAlpha = 0.6;
    for (let k = 0; k < 3; k++) g.fillRect(x0 + 30 + r() * 20, y0 + ch * 0.89 + k * 11, cw - 70 - r() * 40, 4);
    g.globalAlpha = 1;
    // the wear: a water stain, scuffs, and a corner torn off
    const grd = g.createRadialGradient ? g.createRadialGradient(x0 + r() * cw, y0 + r() * ch, 0, x0 + r() * cw, y0 + r() * ch, ch * 0.5) : null;
    if (grd) { grd.addColorStop(0, 'rgba(60,40,20,0.22)'); grd.addColorStop(1, 'rgba(60,40,20,0)'); g.fillStyle = grd; g.fillRect(x0, y0, cw, ch); }
    g.fillStyle = 'rgba(0,0,0,0.12)'; for (let k = 0; k < 40; k++) g.fillRect(x0 + r() * cw, y0 + r() * ch, 2 + r() * 14, 1 + r() * 2);
    g.fillStyle = '#2a2026'; g.beginPath(); const tc = r() < 0.5; g.moveTo(tc ? x0 + cw : x0, y0 + ch); g.lineTo(tc ? x0 + cw - 30 - r() * 30 : x0 + 30 + r() * 30, y0 + ch); g.lineTo(tc ? x0 + cw : x0, y0 + ch - 30 - r() * 40); g.fill();
    g.restore();
  }
}

// ── the view and the screen ─────────────────────────────────────────────────────────────────────
// A street out of the window at a fractional hour, for a room with no place in the world and for the
// moments before GLASS has drawn the real one (panels/room-outlook.js): the sky, the sun or the moon,
// towers in three rows fading into the haze, their windows lit as the evening comes on.
export function paintView(doc, hour, seed = 1) {
  const W = 1024, Hh = 512, c = doc.createElement('canvas');
  c.width = W; c.height = Hh;
  const g = c.getContext('2d'), r = rng(seed * 7919 + 13);
  const day = lightAt(hour), dusk = Math.exp(-(((hour - 19) / 1.2) ** 2)) + Math.exp(-(((hour - 6.3) / 1.0) ** 2));
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

// A box laid against the inside face of one wall: `a0..a1` along it (u on the front and back, v on the
// sides), `d0..d1` out from its face into the room, `y0..y1` up.
function onWall(K, L, wall, a0, a1, d0, d1, y0, y1, hex, k = 1, tex = null, surf) {
  const hu = L.w / 2, D = L.d;
  if (wall === 'front') K.box(a0, a1, d0, d1, y0, y1, hex, k, tex, surf);
  else if (wall === 'back') K.box(a0, a1, D - d1, D - d0, y0, y1, hex, k, tex, surf);
  else if (wall === 'left') K.box(-hu + d0, -hu + d1, a0, a1, y0, y1, hex, k, tex, surf);
  else K.box(hu - d1, hu - d0, a0, a1, y0, y1, hex, k, tex, surf);
}

const BRONZE = '#8a6a44', BRONZE_DARK = '#3a2c1e', WALNUT = { t: 'roomOak', c: '#5a3a26' }, BRASS = '#c9a24a';

// A LIFT CAR (spec.car, or spec.lift while you ride it): walnut below a brass rail, mirror-bronze above
// in three panels with dark reveals, a dark bronze skirting, bronze jambs and a header round each
// doorway, a lit ceiling panel in a bronze frame, and a marble floor with a dark border.
function drawCar(K, L, { DH, doorways }) {
  const { box, quad, TB, C, E } = K, hu = L.w / 2, D = L.d, H = L.h;
  const runs = { front: [[-hu, hu]], back: [[-hu, hu]], left: [[0, D]], right: [[0, D]] };
  const cutRun = (wall, a, b) => { runs[wall] = runs[wall].flatMap(([x, y]) => [[x, Math.min(y, a)], [Math.max(x, b), y]]).filter(([x, y]) => y - x > 0.02); };
  const shutWays = (L.spec.openings || []).filter((o) => o.kind === 'shut' && o.wall && Number.isFinite(o.a) && !doorways.some((d) => d.wall === o.wall));
  for (const o of [...doorways, ...shutWays]) cutRun(o.wall, o.a - 0.07, o.b + 0.07);
  const mid = 1.0, top = H - 0.14, kick = 0.16;
  for (const [wall, rs] of Object.entries(runs)) {
    for (const [a, b] of rs) {
      // a brushed steel kick plate, a bronze cap over it
      onWall(K, L, wall, a, b, 0, 0.014, 0, kick, '#9ea3a8', 1.05, null, METAL);
      onWall(K, L, wall, a, b, 0, 0.018, kick, kick + 0.015, BRONZE_DARK, 1, null, METAL);
      // walnut in raised panels: a darker frame, and each field standing proud of it inside a moulded edge
      onWall(K, L, wall, a, b, 0, 0.01, kick + 0.015, mid - 0.02, '#4a2e1e', 1, WALNUT, SATIN);
      const n = Math.max(1, Math.round((b - a) / 0.75)), w = (b - a) / n;
      for (let i = 0; i < n; i++) {
        const p0 = a + i * w, p1 = p0 + w, y0 = kick + 0.07, y1 = mid - 0.08;
        if (p1 - p0 > 0.2) {
          onWall(K, L, wall, p0 + 0.05, p1 - 0.05, 0.01, 0.016, y0, y1, '#6a4630', 1.05, WALNUT, SATIN);
          onWall(K, L, wall, p0 + 0.07, p1 - 0.07, 0.016, 0.022, y0 + 0.02, y1 - 0.02, WALNUT.c, 1.12, WALNUT, SATIN);
        }
      }
      onWall(K, L, wall, a, b, 0, 0.014, mid - 0.02, mid + 0.01, BRASS, 1.05, null, METAL);
      // mirror-bronze panels, each in a narrow brass frame with a bright bevel inside it, a dark reveal between
      for (let i = 0; i < n; i++) {
        const p0 = a + i * w + 0.012, p1 = a + (i + 1) * w - 0.012, y0 = mid + 0.03, y1 = top - 0.03;
        onWall(K, L, wall, p0, p1, 0, 0.012, y0, y1, BRASS, 1.05, null, METAL);
        onWall(K, L, wall, p0 + 0.014, p1 - 0.014, 0.012, 0.015, y0 + 0.014, y1 - 0.014, '#e8dccb', 1.3, null, GLOSS);
        onWall(K, L, wall, p0 + 0.026, p1 - 0.026, 0.015, 0.017, y0 + 0.026, y1 - 0.026, '#c4a77e', 1.22, null, GLOSS);
      }
      onWall(K, L, wall, a, b, 0, 0.004, mid + 0.01, top, BRONZE_DARK, 1, null, METAL);
      onWall(K, L, wall, a, b, 0, 0.016, top, H, BRONZE, 1, null, METAL);
    }
  }
  // a floor the car isn't at: its doors drawn shut where the doorway would be
  for (const o of shutWays) {
    const m = (o.a + o.b) / 2;
    onWall(K, L, o.wall, o.a, o.b, 0, 0.02, 0, DH, '#a07c52', 1.1, null, MATTE);
    onWall(K, L, o.wall, m - 0.004, m + 0.004, 0.02, 0.024, 0, DH, '#1a1410', 1, null, METAL);
    onWall(K, L, o.wall, o.a + 0.02, o.b - 0.02, 0.02, 0.024, 0.02, 0.24, '#6a5032', 1, null, METAL);
  }
  // the doorways: a bronze jamb either side and a header, and a steel sill in the floor
  for (const o of [...doorways, ...shutWays]) {
    onWall(K, L, o.wall, o.a - 0.07, o.a, 0, 0.03, 0, DH + 0.08, BRONZE, 1.1, null, METAL);
    onWall(K, L, o.wall, o.b, o.b + 0.07, 0, 0.03, 0, DH + 0.08, BRONZE, 1.1, null, METAL);
    onWall(K, L, o.wall, o.a - 0.07, o.b + 0.07, 0, 0.03, DH, DH + 0.08, BRONZE, 1.1, null, METAL);
    onWall(K, L, o.wall, o.a - 0.07, o.b + 0.07, 0, 0.008, DH + 0.08, H, '#b08a5e', 1.15, null, GLOSS);
    onWall(K, L, o.wall, o.a, o.b, -0.14, 0.04, -0.004, 0.006, '#9ea3a8', 1.1, null, METAL);
    onWall(K, L, o.wall, o.a, o.b, 0.04, 0.06, 0.004, 0.008, '#c8ccd0', 1.2, null, METAL);
  }
  // over the open doors, the floor indicator: an amber strip in a dark bezel, an arrow either end
  for (const o of doorways) {
    const m = (o.a + o.b) / 2, y0 = DH + 0.12, y1 = Math.min(H - 0.18, DH + 0.24);
    if (y1 - y0 < 0.06) continue;
    onWall(K, L, o.wall, m - 0.2, m + 0.2, 0.008, 0.03, y0, y1, '#14100c', 1, null, METAL);
    onWall(K, L, o.wall, m - 0.08, m + 0.08, 0.03, 0.034, y0 + 0.025, y1 - 0.025, '#ffb040', 1.7, null, GLOW);
    for (const s of [-1, 1]) {
      const x = m + s * 0.145, yc = (y0 + y1) / 2;
      onWall(K, L, o.wall, x - 0.025, x + 0.025, 0.03, 0.034, yc + (s > 0 ? 0.005 : -0.02), yc + (s > 0 ? 0.02 : -0.005), '#ffb040', 1.4, null, GLOW);
      onWall(K, L, o.wall, x - 0.012, x + 0.012, 0.03, 0.034, yc + (s > 0 ? 0.02 : -0.032), yc + (s > 0 ? 0.032 : -0.02), '#ffb040', 1.4, null, GLOW);
    }
  }
  // a brass handrail on standoffs along each side wall, clear of the button panel
  const panel = L.spec.lift ? liftButtons(L.spec) : [];
  const pv = panel.length ? [Math.min(...panel.map((b) => b.v)) - 0.2, Math.max(...panel.map((b) => b.v)) + 0.2] : null;
  for (const wall of ['left', 'right']) {
    let rs = [[0.25, D - 0.25]];
    if (wall === 'right' && pv) rs = rs.flatMap(([x, y]) => [[x, Math.min(y, pv[0])], [Math.max(x, pv[1]), y]]).filter(([x, y]) => y - x > 0.3);
    for (const [a, b] of rs) {
      onWall(K, L, wall, a, b, 0.055, 0.085, 0.9, 0.93, BRASS, 1.15, null, METAL);
      for (const s of [a + 0.06, b - 0.06]) onWall(K, L, wall, s - 0.012, s + 0.012, 0, 0.06, 0.905, 0.925, BRASS, 1, null, METAL);
    }
  }
  // the ceiling: a coffered bronze grid, a round downlight in each coffer, and a vent slot along the back
  const ins = 0.16, cx0 = -hu + ins, cx1 = hu - ins, cz0 = ins, cz1 = D - ins;
  box(-hu, hu, 0, D, H - 0.02, H - 0.001, BRONZE_DARK, 1, null, METAL);
  const nx = Math.max(1, Math.round((cx1 - cx0) / 0.6)), nz = Math.max(1, Math.round((cz1 - cz0) / 0.6)), gx = (cx1 - cx0) / nx, gz = (cz1 - cz0) / nz;
  for (let i = 0; i <= nx; i++) box(cx0 + i * gx - 0.02, cx0 + i * gx + 0.02, cz0 - 0.02, cz1 + 0.02, H - 0.09, H - 0.02, BRONZE, 1.05, null, METAL);
  for (let j = 0; j <= nz; j++) box(cx0 - 0.02, cx1 + 0.02, cz0 + j * gz - 0.02, cz0 + j * gz + 0.02, H - 0.09, H - 0.02, BRONZE, 1.05, null, METAL);
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const ux = cx0 + (i + 0.5) * gx, vz = cz0 + (j + 0.5) * gz;
    box(ux - gx / 2 + 0.02, ux + gx / 2 - 0.02, vz - gz / 2 + 0.02, vz + gz / 2 - 0.02, H - 0.025, H - 0.02, '#2a2018', 1, null, MATTE);
    // an octagon of glow, near enough round at this size
    for (const [rw, rd] of [[0.075, 0.032], [0.032, 0.075], [0.056, 0.056]]) box(ux - rw, ux + rw, vz - rd, vz + rd, H - 0.034, H - 0.026, '#fff4e0', 1.8, null, GLOW);
    box(ux - 0.09, ux + 0.09, vz - 0.09, vz + 0.09, H - 0.027, H - 0.024, BRASS, 1, null, METAL);
  }
  box(-hu + 0.3, hu - 0.3, D - 0.1, D - 0.04, H - 0.03, H - 0.019, '#0c0a08', 1, null, MATTE);
  for (let x = -hu + 0.34; x < hu - 0.3; x += 0.05) box(x, x + 0.012, D - 0.1, D - 0.04, H - 0.032, H - 0.03, BRONZE, 1, null, METAL);
  // the floor: a dark border, a brass line inside it, a marble field and a black marble diamond in its middle
  const y = 0.014, b = 0.12, t = ROOM_TEXTURES.roomMarble;
  box(-hu, hu, 0, D, 0.001, 0.01, '#1e1a18', 1, null, GLOSS);
  box(-hu + b - 0.02, hu - b + 0.02, b - 0.02, D - b + 0.02, 0.01, 0.0125, BRASS, 1.1, null, METAL);
  const ps = [[-hu + b, b, y], [hu - b, b, y], [hu - b, D - b, y], [-hu + b, D - b, y]];
  quad(TB('roomMarble'), ps, [0, 1, 0], C('#ffffff', 1.05), GLOSS, ps.map((q) => [q[1] / t, q[0] / t]));
  const r = Math.min(hu - b, (D - 2 * b) / 2) * 0.55, mz = D / 2, y2 = y + 0.0015;
  const dm = [[0, mz - r - 0.025, y2], [r + 0.025, mz, y2], [0, mz + r + 0.025, y2], [-r - 0.025, mz, y2]];
  quad(TB('roomMarble'), dm, [0, 1, 0], C(BRASS, 1.1), METAL, dm.map((q) => [q[1] / t, q[0] / t]));
  const di = [[0, mz - r, y2 + 0.001], [r, mz, y2 + 0.001], [0, mz + r, y2 + 0.001], [-r, mz, y2 + 0.001]];
  quad(TB('roomMarble'), di, [0, 1, 0], C('#2a2624', 1), GLOSS, di.map((q) => [q[1] / t, q[0] / t]));
}

// A LIFT CAR'S DOORS: two brushed bronze leaves per open doorway, recessed in the wall, drawn shut and
// lifted out of the room's batches for liftDoorBatch to slide. Open, each leaf sits inside the wall
// either side, past the jamb, where nobody sees it.
function liftLeaves(K, L, { DH, doorways }) {
  const leaves = [];
  for (const o of doorways) {
    const m = (o.a + o.b) / 2, half = (o.b - o.a) / 2;
    for (const side of [-1, 1]) {
      const batches = [K.solid, ...K.textured.values()], was = new Map(batches.map((x) => [x, x.n]));
      const a0 = side < 0 ? o.a - 0.01 : m + 0.002, a1 = side < 0 ? m - 0.002 : o.b + 0.01;
      onWall(K, L, o.wall, a0, a1, -0.1, -0.06, 0.004, DH, '#a07c52', 1.1, null, MATTE);   // matte: a metal leaf showed the lamps' highlight as a round spot sliding over it
      // a kick plate, a dark seam at the meeting edge and a thin bright stile
      onWall(K, L, o.wall, a0 + 0.02, a1 - 0.02, -0.062, -0.058, 0.02, 0.24, '#6a5032', 1, null, METAL);
      const edge = side < 0 ? a1 : a0;
      onWall(K, L, o.wall, edge - 0.004, edge + 0.004, -0.062, -0.057, 0.004, DH, '#1a1410', 1, null, METAL);
      const st = side < 0 ? a1 - 0.05 : a0 + 0.04;
      onWall(K, L, o.wall, st, st + 0.01, -0.0615, -0.0575, 0.3, DH - 0.06, '#d8b47c', 1.2, null, METAL);
      const parts = [];
      for (const x of batches) { const n0 = was.get(x) ?? 0; parts.push(x.data.slice(n0 * STRIDE, x.n * STRIDE)); x.n = n0; }
      const rest = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
      let at = 0;
      for (const p of parts) { rest.set(p, at); at += p.length; }
      // which way it slides, in the host frame: along the wall, away from the middle
      const along = (q) => (o.wall === 'front' || o.wall === 'back' ? L.world(q, o.wall === 'front' ? 0 : L.d, 0) : L.world(o.wall === 'left' ? -L.w / 2 : L.w / 2, q, 0));
      const p0 = along(m), p1 = along(m + side);
      leaves.push({ rest, out: new Float32Array(rest.length), dir: [p1[0] - p0[0], p1[2] - p0[2]], slide: half + 0.03 });
    }
  }
  return leaves;
}

// AUTOMATIC GLASS DOORS: two leaves per doorway, each an aluminium frame round clear glass with a push bar and a
// frosted band at eye height so nobody walks into it, lifted out of the room's batches as a car's doors are. The
// glass itself isn't drawn: what's past the doorway is the street, and the frame is what reads as a door. Open,
// each leaf has slid along the wall behind the glass either side. `at` is the doorway's middle in the host
// frame, for the Stage to open them as somebody comes up to it.
// A LIFT LANDING'S DOORS (`o.lift`) go the same way: two leaves of brushed bronze, a kick plate, a seam and a
// bright stile, as the car's own are, and the Stage opens them as you come up to the lift. `way` is which
// doorway a leaf belongs to, so each doorway opens on its own.
function slideLeaves(K, L, { DH: DH0, ways, keep = false }) {
  const leaves = [], AL = '#aab0b6';
  for (const [way, o] of ways.entries()) {
    const DH = o.h || DH0;
    const m = (o.a + o.b) / 2, half = (o.b - o.a) / 2, mid = o.wall === 'front' ? L.world(m, 0, 0) : o.wall === 'back' ? L.world(m, L.d, 0) : L.world(o.wall === 'left' ? -L.w / 2 : L.w / 2, m, 0);
    for (const side of o.balcony ? [-1] : [-1, 1]) {
      const batches = [K.solid, ...K.textured.values()], was = new Map(batches.map((x) => [x, x.n]));
      if (o.swing) {
        // a hotel door: a bronze frame round a tall pane (left out, so the street shows through it), a middle rail,
        // a brass push plate at hand height and a kick plate, both on the side away from the hinge
        const a0 = side < 0 ? o.a : m + 0.004, a1 = side < 0 ? m - 0.004 : o.b, d0 = -0.1, d1 = -0.06, BZ = '#8a6a44';
        const bar = (u0, u1, y0, y1, hex = BZ, k = 1.05) => onWall(K, L, o.wall, u0, u1, d0, d1, y0, y1, hex, k, null, METAL);
        bar(a0, a0 + 0.09, 0.004, DH); bar(a1 - 0.09, a1, 0.004, DH);
        bar(a0, a1, 0.004, 0.3); bar(a0, a1, DH - 0.09, DH); bar(a0, a1, 1.0, 1.06);
        bar(a0 + 0.09, a1 - 0.09, 0.04, 0.26, '#c9a24a', 1.12);
        const free = side < 0 ? a1 : a0, pu = free - side * 0.16;
        onWall(K, L, o.wall, pu - 0.035, pu + 0.035, d1, d1 + 0.012, 0.98, 1.38, '#d8b47c', 1.18, null, METAL);
        onWall(K, L, o.wall, pu - 0.035, pu + 0.035, d0 - 0.012, d0, 0.98, 1.38, '#d8b47c', 1.18, null, METAL);
      } else if (o.lift) {
        const a0 = side < 0 ? o.a - 0.01 : m + 0.002, a1 = side < 0 ? m - 0.002 : o.b + 0.01;
        onWall(K, L, o.wall, a0, a1, -0.1, -0.06, 0.004, DH, '#a07c52', 1.1, null, METAL);
        onWall(K, L, o.wall, a0 + 0.02, a1 - 0.02, -0.058, -0.054, 0.02, 0.24, '#6a5032', 1, null, MATTE);
        const edge = side < 0 ? a1 : a0;
        onWall(K, L, o.wall, edge - 0.004, edge + 0.004, -0.058, -0.053, 0.004, DH, '#1a1410', 1, null, METAL);
        const st = side < 0 ? a1 - 0.05 : a0 + 0.04;
        onWall(K, L, o.wall, st, st + 0.01, -0.0575, -0.0535, 0.3, DH - 0.06, '#d8b47c', 1.2, null, METAL);
      } else {
      const a0 = side < 0 || o.balcony ? o.a : m + 0.004, a1 = o.balcony ? o.b : side < 0 ? m - 0.004 : o.b, d0 = -0.1, d1 = -0.06;
      // a balcony leaf is framed in black, to match its jambs and head
      const bar = (u0, u1, y0, y1, hex = o.balcony ? '#16171a' : AL, k = 1.1) => onWall(K, L, o.wall, u0, u1, d0, d1, y0, y1, hex, k, null, o.balcony ? SATIN : METAL);
      // a balcony door's leaf is clear glass in a slim frame (the props layer is opaque, so the glass is left
      // out and the view shows through): two rows of etched dots at eye height so nobody walks into it
      if (o.balcony) for (const y of [1.42, 1.5]) for (let u = a0 + 0.1; u < a1 - 0.09; u += 0.07) onWall(K, L, o.wall, u, u + 0.025, -0.082, -0.078, y, y + 0.025, '#e6eef2', 0.95, null, GLOSS);
      bar(a0, a0 + 0.055, 0.004, DH); bar(a1 - 0.055, a1, 0.004, DH);
      bar(a0, a1, 0.004, 0.12); bar(a0, a1, DH - 0.06, DH);
      // the push bar, on the room side, and the frosted band across the glass; a balcony leaf is one clear
      // pane, so it has neither
      if (!o.balcony) onWall(K, L, o.wall, a0 + 0.12, a1 - 0.12, d1, d1 + 0.05, 1.02, 1.06, '#c8ccd0', 1.15, null, METAL);
      if (!o.balcony) onWall(K, L, o.wall, a0 + 0.055, a1 - 0.055, -0.082, -0.078, 1.42, 1.5, '#dfe6ea', 0.9, null, GLOSS);
      }
      if (keep) continue;
      const parts = [];
      for (const x of batches) { const n0 = was.get(x) ?? 0; parts.push(x.data.slice(n0 * STRIDE, x.n * STRIDE)); x.n = n0; }
      const rest = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
      let at = 0;
      for (const p of parts) { rest.set(p, at); at += p.length; }
      const along = (q) => (o.wall === 'front' || o.wall === 'back' ? L.world(q, o.wall === 'front' ? 0 : L.d, 0) : L.world(o.wall === 'left' ? -L.w / 2 : L.w / 2, q, 0));
      const p0 = along(m), p1 = along(m + side);
      const leaf = { rest, out: new Float32Array(rest.length), dir: [p1[0] - p0[0], p1[2] - p0[2]], slide: o.balcony ? 2 * half - 0.04 : o.lift ? half + 0.03 : half - 0.02, at: [mid[0], mid[2]], way, to: o.to };
      if (o.swing) {
        // hung on its outer edge, it swings into the room: the turn is whichever way carries its free edge inward
        const hp = along(side < 0 ? o.a : o.b), fp = along(m), inn = o.wall === 'front' ? L.world(m, 1, 0) : o.wall === 'back' ? L.world(m, L.d - 1, 0) : L.world(o.wall === 'left' ? -L.w / 2 + 1 : L.w / 2 - 1, m, 0);
        const nx = inn[0] - mid[0], nz = inn[2] - mid[2], g = 1.4, rz = (t) => (fp[0] - hp[0]) * Math.sin(t) + (fp[2] - hp[2]) * Math.cos(t), rx = (t) => (fp[0] - hp[0]) * Math.cos(t) - (fp[2] - hp[2]) * Math.sin(t);
        leaf.hinge = [hp[0], hp[2]];
        leaf.turn = rx(g) * nx + rz(g) * nz > rx(-g) * nx + rz(-g) * nz ? g : -g;
      }
      leaves.push(leaf);
    }
  }
  return leaves;
}

// The car's doors `shut` of the way closed (0 open, 1 shut), as a batch for the renderer's props layer.
// `shut` may be an array, one for each doorway (a leaf's `way`). `extra` is vertices that ride along unmoved
// (the lift's read-out).
export function liftDoorBatch(leaves, shut, extra = null) {
  const n = leaves.reduce((s, l) => s + l.rest.length, 0) + (extra?.length || 0), out = new Float32Array(n);
  if (extra) out.set(extra, n - extra.length);
  let at = 0;
  for (const l of leaves) {
    const open = 1 - Math.max(0, Math.min(1, Array.isArray(shut) ? shut[l.way] ?? 1 : shut));
    out.set(l.rest, at);
    if (l.hinge) {
      // a hinged leaf turns about its hinge, its normals with it
      const t = l.turn * open, c = Math.cos(t), s = Math.sin(t), [hx, hz] = l.hinge;
      for (let i = at; i < at + l.rest.length; i += STRIDE) {
        const x = out[i] - hx, z = out[i + 2] - hz, nx = out[i + 3], nz = out[i + 5];
        out[i] = hx + x * c - z * s; out[i + 2] = hz + x * s + z * c;
        out[i + 3] = nx * c - nz * s; out[i + 5] = nx * s + nz * c;
      }
      at += l.rest.length;
      continue;
    }
    const dx = l.dir[0] * l.slide * open, dz = l.dir[1] * l.slide * open;
    for (let i = at; i < at + l.rest.length; i += STRIDE) { out[i] += dx; out[i + 2] += dz; }
    at += l.rest.length;
  }
  return { data: out, n: n / STRIDE };
}

// LETTERING ON A WALL (spec.sign): the name set in a high-contrast serif in graded gold on a black
// lacquer plate, the plate standing 4 cm off a backer edged in gold, as a hotel has over its desk.
// ⚠ THE LETTERS ARE A TEXTURE, NEVER FACES. They were the legend face's plates 4 mm proud of a
// walnut panel: blocky up close, and the two depths fought each other across the lobby, so the name
// flickered. Now each depth has one face on it, 2 cm or more from the next, and the letters are
// painted (paintSign), mipmapped, so they stay smooth at any distance.
function drawSign(K, L) {
  const s = L.spec.sign, { quad, box, TB, C, nrmOf } = K, hu = L.w / 2, D = L.d;
  const { W, H } = signSize(s), across = s.wall === 'back' || s.wall === 'front', span = across ? hu : D / 2;
  const mid = Math.max(-span + W / 2 + 0.2, Math.min(span - W / 2 - 0.2, across ? s.at : D / 2 + s.at));
  // the backer: 2 cm deep, 3 cm of gold showing round the plate
  const e = 0.03;
  onWall(K, L, s.wall, mid - W / 2 - e, mid + W / 2 + e, 0, 0.02, s.y - H / 2 - e, s.y + H / 2 + e, '#b8913e', 1.05, null, MAT.METAL);
  // the plate's four edges, black lacquer, from the backer out to its face at 6 cm
  const d0 = 0.02, d1 = 0.06, a0 = mid - W / 2, a1 = mid + W / 2, y0 = s.y - H / 2, y1 = s.y + H / 2;
  const at = s.wall === 'back' ? (a, b, d) => [a, D - d, b] : s.wall === 'front' ? (a, b, d) => [a, d, b] : s.wall === 'left' ? (a, b, d) => [-hu + d, a, b] : (a, b, d) => [hu - d, a, b];
  const out = s.wall === 'back' ? nrmOf(0, 0, -1) : s.wall === 'front' ? nrmOf(0, 0, 1) : s.wall === 'left' ? nrmOf(1, 0, 0) : nrmOf(-1, 0, 0);
  const lacquer = C('#0d0b09', 1);
  quad(K.solid, [at(a0, y1, d0), at(a1, y1, d0), at(a1, y1, d1), at(a0, y1, d1)], [0, 1, 0], lacquer, GLOSS);
  quad(K.solid, [at(a0, y0, d1), at(a1, y0, d1), at(a1, y0, d0), at(a0, y0, d0)], [0, -1, 0], lacquer, GLOSS);
  for (const a of [a0, a1]) quad(K.solid, [at(a, y0, d0), at(a, y1, d0), at(a, y1, d1), at(a, y0, d1)], out, lacquer, GLOSS, null);
  // the face. Seen from the room, "along" runs right to left on the back and left walls, so the
  // picture's left edge goes at the far end there
  const flip = s.wall === 'back' || s.wall === 'left', L0 = flip ? a1 : a0, L1 = flip ? a0 : a1;
  quad(TB(signKey(s)), [at(L0, y0, d1), at(L1, y0, d1), at(L1, y1, d1), at(L0, y1, d1)], out, C('#ffffff', 1.12), SATIN, [[0, 1], [1, 1], [1, 0], [0, 0]]);
}
// A sign's plate in metres: wide enough for the name in the face paintSign sets it in, with a margin
// either side of a letter-height and a half, and room under the name for its second line.
function signSize(s) {
  const h = s.size, W = Math.max(h * 3, s.text.length * h * 1.02 + h * 1.6), H = h * (s.sub ? 2.15 : 1.75);
  return { W, H };
}
// The texture key carries everything the painter needs, so two signs with the same words share one.
const signKey = (s) => { const { W, H } = signSize(s); return 'roomSign|' + s.text + '|' + (s.sub || '') + '|' + (W / H).toFixed(3); };

// The sign's picture: the plate edge to edge, black lacquer with a faint sheen, a gold hairline
// inset round it, the name in a high-contrast serif with wide tracking in a five-stop gold that's
// light across the middle of the letters, and the second line small under a short gold rule.
function paintSign(doc, key) {
  const [, text, sub, ratio] = key.split('|'), cw = 2048, ch = Math.max(128, Math.round(cw / Number(ratio)));
  const c = doc.createElement('canvas'); c.width = cw; c.height = ch;
  const g = c.getContext('2d');
  const bg = g.createLinearGradient(0, 0, 0, ch);
  bg.addColorStop(0, '#16120e'); bg.addColorStop(0.5, '#0b0907'); bg.addColorStop(1, '#120f0b');
  g.fillStyle = bg; g.fillRect(0, 0, cw, ch);
  const sheen = g.createLinearGradient(0, 0, cw, ch);
  sheen.addColorStop(0, 'rgba(255,240,210,0)'); sheen.addColorStop(0.45, 'rgba(255,240,210,0.05)'); sheen.addColorStop(0.55, 'rgba(255,240,210,0)');
  g.fillStyle = sheen; g.fillRect(0, 0, cw, ch);
  const gold = (y0, y1) => {
    const q = g.createLinearGradient(0, y0, 0, y1);
    q.addColorStop(0, '#8a6424'); q.addColorStop(0.32, '#e9cf8a'); q.addColorStop(0.5, '#fff1c4'); q.addColorStop(0.68, '#c9a050'); q.addColorStop(1, '#7a5520');
    return q;
  };
  const m = Math.round(ch * 0.07);
  g.strokeStyle = gold(m, ch - m); g.lineWidth = Math.max(2, ch * 0.008); g.strokeRect(m, m, cw - 2 * m, ch - 2 * m);
  const serif = '"Didot", "Bodoni 72", "Bodoni MT", "Playfair Display", "Times New Roman", Georgia, serif';
  const big = Math.round(ch * (sub ? 0.4 : 0.5)), cy = sub ? ch * 0.47 : ch * 0.53;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const track = (t, px, sp, y, fill) => {
    // set letter by letter so the tracking is the same in every browser, and tightened to fit
    g.font = `400 ${px}px ${serif}`;
    const ws = [...t].map((ch1) => g.measureText(ch1).width), ink = ws.reduce((a, b) => a + b, 0), room = cw - 6 * m;
    if (ink + sp * (t.length - 1) > room) sp = Math.max(0, (room - ink) / Math.max(1, t.length - 1));
    let x = (cw - ink - sp * (t.length - 1)) / 2;
    g.fillStyle = fill;
    for (let i = 0; i < t.length; i++) { g.fillText(t[i], x + ws[i] / 2, y); x += ws[i] + sp; }
  };
  g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = big * 0.06; g.shadowOffsetY = big * 0.03;
  track(text, big, big * 0.32, cy, gold(cy - big / 2, cy + big / 2));
  g.shadowColor = 'transparent';
  if (sub) {
    const ry = ch * 0.72, small = Math.round(ch * 0.1);
    g.fillStyle = gold(ry - 2, ry + 2); g.fillRect(cw / 2 - cw * 0.06, ry - 1.5, cw * 0.12, 3);
    track(sub, small, small * 0.55, ch * 0.83, gold(ch * 0.83 - small / 2, ch * 0.83 + small / 2));
  }
  return c;
}

// A lift car's panel (room-layout.js liftPanelAt): the reader a door's hololock has (gl/room-lock.js), on the
// right-hand wall, with an amber lens and the two emitters the hologram hangs between. The buttons and the
// read-out are on the hologram (room-lift.js), not in the mesh.
function drawLiftPanel(K, spec) {
  const at = liftPanelAt(spec);
  if (!at) return;
  const { box } = K, { u, v } = at;
  box(u - 0.035, u, v - 0.075, v + 0.075, 1.14, 1.5, '#1c2026', 1, null, MAT.METAL);
  box(u - 0.042, u - 0.035, v - 0.06, v + 0.06, 1.2, 1.44, '#4a525e', 1, null, MAT.METAL);
  box(u - 0.047, u - 0.042, v - 0.035, v + 0.035, 1.3, 1.37, '#ffb040', 1.7, null, GLOW);
  for (const y of [1.115, 1.5]) box(u - 0.075, u - 0.03, v - 0.085, v + 0.085, y, y + 0.025, '#343a44', 1, null, MAT.METAL);
}
