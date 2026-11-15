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
import { cachetWing, cachetInner, cachetPad } from '../../../../shared/room-layout.js';
import { facing, COUNTER_H, doorwaysOf, liftButtons, liftPanelAt, hallOf, stairsOf, wellBox, STAIR } from '../../../../shared/room-layout.js';
import { drawStadiumForm, drawRinkWindow } from './room-stadium.js';
import { drawDecor, drawDecorForm, liftPortal, drawBalconyDress } from './room-decor.js';
import { legend, legendWidth } from '../../../../shared/legend-font.js';
import { drawFitting, baseRun, STONE, FITTED_FORMS, stockOf, shelfKeep, STOCK } from './room-fittings.js';
import { paintDesktop } from './room-screens.js';
import { paintBoothTexture } from './booth-mesh.js';
import { drawEnvPanel } from './room-envctl.js';
import { CAT_GRAIN, paintCatGrain } from './cat-statue.js';
export { FITTED_FORMS };

// How many metres one repeat of each painted material covers (paintRoomTexture). A rug is mapped
// once across itself, so it has no repeat.
export const ROOM_TEXTURES = Object.freeze({ roomBoards: 1.8, roomPlaster: 3.6, roomCeiling: 2.4, roomWeave: 0.45, roomSteel: 0.9,
  roomWood: 1.1, roomConcrete: 1.6, roomTile: 0.9, roomCanvas: 0.8, roomTicking: 0.6, roomOak: 1.15, roomPlasterFine: 3.0, roomStone: 2.0, roomMarble: 2.4, roomTerrazzo: 1.4, roomWool: 0.7, roomFacade: 3.4, roomBrick: 1.3,
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
  if (L.spec.plan) kit.front = fine ? '#3b3d41' : L.spec.kitchen?.front || pick(rng(seed ^ 0x5bd1), ['#d8d0c0', '#4a5a5a', '#8a6a4a', '#e8e4dc']);
  if (KITCHEN_TOP_HEX[L.spec.kitchen?.top]) kit.top = KITCHEN_TOP_HEX[L.spec.kitchen.top];
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
export function buildRoom(L, { seed = 1, lampOn = true, doorShut = false, turning = null, swinging = null, joined = new Set(), shell = false, frontOpen = false } = {}) {
  const K = roomKit(L, bakeAO(L), { textures: ROOM_TEXTURES, cell: 0.4, glow: GLOW });
  const { solid, quad, box, lathe, ball, onU, onV, C, nrmOf, TB, E } = K;
  K.fine = L.spec.finish === 'fine'; K.L = L; K.screens = []; K.dials = []; K.lampOn = lampOn;
  const view = createBatch(64);
  // ⚠ A HAIR UNDER THE FLOOR ABOVE, in a room with a flight up through it. The room above is drawn with this one, its
  // floor in the plane of this ceiling and the tops of these walls, and they fought: boards through the plaster from
  // below, plaster through the boards from above.
  const hu = L.w / 2, D = L.d, H = L.h - (stairsOf(L.spec).some((o) => o.wall === 'ceiling') ? 0.015 : 0), T = 0.14, spec = L.spec, fine = K.fine;
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
    const pit = spec.pit, key = spec.ground === 'marble' ? 'roomMarble' : spec.ground === 'terrazzo' ? 'roomTerrazzo' : spec.ground === 'tile' ? 'roomTile' : spec.ground === 'concrete' ? 'roomConcrete' : spec.ground === 'stone' || spec.ground === 'rubber' ? 'roomStone' : fine ? 'roomOak' : 'roomBoards', t = ROOM_TEXTURES[key];
    const tint = spec.ground === 'stone' ? PALE_STONE : spec.ground === 'rubber' ? '#33363a' : spec.ground === 'concrete' ? '#8a8c8a' : spec.ground === 'tile' ? '#eef0ee' : '#ffffff', marble = spec.ground === 'marble' || spec.ground === 'terrazzo';
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
    } else if (!pit) {
      // cut round the well of a flight coming up from the floor below (stairsOf, `wall: 'floor'`)
      // ⚠ AND WITH NO SLAB UNDER IT. The two rooms of a flight are drawn together, flush, and the slab hung 20 cm into
      // the room below as a black beam right across its ceiling. The room below edges the well instead (drawFlight).
      const wells = stairsOf(spec).filter((o) => o.wall === 'floor').map(wellBox);
      for (const q of cutRects([-hu, hu, 0, D], wells)) lay(...q);
      if (!wells.length) box(-hu - T, hu + T, -T, D + T, -0.2, -0.01, '#2a2622');
    } else {
      const g = 0.06;
      lay(-hu, hu, 0, pit.v0); lay(-hu, hu, pit.v1, D); lay(-hu, pit.u0, pit.v0, pit.v1); lay(pit.u1, hu, pit.v0, pit.v1);
      box(-hu - T, hu + T, -T, pit.v0 - g, -0.2, -0.01, '#2a2622'); box(-hu - T, hu + T, pit.v1 + g, D + T, -0.2, -0.01, '#2a2622');
      box(-hu - T, pit.u0 - g, pit.v0 - g, pit.v1 + g, -0.2, -0.01, '#2a2622'); box(pit.u1 + g, hu + T, pit.v0 - g, pit.v1 + g, -0.2, -0.01, '#2a2622');
      drawPit(K, pit, { key, tint, surf: fine ? SATIN : E });
    }
  }
  // the ceiling, and a slab over it. A roof deck (spec.open) has neither: over it is the sky the glass shows
  // A flight up out of this room goes through it, so it's cut round the flight's well (stairsOf, `wall: 'ceiling'`).
  if (!spec.open) {
    const key = fine ? 'roomPlasterFine' : 'roomCeiling', t = ROOM_TEXTURES[key], wells = stairsOf(spec).filter((o) => o.wall === 'ceiling').map(wellBox);
    for (const [u0, u1, v0, v1] of cutRects([-hu, hu, 0, D], wells)) {
      const ps = [[u0, v1, H], [u1, v1, H], [u1, v0, H], [u0, v0, H]];
      quad(TB(key), ps, [0, -1, 0], C(tone.ceiling || (club ? '#1c181e' : '#f2efe8'), 1), E, ps.map((q) => [q[0] / t, q[1] / t]));
    }
    // (and none over it with a floor above it: it would stand up through that floor)
    if (!wells.length) box(-hu - T, hu + T, -T, D + T, H + 0.01, H + 0.2, '#8a8680');
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
    // stood open while somebody goes through it (`frontOpen`): the leaf swung in on its hinge at d1, flat to the
    // wall beside it, and the corridor dark past the frame
    if (frontOpen) {
      box(d1 - 0.04, d1, D - (d1 - d0), D - 0.01, 0, DH - 0.01, '#6a4a30', 0.92, leaf, SATIN);
      box(d0, d1, D + T - 0.02, D + T, 0, DH, '#141416', 1);
    } else box(d0, d1, dv, D, 0, DH - 0.01, '#6a4a30', 0.92, leaf, SATIN);
    if (!fine && !frontOpen) {
      for (const [a, b] of [[d0 + 0.09, (d0 + d1) / 2 - 0.04], [(d0 + d1) / 2 + 0.04, d1 - 0.09]]) for (const [c, e] of [[0.18, 0.92], [1.08, 1.9]]) {
        box(a, b, dv - 0.012, dv, c, e, '#6a4a30', 0.85, leaf, SATIN);
        box(a + 0.04, b - 0.04, dv - 0.02, dv - 0.012, c + 0.04, e - 0.04, '#6a4a30', 0.97, leaf, SATIN);
      }
    }
    for (const [a, b, c, e] of [[d0 - 0.07, d0, 0, DH + 0.07], [d1, d1 + 0.07, 0, DH + 0.07], [d0 - 0.07, d1 + 0.07, DH, DH + 0.07]]) box(a, b, D - 0.02, D, c, e, fine ? '#2a2c30' : trim, 0.97, null, SATIN);
    const ku = d0 + 0.07;
    if (frontOpen) { /* the knob went round with the leaf */ }
    else if (fine) {
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
  // a flight to the next floor: drawn by the room it stands in, and the balustrade round its well by the room above
  for (const o of stairsOf(spec)) { if (o.wall === 'ceiling') drawFlight(K, o, { H, hu, D, fine, club, trim, plaster }); else drawWell(K, o, { hu, D, fine, club, trim }); }
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
  // a Cachet's keypad, where its station is (cachetPad): one on the false wall stays put while the wall goes round
  for (const p of L.placed) if (p.keypad && (cachetPad(p).wall || p.id !== turning?.id)) { K.lift(p.y0 || 0); drawCachetPad(K, p); }
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
  // A plain room's leaf is a painted timber frame in the room's trim; a tower flat's is black
  if (spec.balcony && !isCar) slides.push({ wall: 'front', a: spec.balcony.door[0], b: spec.balcony.door[1], h: glassTop || DH, to: 'balcony', balcony: true, ...(fine ? {} : { timber: trim }) });
  // ⚠ A ROOM SEEN THROUGH A DOORWAY KEEPS THEM IN ITS BATCHES, DRAWN SHUT: only the room you're in moves them.
  // They used to be left out of a shell altogether, so a lift landing's bronze doors popped in as you stepped into
  // the hall.
  // Never the doorway it's seen through (`joined`): from inside the car that's the landing's own lift doors, and
  // drawn shut they stood behind the car's open ones, a second pair to walk through.
  const shown = shell ? slides.filter((o) => !joined.has(o.to)) : slides;
  const slideDoors = !isCar && shown.length ? slideLeaves(K, L, { DH, ways: shown, keep: shell }) : null;
  return { ...K, view, lamps: [...rest, ...kept, ...spa], windows, spin, swing, liftDoors, slideDoors: shell ? null : slideDoors };
}

// THE CABINET ROUND A COLD ROOM: a back, two sides, a top and a floor, open at the front where the door hangs, so
// the room inside is a room and not a sticker on a solid block. `c` is the outside's colour (or texture). A shut
// door closes the front, so from the room it looks as it always did.
const COLD_WALL = 0.04;
function coldShell(F, R, { hw, hd, h, zf, y0 = 0.06, c, k = 0.96, surf = GLOSS }) {
  const { alongY, pbox } = F, t = COLD_WALL, x0 = -hw + 0.01, x1 = hw - 0.01;
  R(...alongY(), y0, h, x0, x1, -hd, -hd + t, 0.02, c, k, surf);
  R(...alongY(), y0, h, x0, x0 + t, -hd, zf, 0.012, c, k, surf);
  R(...alongY(), y0, h, x1 - t, x1, -hd, zf, 0.012, c, k, surf);
  R(...alongY(), h - t, h, x0, x1, -hd, zf, 0.012, c, k, surf);
  pbox(x0, x1, y0, y0 + t, -hd, zf, typeof c === 'string' ? c : c.c, k, null, surf);
}

// THE INSIDE OF A FRIDGE OR FREEZER, behind its door, from the back of the cabinet (`zb`) to its open front (`zf`):
// a lit liner, glass shelves (wire in a freezer) the whole depth, and what's kept on them, drawn as things: milk
// and juice cartons, bottles, jars, tins, tubs and a takeaway; a crisper drawer of vegetables at the bottom of a
// fridge tall enough; frosted packs and a tray of ice in a freezer. The front few centimetres are left for the
// door's own bins (coldDoor). Its own seed, so the fridge's picks don't move. As much is kept in it as the
// container's level says (gl/room-fittings.js stockOf): nothing, a few things on the middle shelf, the lower
// shelves stocked, or the lot.
const COLD_STOCK = ['#d83a2a', '#f2ead2', '#3a7ad8', '#e8c02a', '#3aa84a', '#c86a4a', '#f4f2ec'];
const COLD_GLASS = ['#3a6a3a', '#5a3a1e', '#d8e4e0', '#8a2a1a', '#2a4a6a'];
const COLD_VEG = ['#4a9a3a', '#c83a2a', '#e88a2a', '#6aaa3a', '#d8c84a', '#7a3a6a'];
const COLD_BIN = 0.08;
function coldInside(K, F, p, x0, x1, y0, y1, zf, frozen, zb = zf - 0.03) {
  const { pbox } = F, r = rng(((p.seed || 7) * 31 + (frozen ? 11 : 5)) >>> 0), rod = rodOf(K), lvl = stockOf(p);
  const lat = (x, z, prof, c, k = 1, n = 10, surf = SATIN) => { const [u, v] = F.P(x, 0, z); K.lathe(u, v, prof, c, k, n, surf); };
  const liner = frozen ? '#e6f2fa' : '#f4f6f0', front = zf - COLD_BIN;
  // the liner, lit: the back, the sides, the roof and the floor, and the lamp under the roof
  pbox(x0, x1, y0, y1, zb, zb + 0.004, liner, 1.3, null, MATTE);
  pbox(x0, x0 + 0.004, y0, y1, zb, zf, liner, 1.2, null, MATTE);
  pbox(x1 - 0.004, x1, y0, y1, zb, zf, liner, 1.2, null, MATTE);
  pbox(x0, x1, y1 - 0.004, y1, zb, zf, liner, 1.1, null, MATTE);
  pbox(x0, x1, y0, y0 + 0.004, zb, zf, liner, 1.25, null, MATTE);
  const mx = (x0 + x1) / 2;
  if (y1 - y0 > 0.3) pbox(mx - 0.06, mx + 0.06, y1 - 0.03, y1 - 0.004, zb + 0.08, zb + 0.16, frozen ? '#d8f0ff' : '#fff6d8', 1.8, null, MATTE);
  // a crisper drawer along the floor of a fridge tall enough for one, and vegetables in it
  let base = y0;
  if (!frozen && y1 - y0 > 0.8) {
    const top = y0 + 0.2;
    pbox(x0 + 0.01, x1 - 0.01, top, top + 0.01, zb, front, '#cfe4ea', 1.15, null, GLOSS);
    pbox(x0 + 0.02, x1 - 0.02, y0 + 0.01, y0 + 0.1, front - 0.012, front, '#d6e8ec', 1.2, null, GLOSS);
    pbox(mx - 0.06, mx + 0.06, y0 + 0.07, y0 + 0.09, front, front + 0.01, '#b8c8cc', 1, null, GLOSS);
    for (let x = x0 + 0.06; x < x1 - 0.05; x += 0.07 + r() * 0.04) for (const z of [zb + 0.1, (zb + front) / 2, front - 0.08]) {
      if (r() > 0.65 * STOCK[lvl]) continue;
      const s = 0.028 + r() * 0.018, y = y0 + 0.01;
      lat(x, z, [[0, y], [s * 0.8, y + s * 0.15], [s, y + s * 0.8], [s * 0.85, y + s * 1.5], [s * 0.3, y + s * 1.9], [0, y + s * 1.95]], pick(r, COLD_VEG), 1.05, 8, SATIN);
    }
    base = top + 0.01;
  }
  const n = Math.max(1, Math.round((y1 - base) / 0.3)), gap = (y1 - base) / (n + 1);
  // the floor of the cabinet is the first shelf, then the glass ones over it
  const shelves = [base, ...Array.from({ length: n }, (_, i) => base + gap * (i + 1))];
  for (const [i, y] of shelves.entries()) {
    if (i) {
      if (frozen) { for (let z = zb + 0.03; z < front; z += 0.045) rod(F.P(x0 + 0.01, y + 0.005, z), F.P(x1 - 0.01, y + 0.005, z), 0.003, '#c8d0d4', 1.05); }
      else {
        pbox(x0 + 0.005, x1 - 0.005, y, y + 0.008, zb + 0.005, front, '#d8eaf0', 1.2, null, GLOSS);
        pbox(x0 + 0.005, x1 - 0.005, y - 0.006, y + 0.012, front - 0.012, front, '#c8d4d8', 1.05, null, METAL);
      }
    }
    const room = (i < shelves.length - 1 ? shelves[i + 1] : y1) - y - 0.03, y2 = y + 0.008;
    if (room < 0.05) continue;
    // two rows deep: the back one full, the front one gappier
    // (a stocked shelf always has something at the back on the left, so a few things is never nothing)
    const kept = shelfKeep(lvl, i, shelves.length);
    for (const [z, keep] of [[zb + 0.08, 0.85], [front - 0.08, 0.55]]) {
      let x = x0 + 0.05;
      while (x < x1 - 0.05) {
        const first = kept > 0 && z === zb + 0.08 && x === x0 + 0.05;
        const used = r() < keep * kept || first ? coldThing(pbox, lat, r, x, z, y2, room, frozen) : 0.06 + r() * 0.04;
        x += used + 0.012 + r() * 0.03;
      }
    }
  }
}
// One thing on a shelf, its foot at y, centred at (x, z), no taller than `room`. Returns how much shelf it took.
function coldThing(pbox, lat, r, x, z, y, room, frozen) {
  if (frozen) {
    const k = r();
    if (k < 0.2 && room > 0.05) {
      // a tray of ice: a white tray with the cubes standing proud
      pbox(x - 0.06, x + 0.06, y, y + 0.025, z - 0.05, z + 0.05, '#e8eef2', 1.15, null, GLOSS);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) pbox(x - 0.05 + i * 0.027, x - 0.03 + i * 0.027, y + 0.025, y + 0.04, z - 0.04 + j * 0.028, z - 0.02 + j * 0.028, '#dff2ff', 1.4, null, GLOSS);
      return 0.12;
    }
    // a pack white with frost over its colour, or a bag lying flat
    const w = 0.08 + r() * 0.07, hh = Math.min(room, 0.04 + r() * 0.1), c = pick(r, COLD_STOCK);
    pbox(x, x + w, y, y + hh, z - 0.05, z + 0.05, c, 0.75, null, SATIN);
    pbox(x - 0.002, x + w + 0.002, y + hh - 0.004, y + hh + 0.002, z - 0.052, z + 0.052, '#eef4f8', 1.25, null, MATTE);
    return w;
  }
  const k = r();
  if (k < 0.18 && room > 0.2) {
    // a carton of milk or juice, a gable top
    const hh = Math.min(room, 0.2 + r() * 0.05), c = pick(r, ['#f4f2ec', '#f4f2ec', '#e8c02a', '#e88a2a', '#d83a2a']);
    pbox(x - 0.035, x + 0.035, y, y + hh - 0.03, z - 0.035, z + 0.035, c, 1.05, null, SATIN);
    pbox(x - 0.036, x + 0.036, y + hh * 0.35, y + hh * 0.55, z - 0.036, z + 0.036, pick(r, ['#3a7ad8', '#3aa84a', '#d83a2a']), 1, null, SATIN);
    pbox(x - 0.035, x + 0.035, y + hh - 0.03, y + hh, z - 0.008, z + 0.008, c, 1, null, SATIN);
    return 0.075;
  }
  if (k < 0.36 && room > 0.18) {
    // a bottle: wine, beer, a sauce, a fizzy drink, with its cap
    const hh = Math.min(room, 0.18 + r() * 0.1), s = 0.028 + r() * 0.01;
    lat(x, z, [[0, y], [s, y], [s, y + hh * 0.6], [s * 0.45, y + hh * 0.82], [s * 0.4, y + hh * 0.96], [0, y + hh * 0.96]], pick(r, COLD_GLASS), 1.1, 10, GLOSS);
    lat(x, z, [[0, y + hh * 0.96], [s * 0.45, y + hh * 0.96], [s * 0.45, y + hh], [0, y + hh]], pick(r, ['#c8a83a', '#d83a2a', '#f4f2ec']), 1, 8, METAL);
    return s * 2 + 0.01;
  }
  if (k < 0.52 && room > 0.1) {
    // a jar with a lid: jam, pickles, mayonnaise
    const hh = Math.min(room, 0.08 + r() * 0.05), s = 0.03 + r() * 0.012;
    lat(x, z, [[0, y], [s, y], [s, y + hh * 0.82], [s * 0.85, y + hh * 0.86], [0, y + hh * 0.86]], pick(r, ['#c83a2a', '#6a8a3a', '#f2ead2', '#8a3a5a']), 1.05, 10, GLOSS);
    lat(x, z, [[0, y + hh * 0.86], [s * 0.9, y + hh * 0.86], [s * 0.9, y + hh], [0, y + hh]], pick(r, ['#d8d8d0', '#c8a83a', '#d83a2a']), 1, 10, METAL);
    return s * 2 + 0.005;
  }
  if (k < 0.66 && room > 0.12) {
    // a tin or a can
    const hh = Math.min(room, 0.11), s = 0.032;
    lat(x, z, [[0, y], [s, y], [s, y + hh], [0, y + hh]], pick(r, COLD_STOCK), 1.05, 10, METAL);
    return s * 2;
  }
  if (k < 0.82) {
    // a tub: butter, yoghurt, leftovers in a box with a coloured lid
    const w = 0.08 + r() * 0.05, hh = Math.min(room, 0.05 + r() * 0.05);
    pbox(x, x + w, y, y + hh - 0.01, z - 0.05, z + 0.05, pick(r, ['#f4f2ec', '#e8e4d8', '#d8e4e8']), 1.05, null, SATIN);
    pbox(x - 0.003, x + w + 0.003, y + hh - 0.01, y + hh, z - 0.053, z + 0.053, pick(r, COLD_STOCK), 1, null, GLOSS);
    return w;
  }
  // a takeaway carton or a wrapped block of cheese
  const w = 0.09 + r() * 0.05, hh = Math.min(room, 0.04 + r() * 0.06);
  pbox(x, x + w, y, y + hh, z - 0.045, z + 0.045, pick(r, ['#f2ead2', '#e8c02a', '#c86a4a', '#f4f2ec']), 1, null, SATIN);
  return w;
}
// THE WELL OF A CHEST FREEZER, from x0 to x1 and z0 to z1, its floor at y0 and its rim at y1: a frosted liner,
// frozen packs and trays of ice in layers, one thin layer for a few things and up near the rim for a full one, and
// two wire baskets hung across the top with more in them when it's full. Its own seed, so the chest's don't move.
function chestInside(K, F, p, x0, x1, y0, y1, z0, z1) {
  const { pbox } = F, r = rng(((p.seed || 7) * 43 + 17) >>> 0), lvl = stockOf(p);
  const lat = (x, z, prof, c, k = 1, n = 10, surf = SATIN) => { const [u, v] = F.P(x, 0, z); K.lathe(u, v, prof, c, k, n, surf); };
  const liner = '#e6f0f6';
  pbox(x0, x1, y0, y0 + 0.004, z0, z1, liner, 1.3, null, MATTE);
  pbox(x0, x1, y0, y1, z0, z0 + 0.004, liner, 1.2, null, MATTE);
  pbox(x0, x1, y0, y1, z1 - 0.004, z1, liner, 1.2, null, MATTE);
  pbox(x0, x0 + 0.004, y0, y1, z0, z1, liner, 1.15, null, MATTE);
  pbox(x1 - 0.004, x1, y0, y1, z0, z1, liner, 1.15, null, MATTE);
  const lh = 0.11;
  [[], [0.45], [0.9, 0.5], [1, 0.95, 0.9, 0.6]][lvl].forEach((keep, j) => {
    const y = y0 + 0.004 + j * lh;
    if (y + lh > y1 - 0.12) return;
    for (let z = z0 + 0.07; z < z1 - 0.06; z += 0.12) {
      let x = x0 + 0.02;
      while (x < x1 - 0.17) x += (r() < keep || (j === 0 && z === z0 + 0.07 && x === x0 + 0.02) ? coldThing(pbox, lat, r, x, z, y, lh - 0.01, true) : 0.08 + r() * 0.05) + 0.01;
    }
  });
  // the baskets across the top: a wire rim and a floor, each its own half of the well
  const bt = y1 - 0.13, mx = (x0 + x1) / 2;
  for (const [a, b] of [[x0 + 0.02, mx - 0.01], [mx + 0.01, x1 - 0.02]]) {
    for (const y of [bt, y1 - 0.01]) for (const [e, f] of [[z0 + 0.02, z0 + 0.03], [z1 - 0.03, z1 - 0.02]]) pbox(a, b, y - 0.006, y, e, f, '#b8c4cc', 1, null, METAL);
    for (let x = a; x <= b; x += (b - a) / 6) pbox(x - 0.003, x + 0.003, bt - 0.006, bt, z0 + 0.02, z1 - 0.02, '#b8c4cc', 1, null, METAL);
    if (lvl >= 2 && r() < (lvl === 3 ? 0.9 : 0.4)) for (let x = a + 0.02; x < b - 0.1;) x += coldThing(pbox, lat, r, x, (z0 + z1) / 2, bt, 0.1, true) + 0.015;
  }
}
// The bins on the inside of a cold room's door, drawn with the door so they swing with it: a lined inner face and
// a clear-fronted bin at each height, with bottles, sauces and a box of eggs stood in them. Its own seed.
function coldDoor(K, F, p, x0, x1, y0, y1, zf, frozen) {
  const { pbox } = F, r = rng(((p.seed || 7) * 37 + (frozen ? 13 : 3)) >>> 0), lvl = stockOf(p);
  const lat = (x, z, prof, c, k = 1, n = 8, surf = GLOSS) => { const [u, v] = F.P(x, 0, z); K.lathe(u, v, prof, c, k, n, surf); };
  pbox(x0 + 0.02, x1 - 0.02, y0 + 0.02, y1 - 0.02, zf - 0.008, zf, frozen ? '#e6f2fa' : '#eef0ea', 1.25, null, MATTE);
  const bins = Math.max(1, Math.floor((y1 - y0) / 0.26)), step = (y1 - y0) / (bins + 0.5), z = zf - COLD_BIN / 2 - 0.006;
  for (let i = 0; i < bins; i++) {
    const y = y0 + 0.05 + step * i;
    pbox(x0 + 0.04, x1 - 0.04, y, y + 0.008, zf - COLD_BIN, zf - 0.008, '#d8e6ea', 1.1, null, GLOSS);
    pbox(x0 + 0.04, x1 - 0.04, y, y + 0.06, zf - COLD_BIN - 0.004, zf - COLD_BIN, '#cfe2e8', 1.2, null, GLOSS);
    const room = Math.min(step - 0.04, 0.24);
    let x = x0 + 0.07;
    // the top bin of a fridge door holds the eggs
    if (!frozen && i === bins - 1 && room > 0.06) {
      // half a box of eggs in a fridge half full, none in one nearly empty
      const ex = lvl >= 3 ? x1 - 0.07 : lvl === 2 ? (x + x1) / 2 : x;
      for (; x < ex; x += 0.045) lat(x, z, [[0, y + 0.008], [0.017, y + 0.015], [0.021, y + 0.035], [0.015, y + 0.058], [0, y + 0.064]], '#e8d8b8', 1.05, 8, SATIN);
      continue;
    }
    while (x < x1 - 0.06) {
      if (r() < 0.75 * shelfKeep(lvl, i, bins) && room > 0.08) {
        const hh = Math.min(room, (frozen ? 0.08 : 0.12) + r() * 0.1), s = 0.024 + r() * 0.008;
        lat(x, z, [[0, y + 0.008], [s, y + 0.008], [s, y + hh * 0.7], [s * 0.5, y + hh * 0.9], [s * 0.45, y + hh], [0, y + hh]], frozen ? '#e8eef2' : pick(r, [...COLD_GLASS, '#f4f2ec', '#d83a2a', '#e8c02a']), 1.05, 8, GLOSS);
      }
      x += 0.06 + r() * 0.02;
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

// [u0, u1, v0, v1] less each hole in it, as rectangles: the strips either side of a hole, then the pieces before
// and after it between them. A floor and a ceiling are laid this way round a stair's well.
function cutRects(r, holes) {
  let out = [r];
  for (const h of holes) {
    const next = [];
    for (const q of out) {
      if (h[0] >= q[1] || h[1] <= q[0] || h[2] >= q[3] || h[3] <= q[2]) { next.push(q); continue; }
      const a = Math.max(q[0], h[0]), b = Math.min(q[1], h[1]);
      if (a > q[0]) next.push([q[0], a, q[2], q[3]]);
      if (b < q[1]) next.push([b, q[1], q[2], q[3]]);
      if (h[2] > q[2]) next.push([a, b, q[2], h[2]]);
      if (h[3] < q[3]) next.push([a, b, h[3], q[3]]);
    }
    out = next;
  }
  return out.filter((q) => q[1] - q[0] > 1e-3 && q[3] - q[2] > 1e-3);
}

// A board in a stair's frame (K.frame) that slopes: x0..x1 across, z0..z1 along it, its bottom rising from b0 to b1
// and its top from t0 to t1. A stringer, or the soffit under a flight.
function slopeBoard(K, F, x0, x1, z0, z1, b0, t0, b1, t1, hex, k = 1) {
  const c = K.C(hex, k), a = Math.atan2(t1 - t0, z1 - z0), ab = Math.atan2(b1 - b0, z1 - z0);
  const f = (ps, n, s = 1) => K.quad(K.solid, ps.map(([x, y, z]) => F.P(x, y, z)), F.N(...n), s === 1 ? c : K.C(hex, k * s));
  f([[x0, b0, z0], [x0, t0, z0], [x0, t1, z1], [x0, b1, z1]], [-1, 0, 0], 0.92);
  f([[x1, b1, z1], [x1, t1, z1], [x1, t0, z0], [x1, b0, z0]], [1, 0, 0], 0.92);
  f([[x0, t0, z0], [x1, t0, z0], [x1, t1, z1], [x0, t1, z1]], [0, Math.cos(a), -Math.sin(a)]);
  f([[x0, b0, z0], [x0, b1, z1], [x1, b1, z1], [x1, b0, z0]], [0, -Math.cos(ab), Math.sin(ab)], 0.85);
  f([[x1, b0, z0], [x1, t0, z0], [x0, t0, z0], [x0, b0, z0]], [0, 0, -1]);
  f([[x0, b1, z1], [x0, t1, z1], [x1, t1, z1], [x1, b1, z1]], [0, 0, 1]);
}
// Whether the line x = X along a stair's frame, from z0 to z1, runs along one of the room's walls
function alongWall(F, X, z0, z1, hu, D, k = 0.3) {
  const a = F.P(X, 0, z0), b = F.P(X, 0, z1);
  return (Math.abs(a[0]) > hu - k && Math.abs(b[0]) > hu - k && a[0] * b[0] > 0) || (a[1] < k && b[1] < k) || (a[1] > D - k && b[1] > D - k);
}

// A FLIGHT UP TO THE NEXT FLOOR (client/shared/room-layout.js stairsOf), drawn by the room it stands in: treads
// with a nose over painted risers, between two stringers, closed underneath by a soffit, with a handrail on
// newels and a baluster a step down each open side. A side along a wall has a rail on brackets instead. Its top
// runs up through the well in the ceiling, and the floor above is its last step.
function drawFlight(K, o, { hu, D, fine, club, trim }) {
  const F = K.frame(o.foot[0], o.foot[1], o.climb[0], o.climb[1]), { pbox } = F, rod = rodOf(K);
  const hw = o.w / 2, riser = o.rise / o.n, g = o.going, len = o.len, rise = o.rise, st = 0.045;
  const wood = fine ? { t: 'roomOak', c: '#b89068' } : { t: 'roomBoards', c: '#a08060' }, paint = club ? '#1a161a' : trim;
  const iron = fine || club ? '#1e1c1c' : paint, railC = fine ? '#5a3a24' : club ? '#2a2226' : '#6a4a30';
  for (let i = 0; i < o.n - 1; i++) {
    const y = (i + 1) * riser, z0 = i * g;
    pbox(-hw, hw, y - 0.04, y, z0 - 0.025, z0 + g, '#ffffff', 1, wood);
    pbox(-hw + 0.01, hw - 0.01, y - riser, y - 0.04, z0, z0 + 0.02, paint, 0.95);
  }
  // the last riser, up to the floor above, and the trimmer under its edge
  pbox(-hw + 0.01, hw - 0.01, rise - riser, rise, len, len + 0.02, paint, 0.95);
  pbox(-hw - st, hw + st, rise - 0.3, rise - riser, len, len + 0.06, '#8a8680');
  // the nose line, and the stringers either side of it, from the floor to the floor above
  const nose = (z) => riser + (rise - riser) * Math.max(0, Math.min(1, z / len));
  const top0 = riser + 0.07, top1 = rise, bot1 = rise - 0.34;
  for (const s of [-1, 1]) slopeBoard(K, F, s < 0 ? -hw - st : hw, s < 0 ? -hw : hw + st, 0, len + 0.06, 0, top0, bot1, top1, paint, 0.9);
  // the soffit: plastered, under the treads from stringer to stringer
  slopeBoard(K, F, -hw, hw, 0, len, 0, 0.02, bot1, bot1 + 0.02, '#e8e4dc', 0.85);
  // the well's edge in the ceiling, cased in the trim: down each side and across the end the flight comes up from
  const wx = hw + STAIR.gap, cw = 0.06, ch = 0.14;
  for (const s of [-1, 1]) if (!alongWall(F, s * wx, o.hole, len, hu, D)) pbox(s < 0 ? -wx - cw : wx, s < 0 ? -wx : wx + cw, rise - ch, rise, o.hole - cw, len + 0.06, paint, 0.95);
  pbox(-wx - cw, wx + cw, rise - ch, rise, o.hole - cw, o.hole, paint, 0.95);
  for (const s of [-1, 1]) {
    const X = s * (hw + st / 2);
    if (alongWall(F, X, 0, len, hu, D)) {
      // a rail on brackets screwed to the wall, a hand's width off it
      const x = s * (hw - 0.07), y = (z) => nose(z) + 0.88;
      rod(F.P(x, y(0.1), 0.1), F.P(x, y(len), len), 0.022, railC, 1, SATIN);
      for (let z = 0.3; z < len; z += 1.2) pbox(x - (s < 0 ? 0.07 : 0), x + (s > 0 ? 0.07 : 0), y(z) - 0.06, y(z) - 0.03, z - 0.012, z + 0.012, '#8a8478');
      continue;
    }
    // a newel at the foot and the top, a baluster on every step, the rail along their heads
    const rail = (z) => nose(z) + 0.9;
    pbox(X - 0.045, X + 0.045, 0, rail(0) + 0.12, -0.02, 0.07, paint, 1);
    pbox(X - 0.045, X + 0.045, bot1, rise + 1.0, len - 0.05, len + 0.04, paint, 1);
    for (let i = 0; i < o.n - 1; i++) { const z = i * g + g / 2, y0 = nose(z) + 0.07; pbox(X - 0.015, X + 0.015, y0, rail(z), z - 0.015, z + 0.015, iron, 0.95); }
    rod(F.P(X, rail(0) + 0.03, 0.02), F.P(X, rail(len) + 0.03, len - 0.04), 0.028, railC, 1, SATIN);
  }
}

// THE WELL A FLIGHT COMES UP THROUGH, drawn by the room above: a balustrade round it on the floor's edge, its long
// sides stopping where the flight's own rail has come up through the floor high enough to take over, and across
// the end the flight goes down from. A side along a wall has none.
function drawWell(K, o, { hu, D, fine, club, trim }) {
  const F = K.frame(o.foot[0], o.foot[1], o.climb[0], o.climb[1]), { pbox } = F;
  const riser = o.rise / o.n, X = o.w / 2 + STAIR.gap + 0.03, z0 = o.hole - 0.03;
  // where the flight's rail (drawFlight) stands half a metre over this floor
  const zk = Math.min(o.len, Math.max(z0 + 0.4, (o.rise - 0.4 - riser) * o.len / (o.rise - riser)));
  const post = club ? '#1a161a' : trim, iron = fine || club ? '#1e1c1c' : trim, railC = fine ? '#5a3a24' : club ? '#2a2226' : '#6a4a30';
  const run = (x0, x1, za, zb, alongZ) => {
    pbox(x0 - 0.04, x0 + 0.04, 0, 1.0, za - 0.04, za + 0.04, post);
    if (alongZ) {
      pbox(x0 - 0.04, x0 + 0.04, 0, 1.0, zb - 0.04, zb + 0.04, post);
      pbox(x0 - 0.035, x0 + 0.035, 0.92, 0.98, za, zb, '#ffffff', 1, { t: fine ? 'roomOak' : 'roomBoards', c: railC });
      pbox(x0 - 0.02, x0 + 0.02, 0.05, 0.09, za, zb, iron);
      for (let z = za + 0.12; z < zb - 0.06; z += 0.13) pbox(x0 - 0.014, x0 + 0.014, 0.09, 0.92, z - 0.014, z + 0.014, iron, 0.95);
    } else {
      pbox(x1 - 0.04, x1 + 0.04, 0, 1.0, za - 0.04, za + 0.04, post);
      pbox(x0, x1, 0.92, 0.98, za - 0.035, za + 0.035, '#ffffff', 1, { t: fine ? 'roomOak' : 'roomBoards', c: railC });
      pbox(x0, x1, 0.05, 0.09, za - 0.02, za + 0.02, iron);
      for (let x = x0 + 0.12; x < x1 - 0.06; x += 0.13) pbox(x - 0.014, x + 0.014, 0.09, 0.92, za - 0.014, za + 0.014, iron, 0.95);
    }
  };
  const wallL = alongWall(F, -X, z0, o.len, hu, D), wallR = alongWall(F, X, z0, o.len, hu, D);
  if (!wallL) run(-X, 0, z0, zk, true);
  if (!wallR) run(X, 0, z0, zk, true);
  if (!alongWall(F, -X, z0, z0, hu, D, 0.15) || !alongWall(F, X, z0, z0, hu, D, 0.15)) run(-X, X, z0, z0, false);
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

// The worktop a flat's kitchen says it has (room-layout.js kitchenOf `top`), or its finish's own.
const KITCHEN_SLABS = { butcher: { t: 'roomButcher', c: '#ffffff' }, stone: STONE, marble: { t: 'roomMarble', c: '#f2eee6' }, terrazzo: { t: 'roomTerrazzo', c: '#ffffff' }, laminate: { t: 'roomLaminate', c: '#ffffff' } };
const KITCHEN_TOP_HEX = { butcher: '#b8875a', stone: '#8a8c8e', marble: '#ece6dc', terrazzo: '#d8d0c0', laminate: '#d8d4cc' };
export const kitchenSlab = (spec) => KITCHEN_SLABS[spec?.kitchen?.top] || null;

// THE KITCHEN of a studio (client/shared/room-layout.js studioPlan), built in whatever's been put in
// it: the L of counter (or an island) with a breakfast overhang on the lounge's side, units along the
// wall in every gap the appliances leave, a splashback, its own floor, and lights hung over the counter.
// `spec.kitchen` (room-layout.js kitchenOf) picks the modules: the units' make, fronts and worktop, wall
// cupboards or open shelves over the run, and what the counter shows the lounge.
function drawKitchen(K, { H, lampOn, lamps, seed }) {
  const L = K.L, fine = K.fine, P = L.spec.plan, KO = L.spec.kitchen || {}, hu = L.w / 2, [c0, c1, v0, v1] = P.counter, [rv0, rv1] = [P.run[2], P.run[3]], { box, quad, TB, C, lathe } = K;
  const r = rng(seed ^ 0x5bd1), rod = rodOf(K), T = COUNTER_H, front = fine ? '#3b3d41' : KO.front || pick(r, ['#d8d0c0', '#4a5a5a', '#8a6a4a', '#e8e4dc']);
  const top = kitchenSlab(L.spec) || (fine ? STONE : { t: 'roomButcher', c: '#ffffff' }), side = fine || KO.face === 'fluted' ? { t: 'roomOak', c: '#8a6a4a' } : null;
  const topSurf = fine || KO.top === 'marble' || KO.top === 'terrazzo' ? SATIN : MATTE, slab = kitchenSlab(L.spec);
  const grade = fine ? 3 : KO.grade;
  const unit = (u, v, fu, fv, w, d, o = {}) => baseRun({ F: K.frame(u, v, fu, fv), p: { w, d, h: T }, r, fine, rod, front, slab }, T, { ...(grade === undefined ? {} : { grade }), ...o });
  const depth = 0.66, runD = P.run[1] - P.run[0], over = c1 - c0 - depth, kv0 = P.kitchen[2];
  // its own floor, stopping at the counter
  {
    const key = fine ? 'roomStone' : 'roomTile', t = ROOM_TEXTURES[key], y = 0.004, ps = [[c0 + over, kv0, y], [hu, kv0, y], [hu, v1, y], [c0 + over, v1, y]];
    quad(TB(key), ps, [0, 1, 0], C(fine ? '#b0b2b2' : '#c8ccc4', 0.95), SATIN, ps.map((q) => [q[0] / t, q[1] / t]));
  }
  // the long side: units on the kitchen's side, a panel and the overhang on the lounge's, and the slab
  // running down the end to the floor (both ends on an island)
  // under the counter's own slab (the box below): its own worktop would sit in the slab's plane and flicker
  unit(c1 - depth / 2, (v0 + v1) / 2, 1, 0, v1 - v0, depth, { noTop: true });
  box(c0, c1, v0, v1, T - 0.04, T, '#a8a49c', 1, top, topSurf);
  counterFace(K, { c0, over, v0, v1, T, front, side, seed, face: KO.face });
  box(c0, c1, v1, v1 + 0.04, 0, T, '#a8a49c', 0.97, top, topSurf);
  if (P.island) box(c0, c1, v0 - 0.04, v0, 0, T, '#a8a49c', 0.97, top, topSurf);
  else {
    // the return to the wall, closing the front of the kitchen
    // back against the end panel, no gap and no upstand: there's no wall behind it
    unit((c1 + hu) / 2, v0 + runD / 2, 0, 1, hu - c1, runD, { noUpstand: true });
    box(c0, hu, v0 - 0.04, v0, 0, T, '#a8a49c', 0.97, top, topSurf);
  }
  // the units along the wall, in the gaps the appliances leave
  const taken = L.placed.filter((p) => p.wall === 'right' && !p.annex && p.v > rv0 - 0.5 && p.v < rv1 + 0.5 && !(p.arche === 'cabinet' || p.arche === 'screen')).map((p) => [p.v - p.w / 2, p.v + p.w / 2]).sort((a, b) => a[0] - b[0]);
  // from the end of the return's worktop: its front lip comes 2 cm past runD, and a unit begun under it laid a
  // second top in the same plane at the corner
  let s = P.island ? rv0 : Math.max(rv0, v0 + runD + 0.02);
  for (const [a, b] of [...taken, [rv1, rv1]]) {
    if (a - s > 0.03) unit(hu - runD / 2, (s + a) / 2, -1, 0, a - s, runD);
    s = Math.max(s, b);
  }
  // the splashback up the wall behind them
  const tall = L.placed.filter((p) => p.wall === 'right' && !p.annex && p.h > 1.2 && p.v > rv0).map((p) => p.v - p.w / 2);
  box(hu - 0.012, hu, rv0, Math.min(rv1, ...tall), T, T + 0.55, '#ffffff', 0.95, fine ? STONE : { t: 'roomTile', c: '#d8dcd8' }, fine ? SATIN : GLOSS);
  // what hangs over the run: wall cupboards or open shelves, in the gaps between what stands tall or hangs there
  if (KO.uppers) {
    const busy = L.placed.filter((p) => p.wall === 'right' && !p.annex && p.v > rv0 - 1 && p.v < rv1 + 1 && (p.h > 1.3 || p.arche === 'cabinet' || p.arche === 'screen'))
      .map((p) => [p.v - p.w / 2 - 0.04, p.v + p.w / 2 + 0.04]).sort((a, b) => a[0] - b[0]);
    let s2 = rv0 + 0.02;
    for (const [a, b] of [...busy, [rv1 - 0.02, rv1]]) {
      if (a - s2 > 0.35) (KO.uppers === 'shelves' ? openShelves : wallCupboards)(K, { hu, a: s2, b: a, H, front, seed: seed ^ Math.round(s2 * 97) });
      s2 = Math.max(s2, b);
    }
  }
  // the lights over the counter: industrial domes on long flexes, or opal globes on brass rods
  const n = Math.max(2, Math.min(4, Math.round((v1 - v0) / 1.6))), um = (c0 + c1) / 2, y = T + 1.0, globe = KO.pendants === 'globe' && !fine;
  for (let i = 0; i < n; i++) {
    const v = v0 + (i + 0.5) * (v1 - v0) / n, hang = globe ? '#b8924a' : fine ? '#17181b' : '#3a3a3a';
    lathe(um, v, [[0, H - 0.015], [0.04, H - 0.015], [0.045, H], [0, H]], hang, 1, 12, globe ? METAL : undefined);
    if (globe) {
      lathe(um, v, [[0.007, y + 0.3], [0.007, H - 0.015]], hang, 1.05, 6, METAL);
      lathe(um, v, [[0.03, y + 0.27], [0.032, y + 0.31], [0, y + 0.31]], hang, 1.05, 12, METAL);
      K.ball(um, v, y + 0.15, 0.13, lampOn ? '#fff4e0' : '#e8e2d6', lampOn ? 1.9 : 0.95, 18, lampOn ? LAMP : SATIN);
      continue;
    }
    lathe(um, v, [[0.004, y + 0.16], [0.004, H - 0.015]], hang, 0.9, 6);
    lathe(um, v, [[0.13, y], [0.11, y + 0.05], [0.04, y + 0.14], [0.02, y + 0.17], [0, y + 0.17]], fine ? '#1c1d20' : '#5a6a5a', 0.95, 16, fine ? METAL : GLOSS);
    lathe(um, v, [[0, y + 0.005], [0.12, y + 0.005]], lampOn ? '#fff0d0' : '#c8c4b8', lampOn ? 2 : 0.8, 14, lampOn ? LAMP : undefined);
  }
  if (!fine) lamps.push({ p: L.world(um, (v0 + v1) / 2, y), annex: false, k: 0.9 });
}

// The counter's side to the lounge, under its overhang (u from c0 to c0 + over): a plain panel, reeded
// oak, or open cubbies a module wide with books and pots in them.
function counterFace(K, { c0, over, v0, v1, T, front, side, seed, face }) {
  const { box } = K, back = c0 + over;
  if (face === 'fluted') {
    // reeds 4 cm apart, every other one standing a centimetre prouder, on a dark ground
    box(back - 0.03, back, v0, v1, 0.02, T - 0.04, '#2a1e16', 1, null, SATIN);
    const n = Math.max(4, Math.round((v1 - v0) / 0.04)), pw = (v1 - v0) / n;
    for (let i = 0; i < n; i++) box(back - 0.03 - (i % 2 ? 0.012 : 0.02), back - 0.03, v0 + i * pw + 0.003, v0 + (i + 1) * pw - 0.003, 0.06, T - 0.06, '#8a6a4a', i % 2 ? 0.9 : 1.05, side, SATIN);
    box(back - 0.06, back, v0, v1, 0.02, 0.06, '#141414', 1, null, SATIN);
    return;
  }
  if (face !== 'shelves') { box(back - 0.03, back, v0, v1, 0.02, T - 0.04, front, 0.9, side, SATIN); return; }
  // cubbies: a back, a floor, a middle shelf and a divider every module, the counter's own colour
  const r = rng(seed ^ 0x77c1), y0 = 0.02, y1 = T - 0.04, ym = (y0 + y1) / 2, a = c0 + 0.02, t = 0.018;
  box(back - 0.02, back, v0, v1, y0, y1, front, 0.75, null, SATIN);
  for (const y of [y0, ym - t / 2]) box(a, back, v0, v1, y, y + t, front, 0.95, null, SATIN);
  const n = Math.max(2, Math.round((v1 - v0) / 0.5)), mw = (v1 - v0) / n;
  for (let i = 0; i <= n; i++) { const v = v0 + i * mw; box(a, back, Math.max(v0, v - t / 2), Math.min(v1, v + t / 2), y0, y1, front, 0.95, null, SATIN); }
  const BOOKS = ['#7a1f1a', '#1f3346', '#2a4a2a', '#c8a46a', '#3a2a1e', '#d8cdb8', '#4a1e2e', '#1a1a1a'], POTS = ['#c46a2a', '#e8e2d6', '#2c4a72', '#6a7a5a', '#1a1a1c'];
  for (let i = 0; i < n; i++) for (const [fy, cy] of [[y0 + t, ym - t / 2], [ym + t / 2, y1]]) {
    const s0 = v0 + i * mw + t, s1 = v0 + (i + 1) * mw - t, k = r();
    if (k < 0.55) {
      // a row of books, leaning at the end if it doesn't fill the cubby
      let v = s0 + 0.01;
      while (v < s1 - 0.05 && r() > 0.06) {
        const bw = 0.022 + r() * 0.03, bh = Math.min(cy - fy - 0.01, 0.17 + r() * 0.12);
        box(a + 0.03 + r() * 0.02, back - 0.03, v, v + bw, fy, fy + bh, pick(r, BOOKS), 0.9 + r() * 0.15, null, SATIN);
        v += bw + 0.002;
      }
    } else if (k < 0.85) {
      // a pot or a jug, turned
      const cu = (a + back) / 2, cv = (s0 + s1) / 2, ph = Math.min(cy - fy - 0.02, 0.14 + r() * 0.12), pr = 0.05 + r() * 0.04;
      K.lathe(cu, cv, [[0, fy], [pr * 0.7, fy], [pr, fy + ph * 0.45], [pr * 0.6, fy + ph * 0.9], [pr * 0.65, fy + ph], [0, fy + ph - 0.01]], pick(r, POTS), 1, 18, GLOSS);
    }
  }
}

// WALL CUPBOARDS over a run, `a` to `b` along the right-hand wall: a carcass 34 cm deep, framed doors a
// module wide in the kitchen's front with a glazed panel, plates and glasses behind it, and a light under.
function wallCupboards(K, { hu, a, b, H, front, seed }) {
  const { box } = K, r = rng(seed), y0 = 1.5, y1 = Math.min(H - 0.12, 2.3), dd = 0.34, u0 = hu - dd, n = Math.max(1, Math.round((b - a) / 0.55)), mw = (b - a) / n, t = 0.018;
  // the carcass as a shell, dark inside: a back, a floor and a roof, the ends and a divider between doors
  box(hu - 0.03, hu - 0.012, a, b, y0, y1, '#2a2420', 1, null, MATTE);
  box(u0, hu - 0.012, a, b, y0, y0 + t, front, 0.9, null, SATIN);
  box(u0, hu - 0.012, a, b, y1 - t, y1, front, 0.9, null, SATIN);
  box(u0 - 0.006, hu - 0.012, a - 0.01, b + 0.01, y1, y1 + 0.03, front, 0.95, null, SATIN);
  for (let i = 0; i <= n; i++) { const v = a + i * mw; box(u0, hu - 0.012, Math.max(a, v - t / 2), Math.min(b, v + t / 2), y0, y1, front, 0.9, null, SATIN); }
  const ym = (y0 + y1) / 2;
  box(u0 + 0.02, hu - 0.03, a, b, ym - 0.009, ym + 0.009, front, 0.85, null, SATIN);
  // a strip light under them, onto the worktop
  box(u0 + 0.02, hu - 0.03, a + 0.02, b - 0.02, y0 - 0.012, y0, '#fff0d0', 1.4, null, GLOW);
  for (let i = 0; i < n; i++) {
    const p0 = a + i * mw + 0.006, p1 = p0 + mw - 0.012, s = 0.05, cv = (p0 + p1) / 2;
    // behind the glass: a stack of plates below the shelf, a few glasses on it
    for (let j = 0; j < 5; j++) K.lathe(u0 + 0.17, cv - 0.04, [[0, y0 + t + j * 0.018], [0.1, y0 + t + j * 0.018], [0.1, y0 + t + 0.012 + j * 0.018], [0, y0 + t + 0.012 + j * 0.018]], '#f4f0e8', 1.05, 16, GLOSS);
    const ng = 2 + Math.floor(r() * 2);
    for (let j = 0; j < ng; j++) K.lathe(u0 + 0.17, cv - 0.08 + j * 0.08, [[0, ym + 0.01], [0.028, ym + 0.01], [0.034, ym + 0.13], [0, ym + 0.13]], '#cfe0e4', 1.1, 10, GLOSS);
    // the door: a frame round a pane of glass, and a brass pull
    for (const [q0, q1, z0, z1] of [[p0, p0 + s, y0, y1], [p1 - s, p1, y0, y1], [p0, p1, y0, y0 + s], [p0, p1, y1 - s, y1]]) box(u0 - 0.02, u0, q0, q1, z0, z1, front, 1, null, SATIN);
    const gp = [[u0 - 0.01, p1 - s, y0 + s], [u0 - 0.01, p0 + s, y0 + s], [u0 - 0.01, p0 + s, y1 - s], [u0 - 0.01, p1 - s, y1 - s]];
    K.quad(K.glass, gp, K.nrmOf(-1, 0, 0), [0.8, 0.86, 0.9], GLOSS, null, true);
    const hv = i % 2 ? p0 + s / 2 : p1 - s / 2;
    box(u0 - 0.035, u0 - 0.02, hv - 0.006, hv + 0.006, y0 + 0.04, y0 + 0.16, '#b8a070', 1.05, null, METAL);
  }
}

// OPEN SHELVES over a run: two or three oak boards on black brackets, with the kitchen's things on them
// (stacked plates, jars with lids, bowls, a jug, a plant trailing over the edge).
function openShelves(K, { hu, a, b, H, seed }) {
  const { box } = K, r = rng(seed), sd = 0.26, u0 = hu - sd, ys = [1.5, 1.88, 2.26].filter((y) => y < H - 0.3);
  const JARS = ['#e8e2d6', '#c46a2a', '#2c4a72', '#6a7a5a', '#d8c08a'];
  for (const y of ys) {
    box(u0, hu - 0.004, a, b, y - 0.035, y, '#8a6a4a', 1, { t: 'roomOak', c: '#a07c52' }, SATIN);
    for (const v of [a + 0.15, b - 0.15]) box(hu - 0.2, hu - 0.004, v - 0.012, v + 0.012, y - 0.16, y - 0.035, '#141414', 1, null, METAL);
    let v = a + 0.06;
    while (v < b - 0.14) {
      const k = r(), cu = u0 + sd / 2;
      if (k < 0.3) { const np = 4 + Math.floor(r() * 4); for (let j = 0; j < np; j++) K.lathe(cu, v + 0.1, [[0, y + j * 0.016], [0.1, y + j * 0.016], [0.1, y + 0.012 + j * 0.016], [0, y + 0.012 + j * 0.016]], '#f4f0e8', 1.05, 16, GLOSS); v += 0.24; }
      else if (k < 0.65) { const jh = 0.12 + r() * 0.1, c = pick(r, JARS); K.lathe(cu, v + 0.05, [[0, y], [0.045, y], [0.045, y + jh], [0.03, y + jh + 0.01], [0, y + jh + 0.01]], c, 1, 14, GLOSS); K.lathe(cu, v + 0.05, [[0, y + jh + 0.01], [0.034, y + jh + 0.01], [0.034, y + jh + 0.03], [0, y + jh + 0.03]], '#8a6a4a', 1, 14, SATIN); v += 0.12; }
      else if (k < 0.82) { K.lathe(cu, v + 0.09, [[0, y], [0.05, y], [0.09, y + 0.07], [0, y + 0.06]], pick(r, JARS), 1, 18, GLOSS); v += 0.2; }
      else if (k < 0.92) {
        // a pothos in a pot, trailing a few leaves over the front
        K.lathe(cu, v + 0.07, [[0, y], [0.05, y], [0.065, y + 0.11], [0, y + 0.11]], '#c46a2a', 1, 14, MATTE);
        for (let j = 0; j < 9; j++) K.ball(cu - 0.06 - r() * 0.08, v + 0.02 + r() * 0.1, y + 0.11 - r() * 0.3, 0.03 + r() * 0.015, j % 2 ? '#3a6a30' : '#4e7a36', 1, 7, SATIN);
        v += 0.16;
      } else v += 0.1 + r() * 0.15;
    }
  }
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
  const pk = d0 - (d1 - d0) - 0.02;
  if (fine) {
    // the right jamb is the one the leaf shuts against; the left is the mouth of the pocket it slides into: two
    // black lips either side of the leaf's track (v -0.1..-0.06) with a dark slot between, so the leaf goes in
    // through a gap instead of through the frame
    const fb = '#141518';
    box(d1 - 0.02, d1 + 0.04, -T - 0.012, 0.012, 0, top + 0.04, fb, 0.97, null, SATIN);
    box(d0 - 0.04, d0 + 0.02, -T - 0.012, -0.106, 0, top + 0.04, fb, 0.97, null, SATIN);
    box(d0 - 0.04, d0 + 0.02, -0.054, 0.012, 0, top + 0.04, fb, 0.97, null, SATIN);
    box(d0 - 0.04, d0 - 0.03, -0.106, -0.054, 0, top + 0.04, '#050506', 1, null, MATTE);
    // the head: a black box over the opening and the pocket, with the track slot along its underside
    box(pk, d1 + 0.04, -T - 0.012, -0.106, top - 0.02, top + 0.06, fb, 0.97, null, SATIN);
    box(pk, d1 + 0.04, -0.054, 0.012, top - 0.02, top + 0.06, fb, 0.97, null, SATIN);
    box(pk, d1 + 0.04, -0.106, -0.054, top + 0.02, top + 0.06, '#050506', 1, null, MATTE);
    // a black threshold track the leaf rides in, the full run of the pocket
    box(pk, d1, -0.11, -0.05, 0, 0.008, fb, 1, null, METAL);
  } else {
    // ⚠ A PLAIN ROOM'S POCKET IS IN THE WALL, AND NOTHING OF IT SHOWS ON THE WALL'S FACE. It had the tower flat's
    // black head box run a door's width out over the plaster, where it cut through the accent band at the
    // door heads. Now the opening is lined through the wall in the room's trim, with an architrave round it like
    // the sash window's, and the leaf goes into the wall through a dark slot in the left-hand lining.
    const lin = (a, b, v0, v1, y0, y1) => box(a, b, v0, v1, y0, y1, trim, 0.95, null, SATIN);
    lin(d1 - 0.02, d1, -T, 0, 0, top);
    lin(d0, d0 + 0.02, -T, -0.106, 0, top);
    lin(d0, d0 + 0.02, -0.054, 0, 0, top);
    box(d0 - 0.01, d0, -0.106, -0.054, 0, top, '#0a0a0b', 1, null, MATTE);
    lin(d0, d1, -T, -0.106, top - 0.02, top);
    lin(d0, d1, -0.054, 0, top - 0.02, top);
    box(d0, d1, -0.106, -0.054, top - 0.004, top, '#0a0a0b', 1, null, MATTE);
    // the architrave on the room side, 1.8 cm proud, so it stands over the ends of the accent band and the skirting
    for (const [a, b, c, e] of [[d0 - 0.07, d0, 0, top + 0.07], [d1, d1 + 0.07, 0, top + 0.07], [d0 - 0.07, d1 + 0.07, top, top + 0.07]]) box(a, b, 0, 0.018, c, e, trim, 0.97, null, SATIN);
    // a brass track let into the threshold, the full run of the pocket
    box(d0, d1, -0.1, -0.06, 0.012, 0.016, '#a88a4a', 1.05, null, METAL);
  }
  // the door itself is an automatic glass slider (slideLeaves, way 'balcony'), moved by the Stage. The shutters
  // come down over its doorway too, on a pane of their own just inside the leaves: its uv runs from 300 at the
  // doorway's middle, and the shader opens it from the right as the one leaf slides left (uShutDoor), shutters down or not.
  // Only where the door is in a wall of glass: a door in a plain wall isn't the window, and its blinds are the window's
  const dm = (d0 + d1) / 2, dps = [[d0, -0.04, 0.004], [d1, -0.04, 0.004], [d1, -0.04, top], [d0, -0.04, top]];
  if ((L.spec.windows || []).some((q) => q.wall === 'front' && q.kind === 'curtain')) quad(K.glass, dps, nrmOf(0, 0, 1), [0.8, 0.86, 0.9], GLOSS, dps.map((q) => [300 + q[0] - dm, q[2]]), true);
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
  } else if (q.lights) {
    // a period window (flags.room.sash): its own frame, sashes, transom, head and drapes
    drawPeriodSash(K, q, F, { half, trim, fine, glass, accent: L.spec.tone?.accent });
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
    // Venetian blinds the room's panel runs (spec.blinds, plugins/envcontrol): only the headrail is a solid, in the
    // reveal under the head; the slats are drawn on the glass by the shutter shader (gl/room-shutters.js blindAt),
    // as they are on a glass wall, so they turn and come down without a rebuild
    if (L.spec.blinds) pbox(-half + fw, half - fw, y1 - fw - 0.05, y1 - fw, -0.03, -0.004, trim, 0.95, null, SATIN);
    if (!fine && !L.spec.blinds) {
      // the blind: a cassette at the head, the cloth down a quarter of the glass, a bar and a pull
      const bl = y1 - (y1 - y0) * 0.24;
      pbox(-half - 0.02, half + 0.02, y1 + 0.07, y1 + 0.15, -0.01, 0.07, trim, 0.95, null, SATIN);
      pbox(-half + 0.01, half - 0.01, bl, y1 + 0.07, 0.03, 0.036, '#e9e1cf', 0.95, { t: 'roomCanvas', c: '#efe6d2' }, CLOTH);
      pbox(-half, half, bl - 0.03, bl, 0.025, 0.045, trim, 0.9, null, SATIN);
      const [pu, pv] = P(0, 0, 0.04);
      K.lathe(pu, pv, [[0, bl - 0.25], [0.012, bl - 0.25], [0.012, bl - 0.21], [0.003, bl - 0.2], [0.003, bl - 0.03], [0, bl - 0.03]], trim, 0.9, 8);
    }
    if (!fine) {
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
  // y0 and y1, the glass's foot and head up the wall, are where the shutters run (gl/room-shutters.js).
  // Under a transom they run on the sashes only: blinds hang below the transom bar, and its light stays clear
  const sy1 = q.lights && q.transom ? y1 - q.transom - 0.035 : y1;
  return { p: L.world(p[0], p[1], p[2]), n: [wn[0] - w0[0], 0, wn[2] - w0[2]], a: [wa[0] - wb[0], 0, wa[2] - wb[2]], b: [0, y1 - y0, 0], k: Math.min(3, Math.max(1, half * 2 * (y1 - y0) / 2.4)), y0, y1: sy1 };
}

// A PERIOD SASH WINDOW (room-layout.js sashOf), in drawPane's frame for it: x along the wall, z out into the
// room, y up, the wall from z = -0.14 to 0 and the glass at -0.06. One-over-one sashes side by side between
// mullions, the upper sash outboard of the lower and its stiles run down past the meeting rail as horns; a
// fixed transom light over them in small panes; a deep window board on an apron, a wide moulded architrave
// and, with `head`, a frieze and cornice over it. Brass fitch catches and lifts, a radiator under it in a
// plain room, and with `drapes` a pair of curtains tied back on a pole. Venetian blinds (spec.blinds) hang
// under the transom bar; with no blinds and no drapes a roller blind does.
function drawPeriodSash(K, q, F, { half, trim, fine, glass, accent }) {
  const { P, N, pbox, alongX, alongY } = F, L = K.L, y0 = q.y0, y1 = q.y1, n = q.lights || 1;
  const brass = q.pole || accent || '#b8913e', fw = 0.06, fv = [-0.095, -0.025], ty = q.transom ? y1 - q.transom : y1;
  const tb = 0.035, sy1 = q.transom ? ty - tb : y1 - fw;
  const frame = (a, b, c, e, z0 = fv[0], z1 = fv[1]) => pbox(a, b, c, e, z0, z1, trim, 0.95, null, SATIN);
  glass(-0.06);
  // the box frame: jambs, head and the sill rail
  frame(-half, -half + fw, y0, y1); frame(half - fw, half, y0, y1);
  frame(-half, half, y1 - fw, y1); frame(-half, half, y0, y0 + 0.045);
  // the mullions between the lights, the full height; the transom bar across
  const mw = 0.045, xs = Array.from({ length: n + 1 }, (_, i) => -half + fw + (i * (2 * (half - fw))) / n);
  for (let i = 1; i < n; i++) frame(xs[i] - mw, xs[i] + mw, y0, y1);
  if (q.transom) frame(-half, half, ty - tb, ty + tb, fv[0], fv[1] + 0.004);
  // each light: the sashes, then the transom's small panes over them
  const sw = 0.045, up = [-0.094, -0.066], lo = [-0.055, -0.024];
  for (let i = 0; i < n; i++) {
    const l = xs[i] + (i ? mw : 0), r = xs[i + 1] - (i < n - 1 ? mw : 0), cx = (l + r) / 2, bot = y0 + 0.045, ym = (bot + sy1) / 2;
    const sash = (a, b, c, e, z) => pbox(a, b, c, e, z[0], z[1], trim, 0.97, null, SATIN);
    // the upper sash, outboard: stiles from the head down past the meeting rail as horns, a top rail and its meeting rail
    for (const [a, b] of [[l, l + sw], [r - sw, r]]) sash(a, b, ym - 0.07, sy1, up);
    sash(l, r, sy1 - sw, sy1, up);
    sash(l + sw, r - sw, ym, ym + 0.04, up);
    // the lower sash, inboard: stiles, its meeting rail, and a deeper bottom rail
    for (const [a, b] of [[l, l + sw], [r - sw, r]]) sash(a, b, bot, ym, lo);
    sash(l + sw, r - sw, ym - 0.04, ym, lo);
    sash(l + sw, r - sw, bot, bot + 0.075, lo);
    // a fitch catch on the meeting rails, and two lifts on the bottom rail
    pbox(cx - 0.035, cx + 0.035, ym - 0.012, ym + 0.006, lo[1], lo[1] + 0.018, brass, 1.05, null, METAL);
    for (const x of [l + 0.12, r - 0.12]) pbox(x - 0.018, x + 0.018, bot + 0.03, bot + 0.05, lo[1], lo[1] + 0.022, brass, 1.05, null, METAL);
    if (q.transom) {
      const m = Math.max(2, Math.round((r - l) / 0.24));
      for (let j = 1; j < m; j++) { const x = l + (j * (r - l)) / m; pbox(x - 0.009, x + 0.009, ty + tb, y1 - fw, -0.078, -0.05, trim, 0.97, null, SATIN); }
    }
  }
  // the window board, a moulded nosing, and the apron under it
  pbox(-half - 0.1, half + 0.1, y0 - 0.04, y0, -0.03, 0.17, trim, 1, null, SATIN);
  pbox(-half - 0.1, half + 0.1, y0 - 0.055, y0 - 0.04, 0.0, 0.155, trim, 0.9, null, SATIN);
  pbox(-half - 0.06, half + 0.06, y0 - 0.2, y0 - 0.055, -0.004, 0.022, trim, 0.94, null, SATIN);
  // the architrave: a wide flat with a raised back band round its outer edge
  const aw = 0.11, ab = 0.028;
  for (const [a, b, c, e] of [[-half - aw, -half, y0 - 0.04, y1 + aw], [half, half + aw, y0 - 0.04, y1 + aw], [-half - aw, half + aw, y1, y1 + aw]]) pbox(a, b, c, e, 0, 0.018, trim, 0.97, null, SATIN);
  for (const [a, b, c, e] of [[-half - aw, -half - aw + ab, y0 - 0.04, y1 + aw], [half + aw - ab, half + aw, y0 - 0.04, y1 + aw], [-half - aw, half + aw, y1 + aw - ab, y1 + aw]]) pbox(a, b, c, e, 0, 0.032, trim, 1, null, SATIN);
  // a frieze and a cornice over it
  if (q.head) {
    pbox(-half - aw, half + aw, y1 + aw, y1 + aw + 0.075, 0, 0.024, trim, 0.95, null, SATIN);
    pbox(-half - aw - 0.025, half + aw + 0.025, y1 + aw + 0.075, y1 + aw + 0.095, 0, 0.045, trim, 0.97, null, SATIN);
    pbox(-half - aw - 0.05, half + aw + 0.05, y1 + aw + 0.095, y1 + aw + 0.125, 0, 0.07, trim, 1.02, null, SATIN);
  }
  // Venetian blinds (spec.blinds, plugins/envcontrol): the headrail under the transom; the slats are the shutter shader's
  if (L.spec.blinds) pbox(-half + fw, half - fw, sy1 - 0.05, sy1, -0.022, -0.002, trim, 0.95, null, SATIN);
  else if (!q.drapes) {
    // a roller blind under the head, the cloth down a fifth of the sashes
    const bl = sy1 - (sy1 - y0) * 0.2;
    pbox(-half + fw, half - fw, sy1 - 0.07, sy1, -0.02, 0.03, trim, 0.95, null, SATIN);
    pbox(-half + fw + 0.01, half - fw - 0.01, bl, sy1 - 0.07, 0.0, 0.006, '#e9e1cf', 0.95, { t: 'roomCanvas', c: '#efe6d2' }, CLOTH);
    pbox(-half + fw, half - fw, bl - 0.03, bl, -0.004, 0.012, trim, 0.9, null, SATIN);
  }
  if (!fine) {
    // the radiator under the board: cast columns on two pipes, in the trim's gloss, sized to the sill
    const r0 = -half + 0.08, r1 = half - 0.08, cols = Math.round((r1 - r0) / 0.065), top = Math.min(0.74, y0 - 0.12);
    for (let i = 0; i < cols; i++) {
      const x = r0 + (i + 0.5) * (r1 - r0) / cols;
      K.rounded(...alongY(), 0.14, top, x - 0.024, x + 0.024, 0.05, 0.14, 0.02, trim, 0.9, GLOSS);
    }
    for (const y of [0.17, top - 0.03]) K.rounded(...alongX(), r0 - 0.04, r1 + 0.04, 0.08, 0.11, y - 0.015, y + 0.015, 0.012, trim, 0.85, GLOSS);
    for (const x of [r0 - 0.06, r1 + 0.06]) { const [u, v] = P(x, 0, 0.09); K.lathe(u, v, [[0.012, 0], [0.012, 0.16]], '#c9c4b8', 0.9, 8, METAL); }
  }
  if (q.drapes) drawDrapes(K, F, { half: half + aw * 0.5, y1: y1 + aw + (q.head ? 0.15 : 0.06), sill: y0, hex: q.drapes, brass });
}

// A PAIR OF DRAPES on a pole over a window, tied back either side: each a run of rounded pleats that hangs
// from the pole, is drawn in to a cord at the tie-back and falls out again to the floor. `half` is where
// the drapes' inner edges hang at the pole, `y1` the pole's height, in drawPeriodSash's frame.
function drawDrapes(K, F, { half, y1, sill, hex, brass }) {
  const { P, N, alongX } = F, col = K.C(hex, 0.92), dark = K.C(hex, 0.7);
  const W = 0.36, pleats = 6, yt = Math.max(0.85, sill + 0.35), segs = 8;
  // the pole on two brackets, with ball finials
  const pe = half + W + 0.06;
  K.rounded(...alongX(), -pe, pe, 0.09, 0.13, y1 - 0.018, y1 + 0.018, 0.016, brass, 1.05, METAL);
  for (const s of [-1, 1]) {
    const [u, v] = P(s * (pe + 0.03), 0, 0.11);
    K.ball(u, v, y1, 0.034, brass, 1.1, 12, METAL);
    drapeBox(F, s * (half + W - 0.04) - 0.015, s * (half + W - 0.04) + 0.015, y1 - 0.012, y1 + 0.012, 0, 0.11, brass);
  }
  // how wide a drape is up its fall: full under the pole, gathered at the tie-back, flared to the floor
  const width = (y) => (y >= yt ? 0.12 + (W - 0.12) * Math.min(1, (y - yt) / Math.max(0.3, (y1 - 0.05 - yt) * 0.55)) : 0.12 + (0.24 - 0.12) * Math.pow((yt - y) / yt, 0.8));
  const ys = [0.005, yt * 0.35, yt * 0.7, yt - 0.06, yt, yt + 0.06, yt + (y1 - yt) * 0.2, yt + (y1 - yt) * 0.4, yt + (y1 - yt) * 0.6, yt + (y1 - yt) * 0.8, y1 - 0.04];
  for (const s of [-1, 1]) {
    const xo = s * (half + W);   // the outer edge, which hangs straight
    for (let p = 0; p < pleats; p++) {
      const t = (p + 0.5) / pleats, zc = 0.085 + (p % 2 ? 0.014 : -0.008);
      const ring = (y) => { const w = width(y), r = (w / pleats) * 0.72; return { x: xo - s * t * w, r, z: zc, y }; };
      const rs = ys.map(ring);
      for (let i = 0; i + 1 < rs.length; i++) {
        const A = rs[i], B = rs[i + 1];
        for (let j = 0; j < segs; j++) {
          const a0 = (j / segs) * Math.PI * 2, a1 = ((j + 1) / segs) * Math.PI * 2, am = (a0 + a1) / 2;
          const pt = (R, a) => P(R.x + Math.cos(a) * R.r, R.y, R.z + Math.sin(a) * R.r * 0.8);
          K.quad(K.solid, [pt(A, a0), pt(A, a1), pt(B, a1), pt(B, a0)], N(Math.cos(am), 0, Math.sin(am)), Math.sin(am) < -0.3 ? dark : col, CLOTH);
        }
      }
    }
    // the tie-back: a band of the same cloth round the gathered drape, and its brass hook in the wall
    const xc = xo - s * 0.06;
    drapeBox(F, xc - 0.075, xc + 0.075, yt - 0.03, yt + 0.03, 0.05, 0.125, hex, 0.75, CLOTH);
    drapeBox(F, xo + s * 0.01 - 0.012, xo + s * 0.01 + 0.012, yt - 0.012, yt + 0.012, 0, 0.06, brass);
  }
}
const drapeBox = (F, x0, x1, y0, y1, z0, z1, hex, k = 1, surf = METAL) => F.pbox(x0, x1, y0, y1, z0, z1, hex, k, null, surf);

// THE EN-SUITE behind the back wall, a second room in the same frame. Its front wall is the far side
// of the flat's back wall, with the door in it standing open against the wall; fine ones are grey
// stone with a light in a slot, plain ones tiled to shoulder height with a bulkhead lamp. A high slot
// of frosted glass in the far wall lets the day in.
function buildAnnex(K, { H, D, T, DH, lampOn, lamps, doorShut }) {
  const { box, quad, TB, C, lathe } = K, L = K.L, A = L.annex, a = L.spec.annex, fine = a.finish === 'fine', spa = a.dress === 'spa';
  const u0 = A.u0, u1 = A.u1, v0 = A.v0, v1 = A.v0 + a.d;
  // a spa en-suite (`ensuite.dress`) is pale veined marble floor to ceiling
  const stone = spa ? { t: 'roomMarble', c: '#efe9df' } : { t: 'roomStone', c: '#d6d6d4' }, wall = fine || spa ? stone : { t: 'roomPlaster', c: '#d8d8d0' }, wallHex = '#ffffff';
  // the floor: stone or square tiles; a spa's is big slabs of a darker stone with fine joints
  {
    const key = fine || spa ? 'roomStone' : 'roomTile', t = ROOM_TEXTURES[key], ps = [[u0, v0, 0], [u1, v0, 0], [u1, v1, 0], [u0, v1, 0]];
    quad(TB(key), ps, [0, 1, 0], C(spa ? '#8a8682' : fine ? '#b0b2b2' : '#c8ccc4', 0.95), SATIN, ps.map((q) => [q[0] / t, q[1] / t]));
    if (spa) {
      const S = 0.9, j = 0.0025;
      for (let u = u0 + S; u < u1 - 0.1; u += S) box(u - j, u + j, v0, v1, 0, 0.0012, '#3a3632', 0.9, null, MATTE);
      for (let v = v0 + S; v < v1 - 0.1; v += S) box(u0, u1, v - j, v + j, 0, 0.0012, '#3a3632', 0.9, null, MATTE);
    }
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
  if (spa) spaDress(K, { u0, u1, v0, v1, H, d0, d1, lw, lampOn, doorShut });
  else if (fine) box(u0 + 0.2, u1 - 0.2, cv - 0.02, cv + 0.02, H - 0.004, H - 0.001, lampOn ? '#fff0d0' : '#c8c4b8', lampOn ? 2 : 0.8);
  else lathe(cu, cv, [[0.13, H - 0.09], [0.15, H - 0.06], [0.15, H - 0.01], [0, H - 0.01]], lampOn ? '#fff2d8' : '#c8c4b8', lampOn ? 1.6 : 0.8, 16, lampOn ? LAMP : undefined);
  // a spa's light is the cove's, which in a tall room (the penthouse's five metres) is a long way up: brought
  // down to where a lamp would be, and stronger as the room is taller
  lamps.push({ p: L.world(cu, cv, spa ? Math.min(H - 0.35, 2.6) : H - 0.35), annex: true, k: spa ? 1.3 * Math.max(1, H / 2.9) : 1.1 });
}
// A SPA EN-SUITE's own dressing, past the marble: a shadow gap at the foot of each wall, a soffit round the
// ceiling with a line of warm light along its inner edge, and a brass ladder rail warming a towel on the wall
// beside the door, on the side the leaf doesn't swing to, if no piece stands there.
function spaDress(K, { u0, u1, v0, v1, H, d0, d1, lw, lampOn, doorShut }) {
  const { box } = K, L = K.L, rod = rodOf(K), dark = '#141312', plaster = '#f4f0e8';
  // the shadow gap: a dark line a few centimetres high, just proud of each wall
  for (const [a, b, c, e] of [[u0, u0 + 0.004, v0, v1], [u1 - 0.004, u1, v0, v1], [u0, u1, v1 - 0.004, v1], [u0, d0, v0 + 0.012, v0 + 0.016], [d1, u1, v0 + 0.012, v0 + 0.016]]) box(a, b, c, e, 0, 0.035, dark, 1, null, MATTE);
  // the soffit, 18 cm wide and 12 deep, and the light along its inner edge
  const s = 0.18, y = H - 0.12, glow = lampOn ? '#ffe2b4' : '#b8b0a2', gk = lampOn ? 1.9 : 0.8;
  for (const [a, b, c, e] of [[u0, u1, v0 + 0.012, v0 + s], [u0, u1, v1 - s, v1], [u0, u0 + s, v0 + s, v1 - s], [u1 - s, u1, v0 + s, v1 - s]]) box(a, b, c, e, y, H, plaster, 1, null, SATIN);
  for (const [a, b, c, e] of [[u0 + s, u1 - s, v0 + s - 0.012, v0 + s], [u0 + s, u1 - s, v1 - s, v1 - s + 0.012], [u0 + s - 0.012, u0 + s, v0 + s, v1 - s], [u1 - s, u1 - s + 0.012, v0 + s, v1 - s]]) box(a, b, c, e, y - 0.006, y + 0.004, glow, gk);
  // the towel rail: the wider stretch of the front wall that isn't behind the open leaf
  const left = [u0 + 0.12, d0 - 0.12], right = [doorShut ? d1 + 0.12 : d1 + lw + 0.12, u1 - 0.12];
  const span = left[1] - left[0] >= right[1] - right[0] ? left : right, w = Math.min(0.55, span[1] - span[0]);
  if (w < 0.4) return;
  const cu = (span[0] + span[1]) / 2, ra = cu - w / 2, rb = cu + w / 2, z = v0 + 0.012 + 0.06;
  // nothing in the way: no piece of the en-suite standing within reach of it
  if (L.placed.some((p) => p.annex && Math.abs(p.u - cu) < w / 2 + Math.max(p.w, p.d) / 2 && p.v - Math.max(p.w, p.d) / 2 < v0 + 0.5)) return;
  const brass = '#b8913e', at = (u, yy, zz = z) => [u, zz, yy];
  for (const u of [ra, rb]) { rod(at(u, 0.55), at(u, 1.45), 0.013, brass, 1.08, METAL, 8); rod(at(u, 0.6, v0 + 0.012), at(u, 0.6), 0.008, brass, 1.08, METAL, 6); rod(at(u, 1.4, v0 + 0.012), at(u, 1.4), 0.008, brass, 1.08, METAL, 6); }
  for (let i = 0; i < 7; i++) { const yy = 0.62 + i * 0.13; rod(at(ra, yy), at(rb, yy), 0.008, brass, 1.08, METAL, 6); }
  // a bath towel folded over the top bars, hanging down the front
  const towel = { t: 'roomWeave', c: '#efe9de' }, tw = w * 0.42;
  box(cu - tw, cu + tw, z - 0.02, z + 0.025, 1.36, 1.42, '#ffffff', 0.98, towel, CLOTH);
  box(cu - tw, cu + tw, z + 0.02, z + 0.035, 0.98, 1.42, '#ffffff', 0.97, towel, CLOTH);
  box(cu - tw, cu + tw, z - 0.035, z - 0.02, 1.12, 1.42, '#ffffff', 0.95, towel, CLOTH);
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

// A CACHET'S KEYPAD (client/shared/room-layout.js cachetPad), drawn where its station is so a player can see
// what to click. It's dressed as the bar's own: smoked glass in a brass hairline, its twelve keys a dim warm grid
// like a lighting panel's, so a guest sees a bar with a control on it and nothing that says what's behind. On a
// false wall it's a plate on the wing; on a bar with no wing, a little pad standing on the worktop's end. Either way
// it's at the left end to somebody facing the bar.
function drawCachetPad(K, p) {
  const [fu, fv] = facing(p.turn), F = K.frame(p.u, p.v, fu, fv), { pbox } = F, pad = cachetPad(p);
  const w = 0.085, h = 0.12, x0 = pad.x - w / 2, x1 = pad.x + w / 2, y0 = pad.y - h / 2, y1 = pad.y + h / 2;
  let z = pad.z;
  if (!pad.wall) {
    // a brass foot on the worktop, and the pad's body standing on it
    pbox(x0 - 0.01, x1 + 0.01, 0.96, 0.972, z - 0.04, z + 0.02, '#b08a4a', 1.15, null, METAL);
    pbox(x0, x1, 0.972, y1, z - 0.03, z - 0.006, '#1c1a18', 1, null, SATIN);
  }
  // the brass hairline, then the smoked glass in it
  pbox(x0 - 0.006, x1 + 0.006, y0 - 0.006, y1 + 0.006, z - 0.006, z + 0.002, '#b08a4a', 1.15, null, METAL);
  pbox(x0, x1, y0, y1, z + 0.002, z + 0.006, '#141416', 1, null, GLOSS);
  // its keys: a grid of three by four, lit dim amber from behind, and a status lamp over them
  const kw = 0.016, kh = 0.014, gx = (w - 0.02) / 3, gy = (h - 0.035) / 4;
  for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) {
    const cx = x0 + 0.01 + gx * (c + 0.5), cy = y0 + 0.01 + gy * (r + 0.5);
    pbox(cx - kw / 2, cx + kw / 2, cy - kh / 2, cy + kh / 2, z + 0.006, z + 0.008, '#e8b070', 1.35, null, MATTE);
  }
  pbox(pad.x - 0.006, pad.x + 0.006, y1 - 0.016, y1 - 0.008, z + 0.006, z + 0.009, '#ffcf8a', 1.7, null, MATTE);
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
  // the seed's picks are always made, so a piece's own `fabric` or `wood` (rowLook) doesn't move the ones after them
  const own = (c, x) => c || x;
  const fab = { t: 'roomWeave', c: own(p.fabric, pick(r, fine ? FABRIC_FINE : FABRIC)) }, wood = { t: fine ? 'roomOak' : 'roomWood', c: own(p.wood, pick(r, fine ? WOOD_FINE : WOOD)) }, enamel = pick(r, fine ? ENAMEL_FINE : ENAMEL), plastic = pick(r, PLASTIC);
  const steel = { t: 'roomSteel', c: '#c8ccd0' };
  const lat = (x, z, prof, mat, k = 1, n = 14, surf = E()) => { const [u, v] = P(x, 0, z); K.lathe(u, v, prof, mat, k, n, surf); };
  const R = (...a) => K.rounded(...a);
  // a stain or a patch on a worn piece: a darker square on a face, a little proud of it
  const stain = (x, y, z, s) => { if (wear > 0.45 && r() < wear) pbox(x - s, x + s, y - s * 0.7, y + s * 0.7, z, z + 0.003, '#2a2018', 0.55 + r() * 0.2, null, MATTE); };
  // a hotel's forms (gl/room-decor.js), then the ones room-fittings.js owns, on the same helpers
  // a flat's control panel (plugins/envcontrol) lays out as a hung cabinet and is drawn as itself
  if (p.dress === 'envctl' && drawEnvPanel(K, F, p)) return;
  if (drawDecorForm(K, F, p)) return;
  // a stadium's: a box office, a card machine, the Cup's case, a seat door, the restrooms, the window onto the ice
  if (drawStadiumForm(K, F, p) || drawRinkWindow(K, F, p)) return;
  // what stands in a studio's kitchen takes its fronts and worktop from the kitchen (spec.kitchen)
  const kit = !p.annex && K.L.spec.kitchen ? { front: K.L.spec.kitchen.front, slab: kitchenSlab(K.L.spec) } : null;
  if (drawFitting({ K, F, p, r, L: K.L, ...(kit?.front ? { front: kit.front } : {}), ...(kit?.slab ? { slab: kit.slab } : {}), coldInside: (...a) => coldInside(K, F, p, ...a), coldShell: (o) => coldShell(F, R, o), coldDoor: (...a) => coldDoor(K, F, p, ...a), COLD_WALL, wear, fine, fab, wood, enamel, plastic, steel, tired, stain, lat, rod, R, pick: (list) => pick(r, list) })) return;
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
      // hollow: the cold rooms inside it go back to the cabinet's back wall (coldShell, coldInside)
      const zf = hd - 0.035, wl = COLD_WALL, ix0 = -hw + 0.01 + wl, ix1 = hw - 0.01 - wl, iy0 = 0.06 + wl, iy1 = h - wl, zb = -hd + wl;
      coldShell(F, R, { hw, hd, h, zf, c: tex || body, k: metal ? 1 : 0.96, surf });
      pbox(-hw + 0.03, hw - 0.03, 0, 0.06, -hd + 0.04, hd - 0.08, '#141414', 0.9);
      if (metal) {
        // two cold rooms side by side behind the doors: the freezer on the left, the fridge on the right, a wall between
        pbox(-0.012, 0.012, iy0, iy1, zb, zf, '#e8ecee', 1.1, null, MATTE);
        coldInside(K, F, p, ix0, -0.012, iy0, iy1, zf, true, zb);
        coldInside(K, F, p, 0.012, ix1, iy0, iy1, zf, false, zb);
        K.mark?.('swing', { side: -1 });
        coldDoor(K, F, p, -hw + 0.01, -0.006, 0.07, h - 0.02, zf, true);
        R(...alongY(), 0.07, h - 0.02, -hw + 0.01, -0.006, zf, zf + 0.035, 0.012, steel, 1.02, METAL);
        rod(P(-0.04, h * 0.35, zf + 0.06), P(-0.04, h * 0.8, zf + 0.06), 0.012, '#e0e4e8', 1.1); for (const y of [h * 0.35, h * 0.8]) rod(P(-0.04, y, zf + 0.035), P(-0.04, y, zf + 0.06), 0.008, '#e0e4e8', 1.1);
        K.mark?.('swing', { side: 1 });
        coldDoor(K, F, p, 0.006, hw - 0.01, 0.07, h - 0.02, zf, false);
        R(...alongY(), 0.07, h - 0.02, 0.006, hw - 0.01, zf, zf + 0.035, 0.012, steel, 1.02, METAL);
        rod(P(0.04, h * 0.35, zf + 0.06), P(0.04, h * 0.8, zf + 0.06), 0.012, '#e0e4e8', 1.1); for (const y of [h * 0.35, h * 0.8]) rod(P(0.04, y, zf + 0.035), P(0.04, y, zf + 0.06), 0.008, '#e0e4e8', 1.1);
        K.mark?.('body');
        pbox(-0.006, 0.006, 0.07, h - 0.02, zf, zf + 0.03, SEAM, 0.9);
      } else {
        const split = h * 0.7;
        // the fridge under the freezer, a shelf of cabinet between them
        pbox(ix0, ix1, split - 0.02, split + 0.02, zb, zf, body, 0.96, null, GLOSS);
        coldInside(K, F, p, ix0, ix1, iy0, split - 0.02, zf, false, zb);
        coldInside(K, F, p, ix0, ix1, split + 0.02, iy1, zf, true, zb);
        pbox(-hw + 0.01, hw - 0.01, split - 0.008, split + 0.008, zf, zf + 0.03, SEAM, 0.9); // the gasket showing between the doors
        // both doors hang on the right, the handles on the left; the freezer's first, then the fridge's with its notes
        const hx = -hw + 0.07, handle = (y0, y1) => { rod(P(hx, y0, zf + 0.06), P(hx, y1, zf + 0.06), 0.011, '#d8dce0', 1.1); for (const y of [y0, y1]) rod(P(hx, y, zf + 0.035), P(hx, y, zf + 0.06), 0.008, '#d8dce0', 1.1); };
        K.mark?.('swing', { side: 1 });
        coldDoor(K, F, p, -hw + 0.01, hw - 0.01, split + 0.008, h - 0.015, zf, true);
        R(...alongY(), split + 0.008, h - 0.015, -hw + 0.01, hw - 0.01, zf, zf + 0.035, 0.014, body, 0.98, GLOSS);
        handle(split + 0.06, split + 0.24);
        K.mark?.('swing', { side: 1 });
        coldDoor(K, F, p, -hw + 0.01, hw - 0.01, 0.07, split - 0.008, zf, false);
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
      if (K.mark) {
        // its lid lifting (swingParts): a frosted well down into the body, packed as full as its level (chestInside)
        const wt = 0.05, yb = 0.2, top = h - 0.07;
        R(...alongX(), -hw, hw, -hd, hd, 0.06, yb, 0.04, enamel, 0.96, GLOSS);
        R(...alongX(), -hw, hw, -hd, -hd + wt, yb - 0.01, top, 0.02, enamel, 0.96, GLOSS);
        R(...alongX(), -hw, hw, hd - wt, hd, yb - 0.01, top, 0.02, enamel, 0.96, GLOSS);
        R(...alongZ(), -hd + wt, hd - wt, -hw, -hw + wt, yb - 0.01, top, 0.02, enamel, 0.96, GLOSS);
        R(...alongZ(), -hd + wt, hd - wt, hw - wt, hw, yb - 0.01, top, 0.02, enamel, 0.96, GLOSS);
        chestInside(K, F, p, -hw + wt, hw - wt, yb, top, -hd + wt, hd - wt);
      } else {
        R(...alongX(), -hw, hw, -hd, hd, 0.06, h - 0.07, 0.04, enamel, 0.96, GLOSS);
        // the frosted well under the lid, and the baskets across it
        pbox(-hw + 0.05, hw - 0.05, h - 0.075, h - 0.07, -hd + 0.05, hd - 0.05, '#e6f0f6', 1.3, null, MATTE);
        for (const x of [-hw * 0.5, hw * 0.5]) pbox(x - 0.012, x + 0.012, h - 0.072, h - 0.071, -hd + 0.06, hd - 0.06, '#b8c4cc', 1, null, METAL);
      }
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
  } else if (key === 'roomTerrazzo') {
    // terrazzo, ground and polished: a warm cream binder full of marble chips, black, rust, ochre, grey and
    // white, a few of them big, and the faint cloud a floor gets from being mopped in the same arcs for years
    g.fillStyle = '#e4d9c6'; g.fillRect(0, 0, N, N);
    specks(26000, 1.6, ['#d6cab4', '#efe7d8', '#cfc2aa'], 0.5);
    specks(5200, 4, ['#2a2622', '#8a3e2c', '#c49a52', '#86847e', '#f6f1e8', '#5a6452'], 0.85);
    specks(700, 9, ['#2a2622', '#a8503a', '#d2ae6a', '#9a978f', '#faf6ee'], 0.9);
    for (let i = 0; i < 12; i++) blot(r() * N, r() * N, 70 + r() * 140, `rgba(${r() < 0.5 ? '170,156,132' : '246,240,228'},0.16)`);
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
  } else if (key === 'roomBrick') {
    // running bond, eight courses a repeat: each brick its own shade and wear, a raked mortar joint, a chip off a corner
    // here and there, soot darker toward the foot of the repeat. The colour is the material's tint (clad 'brick')
    g.fillStyle = '#c8c4bc'; g.fillRect(0, 0, N, N);
    const rows = 8, bh = N / rows, bw = N / 2.5, j = 5;
    for (let rI = 0; rI < rows; rI++) {
      const off = rI % 2 ? bw / 2 : 0, y = rI * bh;
      for (let x = -bw + off; x < N + bw; x += bw) {
        const k = 0.78 + r() * 0.3, warm = r() * 0.08;
        g.fillStyle = `rgb(${Math.round(255 * Math.min(1, k + warm))},${Math.round(236 * k)},${Math.round(226 * k)})`;
        for (const ox of [0, -N, N]) g.fillRect(x + ox + j / 2, y + j / 2, bw - j, bh - j);
        // a chip, and the face's own grain
        if (r() < 0.18) { g.fillStyle = '#c8c4bc'; g.beginPath(); const cx = x + (r() < 0.5 ? j : bw - j), cy = y + (r() < 0.5 ? j : bh - j); g.arc(cx, cy, 3 + r() * 6, 0, Math.PI * 2); g.fill(); }
      }
    }
    specks(9000, 2, ['#5a5048', '#ffffff', '#3a3430'], 0.12);
    const soot = g.createLinearGradient(0, 0, 0, N); soot.addColorStop(0, 'rgba(0,0,0,0)'); soot.addColorStop(1, 'rgba(20,16,12,0.12)');
    g.fillStyle = soot; g.fillRect(0, 0, N, N);
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
      // a balcony leaf is framed in black, to match its jambs and head; in a plain room, in the room's painted trim
      const bar = (u0, u1, y0, y1, hex = o.timber || (o.balcony ? '#16171a' : AL), k = o.timber ? 0.95 : 1.1) => onWall(K, L, o.wall, u0, u1, d0, d1, y0, y1, hex, k, null, o.balcony ? SATIN : METAL);
      // a balcony door's leaf is clear glass in a slim frame (the props layer is opaque, so the glass is left
      // out and the view shows through). It had two rows of etched white dots at eye height; David had them taken off
      if (o.timber) {
        // a timber leaf: broader stiles, a deep bottom rail, a lock rail at hand height and a brass flush pull
        // in the leading stile, the edge you'd hook a finger in to slide it
        bar(a0, a0 + 0.075, 0.004, DH); bar(a1 - 0.075, a1, 0.004, DH);
        bar(a0, a1, 0.004, 0.2); bar(a0, a1, DH - 0.08, DH); bar(a0, a1, 0.98, 1.04);
        onWall(K, L, o.wall, a1 - 0.055, a1 - 0.025, d1, d1 + 0.006, 0.92, 1.12, '#b8924a', 1.15, null, METAL);
      } else {
        bar(a0, a0 + 0.055, 0.004, DH); bar(a1 - 0.055, a1, 0.004, DH);
        bar(a0, a1, 0.004, 0.12); bar(a0, a1, DH - 0.06, DH);
      }
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
